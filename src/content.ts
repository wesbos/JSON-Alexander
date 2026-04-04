import {
  renderTree,
  collapseToLevel,
  expandAll,
  toggleNode,
  toggleAllChildren,
  setupHoverPath,
} from "./viewer";
import viewerCss from "./styles/viewer.css?inline";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function detectJSON(): { data: JsonValue; raw: string } | null {
  const pre = document.querySelector("body > pre");
  const isPlainBody =
    document.body.children.length === 1 && pre instanceof HTMLPreElement;
  const hasJSONContentType = (document.contentType || "").includes("json");

  if (!isPlainBody && !hasJSONContentType) return null;

  const raw = (pre ? pre.textContent : document.body.textContent || "")!.trim();
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== "object") return null;
    return { data, raw };
  } catch {
    return null;
  }
}

async function storageGet(key: string, defaultValue: string): Promise<string> {
  try {
    const result = await chrome.storage.local.get({ [key]: defaultValue });
    return result[key];
  } catch {
    return defaultValue;
  }
}

async function storageSet(key: string, value: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    // Storage unavailable — ignore silently
  }
}

async function getTheme(): Promise<string> {
  return storageGet("jv-theme", "auto");
}

async function setTheme(theme: string): Promise<void> {
  await storageSet("jv-theme", theme);
  const root = document.getElementById("jv-root");
  if (root) root.dataset.theme = theme;
}

async function cycleTheme(): Promise<void> {
  const current = await getTheme();
  const next =
    current === "auto" ? "dark" : current === "dark" ? "light" : "auto";
  await setTheme(next);
  await updateThemeButton();
}

async function updateThemeButton(): Promise<void> {
  const btn = document.getElementById("jv-theme-toggle");
  if (!btn) return;
  const theme = await getTheme();
  const icons: Record<string, string> = { auto: "◐", dark: "☾", light: "☀" };
  btn.textContent = icons[theme];
}

