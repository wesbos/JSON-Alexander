type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

let maxDepth = 0;

function buildPath(
  parentPath: string,
  key: string | number,
  isArrayElement: boolean
): string {
  if (isArrayElement) return `${parentPath}[${key}]`;
  if (typeof key === "string" && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
    return `${parentPath}.${key}`;
  }
  return `${parentPath}["${key}"]`;
}

function countEntries(value: JsonValue): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function typeOf(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStringValue(str: string): string {
  if (/^https?:\/\/[^\s]+$/.test(str)) {
    return `<a class="jv-link" rel="noopener noreferrer" href="` + escapeHtml(str) + `">` + escapeHtml(str) + "</a>"
  }
  return escapeHtml(str)
}

function renderValue(value: JsonValue): string {
  const type = typeOf(value);
  switch (type) {
    case "string":
      return `<span class="jv-string">"${renderStringValue(value as string)}"</span>`;
    case "number":
      return `<span class="jv-number">${value}</span>`;
    case "boolean":
      return `<span class="jv-bool">${value}</span>`;
    case "null":
      return `<span class="jv-null">null</span>`;
    default:
      return "";
  }
}

function renderNode(
  key: string | number | null,
  value: JsonValue,
  path: string,
  depth: number,
  isLast: boolean,
  isArrayElement: boolean
): HTMLDivElement {
  const line = document.createElement("div");
  line.className = "jv-line";
  line.dataset.path = path;
  line.dataset.depth = String(depth);

  if (depth > maxDepth) maxDepth = depth;

  const type = typeOf(value);
  const isContainer = type === "object" || type === "array";
  const comma = isLast ? "" : ",";

  if (isContainer) {
    const count = countEntries(value);
    const openBracket = type === "array" ? "[" : "{";
    const closeBracket = type === "array" ? "]" : "}";
    const label =
      count === 0
        ? ""
        : type === "array"
          ? `${count} item${count !== 1 ? "s" : ""}`
          : `${count} key${count !== 1 ? "s" : ""}`;

    const keyHtml =
      key !== null
        ? `<span class="jv-key">${isArrayElement ? key : `"${escapeHtml(String(key))}"`}</span><span class="jv-punctuation">: </span>`
        : "";

    const hasNestedContainers = Array.isArray(value)
      ? value.some((v) => v !== null && typeof v === "object")
      : Object.values(value as Record<string, JsonValue>).some((v) => v !== null && typeof v === "object");

    const childrenActionHtml = hasNestedContainers
      ? `<button class="jv-action-children" title="Expand/collapse all children">⇕ children</button>`
      : "";
    const actionsHtml = `<span class="jv-inline-actions">${childrenActionHtml}<button class="jv-action-copy-node" title="Copy node value">⧉ copy</button></span>`;

    const countHtml = label ? `<span class="jv-count"> ${label}</span>` : "";
    line.innerHTML = `<span class="jv-toggle">▶</span>${keyHtml}<span class="jv-bracket">${openBracket}</span>${countHtml}<span class="jv-preview"> ${label} ${closeBracket}</span>${actionsHtml}`;

    const children = document.createElement("div");
    children.className = "jv-children";

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const childPath = buildPath(path, i, true);
        children.appendChild(
          renderNode(i, item, childPath, depth + 1, i === value.length - 1, true)
        );
      });
    } else if (value !== null && typeof value === "object") {
      const keys = Object.keys(value);
      keys.forEach((k, i) => {
        const childPath = buildPath(path, k, false);
        children.appendChild(
          renderNode(
            k,
            (value as Record<string, JsonValue>)[k],
            childPath,
            depth + 1,
            i === keys.length - 1,
            false
          )
        );
      });
    }

    line.appendChild(children);

    const close = document.createElement("span");
    close.className = "jv-bracket jv-close";
    close.textContent = closeBracket + comma;
    line.appendChild(close);
  } else {
    const keyHtml =
      key !== null
        ? `<span class="jv-key">${isArrayElement ? key : `"${escapeHtml(String(key))}"`}</span><span class="jv-punctuation">: </span>`
        : "";

    line.innerHTML = `<span class="jv-indent-spacer"></span>${keyHtml}${renderValue(value)}<span class="jv-punctuation">${comma}</span>`;
  }

  return line;
}

