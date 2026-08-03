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
import { NodeLayer } from '../canvas/NodeLayer';
import { hitTestNode } from '../canvas/hitTest';
import { Keypad } from '../keypad/Keypad';
import { useUiStore } from '../store/uiStore';
import { useDocumentStore } from '../store/documentStore';
import { addNumberNode, selectNode, editNumberNode, deselectNode } from '../store/commands';
import { getDeviceLocale } from '../ui/locale';
import { Vec2 } from '../model/types';

export function AppShell() {
  // Escape deselects (§8.5, §8.6) when nothing is focused to catch the key itself - a number
  // node being edited handles its own Escape in NumberNode.tsx, since react-native-web's
  // TextInput stops the keydown from ever reaching this listener while it's focused. Web only:
  // there is no hardware-keyboard equivalent on a touch-only device, and full keyboard support
  // (native included) is P2.8/P7.2's job.
  useEffect(() => {
    // No DOM lib in this project's tsconfig (a bare RN app, per AGENTS.md) - `any` here is
    // the same trade Canvas.tsx's onWheel already makes for the same reason.
    const webWindow = Platform.OS === 'web' ? (globalThis as any).window : undefined;
    if (!webWindow) return;
    function onKeyDown(e: any): void {
      if (e.key === 'Escape') deselectNode();
    }
    webWindow.addEventListener('keydown', onKeyDown);
    return () => webWindow.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleCanvasTap(worldPoint: Vec2): void {
    const { document } = useDocumentStore.getState();
    const hit = hitTestNode(document.nodes, worldPoint, getDeviceLocale());
    if (hit) {
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

  return (
    <GestureHandlerRootView style={styles.fill}>
      <View style={styles.fill}>
        <Canvas style={styles.fill} onTap={handleCanvasTap}>
          <NodeLayer />
        </Canvas>
        <Keypad />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