async function init(): Promise<void> {
  const result = detectJSON();
  if (!result) return;

  const { data, raw } = result;
  const prettyRaw = JSON.stringify(data, null, 2);

  // Inject styles into the existing <head> — no need to nuke or recreate it.
  // Using an inline <style> tag (CSS bundled via ?inline Vite import) means
  // the stylesheet is always available regardless of CSP, sandbox restrictions,
  // or extension resource fetch policies.
  const style = document.createElement("style");
  style.id = "jv-styles";
  style.textContent = viewerCss;
  if (!document.getElementById("jv-styles")) {
    document.head.appendChild(style);
  }

  // Clear only the body — preserve <head> and all its existing nodes.
  document.body.innerHTML = "";
  document.body.style.margin = "0";

  // Build viewer root
  const root = document.createElement("div");
  root.id = "jv-root";
  root.dataset.theme = await getTheme();

  root.innerHTML = `
    <div id="jv-toolbar">
      <span id="jv-info"></span>
      <span id="jv-path-display"><span id="jv-path-text"></span><button id="jv-path-copy" title="Copy path">Copy</button></span>
      <div id="jv-levels"></div>
      <div id="jv-view-picker">
        <button class="jv-view-btn jv-active" data-view="tree">Tree</button>
        <button class="jv-view-btn" data-view="formatted">Formatted</button>
        <button class="jv-view-btn" data-view="raw">Raw</button>
      </div>
      <button id="jv-theme-toggle" title="Toggle theme"></button>
      <button id="jv-copy">Copy JSON</button>
      <div id="jv-settings">
        <button id="jv-settings-toggle" title="Settings">⚙</button>
        <div id="jv-settings-menu">
          <label><input type="checkbox" id="jv-cursor-toggle"> Custom cursor</label>
        </div>
      </div>
    </div>
    <div id="jv-content">
      <pre id="jv-tree"></pre>
      <pre id="jv-formatted"></pre>
      <pre id="jv-raw"></pre>
    </div>
  `;

  document.body.appendChild(root);

  // Custom cursor (off by default)
  const cursorUrl = chrome.runtime.getURL("pointer-32.png");
  function applyCustomCursor(enabled: boolean) {
    if (enabled) {
      root.style.setProperty("--cursor-custom", `url(${cursorUrl}), default`);
    } else {
      root.style.setProperty("--cursor-custom", "default");
    }
  }
  applyCustomCursor((await storageGet("jv-custom-cursor", "false")) === "true");

  const tree = document.getElementById("jv-tree")!;
  const formattedEl = document.getElementById("jv-formatted")!;
  const rawEl = document.getElementById("jv-raw")!;
  const pathDisplay = document.getElementById("jv-path-display")!;
  const pathText = document.getElementById("jv-path-text")!;
  const pathCopyBtn = document.getElementById("jv-path-copy")!;
  const info = document.getElementById("jv-info")!;
  const levelsContainer = document.getElementById("jv-levels")!;

  const { maxDepth, totalKeys } = renderTree(tree, data);
  info.textContent = `${totalKeys} nodes · ${maxDepth} level${maxDepth !== 1 ? "s" : ""} deep`;

  formattedEl.textContent = prettyRaw;
  rawEl.textContent = raw;

  const levelCount = Math.min(maxDepth, 8);
  for (let i = 1; i <= levelCount; i++) {
    const btn = document.createElement("button");
    btn.dataset.level = String(i);
    btn.textContent = String(i);
    btn.addEventListener("click", () => {
      collapseToLevel(tree, i);
      setActiveLevel(btn);
    });
    levelsContainer.appendChild(btn);
  }

  const allBtn = document.createElement("button");
  allBtn.textContent = "All";
  allBtn.dataset.action = "expand-all";
  allBtn.addEventListener("click", () => {
    expandAll(tree);
    setActiveLevel(allBtn);
  });
  levelsContainer.appendChild(allBtn);

  setActiveLevel(allBtn);

  function setActiveLevel(active: HTMLElement) {
    levelsContainer
      .querySelectorAll("button")
      .forEach((b) => b.classList.remove("jv-active"));
    active.classList.add("jv-active");
  }

  tree.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("jv-toggle") ||
      target.classList.contains("jv-preview")
    ) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (line) {
        toggleNode(line);
        levelsContainer
          .querySelectorAll("button")
          .forEach((b) => b.classList.remove("jv-active"));
      }
    }
    if (target.classList.contains("jv-action-children")) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (line) toggleAllChildren(line);
    }
  });

  const viewBtns = document.querySelectorAll<HTMLElement>(".jv-view-btn");
  const views: Record<string, HTMLElement> = {
    tree,
    formatted: formattedEl,
    raw: rawEl,
  };

  function setView(name: string) {
    viewBtns.forEach((b) =>
      b.classList.toggle("jv-active", b.dataset.view === name),
    );
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle("jv-active", key === name);
      el.classList.toggle("jv-hidden", key !== name);
    });
  }

  viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view!));
  });

  document.getElementById("jv-copy")!.addEventListener("click", () => {
    navigator.clipboard.writeText(prettyRaw).then(() => {
      const btn = document.getElementById("jv-copy")!;
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = orig;
      }, 1000);
    });
  });

  await updateThemeButton();
  document
    .getElementById("jv-theme-toggle")!
    .addEventListener("click", cycleTheme);

  const settingsToggle = document.getElementById("jv-settings-toggle")!;
  const settingsMenu = document.getElementById("jv-settings-menu")!;
  settingsToggle.addEventListener("click", () => {
    settingsMenu.classList.toggle("jv-open");
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("#jv-settings")) {
      settingsMenu.classList.remove("jv-open");
    }
  });

  const cursorCheckbox = document.getElementById(
    "jv-cursor-toggle",
  ) as HTMLInputElement;
  cursorCheckbox.checked =
    (await storageGet("jv-custom-cursor", "false")) === "true";
  cursorCheckbox.addEventListener("change", async () => {
    await storageSet("jv-custom-cursor", String(cursorCheckbox.checked));
    applyCustomCursor(cursorCheckbox.checked);
  });

  setupHoverPath(tree, pathText, pathDisplay, pathCopyBtn);

  // Inject data into page context.
  injectPageData(raw);
}

function injectPageData(raw: string): void {
  // CSP `sandbox` without `allow-same-origin` sets window.origin to the string
  // "null". Injecting a <script> into such a page logs a CSP violation, so bail
  // out early. This covers the common case (e.g. GitHub raw files).
  if (window.origin === "null") {
    return;
  }

  // Inject the raw JSON data into the page context via a <script> tag with type="application/json".
  const dataHolder = document.createElement("script");
  dataHolder.type = "application/json";
  dataHolder.id = "jv-json-data";
  dataHolder.textContent = raw;
  document.documentElement.appendChild(dataHolder);

  // Inject the page script that reads the JSON from the DOM and assigns it to window.data.
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-script.js");
  document.documentElement.appendChild(script);
}

init();