export function renderTree(
  container: HTMLElement,
  data: JsonValue
): { maxDepth: number; totalKeys: number } {
  maxDepth = 0;
  container.innerHTML = "";
  const isArray = Array.isArray(data);
  const root = renderNode(null, data, "data", 0, true, false);
  container.appendChild(root);

  const totalKeys = container.querySelectorAll(".jv-line").length;
  return { maxDepth, totalKeys };
}

export function collapseToLevel(
  container: HTMLElement,
  targetLevel: number
): void {
  container.querySelectorAll<HTMLElement>(".jv-line").forEach((line) => {
    const depth = parseInt(line.dataset.depth || "0", 10);
    const children = line.querySelector<HTMLElement>(".jv-children");
    if (!children) return;
    const shouldCollapse = depth >= targetLevel;
    children.classList.toggle("jv-collapsed", shouldCollapse);
    line.classList.toggle("jv-collapsed", shouldCollapse);
  });
}

export function expandAll(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(".jv-children").forEach((el) => {
    el.classList.remove("jv-collapsed");
  });
  container.querySelectorAll<HTMLElement>(".jv-line").forEach((el) => {
    el.classList.remove("jv-collapsed");
  });
}

export function toggleNode(line: HTMLElement): void {
  const children = line.querySelector<HTMLElement>(":scope > .jv-children");
  if (!children) return;
  const isCollapsed = children.classList.toggle("jv-collapsed");
  line.classList.toggle("jv-collapsed", isCollapsed);
}

export function toggleAllChildren(line: HTMLElement): void {
  const children = line.querySelector<HTMLElement>(":scope > .jv-children");
  if (!children) return;
  // Determine target state: if any descendant is collapsed, expand all; otherwise collapse all
  const collapsedDescendants = children.querySelectorAll<HTMLElement>(".jv-children.jv-collapsed");
  const allDescendantContainers = children.querySelectorAll<HTMLElement>(".jv-children");
  const shouldExpand = collapsedDescendants.length > 0;

  allDescendantContainers.forEach((el) => {
    el.classList.toggle("jv-collapsed", !shouldExpand);
  });
  children.querySelectorAll<HTMLElement>(".jv-line").forEach((el) => {
    if (el.querySelector(":scope > .jv-children")) {
      el.classList.toggle("jv-collapsed", !shouldExpand);
    }
  });
  // Also make sure this node itself is expanded so children are visible
  children.classList.remove("jv-collapsed");
  line.classList.remove("jv-collapsed");
}


// ── Content Search ──

interface SearchState {
  matches: HTMLElement[];
  currentIndex: number;
}

const searchState: SearchState = { matches: [], currentIndex: -1 };

function getSearchableText(line: HTMLElement): string {
  const parts: string[] = [];
  const key = line.querySelector<HTMLElement>(":scope > .jv-key");
  if (key) parts.push(key.textContent || "");
  const value = line.querySelector<HTMLElement>(
    ":scope > .jv-string, :scope > .jv-number, :scope > .jv-bool, :scope > .jv-null"
  );
  if (value) parts.push(value.textContent || "");
  return parts.join(" ");
}

function expandAncestors(line: HTMLElement): void {
  let el: HTMLElement | null = line.parentElement;
  while (el) {
    if (el.classList.contains("jv-children") && el.classList.contains("jv-collapsed")) {
      el.classList.remove("jv-collapsed");
      const parentLine = el.closest<HTMLElement>(".jv-line");
      if (parentLine) parentLine.classList.remove("jv-collapsed");
    }
    el = el.parentElement;
  }
}

export function searchContent(
  container: HTMLElement,
  query: string
): { total: number; current: number } {
  // Clear previous highlights
  container.querySelectorAll<HTMLElement>(".jv-search-match, .jv-search-current").forEach((el) => {
    el.classList.remove("jv-search-match", "jv-search-current");
  });
  searchState.matches = [];
  searchState.currentIndex = -1;

  if (!query.trim()) return { total: 0, current: 0 };

  const lowerQuery = query.toLowerCase();
  const lines = container.querySelectorAll<HTMLElement>(".jv-line");

  lines.forEach((line) => {
    const text = getSearchableText(line);
    if (text.toLowerCase().includes(lowerQuery)) {
      line.classList.add("jv-search-match");
      searchState.matches.push(line);
    }
  });

  if (searchState.matches.length > 0) {
    searchState.currentIndex = 0;
    goToCurrentMatch();
  }

  return { total: searchState.matches.length, current: searchState.matches.length > 0 ? 1 : 0 };
}

