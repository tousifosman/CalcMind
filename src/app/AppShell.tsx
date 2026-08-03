// App shell: providers that must wrap everything else. See docs/ARCHITECTURE.md
// §5.1. Theme injection lands with light/dark support in P7.
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Canvas } from '../canvas/Canvas';
import { Keypad } from '../keypad/Keypad';
import { useUiStore } from '../store/uiStore';

export function AppShell() {
  const toggleKeypad = useUiStore((state) => state.toggleKeypad);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <View style={styles.fill}>
        <Canvas style={styles.fill} onTap={toggleKeypad} />
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
