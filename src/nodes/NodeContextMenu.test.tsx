// Tests for the §8.6 context menu components and the uiStore context menu state.
import React from 'react';
import { act } from 'react-test-renderer';
import { NodeContextMenu, CanvasContextMenu, ContextMenuOverlay } from './NodeContextMenu';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import { addNumberNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { renderNode, unmountAll } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    contextMenu: null,
    groupSelectedIds: new Set(),
  });
}

beforeEach(resetStore);
afterEach(unmountAll);

const ANCHOR = { x: 100, y: 200 };

describe('NodeContextMenu', () => {
  test('calls onDelete with nodeId and then onDismiss when Delete is pressed', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    const onDelete = jest.fn();
    const onDismiss = jest.fn();

    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={onDelete}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={onDismiss}
      />,
    );

    // Find the Delete TouchableOpacity by testID via findAllByProps traversal
    const deleteBtn = renderer.root
      .findAll((node) => node.props.testID === `context-menu-item-Delete`)
      .find((node) => typeof node.type === 'function' || node.props.onPress !== undefined);

    expect(deleteBtn).toBeDefined();
    act(() => {
      deleteBtn!.props.onPress();
    });

    expect(onDelete).toHaveBeenCalledWith(id);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('calls onSelectGroup with nodeId and then onDismiss when Select group is pressed', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    const onSelectGroup = jest.fn();
    const onDismiss = jest.fn();

    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={onSelectGroup}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={onDismiss}
      />,
    );

    const selectGroupBtn = renderer.root
      .findAll((node) => node.props.testID === `context-menu-item-Select group`)
      .find((node) => node.props.onPress !== undefined);

    expect(selectGroupBtn).toBeDefined();
    act(() => {
      selectGroupBtn!.props.onPress();
    });

    expect(onSelectGroup).toHaveBeenCalledWith(id);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('Copy is marked disabled', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');

    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    const copyBtn = renderer.root
      .findAll((node) => node.props.testID === `context-menu-item-Copy`)
      .find((node) => node.props.disabled !== undefined);

    expect(copyBtn).toBeDefined();
    expect(copyBtn!.props.disabled).toBe(true);
  });

  test('Unlink from parent is absent for non-reference nodes', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Unlink from parent'),
    ).toHaveLength(0);
  });

  test('Unlink from parent is present for references and invokes the handler (P6.4)', () => {
    const target = addNumberNode({ x: 0, y: 0 }, '7');
    let refId = '';
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        const ref = {
          id: 'ref_unlink',
          kind: 'reference' as const,
          position: { x: 40, y: 0 },
          chainId: null,
          createdAt: 0,
          targetNodeId: target,
        };
        draft.nodes[ref.id] = ref;
        refId = ref.id;
      });
    });
    const onUnlink = jest.fn();
    const onDismiss = jest.fn();
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={refId}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={onUnlink}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    const unlinkBtn = renderer.root
      .findAll((node) => node.props.testID === 'context-menu-item-Unlink from parent')
      .find((node) => node.props.onPress !== undefined);
    expect(unlinkBtn).toBeDefined();
    act(() => {
      unlinkBtn!.props.onPress();
    });
    expect(onUnlink).toHaveBeenCalledWith(refId);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('Label is present for numbers and invokes the handler (P6b.1)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '10');
    const onLabel = jest.fn();
    const onDismiss = jest.fn();
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={onLabel}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    const labelBtn = renderer.root
      .findAll((node) => node.props.testID === 'context-menu-item-Label')
      .find((node) => node.props.onPress !== undefined);
    expect(labelBtn).toBeDefined();
    act(() => {
      labelBtn!.props.onPress();
    });
    expect(onLabel).toHaveBeenCalledWith(id);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('Label is absent for operators', () => {
    let opId = '';
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.op1 = {
          id: 'op1',
          kind: 'operator',
          op: '+',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
        };
        opId = 'op1';
      });
    });
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={opId}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Label'),
    ).toHaveLength(0);
  });

  test('Label is absent for a dangling reference (no live source to write)', () => {
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.dangling = {
          id: 'dangling',
          kind: 'reference',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
          targetNodeId: 'gone',
          lastKnownDisplay: '42',
        };
      });
    });
    const renderer = renderNode(
      <NodeContextMenu
        nodeId="dangling"
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Label'),
    ).toHaveLength(0);
    // Unlink is still offered — convert-to-number is the recovery path.
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Unlink from parent')
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  test('Label is present for a live reference', () => {
    const target = addNumberNode({ x: 0, y: 0 }, '7');
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.ref_live = {
          id: 'ref_live',
          kind: 'reference',
          position: { x: 40, y: 0 },
          chainId: null,
          createdAt: 0,
          targetNodeId: target,
        };
      });
    });
    const renderer = renderNode(
      <NodeContextMenu
        nodeId="ref_live"
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Label').length,
    ).toBeGreaterThanOrEqual(1);
  });

  test('Create link is present for numbers and invokes the handler (§8.6)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '10');
    const onCreateLink = jest.fn();
    const onDismiss = jest.fn();
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={onCreateLink}
        onShowSlider={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    const createLinkBtn = renderer.root
      .findAll((node) => node.props.testID === 'context-menu-item-Create link')
      .find((node) => node.props.onPress !== undefined);
    expect(createLinkBtn).toBeDefined();
    act(() => {
      createLinkBtn!.props.onPress();
    });
    expect(onCreateLink).toHaveBeenCalledWith(id);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('Create link is absent for operators', () => {
    let opId = '';
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.op2 = {
          id: 'op2',
          kind: 'operator',
          op: '+',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
        };
        opId = 'op2';
      });
    });
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={opId}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Create link'),
    ).toHaveLength(0);
  });

  test('Create link is absent for a dangling reference (no live value to link)', () => {
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.dangling2 = {
          id: 'dangling2',
          kind: 'reference',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
          targetNodeId: 'gone',
          lastKnownDisplay: '42',
        };
      });
    });
    const renderer = renderNode(
      <NodeContextMenu
        nodeId="dangling2"
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Create link'),
    ).toHaveLength(0);
  });

  test('Create link is present for a live reference', () => {
    const target = addNumberNode({ x: 0, y: 0 }, '7');
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.ref_live2 = {
          id: 'ref_live2',
          kind: 'reference',
          position: { x: 40, y: 0 },
          chainId: null,
          createdAt: 0,
          targetNodeId: target,
        };
      });
    });
    const renderer = renderNode(
      <NodeContextMenu
        nodeId="ref_live2"
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Create link')
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  test('Show slider is present for a scrubbable number and invokes the handler (§8.8)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '10');
    const onShowSlider = jest.fn();
    const onDismiss = jest.fn();
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={onShowSlider}
        onDismiss={onDismiss}
      />,
    );
    const showSliderBtn = renderer.root
      .findAll((node) => node.props.testID === 'context-menu-item-Show slider')
      .find((node) => node.props.onPress !== undefined);
    expect(showSliderBtn).toBeDefined();
    act(() => {
      showSliderBtn!.props.onPress();
    });
    expect(onShowSlider).toHaveBeenCalledWith(id);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('Show slider is absent for a mid-typing number (nothing to scrub yet)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '-');
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={id}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Show slider'),
    ).toHaveLength(0);
  });

  test('Show slider is absent for operators', () => {
    let opId = '';
    act(() => {
      useDocumentStore.getState().applyCommand((draft) => {
        draft.nodes.op3 = {
          id: 'op3',
          kind: 'operator',
          op: '+',
          position: { x: 0, y: 0 },
          chainId: null,
          createdAt: 0,
        };
        opId = 'op3';
      });
    });
    const renderer = renderNode(
      <NodeContextMenu
        nodeId={opId}
        anchor={ANCHOR}
        onDelete={jest.fn()}
        onSelectGroup={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabel={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(
      renderer.root.findAll((node) => node.props.testID === 'context-menu-item-Show slider'),
    ).toHaveLength(0);
  });
});

describe('CanvasContextMenu', () => {
  test('placeholder items stay disabled and Select all is disabled on an empty canvas', () => {
    const renderer = renderNode(
      <CanvasContextMenu
        anchor={ANCHOR}
        onSelectAll={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    for (const label of ['Add number', 'Paste', 'Add graph', 'Select all']) {
      const btn = renderer.root
        .findAll((node) => node.props.testID === `context-menu-item-${label}`)
        .find((node) => node.props.disabled !== undefined);
      expect(btn).toBeDefined();
      expect(btn!.props.disabled).toBe(true);
    }
  });

  test('Select all is enabled when the canvas has nodes and invokes onSelectAll then onDismiss', () => {
    addNumberNode({ x: 0, y: 0 }, '1');
    const onSelectAll = jest.fn();
    const onDismiss = jest.fn();
    const renderer = renderNode(
      <CanvasContextMenu
        anchor={ANCHOR}
        onSelectAll={onSelectAll}
        onDismiss={onDismiss}
      />,
    );

    const selectAllBtn = renderer.root
      .findAll((node) => node.props.testID === 'context-menu-item-Select all')
      .find((node) => typeof node.props.onPress === 'function');
    expect(selectAllBtn).toBeDefined();
    expect(selectAllBtn!.props.disabled).toBe(false);

    act(() => {
      selectAllBtn!.props.onPress();
    });
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('ContextMenuOverlay', () => {
  test('renders nothing when contextMenu is null', () => {
    const renderer = renderNode(
      <ContextMenuOverlay
        onDeleteNode={jest.fn()}
        onSelectGroup={jest.fn()}
        onSelectAll={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabelNode={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
      />,
    );
    expect(renderer.toJSON()).toBeNull();
  });

  test('renders node menu items when contextMenu.kind === node', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '9');
    act(() => {
      useUiStore.getState().openContextMenu({ kind: 'node', nodeId: id, anchor: ANCHOR });
    });

    const renderer = renderNode(
      <ContextMenuOverlay
        onDeleteNode={jest.fn()}
        onSelectGroup={jest.fn()}
        onSelectAll={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabelNode={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
      />,
    );

    const deleteBtns = renderer.root.findAll(
      (node) => node.props.testID === `context-menu-item-Delete`,
    );
    expect(deleteBtns.length).toBeGreaterThanOrEqual(1);
  });

  test('renders canvas menu items when contextMenu.kind === canvas', () => {
    act(() => {
      useUiStore.getState().openContextMenu({ kind: 'canvas', anchor: ANCHOR });
    });

    const renderer = renderNode(
      <ContextMenuOverlay
        onDeleteNode={jest.fn()}
        onSelectGroup={jest.fn()}
        onSelectAll={jest.fn()}
        onUnlinkFromParent={jest.fn()}
        onLabelNode={jest.fn()}
        onCreateLink={jest.fn()}
        onShowSlider={jest.fn()}
      />,
    );

    const addNumberBtns = renderer.root.findAll(
      (node) => node.props.testID === `context-menu-item-Add number`,
    );
    expect(addNumberBtns.length).toBeGreaterThanOrEqual(1);
    const selectAllBtns = renderer.root.findAll(
      (node) => node.props.testID === 'context-menu-item-Select all',
    );
    expect(selectAllBtns.length).toBeGreaterThanOrEqual(1);
  });

  test('closeContextMenu sets contextMenu to null', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    act(() => {
      useUiStore.getState().openContextMenu({ kind: 'node', nodeId: id, anchor: ANCHOR });
    });
    expect(useUiStore.getState().contextMenu).not.toBeNull();

    act(() => {
      useUiStore.getState().closeContextMenu();
    });
    expect(useUiStore.getState().contextMenu).toBeNull();
  });
});
