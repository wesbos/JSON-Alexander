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
const PREFIX_SUM_FANOUT_THRESHOLD = 1024;
const MAX_PHYSICAL_HEIGHT = 1_000_000;

const URL_PATTERN = /^https?:\/\/[^\s]+$/;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

interface PoolRow {
  line: HTMLDivElement;
  toggle: HTMLSpanElement;
  keySpan: HTMLSpanElement;
  keyPunct: HTMLSpanElement;
  preview: HTMLSpanElement;
  bracketOpen: HTMLSpanElement;
  count: HTMLSpanElement;
  bracketClose: HTMLSpanElement;
  previewComma: HTMLSpanElement;
  leaf: HTMLSpanElement;
  leafValue: HTMLSpanElement;
  leafComma: HTMLSpanElement;
  actionChildren: HTMLButtonElement;
  lastNodeId: number;
  lastIsExpanded: boolean;
}

function createPoolRow(): PoolRow {
  const line = document.createElement("div");
  line.className = "jv-line";

  const guides = document.createElement("span");
  guides.className = "jv-guides";

  const toggle = document.createElement("span");

  const keySpan = document.createElement("span");
  keySpan.className = "jv-key";
  keySpan.hidden = true;

  const keyPunct = document.createElement("span");
  keyPunct.className = "jv-punctuation";
  keyPunct.textContent = ": ";
  keyPunct.hidden = true;

  const preview = document.createElement("span");
  preview.className = "jv-preview";
  preview.hidden = true;

  const bracketOpen = document.createElement("span");
  bracketOpen.className = "jv-bracket";

  const count = document.createElement("span");
  count.className = "jv-count";
  count.hidden = true;

  const bracketClose = document.createElement("span");
  bracketClose.className = "jv-bracket";

  const previewComma = document.createElement("span");
  previewComma.className = "jv-punctuation";

  preview.append(bracketOpen, count, bracketClose, previewComma);

  const leaf = document.createElement("span");
  leaf.hidden = true;

  const leafValue = document.createElement("span");

  const leafComma = document.createElement("span");
  leafComma.className = "jv-punctuation";

  leaf.append(leafValue, leafComma);

  const actions = document.createElement("span");
  actions.className = "jv-inline-actions";

  const actionChildren = document.createElement("button");
  actionChildren.className = "jv-action-children";
  actionChildren.title = "Expand/collapse all children";
  actionChildren.textContent = "⇕ children";
  actionChildren.hidden = true;

  const actionCopy = document.createElement("button");
  actionCopy.className = "jv-action-copy-node";
  actionCopy.title = "Copy node value";
  actionCopy.textContent = "⧉ copy";

  actions.append(actionChildren, actionCopy);

  line.append(guides, toggle, keySpan, keyPunct, preview, leaf, actions);

  return {
    line,
    toggle,
    keySpan,
    keyPunct,
    preview,
    bracketOpen,
    count,
    bracketClose,
    previewComma,
    leaf,
    leafValue,
    leafComma,
    actionChildren,
    lastNodeId: -1,
    lastIsExpanded: false,
  };
}

const URL_DETECT_MAX = 512;
const STRING_DISPLAY_MAX = 500;

function applyLeafValue(span: HTMLSpanElement, value: JsonValue): void {
  if (typeof value === "string") {
    span.className = "jv-string";
    if (value.length < URL_DETECT_MAX && URL_PATTERN.test(value)) {
      const a = document.createElement("a");
      a.className = "jv-link";
      a.rel = "noopener noreferrer";
      a.href = value;
      a.textContent = value;
      span.replaceChildren('"', a, '"');
    } else if (value.length > STRING_DISPLAY_MAX) {
      span.textContent = `"${value.slice(0, STRING_DISPLAY_MAX)}…" (${value.length.toLocaleString()} chars)`;
    } else {
      span.textContent = `"${value}"`;
    }
    return;
  }
  if (typeof value === "number") {
    span.className = "jv-number";
    span.textContent = String(value);
    return;
  }
  if (typeof value === "boolean") {
    span.className = "jv-bool";
    span.textContent = String(value);
    return;
  }
  span.className = "jv-null";
  span.textContent = "null";
}

