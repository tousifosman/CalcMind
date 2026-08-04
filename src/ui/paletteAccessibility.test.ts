// P6.8 — identity palette CVD check. Method: Machado et al. 2009 severity-1.0
// simulation + CIE76 ΔE ≥ MIN_DELTA_E for every identity×identity pair and every
// identity×structural pair. See docs/journal/2026-08-04.md (P6.8 entry).
import {
  MIN_DELTA_E,
  deltaE76,
  findPaletteCollisions,
  hexToRgb,
  simulateCvd,
  structuralFills,
} from './paletteAccessibility';
import { identityHues } from './tokens';

describe('paletteAccessibility primitives', () => {
  test('hexToRgb parses #RRGGBB', () => {
    expect(hexToRgb('#FFFFFF')).toEqual([1, 1, 1]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#2F6BFF')[2]).toBeCloseTo(1, 5);
  });

  test('identical colours have ΔE 0; black/white are far apart', () => {
    const white = hexToRgb('#FFFFFF');
    expect(deltaE76(white, white)).toBeCloseTo(0, 5);
    expect(deltaE76(hexToRgb('#000000'), white)).toBeGreaterThan(50);
  });

  test('CVD simulation is a no-op for kind=none and changes protan/deutan', () => {
    const hex = '#22A75B';
    expect(simulateCvd(hex, 'none')).toEqual(hexToRgb(hex));
    expect(simulateCvd(hex, 'protanopia')).not.toEqual(hexToRgb(hex));
    expect(simulateCvd(hex, 'deuteranopia')).not.toEqual(hexToRgb(hex));
  });
});

describe('identity palette CVD validation (P6.8)', () => {
  test(`all identity pairs and identity×structural stay ≥ ${MIN_DELTA_E} ΔE under normal/protan/deutan`, () => {
    const collisions = findPaletteCollisions(identityHues, MIN_DELTA_E);
    expect(collisions).toEqual([]);
  });

  test('structural fills used in the check match §1.2 role fills', () => {
    expect(structuralFills.map((s) => s.role)).toEqual([
      'number',
      'operator',
      'equals',
      'result',
    ]);
  });

  test('the pre-P6.8 first-guess palette fails this check (documents why it was replaced)', () => {
    // First-guess set from §11.1 before P6.8 — kept here so a future revert is
    // caught by the suite rather than re-litigated from memory.
    const firstGuess = [
      '#2F6BFF',
      '#22A75B',
      '#E0479E',
      '#00B8D9',
      '#8E6E53',
      '#5B4CC4',
    ] as const;
    const collisions = findPaletteCollisions(firstGuess, MIN_DELTA_E);
    expect(collisions.length).toBeGreaterThan(0);
    // Spot-check the collisions the journal names.
    const summary = collisions.map(
      (c) => `${c.kind}:${c.a}/${c.bLabel ?? c.b}`,
    );
    expect(summary.some((s) => s.includes('deuteranopia:#E0479E/number'))).toBe(
      true,
    );
    expect(summary.some((s) => s.includes('protanopia:#5B4CC4/equals'))).toBe(
      true,
    );
  });
});
