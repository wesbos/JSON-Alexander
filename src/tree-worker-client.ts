import type { TreeModel } from "./tree-model";
import { createTreeSearchNodes, searchTreeSearchNodes } from "./tree-search";
import type {
  TreeWorkerMessage,
  TreeWorkerResponseMessage,
  WorkerSearchNodeMessage,
} from "./tree-worker-protocol";

export interface TreeSearchIndex {
  search(query: string): Promise<number[]>;
  prewarm?(): void;
  dispose(): void;
}

interface WorkerLike {
  onmessage: ((event: MessageEvent<TreeWorkerResponseMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: TreeWorkerMessage): void;
  terminate(): void;
}

function createWorkerPayload(model: TreeModel): WorkerSearchNodeMessage[] {
  return createTreeSearchNodes(model).map((node) => ({
    id: node.id,
    searchKey: node.searchKey,
    searchPath: node.searchPath,
    searchValue: node.searchValue,
    hasLongSearchValue: node.hasLongSearchValue,
    rawStringValue: node.rawStringValue,
    isContainer: node.isContainer,
  }));
}

function createExtensionWorker(): WorkerLike {
  return new Worker(chrome.runtime.getURL("tree-worker.js"));
}

export function createLocalTreeSearchIndex(model: TreeModel): TreeSearchIndex {
  const searchNodes = createTreeSearchNodes(model);

  return {
    async search(query: string): Promise<number[]> {
      return searchTreeSearchNodes(searchNodes, query);
    },

    dispose(): void {},
  };
}

export function createBestAvailableTreeSearchIndex(
  model: TreeModel,
  createWorker?: () => WorkerLike
): TreeSearchIndex {
  const localIndex = createLocalTreeSearchIndex(model);
  let workerIndex: TreeSearchIndex | null = null;
  let workerDisabled = false;

  function ensureWorker(): TreeSearchIndex | null {
    if (workerDisabled) return null;
    if (workerIndex !== null) return workerIndex;
    try {
      workerIndex = createTreeWorkerSearchIndex(model, createWorker);
      return workerIndex;
    } catch {
      workerDisabled = true;
      return null;
    }
  }

  return {
    async search(query: string): Promise<number[]> {
      const worker = ensureWorker();
      if (worker === null) return localIndex.search(query);
      try {
        return await worker.search(query);
      } catch {
        workerIndex?.dispose();
        workerIndex = null;
        workerDisabled = true;
        return localIndex.search(query);
      }
    },

    prewarm(): void {
      ensureWorker();
    },

    dispose(): void {
      workerIndex?.dispose();
      localIndex.dispose();
    },
  };
}

export function createTreeWorkerSearchIndex(
  model: TreeModel,
  createWorker: () => WorkerLike = createExtensionWorker
): TreeSearchIndex {
  const worker = createWorker();
  let nextRequestId = 0;
  const pending = new Map<
    number,
    {
      resolve: (matches: number[]) => void;
      reject: (error: Error) => void;
    }
  >();

  const initPromise = Promise.resolve().then(() => {
    worker.postMessage({
      type: "init",
      nodes: createWorkerPayload(model),
    });
  });

  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type !== "search-result") return;

    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    request.resolve(message.matches);
  };

  worker.onerror = () => {
    const error = new Error("Tree search worker failed");
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
  };

  return {
    async search(query: string): Promise<number[]> {
      await initPromise;

      return new Promise<number[]>((resolve, reject) => {
        const requestId = ++nextRequestId;
        pending.set(requestId, { resolve, reject });
        worker.postMessage({
          type: "search",
          requestId,
          query,
        });
      });
    },

    dispose(): void {
      const error = new Error("Tree search worker disposed");
      pending.forEach(({ reject }) => reject(error));
      pending.clear();
      worker.terminate();
    },
  };
}
