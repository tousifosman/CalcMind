// Long-press context menus (§8.6, P2.9).
//
// Two variants, both rendered as a floating sheet positioned at the long-press
// screen point:
//
//   • Node menu — `Copy`, `Delete`, `Select group`, `Label` and `Create link` on values
//     (P6b.1, §8.6), and for a reference `Unlink from parent` (P6.4 / §8.6).
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
import { copyTextForNode } from '../engine/copyText';
import { getDeviceLocale } from '../ui/locale';

// ─── Item shape ──────────────────────────────────────────────────────────────

interface MenuItem {
  label: string;
  disabled?: boolean;
  onPress?: () => void;
  /** Renders as a nested row under its parent — the `Copy As` submenu's own item. */
  indent?: boolean;
  /** Web hover reveal for a submenu parent (`Copy As`), alongside tap-to-toggle —
   *  a no-op prop on native, where `TouchableOpacity` has no hover concept. */
  onHoverIn?: () => void;
}

// ─── Single row ──────────────────────────────────────────────────────────────

function MenuRow({ item }: { item: MenuItem }) {
  // `onMouseEnter` isn't in TouchableOpacityProps's types (no DOM lib in this project's
  // tsconfig, per AGENTS.md) but react-native-web's TouchableOpacity forwards unknown
  // props straight to the underlying host View, which does understand it — same trade
  // Keypad.tsx's `skipTabOrder` already makes for a web-only extra prop.
  const hoverProp = item.onHoverIn ? ({ onMouseEnter: item.onHoverIn } as object) : {};
  return (
    <TouchableOpacity
      testID={`context-menu-item-${item.label}`}
      style={[styles.row, item.indent && styles.rowIndent, item.disabled && styles.rowDisabled]}
      onPress={item.disabled ? undefined : item.onPress}
      disabled={item.disabled}
      accessibilityLabel={item.label}
      accessibilityState={{ disabled: item.disabled ?? false }}
      {...hoverProp}
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
  onCreateLink: (nodeId: NodeId) => void;
  onCopy: (nodeId: NodeId) => void;
  onCopyWithoutResult: () => void;
  onDismiss: () => void;
}

export function NodeContextMenu({
  nodeId,
  anchor,
  onDelete,
  onSelectGroup,
  onUnlinkFromParent,
  onLabel,
  onCreateLink,
  onCopy,
  onCopyWithoutResult,
  onDismiss,
}: NodeContextMenuProps) {
  const nodes = useDocumentStore((s) => s.document.nodes);
  const node = nodes[nodeId];
  // §8.6 `Copy`: enabled only for a kind that actually carries a value (number,
  // result, live/dangling reference) and only once that value is in a copyable state
  // (not an empty or errored result) — `copyTextForNode` is the one place both this
  // enablement check and the actual clipboard write (`copyNodeValue`) agree on that.
  const copyValue = copyTextForNode(nodeId, nodes, getDeviceLocale());
  // §8.6 `Copy As`: only offered once this cell is part of the active group selection
  // (Select group / Select all) — a lone cell has nothing else worth copying "as".
  const groupSelected = useUiStore((s) => s.groupSelectedIds.has(nodeId));
  const [copyAsExpanded, setCopyAsExpanded] = React.useState(false);

  const items: MenuItem[] = [
    {
      label: 'Copy',
      disabled: copyValue === null,
      onPress:
        copyValue === null
          ? undefined
          : () => {
              onCopy(nodeId);
              onDismiss();
            },
    },
  ];

  if (groupSelected) {
    // One item for now (§8.6): `Copy without result`. Tapping (or, on web, hovering)
    // `Copy As` reveals it as a nested row rather than opening a separate flyout —
    // simplest thing that satisfies both "tap" and "hover" for one item. Both handlers
    // only ever *reveal* (never toggle back closed) — a toggle would let a mouse user's
    // own hover-then-click sequence collapse the row it just opened, right as they went
    // to tap the item underneath it (found live: hover revealed it, the click that
    // followed flipped it straight back off).
    items.push({
      label: 'Copy As',
      onPress: () => setCopyAsExpanded(true),
      onHoverIn: () => setCopyAsExpanded(true),
    });
    if (copyAsExpanded) {
      items.push({
        label: 'Copy without result',
        indent: true,
        onPress: () => {
          onCopyWithoutResult();
          onDismiss();
        },
      });
    }
  }

  items.push(
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
  );

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

  // §8.6 `Create link`: the explicit counterpart to §8.7 continuation — drops a free
  // reference to this value near it without an operator, for a link the user wants to
  // place and drag elsewhere. Same eligibility as continuation's source value
  // (number, result, or live reference), so it shares `canLabel`'s condition.
  if (canLabel) {
    items.push({
      label: 'Create link',
      onPress: () => {
        onCreateLink(nodeId);
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
  onCreateLink: (nodeId: NodeId) => void;
  onCopy: (nodeId: NodeId) => void;
  onCopyWithoutResult: () => void;
}

export function ContextMenuOverlay({
  onDeleteNode,
  onSelectGroup,
  onSelectAll,
  onUnlinkFromParent,
  onLabelNode,
  onCreateLink,
  onCopy,
  onCopyWithoutResult,
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
        onCreateLink={onCreateLink}
        onCopy={onCopy}
        onCopyWithoutResult={onCopyWithoutResult}
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
  // The `Copy As` → `Copy without result` nested row (§8.6) — extra left padding
  // reads as "belongs to the item above" without a separate flyout sheet.
  rowIndent: {
    paddingLeft: 34,
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
