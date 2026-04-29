// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import { buildTreeModel } from "./tree-model";
import { createTreeView } from "./viewer";
import type { TreeSearchIndex } from "./tree-worker-client";

function createContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  return container;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createTreeView", () => {
  test("search finds scalar values and highlights the active row", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      users: [{ name: "Ada Lovelace", role: "admin" }],
      metadata: { count: 1 },
    });
    const treeView = createTreeView(container, model);

    await treeView.render();
    const state = await treeView.search("ada");

    expect(state.matchCount).toBeGreaterThan(0);
    const activeRow = container.querySelector<HTMLElement>(".jv-search-active");
    expect(activeRow?.dataset.path).toBe("data.users[0].name");
  });

  test("search finds container nodes by key and path", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      metadata: { totalCount: 42 },
      data: { items: [] },
    });
    const treeView = createTreeView(container, model, {
      initialExpansionDepth: 1,
    });

    await treeView.render();
    let state = await treeView.search("metadata");
    expect(state.matchCount).toBeGreaterThan(0);
    expect(container.querySelector<HTMLElement>(".jv-search-active")?.dataset.path).toBe(
      "data.metadata"
    );

    state = await treeView.search("data.data.items");
    expect(state.matchCount).toBeGreaterThan(0);
    expect(container.querySelector<HTMLElement>(".jv-search-active")?.dataset.path).toBe(
      "data.data.items"
    );
  });

  test("clearing search restores the previous expansion state", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      users: [{ name: "Ada Lovelace", role: "admin" }],
      metadata: { count: 1 },
    });
    const treeView = createTreeView(container, model);

    await treeView.collapseToLevel(1);
    const visibleBeforeSearch = container.querySelectorAll(".jv-line").length;

    await treeView.search("ada");
    expect(container.querySelectorAll(".jv-line").length).toBeGreaterThan(visibleBeforeSearch);

    await treeView.clearSearch();
    expect(container.querySelectorAll(".jv-line")).toHaveLength(visibleBeforeSearch);
  });

  test("stepping search only reveals the active result branch", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      alpha: { nested: { target: "match" } },
      beta: { nested: { target: "match" } },
    });
    const treeView = createTreeView(container, model, {
      initialExpansionDepth: 1,
    });

    await treeView.render();
    await treeView.search("match");

    let visiblePaths = Array.from(container.querySelectorAll<HTMLElement>(".jv-line")).map(
      (row) => row.dataset.path
    );

    expect(visiblePaths).toContain("data.alpha.nested");
    expect(visiblePaths).not.toContain("data.beta.nested");

    await treeView.stepSearch(1);

    visiblePaths = Array.from(container.querySelectorAll<HTMLElement>(".jv-line")).map(
      (row) => row.dataset.path
    );

    expect(container.querySelector<HTMLElement>(".jv-search-active")?.dataset.path).toBe(
      "data.beta.nested.target"
    );
    expect(visiblePaths).not.toContain("data.alpha.nested");
    expect(visiblePaths).toContain("data.beta.nested");
  });

  test("stale async search results do not overwrite the latest query", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      alpha: { nested: { target: "first" } },
      beta: { nested: { target: "second" } },
    });
    const alphaResult = createDeferred<number[]>();
    const betaResult = createDeferred<number[]>();
    const searchIndex: TreeSearchIndex = {
      search(query: string): Promise<number[]> {
        return query === "first" ? alphaResult.promise : betaResult.promise;
      },
      dispose(): void {},
    };
    const treeView = createTreeView(container, model, {
      initialExpansionDepth: 1,
      searchIndex,
    });

    await treeView.render();

    const firstSearch = treeView.search("first");
    const secondSearch = treeView.search("second");

    betaResult.resolve([model.pathToId.get("data.beta.nested.target")!]);
    await secondSearch;

    expect(container.querySelector<HTMLElement>(".jv-search-active")?.dataset.path).toBe(
      "data.beta.nested.target"
    );

    alphaResult.resolve([model.pathToId.get("data.alpha.nested.target")!]);
    await firstSearch;

    expect(treeView.getSearchState().query).toBe("second");
    expect(container.querySelector<HTMLElement>(".jv-search-active")?.dataset.path).toBe(
      "data.beta.nested.target"
    );
  });

  test("branch toggles reuse the visible row list instead of rebuilding it", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      alpha: { nested: { deep: "value" } },
      beta: { nested: { deep: "other" } },
    });
    let recomputeCount = 0;
    const treeView = createTreeView(container, model, {
      initialExpansionDepth: 1,
      debugHooks: {
        onVisibleListRecomputed() {
          recomputeCount += 1;
        },
      },
    });

    await treeView.render();
    expect(recomputeCount).toBe(1);

    await treeView.toggleNode(model.pathToId.get("data.alpha")!);
    expect(recomputeCount).toBe(1);

    await treeView.toggleNode(model.pathToId.get("data.alpha")!);
    expect(recomputeCount).toBe(1);
  });

  test("initialExpansionDepth limits the initial visible rows", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      users: [{ name: "Ada Lovelace", role: "admin" }],
      metadata: { count: 1 },
    });
    const treeView = createTreeView(container, model, {
      initialExpansionDepth: 1,
    });

    await treeView.render();

    const visiblePaths = Array.from(container.querySelectorAll<HTMLElement>(".jv-line")).map(
      (row) => row.dataset.path
    );

    expect(visiblePaths).toEqual(["data", "data.users", "data.metadata"]);
  });

  test("expandAll keeps the DOM windowed instead of rendering every row", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      users: Array.from({ length: 20 }, (_, index) => ({
        name: `User ${index}`,
        role: "admin",
        links: { profile: `/users/${index}` },
      })),
    });
    const treeView = createTreeView(container, model, {
      initialExpansionDepth: 1,
    });

    await treeView.render();
    await treeView.expandAll();

    const renderedRows = container.querySelectorAll(".jv-line").length;
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(model.totalNodes);
  });

  test("expandAll reports progress without forcing another full visible-list rebuild", async () => {
    const container = createContainer();
    const model = buildTreeModel({
      users: Array.from({ length: 2500 }, (_, index) => ({
        name: `User ${index}`,
        profile: {
          id: index,
          tags: [`tag-${index}`, `group-${index}`],
        },
      })),
    });
    const renderMessages: string[] = [];
    let recomputeCount = 0;
    const treeView = createTreeView(container, model, {
      initialExpansionDepth: 1,
      onRenderStateChange(message) {
        renderMessages.push(message);
      },
      debugHooks: {
        onVisibleListRecomputed() {
          recomputeCount += 1;
        },
      },
    });

    await treeView.render();
    expect(recomputeCount).toBe(1);

    await treeView.expandAll();

    expect(recomputeCount).toBe(1);
    expect(renderMessages.some((message) => message.startsWith("Expanding "))).toBe(true);
  });
});
