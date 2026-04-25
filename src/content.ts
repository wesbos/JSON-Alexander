import {
  renderTree,
  collapseToLevel,
  expandAll,
  toggleNode,
  toggleAllChildren,
  setupHoverPath,
} from "./viewer";
import { toJsonSchema } from "./schema";
import "./styles/viewer.css";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function parsePath(path: string): string[] {
  const segments: string[] = [];
  const matcher = /([^[.\]]+)|\[(\d+|"(?:[^"\\]|\\.)*")\]/g;
  let match: RegExpExecArray | null = matcher.exec(path);

  while (match) {
    const dotToken = match[1];
    const bracketToken = match[2];

    if (dotToken) {
      segments.push(dotToken);
    } else if (bracketToken) {
      if (bracketToken.startsWith('"')) {
        try {
          segments.push(JSON.parse(bracketToken) as string);
        } catch {
          return [];
        }
      } else {
        segments.push(bracketToken);
      }
    }

    match = matcher.exec(path);
  }

  if (segments[0] === "data") return segments.slice(1);
  return segments;
}

function getValueAtPath(source: JsonValue, path: string): JsonValue | undefined {
  const segments = parsePath(path);
  if (!segments.length && path !== "data") return;

  let current: JsonValue | undefined = source;

  for (const segment of segments) {
    if (current === null || typeof current !== "object") return;

    let next: JsonValue | undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return;
      next = current[Number(segment)];
    } else {
      next = current[segment];
    }

    if (next === undefined) return;
    current = next;
  }

  return current;
}

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
  const result = await chrome.storage.local.get({ [key]: defaultValue });
  return result[key] as string;
}

async function storageSet(key: string, value: string): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
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
  const next = current === "auto" ? "dark" : current === "dark" ? "light" : "auto";
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

  // Nuke existing page content
  document.documentElement.innerHTML = "";
  const head = document.createElement("head");
  const body = document.createElement("body");
  document.documentElement.appendChild(head);
  document.documentElement.appendChild(body);

  // Build viewer DOM
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
        <button class="jv-view-btn" data-view="schema">Schema</button>
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
      <pre id="jv-schema"></pre>
    </div>
  `;

  body.appendChild(root);

  // Custom cursor (off by default)
  const cursorUrl = chrome.runtime.getURL("pointer-32.png");
  function applyCustomCursor(enabled: boolean) {
    if (enabled) {
      root.style.setProperty("--cursor-custom", `url(${cursorUrl}), default`);
    } else {
      root.style.setProperty("--cursor-custom", "default");
    }
  }
  applyCustomCursor(await storageGet("jv-custom-cursor", "false") === "true");

  // Re-inject styles (we nuked the head)
  const style = document.createElement("style");
  style.textContent = (document.querySelector('style[data-vite-dev-id]') || {} as any).textContent || '';
  // For production, the CSS is loaded via manifest. We need to re-add the link.
  // Vite injects CSS as a <style> tag in dev, but for extension we load via manifest.
  // Since we nuked the HTML, re-request the CSS from the extension.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("content.css");
  head.appendChild(link);

  const tree = document.getElementById("jv-tree")!;
  const formattedEl = document.getElementById("jv-formatted")!;
  const rawEl = document.getElementById("jv-raw")!;
  const schemaEl = document.getElementById("jv-schema")!;
  const pathDisplay = document.getElementById("jv-path-display")!;
  const pathText = document.getElementById("jv-path-text")!;
  const pathCopyBtn = document.getElementById("jv-path-copy")!;
  const info = document.getElementById("jv-info")!;
  const levelsContainer = document.getElementById("jv-levels")!;

  // Render tree
  const { maxDepth, totalKeys } = renderTree(tree, data);
  info.textContent = `${totalKeys} nodes · ${maxDepth} level${maxDepth !== 1 ? "s" : ""} deep`;

  // Formatted and raw views
  formattedEl.textContent = prettyRaw;
  rawEl.textContent = raw;

  // Level buttons
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

  // Set "All" as initially active
  setActiveLevel(allBtn);

  function setActiveLevel(active: HTMLElement) {
    levelsContainer.querySelectorAll("button").forEach((b) =>
      b.classList.remove("jv-active")
    );
    active.classList.add("jv-active");
  }

  // Toggle expand/collapse on click
  tree.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("jv-toggle") || target.classList.contains("jv-preview")) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (line) {
        toggleNode(line);
        levelsContainer.querySelectorAll("button").forEach((b) =>
          b.classList.remove("jv-active")
        );
      }
    }
    // Inline action: expand/collapse all children
    if (target.classList.contains("jv-action-children")) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (line) toggleAllChildren(line);
    }
    // Inline action: copy selected node value
    if (target.classList.contains("jv-action-copy-node")) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (!line) return;
      const path = line.dataset.path;
      if (!path) return;

      const selectedValue = getValueAtPath(data, path);
      if (selectedValue === undefined) return;

      navigator.clipboard.writeText(JSON.stringify(selectedValue, null, 2));
      const originalLabel = target.textContent;
      target.textContent = "copied!";
      setTimeout(() => {
        target.textContent = originalLabel;
      }, 1000);
    }
  });

  // View picker
  const viewBtns = document.querySelectorAll<HTMLElement>(".jv-view-btn");
  const views: Record<string, HTMLElement> = { tree, formatted: formattedEl, raw: rawEl, schema: schemaEl };
  let schemaGenerated = false;

  const copyBtn = document.getElementById("jv-copy")!;

  function setView(name: string) {
    if (name === "schema" && !schemaGenerated) {
      schemaEl.textContent = toJsonSchema(data);
      schemaGenerated = true;
    }
    copyBtn.textContent = name === "schema" ? "Copy JSON Schema" : "Copy JSON";
    viewBtns.forEach((b) => b.classList.toggle("jv-active", b.dataset.view === name));
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle("jv-active", key === name);
      el.classList.toggle("jv-hidden", key !== name);
    });
  }

  viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view!));
  });

  // Copy
  copyBtn.addEventListener("click", () => {
    const isSchema = copyBtn.textContent === "Copy JSON Schema";
    const text = isSchema ? schemaEl.textContent! : prettyRaw;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = orig; }, 1000);
    });
  });

  // Theme toggle
  await updateThemeButton();
  document.getElementById("jv-theme-toggle")!.addEventListener("click", cycleTheme);

  // Settings menu
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

  // Custom cursor toggle
  const cursorCheckbox = document.getElementById("jv-cursor-toggle") as HTMLInputElement;
  cursorCheckbox.checked = await storageGet("jv-custom-cursor", "false") === "true";
  cursorCheckbox.addEventListener("change", async () => {
    await storageSet("jv-custom-cursor", String(cursorCheckbox.checked));
    applyCustomCursor(cursorCheckbox.checked);
  });

  // Hover path
  setupHoverPath(tree, pathText, pathDisplay, pathCopyBtn);

  // Inject data into page context
  injectPageData(raw);
}

function injectPageData(raw: string): void {
  try {
    const holder = document.createElement("script");
    holder.type = "application/json";
    holder.id = "jv-json-data";
    holder.textContent = raw;
    document.documentElement.appendChild(holder);

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-script.js");
    document.documentElement.appendChild(script);
  } catch {
    // Sandboxed frames block script injection — window.data won't be available
  }
}

init();
