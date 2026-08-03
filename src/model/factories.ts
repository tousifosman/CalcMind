import { nanoid } from 'nanoid';
import {
  CalcDocument,
  CURRENT_SCHEMA_VERSION,
  NodeId,
  ChainId,
} from './types';

export function createNodeId(): NodeId {
  return `n_${nanoid()}`;
}

export function createChainId(): ChainId {
  return `c_${nanoid()}`;
}

export function createDocumentId(): string {
  return `doc_${nanoid()}`;
}

export function createEmptyDocument(name = 'Untitled'): CalcDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createDocumentId(),
    name,
    createdAt: now,
    updatedAt: now,
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
    nodes: {},
    chains: {},
  };
}
