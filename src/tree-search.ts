import { type TreeModel, isContainerNode } from "./tree-model";

export interface TreeSearchNode {
  id: number;
  searchValue: string;
  hasLongSearchValue: boolean;
  rawStringValue?: string;
  searchKey: string;
  searchPath: string;
  isContainer: boolean;
}

export interface TreeSearchMatch {
  nodeId: number;
  score: number;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function valueMatches(node: TreeSearchNode, query: string): boolean {
  if (!node.searchValue) return false;
  if (node.searchValue.includes(query)) return true;
  return node.hasLongSearchValue && typeof node.rawStringValue === "string"
    ? node.rawStringValue.includes(query)
    : false;
}

function matchScore(node: TreeSearchNode, query: string): number | null {
  if (node.searchKey === query || node.searchPath === query) return 0;
  if (!node.isContainer && node.searchValue === query) return 1;
  if (!node.isContainer && valueMatches(node, query)) return 2;
  if (node.searchKey && node.searchKey.includes(query)) return 3;
  if (node.searchPath.includes(query)) return 4;
  return null;
}

export function createTreeSearchNodes(model: TreeModel): TreeSearchNode[] {
  return model.nodes.map((node) => ({
    id: node.id,
    searchValue: node.searchValue,
    hasLongSearchValue: node.hasLongSearchValue,
    rawStringValue:
      node.hasLongSearchValue && typeof node.value === "string"
        ? node.value.toLowerCase()
        : undefined,
    searchKey: node.searchKey,
    searchPath: node.searchPath,
    isContainer: isContainerNode(node),
  }));
}

export function collectTreeSearchMatches(
  nodes: readonly TreeSearchNode[],
  query: string,
  start = 0,
  end: number = nodes.length
): TreeSearchMatch[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const matches: TreeSearchMatch[] = [];
  for (let index = start; index < end; index += 1) {
    const node = nodes[index];
    const score = matchScore(node, normalizedQuery);
    if (score !== null) matches.push({ nodeId: node.id, score });
  }
  return matches;
}

export function sortTreeSearchMatches(matches: readonly TreeSearchMatch[]): number[] {
  return [...matches]
    .sort((left, right) =>
      left.score === right.score ? left.nodeId - right.nodeId : left.score - right.score
    )
    .map((match) => match.nodeId);
}

export function searchTreeSearchNodes(
  nodes: readonly TreeSearchNode[],
  query: string
): number[] {
  return sortTreeSearchMatches(collectTreeSearchMatches(nodes, query));
}

export function hydrateTreeSearchNodes(
  nodes: Array<{
    id: number;
    searchKey: string;
    searchPath: string;
    searchValue: string;
    hasLongSearchValue: boolean;
    rawStringValue?: string;
    isContainer: boolean;
  }>
): TreeSearchNode[] {
  return nodes as TreeSearchNode[];
}
