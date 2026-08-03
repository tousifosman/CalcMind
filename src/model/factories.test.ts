import { createEmptyDocument, createNodeId, createChainId } from './factories';
import { CURRENT_SCHEMA_VERSION } from './types';

describe('createEmptyDocument', () => {
  test('produces a valid empty document', () => {
    const doc = createEmptyDocument('My Canvas');
    expect(doc.name).toBe('My Canvas');
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.nodes).toEqual({});
    expect(doc.chains).toEqual({});
    expect(doc.viewport).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 });
  });

  test('defaults the name to Untitled', () => {
    expect(createEmptyDocument().name).toBe('Untitled');
  });

  test('assigns distinct ids to distinct documents', () => {
    const a = createEmptyDocument();
    const b = createEmptyDocument();
    expect(a.id).not.toBe(b.id);
  });
});

describe('id factories', () => {
  test('createNodeId and createChainId are prefixed and unique', () => {
    const n1 = createNodeId();
    const n2 = createNodeId();
    const c1 = createChainId();
    expect(n1).toMatch(/^n_/);
    expect(c1).toMatch(/^c_/);
    expect(n1).not.toBe(n2);
  });
});
