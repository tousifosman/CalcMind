import React from 'react';
import { act } from 'react-test-renderer';
import { DanglingRecoverySheet, DanglingRecoveryOverlay } from './DanglingRecoverySheet';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { createEmptyDocument } from '../model/factories';
import { explainDanglingReference } from '../engine/reference';
import { renderNode, unmountAll } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({
    danglingRecoveryId: null,
    repointReferenceId: null,
    contextMenu: null,
  });
}

beforeEach(resetStore);
afterEach(unmountAll);

function injectDangling(id: string, lastKnownDisplay: string): void {
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[id] = {
      id,
      kind: 'reference',
      position: { x: 0, y: 0 },
      chainId: null,
      createdAt: 0,
      targetNodeId: 'gone',
      lastKnownDisplay,
    };
  });
}

describe('DanglingRecoverySheet (P6.4 / §11.2)', () => {
  test('explains the break and offers both recovery actions', () => {
    injectDangling('ref1', '99');
    const onBeginRepoint = jest.fn();
    const onDismiss = jest.fn();
    const renderer = renderNode(
      <DanglingRecoverySheet
        referenceId="ref1"
        onDismiss={onDismiss}
        onBeginRepoint={onBeginRepoint}
      />,
    );

    const explanation = renderer.root.findByProps({ testID: 'dangling-recovery-explanation' });
    expect(explanation.props.children).toBe(explainDanglingReference());
    expect(explanation.props.children).not.toBe('?');

    const lastKnown = renderer.root.findByProps({ testID: 'dangling-recovery-last-known' });
    expect(lastKnown.props.children).toEqual(['Last known value: ', '99']);

    const repoint = renderer.root
      .findAll((n) => n.props.testID === 'dangling-recovery-repoint')
      .find((n) => n.props.onPress !== undefined)!;
    act(() => {
      repoint.props.onPress();
    });
    expect(onBeginRepoint).toHaveBeenCalledWith('ref1');
  });

  test('convert freezes the last known value as a number and dismisses', () => {
    injectDangling('ref1', '42');
    const onDismiss = jest.fn();
    const renderer = renderNode(
      <DanglingRecoverySheet
        referenceId="ref1"
        onDismiss={onDismiss}
        onBeginRepoint={jest.fn()}
      />,
    );
    const convert = renderer.root
      .findAll((n) => n.props.testID === 'dangling-recovery-convert')
      .find((n) => n.props.onPress !== undefined)!;
    act(() => {
      convert.props.onPress();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().document.nodes.ref1).toBeUndefined();
    const numbers = Object.values(useDocumentStore.getState().document.nodes).filter(
      (n) => n.kind === 'number',
    );
    expect(numbers).toHaveLength(1);
    expect(numbers[0]).toMatchObject({ kind: 'number', raw: '42' });
  });
});

describe('DanglingRecoveryOverlay', () => {
  test('renders nothing when no recovery is open', () => {
    const renderer = renderNode(<DanglingRecoveryOverlay />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('opens when danglingRecoveryId is set', () => {
    injectDangling('ref1', '1');
    act(() => {
      useUiStore.getState().openDanglingRecovery('ref1');
    });
    const renderer = renderNode(<DanglingRecoveryOverlay />);
    expect(
      renderer.root.findAll((n) => n.props.testID === 'dangling-recovery-sheet').length,
    ).toBeGreaterThanOrEqual(1);
  });
});
