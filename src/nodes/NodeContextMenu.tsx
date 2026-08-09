// Long-press context menus (§8.6, P2.9).
//
// Two variants, both rendered as a floating sheet positioned at the long-press
// screen point:
//
//   • Node menu — `Copy`, `Delete`, `Select group`, `Label` on values (P6b.1),
//     and for a reference `Unlink from parent` (P6.4 / §8.6).
//   • Canvas menu — `Add number`, `Paste`, `Add graph` (disabled: §17.2 defers
//     graphing; copy/paste is future work; Add number is a normal tap), plus
//     `Select all` when the canvas has nodes (§8.6).
//
// Dismissal: tapping the scrim (the transparent full-screen backdrop) closes the menu without
// taking any action. Selecting a menu item also closes it after running its handler.
//
// Precedence with P3.7 long-press-to-move-chain: the context menu has precedence. The menu
// opens on a 500 ms long-press; chain-move arms at 200 ms then requires movement. If the
// menu is already open, `useNodeDrag` checks `contextMenu !== null` and refuses moveChain
// (recorded as the decided precedence — see journal entry 2026-08-04.md).
import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import { NodeId, Vec2 } from '../model/types';

// ─── Item shape ──────────────────────────────────────────────────────────────

interface MenuItem {
  label: string;
  disabled?: boolean;
  onPress?: () => void;
}

// ─── Single row ──────────────────────────────────────────────────────────────

function MenuRow({ item }: { item: MenuItem }) {
  return (
    <TouchableOpacity
      testID={`context-menu-item-${item.label}`}
      style={[styles.row, item.disabled && styles.rowDisabled]}
      onPress={item.disabled ? undefined : item.onPress}
      disabled={item.disabled}
      accessibilityLabel={item.label}
      accessibilityState={{ disabled: item.disabled ?? false }}
    >
      <Text style={[styles.rowText, item.disabled && styles.rowTextDisabled]}>{item.label}</Text>
    </TouchableOpacity>
  );
}

// ─── Floating sheet ───────────────────────────────────────────────────────────

interface MenuSheetProps {
  anchor: Vec2;
  items: MenuItem[];
  onDismiss: () => void;
}

