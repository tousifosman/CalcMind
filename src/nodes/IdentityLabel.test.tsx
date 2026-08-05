// P6b.1 — label belongs to the identity: one edit updates the declaration and
// every reference that shares it (§11.1).
import React from 'react';
import { Text } from 'react-native';
import { act } from 'react-test-renderer';
import { NumberNode } from './NumberNode';
import { ResultNode } from './ResultNode';
import { ReferenceNode } from './ReferenceNode';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import {
  addNumberNode,
  appendEqualsNode,
  continueFromResult,
  setNodeLabel,
} from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { identityHues } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';
import { resetIdentityHueCacheForTests } from './useIdentityHue';
import type { ResultNode as ResultNodeModel } from '../model/types';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    editingLabelNodeId: null,
  });
  resetIdentityHueCacheForTests();
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('identity labels (P6b.1 / §11.1)', () => {
  test('label on a value with three references updates all four cells together', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '10000');
    appendEqualsNode(a);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    ) as ResultNodeModel;
    expect(result).toBeDefined();

    const { referenceId: ref1 } = continueFromResult(result.id, '+');
    const { referenceId: ref2 } = continueFromResult(result.id, '×');
    const { referenceId: ref3 } = continueFromResult(result.id, '-');

    const stackBefore = useDocumentStore.getState().undoStack.length;
    act(() => {
      setNodeLabel(result.id, 'Initial Deposit');
    });
    expect(useDocumentStore.getState().undoStack).toHaveLength(stackBefore + 1);

    const resultTree = renderNode(<ResultNode id={result.id} />);
    expect(findHostByTestID(resultTree.root, `result-node-${result.id}-label`).props.children).toBe(
      'Initial Deposit',
    );

    for (const refId of [ref1, ref2, ref3]) {
      const refTree = renderNode(<ReferenceNode id={refId} />);
      expect(findHostByTestID(refTree.root, `reference-node-${refId}-label`).props.children).toBe(
        'Initial Deposit',
      );
      // Caption colour matches the identity hue on references too.
      expect(findHostByTestID(refTree.root, `reference-node-${refId}-label`).props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: identityHues[0] })]),
      );
    }
  });

  test('labelling a plain number alone grants an identity hue (zero references)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '42');
    act(() => {
      setNodeLabel(id, 'Answer');
    });
    const renderer = renderNode(<NumberNode id={id} />);
    const ring = findHostByTestID(renderer.root, `number-node-${id}-identity-ring`);
    expect(ring.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: identityHues[0] })]),
    );
    const label = findHostByTestID(renderer.root, `number-node-${id}-label`);
    expect(label.props.children).toBe('Answer');
    expect(label.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: identityHues[0] })]),
    );
  });

  test('a reference does not keep a stale caption after the source label is cleared', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    appendEqualsNode(id);
    const result = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    ) as ResultNodeModel;
    const { referenceId } = continueFromResult(result.id, '+');
    act(() => setNodeLabel(result.id, 'Temp'));
    act(() => setNodeLabel(result.id, ''));

    const refTree = renderNode(<ReferenceNode id={referenceId} />);
    expect(
      refTree.root.findAllByType(Text).filter((t) => t.props.children === 'Temp'),
    ).toHaveLength(0);
    expect(
      refTree.root.findAll((n) => n.props.testID === `reference-node-${referenceId}-label`),
    ).toHaveLength(0);
  });
});
