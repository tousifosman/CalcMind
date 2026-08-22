// Design tokens sampled from the reference image's pixels. See docs/ARCHITECTURE.md §1.2.
// The reference raster has a cell height of 256px; these are that geometry normalised
// to a 64dp node height.

export const tokens = {
  /** The cell height *at the compiled-in default font size* (`numeralFontSize` below) — see
   *  {@link nodeHeightFor} for the live value at any other size (§1.2 P7: the Settings
   *  sheet's Canvas Number Font Size row). Used directly only where a live per-render value isn't
   *  warranted (the §8.4 spatial-hash bucket edge is a coarse performance partition, not a
   *  hit-test bound) or as the fallback default for a `fontSize`-parameterised function
   *  nobody has called with a live size. Reduced from the reference's ratio-accurate 64
   *  alongside the numeral shrink — a fixed 64dp band around a 22px glyph (down from the
   *  reference's 30px) left visible empty space above and below the text. Cut further to 40
   *  on follow-up feedback that 48 still looked spacious; held near the ~44dp common
   *  touch-target minimum since this height is also the cell's tap/drag target (no separate
   *  hitSlop — see `canvas/hitTest.ts`), not just its paint box. `mathAxisOffset` scaled
   *  down with it. */
  nodeHeight: 40,
  borderBand: 3,
  /** Reduced from the reference's ratio-accurate 30 — at that size, in the reference's bold
   *  800 weight, glyphs read as oversized on-screen. Deliberate deviation from the sampled
   *  geometry above (§1.2). This is only the compiled-in *default* — §12.5's Settings sheet
   *  lets the user override it live, 14–30dp; live call sites read
   *  `usePreferencesStore`, not this constant. */
  numeralFontSize: 22,
  numeralFontWeight: '400' as const,
  /** Reduced from the reference's ratio-accurate 12, then halved again to 4 on further
   *  user feedback that 8 still read as excess whitespace rather than breathing room. */
  numberPaddingX: 4,
  /** Vertical counterpart to `numberPaddingX`, added above and below the glyph to derive
   *  the cell height at any font size (`nodeHeightFor`) — chosen so that
   *  `nodeHeightFor(numeralFontSize) === nodeHeight` exactly (9×2 + 22 = 40), so the live
   *  formula reproduces the tuned default rather than jumping on first use (§1.2 P7). */
  numberPaddingY: 9,
  /** Reduced from the reference-derived 34 — measured live (`getBoundingClientRect` on the
   *  glyph vs. the cell) at ~10.5dp of padding either side of a ~13dp-wide glyph, well past
   *  `numberPaddingX`'s already-trimmed 4dp for the equivalent number-cell padding. `26`
   *  keeps a visibly narrower pill without cutting so far the glyph looks cramped. */
  operatorWidth: 26,
  equalsWidth: 35,
  /** Bumped from the reference's 3 (ratio-accurate) to 8 for a friendlier silhouette. */
  cornerRadius: 8,
  /** Offset of the maths axis (where +, -, = glyphs are drawn) below the cell's vertical centre.
   *  Scaled down with `nodeHeight`'s reductions to stay near the same ~0.063 ratio to the band
   *  height that the reference geometry set (§1.2); rounded to the nearest dp each step. Stays
   *  fixed even though `nodeHeight` is now live (§12.5) — a 1-2dp baseline nudge reads the same
   *  across the whole settings range; not worth the extra derivation. */
  mathAxisOffset: 2,
} as const;

/** Live cell height at any numeral font size (§1.2 P7) — `fontSize` plus `numberPaddingY` on
 *  each side, the same symmetric-padding model `numberPaddingX` already uses for width.
 *  Every call site that needs the *actual* rendered cell height (not the coarse
 *  `SPATIAL_HASH_BUCKET` partition) derives it from whatever `fontSize` it already has in
 *  scope through this function, rather than reading `tokens.nodeHeight` — see §12.5. */
export function nodeHeightFor(fontSize: number): number {
  return fontSize + 2 * tokens.numberPaddingY;
}

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

/** Keyboard/pointer selection focus ring (P7.2 / §8.6). Pure white on the dark canvas —
 *  role borders are themselves light tints, so a near-white grey read as part of the
 *  structural band; full white keeps the keypad target obvious on operators and
 *  read-only results and selected-but-not-editing numbers (continuation, §8.7). */
export const selectionFocusColor = '#FFFFFF';

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
