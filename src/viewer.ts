import {
  type JsonNode,
  type JsonValue,
  type TreeModel,
  isContainerNode,
} from "./tree-model";
import {
  createLocalTreeSearchIndex,
  type TreeSearchIndex,
} from "./tree-worker-client";

const VIRTUAL_ROW_HEIGHT = 24;
const VIRTUAL_OVERSCAN = 30;
const VISIBLE_ROWS_BATCH_SIZE = 2000;
const EXPAND_ALL_BATCH_SIZE = 4000;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStringValue(str: string): string {
  if (/^https?:\/\/[^\s]+$/.test(str)) {
    const escaped = escapeHtml(str);
    return `<a class="jv-link" rel="noopener noreferrer" href="${escaped}">${escaped}</a>`;
  }
  return escapeHtml(str);
}

function renderValue(value: JsonValue): string {
  if (typeof value === "string") {
    return `<span class="jv-string">"${renderStringValue(value)}"</span>`;
  }
  if (typeof value === "number") {
    return `<span class="jv-number">${value}</span>`;
  }
  if (typeof value === "boolean") {
    return `<span class="jv-bool">${value}</span>`;
  }
  return `<span class="jv-null">null</span>`;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function keyHtml(node: JsonNode): string {
  if (node.key === null) return "";
  const key = node.isArrayElement ? String(node.key) : `"${escapeHtml(String(node.key))}"`;
  return `<span class="jv-key">${key}</span><span class="jv-punctuation">: </span>`;
}

function renderRow(node: JsonNode, expanded: ReadonlySet<number>): HTMLDivElement {
  const line = document.createElement("div");
  const isContainer = isContainerNode(node);
  const isExpanded = isContainer && expanded.has(node.id);
  const comma = node.isLast ? "" : ",";
  const hasChildren = node.childIds.length > 0;
  const toggleHtml = hasChildren
    ? `<span class="jv-toggle">▶</span>`
    : `<span class="jv-indent-spacer"></span>`;

  line.className = "jv-line";
  if (isContainer && !isExpanded) line.classList.add("jv-collapsed");
  line.dataset.nodeId = String(node.id);
  line.dataset.path = node.path;
  line.dataset.depth = String(node.depth);
  line.style.setProperty("--jv-depth", String(node.depth));

  const childrenActionHtml = node.hasNestedContainers
    ? `<button class="jv-action-children" title="Expand/collapse all children">⇕ children</button>`
    : "";
  const actionsHtml = `<span class="jv-inline-actions">${childrenActionHtml}<button class="jv-action-copy-node" title="Copy node value">⧉ copy</button></span>`;

  if (isContainer) {
    const openBracket = node.type === "array" ? "[" : "{";
    const closeBracket = node.type === "array" ? "]" : "}";
    const countHtml = node.label
      ? ` <span class="jv-count">${escapeHtml(node.label)}</span> `
      : "";
    line.innerHTML = `<span class="jv-guides"></span>${toggleHtml}${keyHtml(node)}<span class="jv-preview"><span class="jv-bracket">${openBracket}</span>${countHtml}<span class="jv-bracket">${closeBracket}</span><span class="jv-punctuation">${comma}</span></span>${actionsHtml}`;
  } else {
    line.innerHTML = `<span class="jv-guides"></span>${toggleHtml}${keyHtml(node)}${renderValue(node.value)}<span class="jv-punctuation">${comma}</span>${actionsHtml}`;
  }

  return line;
}

export interface TreeSearchState {
  query: string;
  matchCount: number;
  activeIndex: number;
}

export interface TreeViewController {
  render: (scrollToNodeId?: number | null) => Promise<void>;
  collapseToLevel: (targetLevel: number) => Promise<void>;
  expandAll: () => Promise<void>;
  toggleNode: (nodeId: number) => Promise<void>;
  toggleAllChildren: (nodeId: number) => Promise<void>;
  search: (query: string) => Promise<TreeSearchState>;
  stepSearch: (delta: number) => Promise<TreeSearchState>;
  clearSearch: () => Promise<TreeSearchState>;
  getSearchState: () => TreeSearchState;
  getStats: () => { maxDepth: number; totalNodes: number };
  getNodePath: (nodeId: number) => string;
  getNodeValue: (nodeId: number) => JsonValue;
  getAncestorIds: (nodeId: number) => number[];
  getRowElement: (nodeId: number) => HTMLElement | null;
}

export function createTreeView(
  container: HTMLElement,
  model: TreeModel,
  options?: {
    initialExpansionDepth?: number | null;
    scrollContainer?: HTMLElement;
    searchIndex?: TreeSearchIndex;
    onRenderStateChange?: (message: string) => void;
    debugHooks?: {
      onVisibleListRecomputed?: () => void;
    };
  }
): TreeViewController {
  const scrollContainer = options?.scrollContainer ?? container;
  const spacer = document.createElement("div");
  const rowsLayer = document.createElement("div");
  spacer.className = "jv-tree-spacer";
  rowsLayer.className = "jv-tree-rows";
  container.innerHTML = "";
  container.appendChild(spacer);
  container.appendChild(rowsLayer);
  const searchIndex = options?.searchIndex ?? createLocalTreeSearchIndex(model);

  function createExpandedSet(initialExpansionDepth?: number | null): Set<number> {
    if (initialExpansionDepth === null || initialExpansionDepth === undefined) {
      return new Set<number>(
        model.nodes.filter((node) => node.childIds.length > 0).map((node) => node.id)
      );
    }

    return new Set<number>(
      model.nodes
        .filter((node) => node.childIds.length > 0 && node.depth < initialExpansionDepth)
        .map((node) => node.id)
    );
  }

  let expanded = createExpandedSet(options?.initialExpansionDepth);
  let visibleNodeIds: number[] = [];
  let visibleIndexById = new Map<number, number>();
  let renderedExpanded: ReadonlySet<number> = expanded;
  const rowByNodeId = new Map<number, HTMLElement>();
  let renderToken = 0;
  let searchToken = 0;
  let searchMatches: number[] = [];
  let searchMatchSet = new Set<number>();
  let activeSearchIndex = -1;
  let searchQuery = "";
  let preSearchExpanded: Set<number> | null = null;
  let searchRevealNodeId: number | null = null;
  let pendingScrollNodeId: number | null = null;
  let renderScheduled = false;

  function currentSearchState(): TreeSearchState {
    return {
      query: searchQuery,
      matchCount: searchMatches.length,
      activeIndex: activeSearchIndex,
    };
  }

  function getAncestorIds(nodeId: number): number[] {
    const ancestors: number[] = [];
    let current = model.nodes[nodeId].parentId;
    while (current !== null) {
      ancestors.push(current);
      current = model.nodes[current].parentId;
    }
    return ancestors;
  }

  function expandedForRender(): ReadonlySet<number> {
    if (searchRevealNodeId === null) {
      return expanded;
    }

    const nextExpanded = new Set(expanded);
    getAncestorIds(searchRevealNodeId).forEach((ancestorId) => {
      if (model.nodes[ancestorId].childIds.length > 0) {
        nextExpanded.add(ancestorId);
      }
    });
    return nextExpanded;
  }

  function collectExpandedDescendantNodeIds(
    nodeId: number,
    currentExpanded: ReadonlySet<number>
  ): number[] {
    const descendants: number[] = [];
    const stack = [...model.nodes[nodeId].childIds].reverse();

    while (stack.length > 0) {
      const currentNodeId = stack.pop()!;
      descendants.push(currentNodeId);

      if (!currentExpanded.has(currentNodeId)) continue;
      const childIds = model.nodes[currentNodeId].childIds;
      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        stack.push(childIds[index]);
      }
    }

    return descendants;
  }

  function findVisibleDescendantRange(nodeId: number): { start: number; end: number } {
    const start = visibleIndexOf(nodeId) + 1;
    const nodeDepth = model.nodes[nodeId].depth;
    let end = start;

    while (
      end < visibleNodeIds.length &&
      model.nodes[visibleNodeIds[end]].depth > nodeDepth
    ) {
      end += 1;
    }

    return { start, end };
  }

  async function computeVisibleNodeIds(
    currentExpanded: ReadonlySet<number>
  ): Promise<number[]> {
    options?.debugHooks?.onVisibleListRecomputed?.();
    const token = ++renderToken;
    const nextVisibleNodeIds: number[] = [];
    const stack = [model.rootId];

    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      nextVisibleNodeIds.push(nodeId);

      if (nextVisibleNodeIds.length % VISIBLE_ROWS_BATCH_SIZE === 0) {
        if (token !== renderToken) {
          return visibleNodeIds;
        }
        options?.onRenderStateChange?.(
          `Preparing ${nextVisibleNodeIds.length.toLocaleString()} expanded rows...`
        );
        await nextFrame();
      }

      if (!currentExpanded.has(nodeId)) continue;
      const childIds = model.nodes[nodeId].childIds;
      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        stack.push(childIds[index]);
      }
    }

    return token === renderToken ? nextVisibleNodeIds : visibleNodeIds;
  }

  function applySearchClasses() {
    if (searchMatchSet.size === 0) return;
    rowByNodeId.forEach((row, nodeId) => {
      if (searchMatchSet.has(nodeId)) row.classList.add("jv-search-match");
    });
    if (activeSearchIndex >= 0) {
      const row = rowByNodeId.get(searchMatches[activeSearchIndex]);
      if (row) row.classList.add("jv-search-active");
    }
  }

  function rebuildVisibleIndex(): void {
    visibleIndexById = new Map();
    for (let index = 0; index < visibleNodeIds.length; index += 1) {
      visibleIndexById.set(visibleNodeIds[index], index);
    }
  }

  function setVisibleNodeIds(next: number[]): void {
    visibleNodeIds = next;
    rebuildVisibleIndex();
  }

  function visibleIndexOf(nodeId: number): number {
    return visibleIndexById.get(nodeId) ?? -1;
  }

  function scrollToNode(nodeId: number) {
    const index = visibleIndexOf(nodeId);
    if (index < 0) return;
    const viewportHeight = scrollContainer.clientHeight || window.innerHeight || 800;
    const targetTop = Math.max(
      0,
      index * VIRTUAL_ROW_HEIGHT - viewportHeight / 2 + VIRTUAL_ROW_HEIGHT / 2
    );
    scrollContainer.scrollTop = targetTop;
  }

  function renderWindow(statusMessage?: string | null) {
    renderScheduled = false;
    rowByNodeId.clear();

    const totalRows = visibleNodeIds.length;
    if (totalRows === 0) {
      spacer.style.height = "0px";
      rowsLayer.replaceChildren();
      options?.onRenderStateChange?.(statusMessage ?? "");
      return;
    }

    const viewportHeight = scrollContainer.clientHeight || window.innerHeight || 800;
    const scrollTop = scrollContainer.scrollTop;
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN
    );
    const endIndex = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN
    );
    const offsetTop = startIndex * VIRTUAL_ROW_HEIGHT;

    spacer.style.height = `${totalRows * VIRTUAL_ROW_HEIGHT}px`;
    rowsLayer.style.transform = `translateY(${offsetTop}px)`;

    const fragment = document.createDocumentFragment();
    visibleNodeIds.slice(startIndex, endIndex).forEach((nodeId) => {
      const row = renderRow(model.nodes[nodeId], renderedExpanded);
      rowByNodeId.set(nodeId, row);
      fragment.appendChild(row);
    });
    rowsLayer.replaceChildren(fragment);
    applySearchClasses();

    if (pendingScrollNodeId !== null) {
      if (!rowByNodeId.has(pendingScrollNodeId)) {
        scrollToNode(pendingScrollNodeId);
      }
      pendingScrollNodeId = null;
    }

    options?.onRenderStateChange?.(
      statusMessage ??
        (totalRows > 10000
          ? `Showing ${totalRows.toLocaleString()} expanded rows with virtualization.`
          : "")
    );
  }

  function scheduleWindowRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    void nextFrame().then(() => {
      renderWindow();
    });
  }

  async function render(scrollToNodeId: number | null = null): Promise<void> {
    renderedExpanded = expandedForRender();
    setVisibleNodeIds(await computeVisibleNodeIds(renderedExpanded));
    pendingScrollNodeId = scrollToNodeId;
    if (scrollToNodeId !== null) {
      scrollToNode(scrollToNodeId);
    }
    renderWindow();
  }

  function commitVisibleNodeIds(
    nextVisibleNodeIds: number[],
    scrollToNodeId: number | null = null,
    statusMessage?: string | null
  ) {
    renderedExpanded = expandedForRender();
    setVisibleNodeIds(nextVisibleNodeIds);
    pendingScrollNodeId = scrollToNodeId;
    if (scrollToNodeId !== null) {
      scrollToNode(scrollToNodeId);
    }
    renderWindow(statusMessage);
  }

  async function expandAllProgressively(nextExpanded: Set<number>): Promise<void> {
    expanded = nextExpanded;
    const allVisibleNodeIds = model.nodes.map((node) => node.id);
    const totalRows = allVisibleNodeIds.length;

    for (let end = EXPAND_ALL_BATCH_SIZE; end < totalRows; end += EXPAND_ALL_BATCH_SIZE) {
      commitVisibleNodeIds(
        allVisibleNodeIds.slice(0, end),
        null,
        `Expanding ${end.toLocaleString()} / ${totalRows.toLocaleString()} rows...`
      );
      await nextFrame();
    }

    commitVisibleNodeIds(allVisibleNodeIds);
  }

  async function revealNode(nodeId: number): Promise<void> {
    searchRevealNodeId = nodeId;
    await render(nodeId);
  }

  async function applyExpandedState(
    nextExpanded: Set<number>,
    applyOptions?: {
      scrollToNodeId?: number | null;
      visibleNodeIds?: number[];
    }
  ): Promise<void> {
    expanded = nextExpanded;
    if (applyOptions?.visibleNodeIds) {
      commitVisibleNodeIds(
        applyOptions.visibleNodeIds,
        applyOptions?.scrollToNodeId ?? null
      );
      return;
    }
    await render(applyOptions?.scrollToNodeId ?? null);
  }

  const controller: TreeViewController = {
    render,

    async collapseToLevel(targetLevel: number): Promise<void> {
      const nextExpanded = new Set<number>();
      const nextVisibleNodeIds: number[] = [];
      for (const node of model.nodes) {
        if (node.depth <= targetLevel) nextVisibleNodeIds.push(node.id);
        if (node.childIds.length > 0 && node.depth < targetLevel) {
          nextExpanded.add(node.id);
        }
      }
      if (searchRevealNodeId !== null) {
        await applyExpandedState(nextExpanded);
        return;
      }
      await applyExpandedState(nextExpanded, { visibleNodeIds: nextVisibleNodeIds });
    },

    async expandAll(): Promise<void> {
      const nextExpanded = new Set<number>(
        model.nodes.filter((node) => node.childIds.length > 0).map((node) => node.id)
      );
      if (searchRevealNodeId !== null) {
        await applyExpandedState(nextExpanded);
        return;
      }
      await expandAllProgressively(nextExpanded);
    },

    async toggleNode(nodeId: number): Promise<void> {
      if (model.nodes[nodeId].childIds.length === 0) return;
      const nextExpanded = new Set(expanded);

      if (nextExpanded.has(nodeId)) {
        nextExpanded.delete(nodeId);
        if (searchRevealNodeId === null) {
          const nextVisibleNodeIds = [...visibleNodeIds];
          const { start, end } = findVisibleDescendantRange(nodeId);
          nextVisibleNodeIds.splice(start, end - start);
          await applyExpandedState(nextExpanded, {
            scrollToNodeId: nodeId,
            visibleNodeIds: nextVisibleNodeIds,
          });
          return;
        }
      } else {
        nextExpanded.add(nodeId);
        if (searchRevealNodeId === null) {
          const nextVisibleNodeIds = [...visibleNodeIds];
          const insertAt = visibleIndexOf(nodeId) + 1;
          nextVisibleNodeIds.splice(
            insertAt,
            0,
            ...collectExpandedDescendantNodeIds(nodeId, nextExpanded)
          );
          await applyExpandedState(nextExpanded, {
            scrollToNodeId: nodeId,
            visibleNodeIds: nextVisibleNodeIds,
          });
          return;
        }
      }
      await applyExpandedState(nextExpanded, { scrollToNodeId: nodeId });
    },

    async toggleAllChildren(nodeId: number): Promise<void> {
      const node = model.nodes[nodeId];
      if (node.childIds.length === 0) return;

      function collectDescendantContainers(currentNodeId: number): number[] {
        return model.nodes[currentNodeId].childIds.flatMap((childId) => {
          const child = model.nodes[childId];
          if (!isContainerNode(child)) return [];
          return [childId, ...collectDescendantContainers(childId)];
        });
      }

      const descendantContainers = collectDescendantContainers(nodeId);
      const shouldExpand = descendantContainers.some((childId) => !expanded.has(childId));
      const nextExpanded = new Set(expanded);

      descendantContainers.forEach((childId) => {
        if (model.nodes[childId].childIds.length === 0) return;
        if (shouldExpand) {
          nextExpanded.add(childId);
        } else {
          nextExpanded.delete(childId);
        }
      });

      nextExpanded.add(nodeId);
      await applyExpandedState(nextExpanded, { scrollToNodeId: nodeId });
    },

    async search(query: string): Promise<TreeSearchState> {
      const normalizedQuery = query.trim().toLowerCase();

      if (!normalizedQuery) {
        return controller.clearSearch();
      }

      if (preSearchExpanded === null) {
        preSearchExpanded = new Set(expanded);
      }

      searchQuery = query;
      searchToken += 1;
      const token = searchToken;
      options?.onRenderStateChange?.("Searching...");
      const matches = await searchIndex.search(normalizedQuery);

      if (token !== searchToken) {
        return currentSearchState();
      }
      searchMatches = matches;
      searchMatchSet = new Set(matches);
      activeSearchIndex = searchMatches.length > 0 ? 0 : -1;

      if (activeSearchIndex >= 0) {
        await revealNode(searchMatches[activeSearchIndex]);
      } else {
        searchRevealNodeId = null;
        await render();
      }

      options?.onRenderStateChange?.("");
      return currentSearchState();
    },

    async stepSearch(delta: number): Promise<TreeSearchState> {
      if (searchMatches.length === 0) return currentSearchState();
      activeSearchIndex =
        (activeSearchIndex + delta + searchMatches.length) % searchMatches.length;
      await revealNode(searchMatches[activeSearchIndex]);
      return currentSearchState();
    },

    async clearSearch(): Promise<TreeSearchState> {
      searchToken += 1;
      searchQuery = "";
      searchMatches = [];
      searchMatchSet = new Set();
      activeSearchIndex = -1;
      searchRevealNodeId = null;

      if (preSearchExpanded !== null) {
        expanded = new Set(preSearchExpanded);
        preSearchExpanded = null;
      }

      await render();
      options?.onRenderStateChange?.("");
      return currentSearchState();
    },

    getSearchState(): TreeSearchState {
      return currentSearchState();
    },

    getStats() {
      return {
        maxDepth: model.maxDepth,
        totalNodes: model.totalNodes,
      };
    },

    getNodePath(nodeId: number): string {
      return model.nodes[nodeId].path;
    },

    getNodeValue(nodeId: number): JsonValue {
      return model.nodes[nodeId].value;
    },

    getAncestorIds,

    getRowElement(nodeId: number): HTMLElement | null {
      return rowByNodeId.get(nodeId) || null;
    },
  };

  scrollContainer.addEventListener("scroll", () => {
    scheduleWindowRender();
  });

  return controller;
}

