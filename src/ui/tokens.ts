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

/** Neutral caption colour for a node's `label` (§6, §11.1). Not an identity hue - those are
 *  P6.5 - so this is the same neutral ink `docs/assets/node-anatomy.svg` uses for its own
 *  callouts, not a colour invented for this purpose. */
export const labelColor = '#3B4252';

/** Mid-drag insertion caret (§8.3 / P3.6). Light hairline on the dark canvas — not an
 *  identity hue and not a role fill, so it never reads as "this slot is a number/operator".
 *  `labelColor` is too dark against the canvas to see (verified in-browser). */
export const insertionCaretColor = '#F3F4F6';

/** Result cells get a dot texture on top of their fill: a 4x4 unit tile with
 *  1-unit dots at (1,0) and (3,2), coloured resultDotColor. See §1.2 and §11.3. */
export const resultDotColor = '#FFD1CF';

/** Identity hues (§11.1): assigned to a value that is referenced or labelled.
 *  Render-time only, never persisted — see §11.1 and decision 12. Chosen to stay
 *  distinguishable from the structural palette above and from each other; NOT yet
 *  checked for deuteranopia/protanopia (§17.2, open question 6) — validate before
 *  this list is used for anything the user depends on to distinguish links. */
export const identityHues = [
  '#2F6BFF',
  '#22A75B',
  '#E0479E',
  '#00B8D9',
  '#8E6E53',
  '#5B4CC4',
] as const;
