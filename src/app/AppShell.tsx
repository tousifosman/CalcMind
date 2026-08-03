// App shell: providers that must wrap everything else. See docs/ARCHITECTURE.md
// §5.1. Theme injection lands with light/dark support in P7.
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Canvas } from '../canvas/Canvas';

export function AppShell() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <Canvas />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
