// Design tokens sampled from the reference image's pixels. See docs/ARCHITECTURE.md §1.2.
// The reference raster has a cell height of 256px; these are that geometry normalised
// to a 64dp node height.

export const tokens = {
  nodeHeight: 64,
  borderBand: 3,
  numeralFontSize: 30,
  numeralFontWeight: '800' as const,
  numberPaddingX: 12,
  operatorWidth: 34,
  equalsWidth: 35,
  /** Bumped from the reference's 3 (ratio-accurate) to 8 for a friendlier silhouette. */
  cornerRadius: 8,
  /** Offset of the maths axis (where +, -, = glyphs are drawn) below the cell's vertical centre. */
  mathAxisOffset: 4,
} as const;

export type NodeRole = 'number' | 'operator' | 'equals' | 'result';

interface RolePalette {
  fill: string;
  border: string;
}

export const rolePalette: Record<NodeRole, RolePalette> = {
  number: { fill: '#44BDAD', border: '#8CE0D2' },
  operator: { fill: '#FFBF28', border: '#FFD78E' },
  equals: { fill: '#7030A0', border: '#AA557F' },
  result: { fill: '#FF7E79', border: '#FFA3A0' },
};

export const glyphColor = '#FFFFFF';

/** Neutral caption colour for a node's `label` when it has no identity (§6, §11.1).
 *  Identity-bearing cells paint the caption in their hue instead (P6.5). */
export const labelColor = '#3B4252';

/** Mid-drag insertion caret (§8.3 / P3.6). Light hairline on the dark canvas — not an
 *  identity hue and not a role fill, so it never reads as "this slot is a number/operator".
 *  `labelColor` is too dark against the canvas to see (verified in-browser). */
export const insertionCaretColor = '#F3F4F6';

/** Result cells get a dot texture on top of their fill: a 4x4 unit tile with
 *  1-unit dots at (1,0) and (3,2), coloured resultDotColor. See §1.2 and §11.3. */
export const resultDotColor = '#FFD1CF';

/** Identity hues (§11.1 / P6.5 / P6.8): assigned at render time to a value that is
 *  referenced or labelled. Never persisted — decision 12. Validated for
 *  deuteranopia/protanopia against every other swatch and the structural role
 *  fills (§1.2) — see `paletteAccessibility.ts` and the P6.8 journal entry.
 *  Replaces the pre-check first guess (`#2F6BFF`, `#22A75B`, `#E0479E`,
 *  `#00B8D9`, `#8E6E53`, `#5B4CC4`). */
export const identityHues = [
  '#2F6BFF',
  '#0D8A4A',
  '#880E4F',
  '#00B8D9',
  '#B8860B',
  '#560BAD',
] as const;

/** Mix `#RRGGBB` toward white by `amount` ∈ [0, 1]. Shared by paren depth tints
 *  and identity reference borders. */
export function lightenHex(hex: string, amount: number): string {
  const body = hex.startsWith('#') ? hex.slice(1) : hex;
  const mix = (value: number) =>
    Math.round(value + (255 - value) * amount)
      .toString(16)
      .padStart(2, '0');
  const channels = [body.slice(0, 2), body.slice(2, 4), body.slice(4, 6)].map(
    (c) => parseInt(c, 16),
  );
  return `#${channels.map(mix).join('')}`;
}

/** Lighter border twin for an identity fill. Role cells pair fill with a distinct
 *  border band; references do the same so the cell stays bounded on the dark
 *  canvas rather than reading as a flat unedged block. */
export function identityBorderFor(fillHue: string): string {
  return lightenHex(fillHue, 0.35);
}
