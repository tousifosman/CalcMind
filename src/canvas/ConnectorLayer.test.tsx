import React from 'react';
import { Text } from 'react-native';
import { act } from 'react-test-renderer';
import { ConnectorLayer } from './ConnectorLayer';
import { CONNECTOR_FAN_COLLAPSE_AT } from './connectors';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { createEmptyDocument } from '../model/factories';
import { selectNode } from '../store/commands';
import { renderNode, unmountAll, findHostByTestID } from '../nodes/testUtils';
import { resetIdentityHueCacheForTests } from '../nodes/useIdentityHue';
import { identityHues } from '../ui/tokens';
import type { CalcNode, Chain, ResultNode } from '../model/types';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStores() {
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
  });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    groupSelectedIds: new Set(),
    dragSnap: null,
  });
  resetIdentityHueCacheForTests();
}

beforeEach(resetStores);
afterEach(unmountAll);

/** One source result with `consumerCount` live references, spread horizontally. */
function seedFan(consumerCount: number): {
  resultId: string;
  referenceIds: string[];
} {
  const resultId = 'n_result';
  const referenceIds: string[] = [];
  const nodes: Record<string, CalcNode> = {};
  const chains: Record<string, Chain> = {};

  const result: ResultNode = {
    id: resultId,
    kind: 'result',
    sourceChainId: 'c_src',
    position: { x: 100, y: 40 },
    chainId: 'c_src',
    createdAt: 0,
    derived: { display: '15', computedAt: '2026-08-04T00:00:00.000Z' },
  };
  nodes[resultId] = result;
  chains.c_src = {
    id: 'c_src',
    anchor: { x: 100, y: 40 },
    members: [resultId],
  };

  for (let i = 0; i < consumerCount; i++) {
    const refId = `n_ref_${i}`;
    const chainId = `c_dep_${i}`;
    referenceIds.push(refId);
    nodes[refId] = {
      id: refId,
      kind: 'reference',
      targetNodeId: resultId,
      position: { x: 40 + i * 70, y: 180 },
      chainId,
      createdAt: 0,
    };
    chains[chainId] = {
      id: chainId,
      anchor: { x: 40 + i * 70, y: 180 },
      members: [refId],
    };
  }

  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes = nodes;
    draft.chains = chains;
  });

  return { resultId, referenceIds };
}

describe('ConnectorLayer', () => {
  test('renders a bezier for each live reference in the source hue', () => {
    const { referenceIds } = seedFan(2);
    const renderer = renderNode(<ConnectorLayer />);
    findHostByTestID(renderer.root, 'connector-layer');
    for (const id of referenceIds) {
      const curve = findHostByTestID(renderer.root, `connector-curve-${id}`);
      expect(curve.props.stroke).toBe(identityHues[0]);
      expect(curve.props.d).toMatch(/^M/);
      expect(curve.props.markerEnd).toContain('cm-arrow-');
    }
  });

  test('shows a count badge when a source has more than ~4 consumers', () => {
    seedFan(CONNECTOR_FAN_COLLAPSE_AT);
    const renderer = renderNode(<ConnectorLayer />);
    findHostByTestID(renderer.root, 'connector-badge-n_result');
    expect(
      renderer.root.findAll(
        (node) =>
          typeof node.props?.testID === 'string' &&
          node.props.testID.startsWith('connector-curve-'),
      ),
    ).toHaveLength(0);
    const countTexts = renderer.root
      .findAllByType(Text)
      .filter((t) => t.props.children === CONNECTOR_FAN_COLLAPSE_AT);
    expect(countTexts.length).toBeGreaterThan(0);
  });

  test('expands the badge to curves when the source is selected', () => {
    const { resultId, referenceIds } = seedFan(CONNECTOR_FAN_COLLAPSE_AT);
    act(() => {
      selectNode(resultId);
    });
    const renderer = renderNode(<ConnectorLayer />);
    expect(
      renderer.root.findAllByProps({ testID: 'connector-badge-n_result' }),
    ).toHaveLength(0);
    for (const id of referenceIds) {
      expect(
        findHostByTestID(renderer.root, `connector-curve-${id}`),
      ).toBeTruthy();
    }
  });

  test('curve endpoint follows dragSnap while a reference is mid-drag', () => {
    const { referenceIds } = seedFan(1);
    const refId = referenceIds[0]!;
    const renderer = renderNode(<ConnectorLayer />);
    const before = findHostByTestID(renderer.root, `connector-curve-${refId}`)
      .props.d as string;

    act(() => {
      useUiStore.getState().setDragSnap({
        nodeId: refId,
        position: { x: 200, y: 300 },
        candidate: null,
        movingChainId: null,
      });
    });

    const after = findHostByTestID(renderer.root, `connector-curve-${refId}`)
      .props.d as string;
    expect(after).not.toBe(before);
    expect(after).toMatch(/, \d+(\.\d+)? 300$/);
  });
});
