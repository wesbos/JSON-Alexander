export interface WorkerSearchNodeMessage {
  id: number;
  searchKey: string;
  searchPath: string;
  searchValue: string;
  hasLongSearchValue: boolean;
  rawStringValue?: string;
  isContainer: boolean;
}

interface WorkerInitMessage {
  type: "init";
  nodes: WorkerSearchNodeMessage[];
}

export interface WorkerSearchMessage {
  type: "search";
  requestId: number;
  query: string;
}

interface WorkerSearchResultMessage {
  type: "search-result";
  requestId: number;
  matches: number[];
}

export type TreeWorkerMessage = WorkerInitMessage | WorkerSearchMessage;
export type TreeWorkerResponseMessage = WorkerSearchResultMessage;
