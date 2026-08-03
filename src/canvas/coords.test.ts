import fc from 'fast-check';
import { worldToScreen, screenToWorld } from './coords';
import { Viewport, ZOOM_MIN, ZOOM_MAX } from '../model/types';

const vec2 = fc.record({
  x: fc.float({ noNaN: true, min: Math.fround(-1e6), max: Math.fround(1e6) }),
  y: fc.float({ noNaN: true, min: Math.fround(-1e6), max: Math.fround(1e6) }),
});

const viewport: fc.Arbitrary<Viewport> = fc.record({
  pan: vec2,
  zoom: fc.float({ noNaN: true, min: Math.fround(ZOOM_MIN), max: Math.fround(ZOOM_MAX) }),
});

describe('worldToScreen / screenToWorld', () => {
  test('are inverses for arbitrary points and viewports', () => {
    fc.assert(
      fc.property(vec2, viewport, (world, vp) => {
        const roundTripped = screenToWorld(worldToScreen(world, vp), vp);
        expect(roundTripped.x).toBeCloseTo(world.x, 6);
        expect(roundTripped.y).toBeCloseTo(world.y, 6);
      }),
    );
  });

  test('screenToWorld undoes worldToScreen the other way round too', () => {
    fc.assert(
      fc.property(vec2, viewport, (screen, vp) => {
        const roundTripped = worldToScreen(screenToWorld(screen, vp), vp);
        expect(roundTripped.x).toBeCloseTo(screen.x, 6);
        expect(roundTripped.y).toBeCloseTo(screen.y, 6);
      }),
    );
  });

  test('identity viewport (no pan, zoom 1) is a no-op', () => {
    const vp: Viewport = { pan: { x: 0, y: 0 }, zoom: 1 };
    expect(worldToScreen({ x: 12, y: -7 }, vp)).toEqual({ x: 12, y: -7 });
    expect(screenToWorld({ x: 12, y: -7 }, vp)).toEqual({ x: 12, y: -7 });
  });

  test('pan shifts, zoom scales, around the reference formulas', () => {
    const vp: Viewport = { pan: { x: 100, y: 50 }, zoom: 2 };
    expect(worldToScreen({ x: 150, y: 50 }, vp)).toEqual({ x: 100, y: 0 });
    expect(screenToWorld({ x: 100, y: 0 }, vp)).toEqual({ x: 150, y: 50 });
  });
});
