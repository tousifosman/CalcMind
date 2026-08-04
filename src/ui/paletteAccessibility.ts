// Identity-palette accessibility helpers (P6.8 / §11.1 / §17.2 item 6).
//
// Colour carries link identity, so the palette must stay distinguishable under
// the two most common dichromacies (protanopia, deuteranopia) as well as in
// normal vision — both adjacent identity pairs and identity-vs-structural
// (teal / amber / purple / salmon) pairs.
//
// Method (locked by paletteAccessibility.test.ts, recorded in the journal):
//   1. Simulate CVD with Machado et al. (2009) severity-1.0 matrices in
//      linear-sRGB space.
//   2. Convert to CIE L*a*b* (D65) and measure ΔE₇₆.
//   3. Require ΔE ≥ {@link MIN_DELTA_E} for every adjacent identity pair and
//      every identity×structural pair, under normal / protan / deutan.
import { identityHues, rolePalette } from './tokens';

/** Glanceable-separation floor used for P6.8. Below this, two fills are treated
 *  as colliding for the purpose of link identity. */
export const MIN_DELTA_E = 15;

/** Machado et al. 2009, protanopia at severity 1.0 (linear sRGB). */
const MACHADO_PROTAN: ReadonlyArray<readonly [number, number, number]> = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];

/** Machado et al. 2009, deuteranopia at severity 1.0 (linear sRGB). */
const MACHADO_DEUTAN: ReadonlyArray<readonly [number, number, number]> = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];

export type CvdKind = 'none' | 'protanopia' | 'deuteranopia';

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length !== 6) {
    throw new Error(`hexToRgb: expected #RRGGBB, got ${hex}`);
  }
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function applyMatrix(
  m: ReadonlyArray<readonly [number, number, number]>,
  rgb: Rgb,
): Rgb {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  return [
    linearToSrgb(m[0]![0] * r + m[0]![1] * g + m[0]![2] * b),
    linearToSrgb(m[1]![0] * r + m[1]![1] * g + m[1]![2] * b),
    linearToSrgb(m[2]![0] * r + m[2]![1] * g + m[2]![2] * b),
  ];
}

/** Simulate how `hex` appears under `kind`. `none` is the identity. */
export function simulateCvd(hex: string, kind: CvdKind): Rgb {
  const rgb = hexToRgb(hex);
  if (kind === 'none') return rgb;
  return applyMatrix(kind === 'protanopia' ? MACHADO_PROTAN : MACHADO_DEUTAN, rgb);
}

function rgbToXyz(rgb: Rgb): Rgb {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  ];
}

function xyzToLab(xyz: Rgb): Rgb {
  // D65 white point
  const xn = 0.95047;
  const yn = 1;
  const zn = 1.08883;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;
  const fx = f(xyz[0] / xn);
  const fy = f(xyz[1] / yn);
  const fz = f(xyz[2] / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE between two sRGB colours in 0–1 channel space. */
export function deltaE76(a: Rgb, b: Rgb): number {
  const A = xyzToLab(rgbToXyz(a));
  const B = xyzToLab(rgbToXyz(b));
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

export interface PalettePairFailure {
  kind: CvdKind;
  a: string;
  b: string;
  /** Human label for `b` when it is a structural role fill. */
  bLabel?: string;
  deltaE: number;
}

/** Structural fills identity hues must stay clear of (§1.2 role table). */
export const structuralFills: ReadonlyArray<{ role: string; hex: string }> = [
  { role: 'number', hex: rolePalette.number.fill },
  { role: 'operator', hex: rolePalette.operator.fill },
  { role: 'equals', hex: rolePalette.equals.fill },
  { role: 'result', hex: rolePalette.result.fill },
];

/**
 * Adjacent identity pairs + every identity×structural pair under the three
 * vision conditions. Returns every pair whose ΔE falls below `minDeltaE`.
 */
export function findPaletteCollisions(
  palette: readonly string[] = identityHues,
  minDeltaE: number = MIN_DELTA_E,
): PalettePairFailure[] {
  const kinds: CvdKind[] = ['none', 'protanopia', 'deuteranopia'];
  const failures: PalettePairFailure[] = [];

  for (const kind of kinds) {
    for (let i = 0; i < palette.length - 1; i++) {
      const a = palette[i]!;
      const b = palette[i + 1]!;
      const deltaE = deltaE76(simulateCvd(a, kind), simulateCvd(b, kind));
      if (deltaE < minDeltaE) {
        failures.push({ kind, a, b, deltaE });
      }
    }
    for (const hue of palette) {
      for (const { role, hex } of structuralFills) {
        const deltaE = deltaE76(simulateCvd(hue, kind), simulateCvd(hex, kind));
        if (deltaE < minDeltaE) {
          failures.push({ kind, a: hue, b: hex, bLabel: role, deltaE });
        }
      }
    }
  }

  return failures;
}