export function setupHoverPath(
  tree: HTMLElement,
  treeView: TreeViewController,
  pathText: HTMLElement,
  pathDisplay: HTMLElement,
  pathCopyBtn: HTMLElement
): void {
  let pinned = false;
  let highlightedLines: HTMLElement[] = [];

  function clearHighlights() {
    highlightedLines.forEach((el) => {
      el.classList.remove("jv-current", "jv-ancestor");
    });
    highlightedLines = [];
  }

  function highlightLine(line: HTMLElement) {
    const nodeId = Number(line.dataset.nodeId);
    clearHighlights();
    line.classList.add("jv-current");
    highlightedLines.push(line);

    treeView.getAncestorIds(nodeId).forEach((ancestorId) => {
      const ancestorRow = treeView.getRowElement(ancestorId);
      if (!ancestorRow) return;
      ancestorRow.classList.add("jv-ancestor");
      highlightedLines.push(ancestorRow);
    });
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

  tree.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("jv-toggle") ||
      target.classList.contains("jv-preview") ||
      target.closest(".jv-inline-actions")
    ) {
      return;
    }

    const line = target.closest<HTMLElement>(".jv-line");
    if (!line) return;
    const path = line.dataset.path;
    if (!path) return;

    pinned = true;
    showPath(path, true);
  });

  pathCopyBtn.addEventListener("click", () => {
    const text = pathText.textContent;
    if (!text) return;

    navigator.clipboard.writeText(text);
    const originalText = pathCopyBtn.textContent;
    pathCopyBtn.textContent = "Copied!";
    setTimeout(() => {
      pathCopyBtn.textContent = originalText;
      pinned = false;
      clearHighlights();
      clearPath();
    }, 1000);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pinned) {
      pinned = false;
      clearHighlights();
      clearPath();
    }
  });
}
