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

describe('ReferenceNode result-pattern propagation (§11.1)', () => {
  test('a reference to a number gets no dot texture', () => {
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
    expect(
      renderer.root.findAllByProps({ testID: 'reference-node-ref1-texture' }),
    ).toHaveLength(0);
  });

  test('a reference straight to a result gets the same dot texture as the result itself', () => {
    inject(
      {
        id: 'ref1',
        kind: 'reference',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: 0,
        targetNodeId: 'r1',
      },
      {
        r1: {
          id: 'r1',
          kind: 'result',
          sourceChainId: 'c1',
          position: { x: 0, y: 0 },
          chainId: 'c1',
          createdAt: 0,
          derived: { display: '27', computedAt: '2026-08-17T00:00:00.000Z' },
        },
      },
    );
    const renderer = renderNode(<ReferenceNode id="ref1" />);
    expect(findHostByTestID(renderer.root, 'reference-node-ref1-texture')).toBeTruthy();
  });

  test('a reference to a reference that ultimately targets a result also gets the texture', () => {
    inject(
      {
        id: 'ref2',
        kind: 'reference',
        position: { x: 0, y: 0 },
        chainId: null,
        createdAt: 0,
        targetNodeId: 'ref1',
      },
      {
        ref1: {
          id: 'ref1',
          kind: 'reference',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
          targetNodeId: 'r1',
        },
        r1: {
          id: 'r1',
          kind: 'result',
          sourceChainId: 'c1',
          position: { x: 0, y: 0 },
          chainId: 'c1',
          createdAt: 0,
          derived: { display: '27', computedAt: '2026-08-17T00:00:00.000Z' },
        },
      },
    );
    const renderer = renderNode(<ReferenceNode id="ref2" />);
    expect(findHostByTestID(renderer.root, 'reference-node-ref2-texture')).toBeTruthy();
  });

  test('a dangling reference gets no dot texture even if the last-known source was a result', () => {
    inject({
      id: 'ref1',
      kind: 'reference',
      position: { x: 0, y: 0 },
      chainId: null,
      createdAt: 0,
      targetNodeId: 'gone',
      lastKnownDisplay: '27',
    });
    const renderer = renderNode(<ReferenceNode id="ref1" />);
    expect(
      renderer.root.findAllByProps({ testID: 'reference-node-ref1-texture' }),
    ).toHaveLength(0);
  });
});
