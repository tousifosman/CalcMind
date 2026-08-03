// World <-> screen transform. See docs/ARCHITECTURE.md §7.
//
//   screen = (world - pan) * zoom
//   world  = screen / zoom + pan
import { Vec2, Viewport } from '../model/types';

export function worldToScreen(world: Vec2, viewport: Viewport): Vec2 {
  return {
    x: (world.x - viewport.pan.x) * viewport.zoom,
    y: (world.y - viewport.pan.y) * viewport.zoom,
  };
}

export function screenToWorld(screen: Vec2, viewport: Viewport): Vec2 {
  return {
    x: screen.x / viewport.zoom + viewport.pan.x,
    y: screen.y / viewport.zoom + viewport.pan.y,
  };
}
