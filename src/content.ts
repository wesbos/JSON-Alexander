import { buildTreeModel, type JsonValue } from "./tree-model";
import { createTreeView, setupHoverPath } from "./viewer";
import {
  createBestAvailableTreeSearchIndex,
  createLocalTreeSearchIndex,
} from "./tree-worker-client";
import "./styles/viewer.css";

const LARGE_TREE_NODE_THRESHOLD = 8000;
const LARGE_TREE_INITIAL_EXPANSION_DEPTH = 2;

function detectJSON(): { data: JsonValue; raw: string } | null {
  const pre = document.querySelector("body > pre");
  const isPlainBody =
    document.body.children.length === 1 && pre instanceof HTMLPreElement;
  const hasJSONContentType = (document.contentType || "").includes("json");

  if (!isPlainBody && !hasJSONContentType) return null;

  const raw = (pre ? pre.textContent : document.body.textContent || "")!.trim();
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as JsonValue;
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
  let prettyRaw: string | null = null;

  function getPrettyRaw(): string {
    if (prettyRaw === null) {
      prettyRaw = JSON.stringify(data, null, 2);
    }
    return prettyRaw;
  }

  document.documentElement.innerHTML = "";
  const head = document.createElement("head");
  const body = document.createElement("body");
  document.documentElement.appendChild(head);
  document.documentElement.appendChild(body);

  const root = document.createElement("div");
  root.id = "jv-root";
  root.dataset.theme = await getTheme();

  root.innerHTML = `
    <div id="jv-toolbar">
      <span id="jv-info"></span>
      <span id="jv-path-display"><span id="jv-path-text"></span><button id="jv-path-copy" title="Copy path">Copy</button></span>
      <div id="jv-levels"></div>
      <button id="jv-search-toggle" title="Search (⌘F)">⌕</button>
      <div id="jv-view-picker">
        <button class="jv-view-btn jv-active" data-view="tree">Tree</button>
        <button class="jv-view-btn" data-view="formatted">Formatted</button>
        <button class="jv-view-btn" data-view="raw">Raw</button>
      </div>
      <span id="jv-render-status"></span>
      <button id="jv-theme-toggle" title="Toggle theme"></button>
      <button id="jv-copy">Copy JSON</button>
      <div id="jv-settings">
        <button id="jv-settings-toggle" title="Settings">⚙</button>
        <div id="jv-settings-menu">
          <label><input type="checkbox" id="jv-cursor-toggle"> Custom cursor</label>
        </div>
      </div>
    </div>
    <div id="jv-search-panel" hidden>
      <input id="jv-search-input" type="search" placeholder="Search keys, values, paths" spellcheck="false">
      <span id="jv-search-status"></span>
      <button id="jv-search-prev" title="Previous result (Shift+Enter)">↑</button>
      <button id="jv-search-next" title="Next result (Enter)">↓</button>
      <button id="jv-search-clear" title="Close (Esc)">×</button>
    </div>
    <div id="jv-content">
      <div id="jv-tree"></div>
      <pre id="jv-formatted"></pre>
      <pre id="jv-raw"></pre>
    </div>
  `;

  body.appendChild(root);

  const cursorUrl = chrome.runtime.getURL("pointer-32.png");
  function applyCustomCursor(enabled: boolean) {
    if (enabled) {
      root.style.setProperty("--cursor-custom", `url(${cursorUrl}), default`);
      root.dataset.customCursor = "true";
    } else {
      root.style.removeProperty("--cursor-custom");
      delete root.dataset.customCursor;
    }
  }
  applyCustomCursor(await storageGet("jv-custom-cursor", "false") === "true");

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("content.css");
  head.appendChild(link);

  const tree = document.getElementById("jv-tree")!;
  const formattedEl = document.getElementById("jv-formatted")!;
  const rawEl = document.getElementById("jv-raw")!;
  const pathDisplay = document.getElementById("jv-path-display")!;
  const pathText = document.getElementById("jv-path-text")!;
  const pathCopyBtn = document.getElementById("jv-path-copy")!;
  const searchInput = document.getElementById("jv-search-input") as HTMLInputElement;
  const searchStatus = document.getElementById("jv-search-status")!;
  const searchPrevBtn = document.getElementById("jv-search-prev") as HTMLButtonElement;
  const searchNextBtn = document.getElementById("jv-search-next") as HTMLButtonElement;
  const searchClearBtn = document.getElementById("jv-search-clear") as HTMLButtonElement;
  const info = document.getElementById("jv-info")!;
  const levelsContainer = document.getElementById("jv-levels")!;
  const renderStatus = document.getElementById("jv-render-status")!;
  const content = document.getElementById("jv-content")!;
  const viewBtns = document.querySelectorAll<HTMLElement>(".jv-view-btn");
  const views: Record<string, HTMLElement> = { tree, formatted: formattedEl, raw: rawEl };
  const loadedViews = new Set<string>(["tree"]);
  let currentView = "tree";
  let searchTimer: number | null = null;

  renderStatus.textContent = "Indexing JSON...";
  const model = buildTreeModel(data);
  const initialExpansionDepth =
    model.totalNodes > LARGE_TREE_NODE_THRESHOLD
      ? LARGE_TREE_INITIAL_EXPANSION_DEPTH
      : null;
  const searchIndex =
    typeof Worker === "function"
      ? createBestAvailableTreeSearchIndex(model)
      : createLocalTreeSearchIndex(model);
  const treeView = createTreeView(tree, model, {
    initialExpansionDepth,
    scrollContainer: content,
    searchIndex,
    onRenderStateChange(message) {
      renderStatus.textContent = message;
    },
  });

  const { maxDepth, totalNodes } = treeView.getStats();
  info.textContent = `${totalNodes} nodes · ${maxDepth} level${maxDepth !== 1 ? "s" : ""} deep`;
  await treeView.render();

  const levelCount = Math.min(maxDepth, 8);
  for (let i = 1; i <= levelCount; i++) {
    const btn = document.createElement("button");
    btn.dataset.level = String(i);
    btn.textContent = String(i);
    btn.addEventListener("click", () => {
      void treeView.collapseToLevel(i);
      setActiveLevel(btn);
    });
    levelsContainer.appendChild(btn);
  }

  const allBtn = document.createElement("button");
  allBtn.textContent = "All";
  allBtn.dataset.action = "expand-all";
  allBtn.addEventListener("click", () => {
    void treeView.expandAll();
    setActiveLevel(allBtn);
  });
  levelsContainer.appendChild(allBtn);
  if (initialExpansionDepth !== null) {
    const initialLevelButton = levelsContainer.querySelector<HTMLElement>(
      `button[data-level="${initialExpansionDepth}"]`
    );
    if (initialLevelButton) {
      setActiveLevel(initialLevelButton);
      renderStatus.textContent = `Large JSON: showing ${initialExpansionDepth} levels first. Search covers the full document.`;
    } else {
      setActiveLevel(allBtn);
    }
  } else {
    setActiveLevel(allBtn);
  }

  function setActiveLevel(active: HTMLElement) {
    levelsContainer.querySelectorAll("button").forEach((b) =>
      b.classList.remove("jv-active")
    );
    active.classList.add("jv-active");
  }

  tree.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("jv-toggle") || target.classList.contains("jv-preview")) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (line) {
        void treeView.toggleNode(Number(line.dataset.nodeId));
        levelsContainer.querySelectorAll("button").forEach((b) =>
          b.classList.remove("jv-active")
        );
      }
    }

    if (target.classList.contains("jv-action-children")) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (line) {
        void treeView.toggleAllChildren(Number(line.dataset.nodeId));
      }
    }

    if (target.classList.contains("jv-action-copy-node")) {
      const line = target.closest<HTMLElement>(".jv-line");
      if (!line) return;

      const selectedValue = treeView.getNodeValue(Number(line.dataset.nodeId));
      navigator.clipboard.writeText(JSON.stringify(selectedValue, null, 2));

      const originalLabel = target.textContent;
      target.textContent = "copied!";
      setTimeout(() => {
        target.textContent = originalLabel;
      }, 1000);
    }
  });

  function ensureViewContent(name: string) {
    if (loadedViews.has(name)) return;

    if (name === "formatted") {
      formattedEl.textContent = getPrettyRaw();
    } else if (name === "raw") {
      rawEl.textContent = raw;
    }

    loadedViews.add(name);
  }

  function setView(name: string) {
    currentView = name;
    ensureViewContent(name);
    viewBtns.forEach((btn) => btn.classList.toggle("jv-active", btn.dataset.view === name));
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle("jv-active", key === name);
      el.classList.toggle("jv-hidden", key !== name);
    });
  }

  viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view!));
  });

  document.getElementById("jv-copy")!.addEventListener("click", () => {
    navigator.clipboard.writeText(getPrettyRaw()).then(() => {
      const btn = document.getElementById("jv-copy")!;
      const originalText = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1000);
    });
  });

  function updateSearchUi() {
    const state = treeView.getSearchState();

    if (!state.query) {
      searchStatus.textContent = "";
    } else if (state.matchCount === 0) {
      searchStatus.textContent = "0 results";
    } else {
      searchStatus.textContent = `${state.activeIndex + 1} of ${state.matchCount}`;
    }

    const hasResults = state.matchCount > 0;
    searchPrevBtn.disabled = !hasResults;
    searchNextBtn.disabled = !hasResults;
    searchClearBtn.disabled = !state.query;
  }

  async function runSearch(query: string) {
    searchTimer = null;
    await treeView.search(query);
    updateSearchUi();
  }

  async function commitSearch(query: string) {
    if (searchTimer !== null) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    await runSearch(query);
  }

  searchInput.addEventListener("input", () => {
    if (searchTimer !== null) {
      window.clearTimeout(searchTimer);
    }
    searchTimer = window.setTimeout(() => {
      void runSearch(searchInput.value);
    }, 180);
  });

  const searchPanel = document.getElementById("jv-search-panel")!;
  const searchToggleBtn = document.getElementById("jv-search-toggle")!;

  function openSearchPanel(): void {
    searchPanel.hidden = false;
    searchInput.focus();
    searchInput.select();
  }

  function closeSearchPanel(): void {
    searchPanel.hidden = true;
    if (searchTimer !== null) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (searchInput.value || treeView.getSearchState().query) {
      searchInput.value = "";
      void treeView.clearSearch().then(updateSearchUi);
    }
  }

  searchToggleBtn.addEventListener("click", () => {
    if (searchPanel.hidden) openSearchPanel();
    else closeSearchPanel();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const currentQuery = treeView.getSearchState().query;
      if (searchInput.value !== currentQuery) {
        void commitSearch(searchInput.value);
      } else {
        void treeView.stepSearch(e.shiftKey ? -1 : 1).then(updateSearchUi);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel();
    }
  });

  searchInput.addEventListener("search", () => {
    void commitSearch(searchInput.value);
  });

  searchPrevBtn.addEventListener("click", () => {
    void treeView.stepSearch(-1).then(updateSearchUi);
  });

  searchNextBtn.addEventListener("click", () => {
    void treeView.stepSearch(1).then(updateSearchUi);
  });

  searchClearBtn.addEventListener("click", () => {
    closeSearchPanel();
  });

  document.addEventListener("keydown", (e) => {
    const isFindShortcut =
      (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";
    if (isFindShortcut && currentView === "tree") {
      e.preventDefault();
      openSearchPanel();
      return;
    }
    if (e.key === "Escape" && !searchPanel.hidden) {
      e.preventDefault();
      closeSearchPanel();
    }
  });

  updateSearchUi();

  await updateThemeButton();
  document.getElementById("jv-theme-toggle")!.addEventListener("click", cycleTheme);

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

  const cursorCheckbox = document.getElementById("jv-cursor-toggle") as HTMLInputElement;
  cursorCheckbox.checked = await storageGet("jv-custom-cursor", "false") === "true";
  cursorCheckbox.addEventListener("change", async () => {
    await storageSet("jv-custom-cursor", String(cursorCheckbox.checked));
    applyCustomCursor(cursorCheckbox.checked);
  });

  setupHoverPath(tree, treeView, pathText, pathDisplay, pathCopyBtn);
  window.addEventListener("pagehide", () => {
    searchIndex.dispose();
  });

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