function applyPoolRow(row: PoolRow, node: JsonNode, isExpanded: boolean): void {
  if (row.lastNodeId === node.id && row.lastIsExpanded === isExpanded) {
    return;
  }
  const isContainer = node.type === "object" || node.type === "array";
  // If only expansion state changed (same node), only update collapsed class.
  if (row.lastNodeId === node.id) {
    if (isContainer) {
      row.line.classList.toggle("jv-collapsed", !isExpanded);
    }
    row.lastIsExpanded = isExpanded;
    return;
  }
  const line = row.line;
  line.dataset.nodeId = String(node.id);
  line.dataset.path = node.path;
  line.dataset.depth = String(node.depth);
  line.style.setProperty("--jv-depth", String(node.depth));

  const hasChildren = node.childIds.length > 0;

  line.className = isContainer && !isExpanded ? "jv-line jv-collapsed" : "jv-line";

  if (hasChildren) {
    if (row.toggle.className !== "jv-toggle") row.toggle.className = "jv-toggle";
    if (row.toggle.textContent !== "▶") row.toggle.textContent = "▶";
  } else {
    if (row.toggle.className !== "jv-indent-spacer") {
      row.toggle.className = "jv-indent-spacer";
    }
    if (row.toggle.textContent !== "") row.toggle.textContent = "";
  }

  if (node.key === null) {
    row.keySpan.hidden = true;
    row.keyPunct.hidden = true;
  } else {
    row.keySpan.textContent = node.isArrayElement
      ? String(node.key)
      : `"${node.key}"`;
    row.keySpan.hidden = false;
    row.keyPunct.hidden = false;
  }

  const comma = node.isLast ? "" : ",";

  if (isContainer) {
    row.preview.hidden = false;
    row.leaf.hidden = true;
    row.bracketOpen.textContent = node.type === "array" ? "[" : "{";
    row.bracketClose.textContent = node.type === "array" ? "]" : "}";
    if (node.label) {
      row.count.textContent = ` ${node.label} `;
      row.count.hidden = false;
    } else {
      row.count.hidden = true;
    }
    row.previewComma.textContent = comma;
  } else {
    row.preview.hidden = true;
    row.leaf.hidden = false;
    applyLeafValue(row.leafValue, node.value);
    row.leafComma.textContent = comma;
  }

  row.actionChildren.hidden = !node.hasNestedContainers;
  row.lastNodeId = node.id;
  row.lastIsExpanded = isExpanded;
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

  const totalNodes = model.totalNodes;
  const expanded = new Uint8Array(totalNodes);
  const subtreeRowCount = new Int32Array(totalNodes);
  const prefixSumCache = new Map<number, Int32Array>();

  function invalidatePrefixSum(nodeId: number): void {
    if (prefixSumCache.size > 0) prefixSumCache.delete(nodeId);
  }

  function getPrefixSums(nodeId: number): Int32Array | null {
    const childIds = model.nodes[nodeId].childIds;
    if (childIds.length < PREFIX_SUM_FANOUT_THRESHOLD) return null;
    const cached = prefixSumCache.get(nodeId);
    if (cached) return cached;
    const sums = new Int32Array(childIds.length + 1);
    let acc = 0;
    for (let i = 0; i < childIds.length; i += 1) {
      acc += effectiveRowCount(childIds[i]);
      sums[i + 1] = acc;
    }
    prefixSumCache.set(nodeId, sums);
    return sums;
  }

  function setInitialExpansion(initialExpansionDepth?: number | null): void {
    expanded.fill(0);
    if (initialExpansionDepth === null || initialExpansionDepth === undefined) {
      for (let i = 0; i < totalNodes; i += 1) {
        if (model.nodes[i].childIds.length > 0) expanded[i] = 1;
      }
    } else {
      for (let i = 0; i < totalNodes; i += 1) {
        const node = model.nodes[i];
        if (node.childIds.length > 0 && node.depth < initialExpansionDepth) {
          expanded[i] = 1;
        }
      }
    }
  }

  function isExpandedBit(nodeId: number): boolean {
    return expanded[nodeId] === 1;
  }

  function effectiveRowCount(nodeId: number): number {
    return expanded[nodeId] === 1 ? subtreeRowCount[nodeId] : 1;
  }

  function recomputeAllSubtreeCounts(): void {
    options?.debugHooks?.onVisibleListRecomputed?.();
    prefixSumCache.clear();
    for (let i = totalNodes - 1; i >= 0; i -= 1) {
      const node = model.nodes[i];
      const childIds = node.childIds;
      if (childIds.length === 0) {
        subtreeRowCount[i] = 1;
        continue;
      }
      let sum = 1;
      for (let c = 0; c < childIds.length; c += 1) {
        sum += effectiveRowCount(childIds[c]);
      }
      subtreeRowCount[i] = sum;
    }
  }

  function totalVisibleRows(): number {
    return effectiveRowCount(model.rootId);
  }

  function fastForwardChildren(
    nodeId: number,
    startChildIndex: number,
    rowsRemaining: number
  ): { childIndex: number; rowsConsumed: number } {
    const childIds = model.nodes[nodeId].childIds;
    const ps = getPrefixSums(nodeId);
    if (ps !== null) {
      const baseSum = ps[startChildIndex];
      let lo = startChildIndex;
      let hi = childIds.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (ps[mid] - baseSum <= rowsRemaining) lo = mid;
        else hi = mid - 1;
      }
      return { childIndex: lo, rowsConsumed: ps[lo] - baseSum };
    }
    let i = startChildIndex;
    let consumed = 0;
    while (i < childIds.length) {
      const eff = effectiveRowCount(childIds[i]);
      if (consumed + eff > rowsRemaining) break;
      consumed += eff;
      i += 1;
    }
    return { childIndex: i, rowsConsumed: consumed };
  }

  function getWindowNodeIds(start: number, end: number): number[] {
    const result: number[] = [];
    const total = totalVisibleRows();
    if (total === 0 || start >= total || end <= start) return result;
    const targetEnd = Math.min(end, total);

    let row = 0;

    function visit(nodeId: number): boolean {
      if (row >= targetEnd) return true;
      if (row >= start) result.push(nodeId);
      row += 1;
      if (row >= targetEnd) return true;
      if (!isExpandedBit(nodeId)) return false;
      const childIds = model.nodes[nodeId].childIds;
      let i = 0;
      if (row < start) {
        const skipped = fastForwardChildren(nodeId, 0, start - row);
        i = skipped.childIndex;
        row += skipped.rowsConsumed;
      }
      while (i < childIds.length && row < targetEnd) {
        if (visit(childIds[i])) return true;
        i += 1;
      }
      return row >= targetEnd;
    }

    visit(model.rootId);
    return result;
  }

  function rowIndexOf(nodeId: number): number {
    if (nodeId === model.rootId) return 0;
    let index = 0;
    let current = nodeId;
    while (current !== model.rootId) {
      const node = model.nodes[current];
      const parentId = node.parentId;
      if (parentId === null) return -1;
      if (!isExpandedBit(parentId)) return -1;
      const siblingIndex = node.siblingIndex;
      const ps = getPrefixSums(parentId);
      if (ps !== null) {
        index += ps[siblingIndex];
      } else {
        const siblings = model.nodes[parentId].childIds;
        for (let i = 0; i < siblingIndex; i += 1) {
          index += effectiveRowCount(siblings[i]);
        }
      }
      index += 1;
      current = parentId;
    }
    return index;
  }

  function applyExpandedDelta(nodeId: number, delta: number): void {
    let parentId = model.nodes[nodeId].parentId;
    while (parentId !== null) {
      subtreeRowCount[parentId] += delta;
      invalidatePrefixSum(parentId);
      if (!isExpandedBit(parentId)) break;
      parentId = model.nodes[parentId].parentId;
    }
  }

  function setExpandedAndPropagate(nodeId: number, value: boolean): boolean {
    const node = model.nodes[nodeId];
    if (node.childIds.length === 0) return false;
    const wasExpanded = isExpandedBit(nodeId);
    if (wasExpanded === value) return false;
    const oldEff = wasExpanded ? subtreeRowCount[nodeId] : 1;
    expanded[nodeId] = value ? 1 : 0;
    const newEff = value ? subtreeRowCount[nodeId] : 1;
    const delta = newEff - oldEff;
    if (delta !== 0) applyExpandedDelta(nodeId, delta);
    return true;
  }

  setInitialExpansion(options?.initialExpansionDepth);
  recomputeAllSubtreeCounts();

  const rowPool: PoolRow[] = [];
  const rowByNodeId = new Map<number, HTMLElement>();
  let searchToken = 0;
  let searchMatches: number[] = [];
  let searchMatchSet = new Set<number>();
  let activeSearchIndex = -1;
  let searchQuery = "";
  let preSearchExpandedSnapshot: Uint8Array | null = null;
  let pendingScrollNodeId: number | null = null;
  let renderScheduled = false;

  function ensurePoolSize(size: number): void {
    while (rowPool.length < size) {
      const row = createPoolRow();
      rowPool.push(row);
      rowsLayer.appendChild(row.line);
    }
  }

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

  function applySearchClasses() {
    for (let i = 0; i < rowPool.length; i += 1) {
      rowPool[i].line.classList.remove("jv-search-match", "jv-search-active");
    }
    if (searchMatchSet.size === 0) return;
    rowByNodeId.forEach((row, nodeId) => {
      if (searchMatchSet.has(nodeId)) row.classList.add("jv-search-match");
    });
    if (activeSearchIndex >= 0) {
      const row = rowByNodeId.get(searchMatches[activeSearchIndex]);
      if (row) row.classList.add("jv-search-active");
    }
  }

  function scrollToNode(nodeId: number): void {
    const index = rowIndexOf(nodeId);
    if (index < 0) return;
    const viewportHeight = scrollContainer.clientHeight || window.innerHeight || 800;
    const totalRows = totalVisibleRows();
    const virtualHeight = totalRows * VIRTUAL_ROW_HEIGHT;
    const physicalHeight = Math.min(virtualHeight, MAX_PHYSICAL_HEIGHT);
    const scale =
      virtualHeight > MAX_PHYSICAL_HEIGHT ? virtualHeight / physicalHeight : 1;
    const physicalRowTop = (index * VIRTUAL_ROW_HEIGHT) / scale;
    const targetTop = Math.max(
      0,
      physicalRowTop - viewportHeight / 2 + VIRTUAL_ROW_HEIGHT / 2
    );
    scrollContainer.scrollTop = targetTop;
  }

  function renderWindow(statusMessage?: string | null) {
    renderScheduled = false;

    const totalRows = totalVisibleRows();
    if (totalRows === 0) {
      spacer.style.height = "0px";
      rowByNodeId.clear();
      for (let i = 0; i < rowPool.length; i += 1) rowPool[i].line.hidden = true;
      options?.onRenderStateChange?.(statusMessage ?? "");
      return;
    }

    const viewportHeight = scrollContainer.clientHeight || window.innerHeight || 800;
    const virtualHeight = totalRows * VIRTUAL_ROW_HEIGHT;
    const physicalHeight = Math.min(virtualHeight, MAX_PHYSICAL_HEIGHT);
    spacer.style.height = `${physicalHeight}px`;

    const scale =
      virtualHeight > MAX_PHYSICAL_HEIGHT ? virtualHeight / physicalHeight : 1;

    const maxScroll = Math.max(0, physicalHeight - viewportHeight);
    let scrollTop = scrollContainer.scrollTop;
    if (scrollTop > maxScroll) {
      scrollTop = maxScroll;
      scrollContainer.scrollTop = maxScroll;
    }

    const virtualScrollTop = scrollTop * scale;
    const virtualViewportHeight = viewportHeight * scale;
    const startIndex = Math.max(
      0,
      Math.floor(virtualScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN
    );
    const endIndex = Math.min(
      totalRows,
      Math.ceil((virtualScrollTop + virtualViewportHeight) / VIRTUAL_ROW_HEIGHT) +
        VIRTUAL_OVERSCAN
    );
    const offsetTop = (startIndex * VIRTUAL_ROW_HEIGHT) / scale;

    rowsLayer.style.transform = `translateY(${offsetTop}px)`;

    const nodeIds = getWindowNodeIds(startIndex, endIndex);
    ensurePoolSize(nodeIds.length);
    rowByNodeId.clear();
    for (let i = 0; i < nodeIds.length; i += 1) {
      const nodeId = nodeIds[i];
      const row = rowPool[i];
      applyPoolRow(row, model.nodes[nodeId], isExpandedBit(nodeId));
      row.line.hidden = false;
      rowByNodeId.set(nodeId, row.line);
    }
    for (let i = nodeIds.length; i < rowPool.length; i += 1) {
      rowPool[i].line.hidden = true;
    }
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

  function render(scrollToNodeId: number | null = null): Promise<void> {
    pendingScrollNodeId = scrollToNodeId;
    if (scrollToNodeId !== null) {
      scrollToNode(scrollToNodeId);
    }
    renderWindow();
    return Promise.resolve();
  }

  function snapshotExpanded(): Uint8Array {
    return new Uint8Array(expanded);
  }

  function restoreExpanded(snapshot: Uint8Array): void {
    expanded.set(snapshot);
    recomputeAllSubtreeCounts();
  }

  function revealNode(nodeId: number): void {
    const ancestors = getAncestorIds(nodeId);
    ancestors.reverse();
    for (let i = 0; i < ancestors.length; i += 1) {
      const ancestorId = ancestors[i];
      if (model.nodes[ancestorId].childIds.length === 0) continue;
      if (isExpandedBit(ancestorId)) continue;
      setExpandedAndPropagate(ancestorId, true);
    }
    pendingScrollNodeId = nodeId;
    scrollToNode(nodeId);
    renderWindow();
  }

  const controller: TreeViewController = {
    render,

    async collapseToLevel(targetLevel: number): Promise<void> {
      for (let i = 0; i < totalNodes; i += 1) {
        const node = model.nodes[i];
        expanded[i] =
          node.childIds.length > 0 && node.depth < targetLevel ? 1 : 0;
      }
      recomputeAllSubtreeCounts();
      pendingScrollNodeId = null;
      renderWindow();
    },

    async expandAll(): Promise<void> {
      for (let i = 0; i < totalNodes; i += 1) {
        expanded[i] = model.nodes[i].childIds.length > 0 ? 1 : 0;
      }
      recomputeAllSubtreeCounts();
      pendingScrollNodeId = null;
      renderWindow();
    },

    async toggleNode(nodeId: number): Promise<void> {
      const node = model.nodes[nodeId];
      if (node.childIds.length === 0) return;
      const wasExpanded = isExpandedBit(nodeId);
      setExpandedAndPropagate(nodeId, !wasExpanded);
      pendingScrollNodeId = nodeId;
      scrollToNode(nodeId);
      renderWindow();
    },

    async toggleAllChildren(nodeId: number): Promise<void> {
      const node = model.nodes[nodeId];
      if (node.childIds.length === 0) return;

      const descendantContainers: number[] = [];
      const stack: number[] = [...node.childIds];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (!isContainerNode(model.nodes[id])) continue;
        descendantContainers.push(id);
        const ch = model.nodes[id].childIds;
        for (let i = 0; i < ch.length; i += 1) stack.push(ch[i]);
      }

      let shouldExpand = false;
      for (let i = 0; i < descendantContainers.length; i += 1) {
        if (!isExpandedBit(descendantContainers[i])) {
          shouldExpand = true;
          break;
        }
      }

      // Bulk set expanded then recompute (cheaper than incremental for big subtrees)
      for (let i = 0; i < descendantContainers.length; i += 1) {
        const id = descendantContainers[i];
        if (model.nodes[id].childIds.length === 0) continue;
        expanded[id] = shouldExpand ? 1 : 0;
      }
      expanded[nodeId] = 1;
      recomputeAllSubtreeCounts();

      pendingScrollNodeId = nodeId;
      scrollToNode(nodeId);
      renderWindow();
    },

    async search(query: string): Promise<TreeSearchState> {
      const normalizedQuery = query.trim().toLowerCase();

      if (!normalizedQuery) {
        return controller.clearSearch();
      }

      if (preSearchExpandedSnapshot === null) {
        preSearchExpandedSnapshot = snapshotExpanded();
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
        revealNode(searchMatches[activeSearchIndex]);
      } else {
        renderWindow();
      }

      options?.onRenderStateChange?.("");
      return currentSearchState();
    },

    async stepSearch(delta: number): Promise<TreeSearchState> {
      if (searchMatches.length === 0) return currentSearchState();
      activeSearchIndex =
        (activeSearchIndex + delta + searchMatches.length) % searchMatches.length;
      revealNode(searchMatches[activeSearchIndex]);
      return currentSearchState();
    },

    async clearSearch(): Promise<TreeSearchState> {
      searchToken += 1;
      searchQuery = "";
      searchMatches = [];
      searchMatchSet = new Set();
      activeSearchIndex = -1;

      if (preSearchExpandedSnapshot !== null) {
        restoreExpanded(preSearchExpandedSnapshot);
        preSearchExpandedSnapshot = null;
      }

      pendingScrollNodeId = null;
      renderWindow();
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
