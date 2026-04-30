import {
  collectTreeSearchMatches,
  hydrateTreeSearchNodes,
  sortTreeSearchMatches,
  type TreeSearchMatch,
  type TreeSearchNode,
} from "./tree-search";
import type {
  TreeWorkerMessage,
  WorkerSearchMessage,
} from "./tree-worker-protocol";

const WORKER_SEARCH_BATCH_SIZE = 500;

let searchNodes: TreeSearchNode[] = [];
let latestRequestId = 0;

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function runSearch(message: WorkerSearchMessage): Promise<void> {
  latestRequestId = message.requestId;
  const normalizedQuery = message.query.trim().toLowerCase();

  if (!normalizedQuery) {
    self.postMessage({
      type: "search-result",
      requestId: message.requestId,
      matches: [],
    });
    return;
  }

  const matches: TreeSearchMatch[] = [];
  const total = searchNodes.length;

  for (let start = 0; start < total; start += WORKER_SEARCH_BATCH_SIZE) {
    if (message.requestId !== latestRequestId) return;

    const end = Math.min(start + WORKER_SEARCH_BATCH_SIZE, total);
    const batch = collectTreeSearchMatches(searchNodes, normalizedQuery, start, end);
    for (let index = 0; index < batch.length; index += 1) matches.push(batch[index]);

    if (end < total) await nextTask();
  }

  if (message.requestId !== latestRequestId) {
    return;
  }

  self.postMessage({
    type: "search-result",
    requestId: message.requestId,
    matches: sortTreeSearchMatches(matches),
  });
}

self.addEventListener("message", (event: MessageEvent<TreeWorkerMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    searchNodes = hydrateTreeSearchNodes(message.nodes);
    return;
  }

  void runSearch(message);
});
