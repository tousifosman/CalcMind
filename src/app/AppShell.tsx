// App shell: providers that must wrap everything else, plus the top-level tap dispatch that
// turns "the user tapped somewhere on the canvas" into a domain action (§8.6, P2.6): hit-test
// the tap's world point against the document's nodes, then either select what was hit or
// create a fresh number node in edit mode where there wasn't one. This replaces P2.7's
// placeholder - every tap toggled the keypad, because nothing else was on the canvas yet to
// tap on (see the P2.7 addendum in docs/journal/2026-08-03.md) - now that there is.
// See docs/ARCHITECTURE.md §5.1. Theme injection lands with light/dark support in P7.
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Canvas } from '../canvas/Canvas';
import { ConnectorLayer } from '../canvas/ConnectorLayer';
import { NodeLayer } from '../canvas/NodeLayer';
import { hitTestNode } from '../canvas/hitTest';
import { Keypad } from '../keypad/Keypad';
import { ContextMenuOverlay } from '../nodes/NodeContextMenu';
import { DanglingRecoveryOverlay } from '../nodes/DanglingRecoverySheet';
import { commandFromHardwareKey, dispatchEditorCommand } from '../keypad/keymap';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import {
  addNumberNode,
  selectNode,
  editNumberNode,
  deleteNode,
  selectGroup,
  unlinkFromParent,
  repointReference,
  editNodeLabel,
} from '../store/commands';
import { isDanglingReference, isRepointTarget } from '../engine/reference';
import { getDeviceLocale } from '../ui/locale';
import { Vec2 } from '../model/types';
import { startAutosave } from './startAutosave';
import { loadMostRecentDocument } from './loadOnStart';

export function AppShell() {
  // Debounced autosave + force-flush on background / pagehide (§12.3, P5.6).
  useEffect(() => startAutosave(), []);

  // Open the most recently saved document on launch, if one exists (§12.3, P5.5). Must run
  // after startAutosave() above so there is a controller to flush before the swap.
  useEffect(() => {
    loadMostRecentDocument();
  }, []);

  // Hardware/web-keyboard dispatch (§8.5, P2.8), through the same `dispatchEditorCommand`
  // the on-screen keypad uses below. Web only: there is no hardware-keyboard equivalent on a
  // touch-only device. A number node being edited handles its own keys locally in
  // NumberNode.tsx instead - react-native-web's TextInput stops most handled keydowns from
  // reaching this listener while it's focused (docs/journal/2026-08-03.md), but not
  // reliably every one: Enter was observed reaching both handlers, double-dispatching (the
  // editing node's own '=' append, then a second, unwanted "nothing selected" one here). The
  // activeElement check below is the actual guard against that - the comment above is why a
  // key gets to the input at all, not why this listener skips it.
  useEffect(() => {
    // No DOM lib in this project's tsconfig (a bare RN app, per AGENTS.md) - `any` here is
    // the same trade Canvas.tsx's onWheel already makes for the same reason.
    const webWindow = Platform.OS === 'web' ? (globalThis as any).window : undefined;
    if (!webWindow) return;
    function onKeyDown(e: any): void {
      const focusedTag = webWindow.document?.activeElement?.tagName;
      if (focusedTag === 'INPUT' || focusedTag === 'TEXTAREA') return;
      // Escape cancels an in-progress re-point (P6.4) before the usual deselect path.
      if (e.key === 'Escape' && useUiStore.getState().repointReferenceId) {
        useUiStore.getState().clearRepoint();
        return;
      }
      const command = commandFromHardwareKey(e.key);
      if (command) dispatchEditorCommand(command);
    }
    webWindow.addEventListener('keydown', onKeyDown);
    return () => webWindow.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleCanvasTap(worldPoint: Vec2): void {
    useUiStore.getState().setLastInteractionPoint(worldPoint);
    const { document } = useDocumentStore.getState();
    const hit = hitTestNode(document.nodes, worldPoint, getDeviceLocale());

    // Re-point mode (§11.2): the next valid value becomes the new target; empty /
    // invalid taps cancel without creating a node.
    const repointId = useUiStore.getState().repointReferenceId;
    if (repointId) {
      if (hit && isRepointTarget(hit.id, document.nodes, repointId)) {
        repointReference(repointId, hit.id);
      }
      useUiStore.getState().clearRepoint();
      return;
    }

    if (hit) {
      if (hit.kind === 'reference') {
        const ref = document.nodes[hit.id];
        if (ref && ref.kind === 'reference' && isDanglingReference(ref, document.nodes)) {
          useUiStore.getState().openDanglingRecovery(hit.id);
          return;
        }
      }
      if (hit.kind === 'number') {
        editNumberNode(hit.id);
      } else {
        selectNode(hit.id);
      }
    } else {
      const id = addNumberNode(worldPoint, '');
      editNumberNode(id);
    }
    useUiStore.getState().showKeypad();
  }

  // Long-press dispatches the §8.6 context menu. `screenPoint` is in absolute screen
  // coordinates so the floating sheet can be positioned without the viewport transform.
  function handleCanvasLongPress(worldPoint: Vec2, screenPoint: Vec2): void {
    const { document } = useDocumentStore.getState();
    const hit = hitTestNode(document.nodes, worldPoint, getDeviceLocale());
    if (hit) {
      useUiStore.getState().openContextMenu({ kind: 'node', nodeId: hit.id, anchor: screenPoint });
    } else {
      useUiStore.getState().openContextMenu({ kind: 'canvas', anchor: screenPoint });
    }
  }

  return (
    <GestureHandlerRootView style={styles.fill}>
      <View style={styles.fill}>
        <Canvas style={styles.fill} onTap={handleCanvasTap} onLongPress={handleCanvasLongPress}>
          <NodeLayer />
          <ConnectorLayer />
        </Canvas>
        <Keypad locale={getDeviceLocale()} onKeyPress={dispatchEditorCommand} />
        <ContextMenuOverlay
          onDeleteNode={deleteNode}
          onSelectGroup={selectGroup}
          onUnlinkFromParent={unlinkFromParent}
          onLabelNode={editNodeLabel}
        />
        <DanglingRecoveryOverlay />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
