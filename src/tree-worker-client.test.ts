import { describe, expect, test } from "vitest";

import { buildTreeModel } from "./tree-model";
import {
  createBestAvailableTreeSearchIndex,
  createTreeWorkerSearchIndex,
} from "./tree-worker-client";

type FakeWorker = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: { type: string; requestId?: number; query?: string }): void;
  terminate(): void;
};

describe("tree worker search index", () => {
  test("worker-backed search returns ranked matches", async () => {
    const model = buildTreeModel({
      alpha: { target: "match" },
      beta: { target: "other" },
    });

    const messages: unknown[] = [];
    const worker: FakeWorker = {
      onmessage: null,
      onerror: null,
      postMessage(message: { type: string; requestId?: number; query?: string }) {
        messages.push(message);
        if (message.type === "search") {
          this.onmessage?.({
            data: {
              type: "search-result",
              requestId: message.requestId!,
              matches: [model.pathToId.get("data.alpha.target")!],
            },
          } as MessageEvent);
        }
      },
      terminate() {},
    };

    const searchIndex = createTreeWorkerSearchIndex(model, () => worker);
    const matches = await searchIndex.search("match");

    expect(matches).toEqual([model.pathToId.get("data.alpha.target")]);
    expect(messages[0]).toMatchObject({ type: "init" });
    expect(messages[1]).toMatchObject({ type: "search", query: "match" });
  });

  test("falls back to local search when worker creation fails", async () => {
    const model = buildTreeModel({
      alpha: { target: "match" },
      beta: { target: "other" },
    });

    const searchIndex = createBestAvailableTreeSearchIndex(model, () => {
      throw new Error("worker blocked");
    });

    await expect(searchIndex.search("match")).resolves.toEqual([
      model.pathToId.get("data.alpha.target"),
    ]);
  });

  test("does not construct the worker until search is used", () => {
    const model = buildTreeModel({
      alpha: { target: "match" },
    });
    let createWorkerCalls = 0;

    createBestAvailableTreeSearchIndex(model, () => {
      createWorkerCalls += 1;
      throw new Error("worker blocked");
    });

    expect(createWorkerCalls).toBe(0);
  });
});
