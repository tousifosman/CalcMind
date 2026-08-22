// Shared Reanimated viewport values from Canvas (§7). Node drag (P3.5) needs the live
// zoom to convert screen-pixel pan translations into world deltas — reading the Zustand
// store mid-gesture would be a frame behind a pinch and would make snap thresholds feel
// zoom-dependent, which §7 forbids. Context keeps the shared values on the UI thread.
import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type { WorldRect } from './autoPan';

/** Callbacks around an auto-pan that's actually about to happen — see `panIntoView` below.
 *  Both fire at most once per call; neither fires at all if the rect already fit and no pan
 *  was needed. */
export interface AutoPanCallbacks {
  /** Called synchronously, immediately before the pan animation starts. */
  onWillPan?: () => void;
  /** Called once the pan settles (commits), or once `rect` is confirmed to need no pan. */
  onSettled?: () => void;
}

export interface CanvasViewportValues {
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  zoom: SharedValue<number>;
  /** Auto-pan-to-edited-cell (§7 P7 follow-up): animates the canvas so `rect` (world
   *  space) clears `AUTO_PAN_PADDING` on every edge it currently violates, then commits
   *  the result the same way a released gesture does (`Canvas`'s own `commitViewport`).
   *  A no-op (including `callbacks`) if `rect` already fits. See `autoPan.ts` for the
   *  geometry. `callbacks` exists for a caller like `NumberNode` that needs to blur its own
   *  focused input for the pan's duration — see its call site for why. */
  panIntoView: (rect: WorldRect, callbacks?: AutoPanCallbacks) => void;
}

export const CanvasViewportContext = createContext<CanvasViewportValues | null>(null);

export function useCanvasViewport(): CanvasViewportValues {
  const ctx = useContext(CanvasViewportContext);
  if (!ctx) {
    throw new Error('useCanvasViewport must be used inside Canvas');
  }
  return ctx;
}

/** Same context, but returns `null` instead of throwing when there is no `<Canvas>`
 *  ancestor. For a consumer like `NumberNode` where auto-pan is a best-effort extra
 *  rather than a hard requirement — component-test specs render it standalone, without
 *  mounting a `Canvas`, and that must keep working rather than crash on this. */
export function useCanvasViewportOptional(): CanvasViewportValues | null {
  return useContext(CanvasViewportContext);
}