function goToCurrentMatch(): void {
  searchState.matches.forEach((m) => m.classList.remove("jv-search-current"));
  if (searchState.currentIndex < 0 || searchState.currentIndex >= searchState.matches.length) return;
  const match = searchState.matches[searchState.currentIndex];
  match.classList.add("jv-search-current");
  expandAncestors(match);
  match.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function searchNext(): { total: number; current: number } {
  if (searchState.matches.length === 0) return { total: 0, current: 0 };
  searchState.currentIndex = (searchState.currentIndex + 1) % searchState.matches.length;
  goToCurrentMatch();
  return { total: searchState.matches.length, current: searchState.currentIndex + 1 };
}

export function searchPrev(): { total: number; current: number } {
  if (searchState.matches.length === 0) return { total: 0, current: 0 };
  searchState.currentIndex = (searchState.currentIndex - 1 + searchState.matches.length) % searchState.matches.length;
  goToCurrentMatch();
  return { total: searchState.matches.length, current: searchState.currentIndex + 1 };
}

export function clearSearch(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(".jv-search-match, .jv-search-current").forEach((el) => {
    el.classList.remove("jv-search-match", "jv-search-current");
  });
  searchState.matches = [];
  searchState.currentIndex = -1;
}

export function setupHoverPath(
  tree: HTMLElement,
  pathText: HTMLElement,
  pathDisplay: HTMLElement,
  pathCopyBtn: HTMLElement
): void {
  let pinned = false;

  function clearHighlights() {
    tree.querySelectorAll<HTMLElement>(".jv-current, .jv-ancestor").forEach((el) => {
      el.classList.remove("jv-current", "jv-ancestor");
    });
  }

  function highlightLine(line: HTMLElement) {
    clearHighlights();
    line.classList.add("jv-current");
    let el = line.parentElement;
    while (el) {
      const parentLine = el.closest<HTMLElement>(".jv-line");
      if (parentLine && parentLine !== line) {
        parentLine.classList.add("jv-ancestor");
        el = parentLine.parentElement;
      } else {
        break;
      }
    }
  }

  function showPath(path: string, isPinned: boolean) {
    pathText.textContent = path;
    pathDisplay.classList.add("jv-visible");
    pathDisplay.classList.toggle("jv-pinned", isPinned);
  }

  function clearPath() {
    pathText.textContent = "";
    pathDisplay.classList.remove("jv-visible", "jv-pinned");
  }

  tree.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement;
    const line = target.closest<HTMLElement>(".jv-line");
    if (!line) return;

    highlightLine(line);

    if (pinned) return;
    const path = line.dataset.path;
    if (!path) return;
    showPath(path, false);
  });

  tree.addEventListener("mouseout", (e) => {
    const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
    if (related && tree.contains(related)) return;
    clearHighlights();
    if (pinned) return;
    clearPath();
  });

  // Click a line to pin the path
  tree.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("jv-toggle") ||
      target.classList.contains("jv-preview") ||
      target.closest(".jv-inline-actions")
    ) return;

    const line = target.closest<HTMLElement>(".jv-line");
    if (!line) return;
    const path = line.dataset.path;
    if (!path) return;

    pinned = true;
    showPath(path, true);
  });

  // Copy button
  pathCopyBtn.addEventListener("click", () => {
    const text = pathText.textContent;
    if (text) {
      navigator.clipboard.writeText(text);
      const orig = pathCopyBtn.textContent;
      pathCopyBtn.textContent = "Copied!";
      setTimeout(() => {
        pathCopyBtn.textContent = orig;
        pinned = false;
        clearPath();
      }, 1000);
    }
  });

  // Escape to unpin
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pinned) {
      pinned = false;
      clearPath();
    }
  });
}
