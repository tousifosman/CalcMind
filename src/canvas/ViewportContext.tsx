// Shared Reanimated viewport values from Canvas (§7). Node drag (P3.5) needs the live
// zoom to convert screen-pixel pan translations into world deltas — reading the Zustand
// store mid-gesture would be a frame behind a pinch and would make snap thresholds feel
// zoom-dependent, which §7 forbids. Context keeps the shared values on the UI thread.
import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

export interface CanvasViewportValues {
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  zoom: SharedValue<number>;
}

export const CanvasViewportContext = createContext<CanvasViewportValues | null>(null);

export function useCanvasViewport(): CanvasViewportValues {
  const ctx = useContext(CanvasViewportContext);
  if (!ctx) {
    throw new Error('useCanvasViewport must be used inside Canvas');
  }
  return ctx;
}