function MenuSheet({ anchor, items, onDismiss }: MenuSheetProps) {
  return (
    <Modal transparent animationType="none" onRequestClose={onDismiss} testID="context-menu-modal">
      {/* Full-screen scrim: tapping outside dismisses without acting */}
      <Pressable style={styles.scrim} onPress={onDismiss} testID="context-menu-scrim">
        {/* Inner Pressable stops the sheet's own taps from bubbling to the scrim */}
        <Pressable
          style={[styles.sheet, { left: anchor.x, top: anchor.y }]}
          testID="context-menu-sheet"
        >
          {items.map((item) => (
            <MenuRow key={item.label} item={item} />
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Node context menu ────────────────────────────────────────────────────────

interface NodeContextMenuProps {
  nodeId: NodeId;
  anchor: Vec2;
  onDelete: (nodeId: NodeId) => void;
  onSelectGroup: (nodeId: NodeId) => void;
  onUnlinkFromParent: (nodeId: NodeId) => void;
  onLabel: (nodeId: NodeId) => void;
  onDismiss: () => void;
}

export function NodeContextMenu({
  nodeId,
  anchor,
  onDelete,
  onSelectGroup,
  onUnlinkFromParent,
  onLabel,
  onDismiss,
}: NodeContextMenuProps) {
  const nodes = useDocumentStore((s) => s.document.nodes);
  const node = nodes[nodeId];
  const items: MenuItem[] = [
    {
      label: 'Copy',
      // Copy is future work — declared per §8.6 but not yet functional.
      disabled: true,
    },
    {
      label: 'Delete',
      onPress: () => {
        onDelete(nodeId);
        onDismiss();
      },
    },
    {
      label: 'Select group',
      onPress: () => {
        onSelectGroup(nodeId);
        onDismiss();
      },
    },
  ];

  // §11.1 / P6b.1: numbers, results, and live references can carry an identity caption.
  // Dangling refs have no source to write to — omit the affordance.
  const canLabel =
    node &&
    (node.kind === 'number' ||
      node.kind === 'result' ||
      (node.kind === 'reference' && nodes[node.targetNodeId] !== undefined));

  if (canLabel) {
    items.push({
      label: 'Label',
      onPress: () => {
        onLabel(nodeId);
        onDismiss();
      },
    });
  }

  // §8.6: references also get `Unlink from parent` — freezes the live/last-known
  // value as a plain number (P6.4). Same action as dangling convert-to-number.
  if (node?.kind === 'reference') {
    items.push({
      label: 'Unlink from parent',
      onPress: () => {
        onUnlinkFromParent(nodeId);
        onDismiss();
      },
    });
  }

  return <MenuSheet anchor={anchor} items={items} onDismiss={onDismiss} />;
}

// ─── Canvas context menu ──────────────────────────────────────────────────────

interface CanvasContextMenuProps {
  anchor: Vec2;
  onSelectAll: () => void;
  onDismiss: () => void;
}

export function CanvasContextMenu({
  anchor,
  onSelectAll,
  onDismiss,
}: CanvasContextMenuProps) {
  // The first three stay disabled: §17.2 defers graphing; copy/paste is future work;
  // `Add number` is handled by a normal tap — a long-press on empty canvas reaching
  // this menu is the explicit §8.6 affordance so it's declared here disabled rather than
  // wired to addNumberNode (which would bypass the intent signal of a deliberate long-press).
  // `Select all` is the one live action: it needs the canvas to have something to select.
  const nodeCount = useDocumentStore((s) => Object.keys(s.document.nodes).length);
  const items: MenuItem[] = [
    { label: 'Add number', disabled: true },
    { label: 'Paste', disabled: true },
    { label: 'Add graph', disabled: true },
    {
      label: 'Select all',
      disabled: nodeCount === 0,
      onPress: () => {
        onSelectAll();
        onDismiss();
      },
    },
  ];

  return <MenuSheet anchor={anchor} items={items} onDismiss={onDismiss} />;
}

// ─── Integrated overlay (reads from uiStore) ──────────────────────────────────

/** Renders whichever context menu is currently open (or nothing). Mount once near
 *  the root, above the canvas and keypad. Handlers are injected as props so this
 *  component stays decoupled from command imports. */
interface ContextMenuOverlayProps {
  onDeleteNode: (nodeId: NodeId) => void;
  onSelectGroup: (nodeId: NodeId) => void;
  onSelectAll: () => void;
  onUnlinkFromParent: (nodeId: NodeId) => void;
  onLabelNode: (nodeId: NodeId) => void;
}

export function ContextMenuOverlay({
  onDeleteNode,
  onSelectGroup,
  onSelectAll,
  onUnlinkFromParent,
  onLabelNode,
}: ContextMenuOverlayProps) {
  const contextMenu = useUiStore((state) => state.contextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);

  if (!contextMenu) return null;

  if (contextMenu.kind === 'node') {
    return (
      <NodeContextMenu
        nodeId={contextMenu.nodeId}
        anchor={contextMenu.anchor}
        onDelete={onDeleteNode}
        onSelectGroup={onSelectGroup}
        onUnlinkFromParent={onUnlinkFromParent}
        onLabel={onLabelNode}
        onDismiss={closeContextMenu}
      />
    );
  }

  return (
    <CanvasContextMenu
      anchor={contextMenu.anchor}
      onSelectAll={onSelectAll}
      onDismiss={closeContextMenu}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    minWidth: 180,
    paddingVertical: 4,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  rowDisabled: {
    opacity: 0.35,
  },
  rowText: {
    fontSize: 16,
    color: '#1A1A2E',
  },
  rowTextDisabled: {
    color: '#888',
  },
});
