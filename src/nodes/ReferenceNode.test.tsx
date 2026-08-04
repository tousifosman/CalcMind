import React from 'react';
import { ReferenceNode, DANGLING_REFERENCE_OPACITY } from './ReferenceNode';
import { useDocumentStore } from '../store/documentStore';
import { createEmptyDocument } from '../model/factories';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';
import type { ReferenceNode as ReferenceNodeModel } from '../model/types';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
}

beforeEach(resetStore);
afterEach(unmountAll);

function inject(node: ReferenceNodeModel, extra: Record<string, unknown> = {}): void {
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[node.id] = node;
    for (const [id, value] of Object.entries(extra)) {
      draft.nodes[id] = value as never;
    }
  });
}

describe('ReferenceNode (P6.4 dangling)', () => {
  test('live reference shows the target value without strike-through', () => {
    inject(
      {
        id: 'ref1',
        kind: 'reference',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: 0,
        targetNodeId: 'n1',
      },
      {
        n1: {
          id: 'n1',
          kind: 'number',
          raw: '42',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
        },
      },
    );
    const renderer = renderNode(<ReferenceNode id="ref1" />);
    const content = findHostByTestID(renderer.root, 'reference-node-ref1-content');
    expect(content.props.children).toBe('42');
    const flat = (Array.isArray(content.props.style) ? content.props.style : [content.props.style])
      .filter(Boolean)
      .reduce((acc: Record<string, unknown>, s: Record<string, unknown>) => ({ ...acc, ...s }), {});
    expect(flat.textDecorationLine).toBeUndefined();
    expect(flat.opacity).toBeUndefined();
  });

  test('dangling reference shows lastKnownDisplay struck-through and dimmed', () => {
    inject({
      id: 'ref1',
      kind: 'reference',
      position: { x: 0, y: 0 },
      chainId: null,
      createdAt: 0,
      targetNodeId: 'gone',
      lastKnownDisplay: '1,224',
    });
    const renderer = renderNode(<ReferenceNode id="ref1" />);
    const content = findHostByTestID(renderer.root, 'reference-node-ref1-content');
    expect(content.props.children).toBe('1,224');
    expect(content.props.children).not.toBe('?');
    const flat = (Array.isArray(content.props.style) ? content.props.style : [content.props.style])
      .filter(Boolean)
      .reduce((acc: Record<string, unknown>, s: Record<string, unknown>) => ({ ...acc, ...s }), {});
    expect(flat.textDecorationLine).toBe('line-through');
    expect(flat.opacity).toBe(DANGLING_REFERENCE_OPACITY);
  });
});
