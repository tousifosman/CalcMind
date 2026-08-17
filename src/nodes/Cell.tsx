// Shared chrome for every node kind (§1.1, §11.3): the fixed-height, coloured-band pill and its
// optional label. Plain RN `View`s with per-corner `border*Radius`/`border*Width` for the common
// case — the border band is drawn as a border rather than a nested inset View because that's the
// cheapest way to get a flush ring at an exact `borderBand` width without hand-computing an inner
// radius. A chain's members are flush (§1.1), so only the cell at each end of a multi-member
// chain rounds its outer corner and carries a border on that outer side — `groupPosition` (from
// `useGroupPosition`) is what each caller passes to say which cell that is; see `cornerRadii`/
// `sideBorderWidths` below. Result cells — and any reference cell tracing back to one, §11.1 —
// pass an SVG `bandBackground` (dot texture, P7.3) clipped to the band's own rounded corner.
// The identity/selection rings sit outside the band as siblings, not children of it, precisely
// so that per-cell clip never touches them. Node-kind components (NumberNode etc.) own their
// palette, width and glyph content and render through this so the six of them don't each
// re-derive the same box model.
//
// Identity (§11.1 / P6.5 / P6b.1): when `identityHue` is set, a ring is drawn outside the cell
// (same geometry as the P7.2 selection focus ring below it) and the label (if any) uses that
// hue. References pass the hue as their fill/border instead and leave `identityHue` unset — the
// ring is for declaring cells, the fill is for reference cells. References that still show the
// identity caption pass `labelHue` so the caption matches without drawing a ring. In-place label
// editing (P6b.1) swaps the caption Text for a TextInput.
import { ReactNode, useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, TextStyle, View } from 'react-native';
import { tokens, labelColor, selectionFocusColor, nodeHeightFor } from '../ui/tokens';
import { usePreferencesStore } from '../store/preferencesStore';
import type { GroupPosition } from './useGroupPosition';

/** Per-corner radius for a cell at `groupPosition`: only the chain's outer edge rounds
 *  (§1.1 / `docs/assets/formula-reference.svg`'s single clipped silhouette around the whole
 *  chain) — a `start` cell rounds its left corners, an `end` cell its right, a `middle` cell
 *  is square on both, and a `solo` cell (no chain, or a chain of one) rounds all four, same
 *  as before this distinction existed. */
function cornerRadii(groupPosition: GroupPosition, radius: number) {
  const left = groupPosition === 'solo' || groupPosition === 'start';
  const right = groupPosition === 'solo' || groupPosition === 'end';
  return {
    borderTopLeftRadius: left ? radius : 0,
    borderBottomLeftRadius: left ? radius : 0,
    borderTopRightRadius: right ? radius : 0,
    borderBottomRightRadius: right ? radius : 0,
  };
}

/** Left/right border width for a cell at `groupPosition`: an interior seam between flush
 *  neighbours carries no border on either side of it, only the chain's two outer edges do —
 *  top and bottom stay full-width on every cell regardless (set as a static style below).
 *  Exported so a `bandBackground` (the P7.3 result dot texture, on `ResultNode` and any
 *  `ReferenceNode` showing the same pattern) can size itself to the band's actual inner
 *  content box rather than assuming both sides always carry a border. */
export function sideBorderWidths(groupPosition: GroupPosition, width: number) {
  const left = groupPosition === 'solo' || groupPosition === 'start' ? width : 0;
  const right = groupPosition === 'solo' || groupPosition === 'end' ? width : 0;
  return { borderLeftWidth: left, borderRightWidth: right };
}

/** Outset identity ring width — matches the structural `borderBand` so the ring reads as
 *  part of the same chrome language, not a thicker selection outline. Same width as
 *  `SELECTION_FOCUS_WIDTH` (they share the same outset geometry; only the colour differs). */
export const IDENTITY_RING_WIDTH = tokens.borderBand;

/** Selection focus ring paints just outside the structural band so it stays visible on
 *  every role fill (P7.2: "Focus is always visible"). Outset clears the light role
 *  border; width is thick enough to read at chain scale. The selected node's wrapper
 *  also elevates z-index so flush neighbours cannot cover this ring. */
export const SELECTION_FOCUS_WIDTH = 3;
export const SELECTION_FOCUS_OUTSET = 4;

/**
 * Web-only: stop Space/Enter bubbling to a GestureDetector ancestor (§11.1 / P6b.1).
 * Exported so the trap itself is unit-testable — react-test-renderer TextInput refs are
 * not real DOM nodes, so the effect path cannot be exercised end-to-end in Jest.
 */
export function attachLabelKeyTrap(inputNode: {
  addEventListener: (type: string, listener: (e: { key: string; stopPropagation: () => void }) => void) => void;
  removeEventListener: (type: string, listener: (e: { key: string; stopPropagation: () => void }) => void) => void;
}): () => void {
  function onNativeKeyDown(e: { key: string; stopPropagation: () => void }): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation();
  }
  inputNode.addEventListener('keydown', onNativeKeyDown);
  return () => inputNode.removeEventListener('keydown', onNativeKeyDown);
}

interface CellProps {
  width: number;
  fill: string;
  border: string;
  label?: string;
  /** Identity hue for a declaring cell's ring + default label colour (§11.1). */
  identityHue?: string;
  /** Caption colour without drawing an identity ring — references showing a source label. */
  labelHue?: string;
  /** When true, the caption is an editable TextInput (P6b.1). */
  isEditingLabel?: boolean;
  /** Selected (or group-selected) — draws the P7.2 focus ring. */
  selected?: boolean;
  /** This selection is specifically `Select group` / `Select all` membership (§8.6), not
   *  the lone keypad-target selection — so the focus ring should merge with flush group
   *  siblings rather than draw a complete ring around just this one cell. See
   *  `useNodeGroupSelected`. Defaults to `false`: an ordinary single selection always gets
   *  a full ring, even on a structurally `'middle'` cell. */
  groupSelected?: boolean;
  /** This cell's position in its chain's flush run (§1.1). Defaults to `'solo'` — full round,
   *  full border — so a caller that hasn't wired chain membership through renders exactly as
   *  it did before this prop existed. */
  groupPosition?: GroupPosition;
  onLabelChange?: (text: string) => void;
  onLabelBlur?: () => void;
  testID?: string;
  /** Painted inside the band, behind the glyph, clipped to its rounded corner (result dot
   *  texture). The identity/selection rings sit outside the band entirely, so this never
   *  clips them (§11.1). */
  bandBackground?: ReactNode;
  children: ReactNode;
}

export function Cell({
  width,
  fill,
  border,
  label,
  identityHue,
  labelHue,
  isEditingLabel,
  selected,
  groupSelected,
  groupPosition = 'solo',
  onLabelChange,
  onLabelBlur,
  testID,
  bandBackground,
  children,
}: CellProps) {
  const captionColor = labelHue ?? identityHue ?? labelColor;
  const showCaption = isEditingLabel || (label !== undefined && label.length > 0);
  const labelInputRef = useRef<TextInput>(null);
  // Live cell height (§12.5): every cell shares the same height (unlike `width`, which
  // varies per node and is computed by each caller), so Cell reads the setting itself
  // rather than asking all six node components to also thread it through as a prop.
  const height = nodeHeightFor(usePreferencesStore((s) => s.numeralFontSize));

  // Same web-only Space/Enter trap as NumberNode: gesture-handler's KeyboardEventManager
  // treats a bubbling Space/Enter on a GestureDetector ancestor as tap activation, which
  // steals focus mid-label (Space → only the first word survives). Stop propagation on the
  // real <input> before that listener sees it; Enter still finishes via onSubmitEditing.
  useEffect(() => {
    if (Platform.OS !== 'web' || !isEditingLabel) return;
    const inputNode: any = labelInputRef.current;
    if (!inputNode || typeof inputNode.addEventListener !== 'function') return;
    return attachLabelKeyTrap(inputNode);
  }, [isEditingLabel]);

  return (
    <View style={styles.wrapper}>
      {showCaption ? (
        isEditingLabel ? (
          <TextInput
            ref={labelInputRef}
            testID={testID ? `${testID}-label-input` : undefined}
            style={[styles.label, styles.labelInput, { color: captionColor }]}
            value={label ?? ''}
            onChangeText={onLabelChange}
            onBlur={onLabelBlur}
            autoFocus
            blurOnSubmit
            onSubmitEditing={onLabelBlur}
            placeholder="Label"
            placeholderTextColor={labelColor}
          />
        ) : (
          <Text
            testID={testID ? `${testID}-label` : undefined}
            style={[styles.label, { color: captionColor }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        )
      ) : null}
      {/* Outset rings (identity, selection focus) are siblings of the band, not children
       *  of it: the band clips its own content to the rounded corner whenever it has a
       *  `bandBackground` texture (P7.3), and an outset ring nested *inside* a clipped
       *  parent would itself be clipped away — invisible despite rendering correctly.
       *  This wrapper is the shared positioning frame both the band and the rings size
       *  themselves against. */}
      <View style={[styles.cellOuter, { width, height }]}>
        <View
          testID={testID}
          style={[
            styles.band,
            { width, height, borderColor: border, backgroundColor: fill },
            cornerRadii(groupPosition, tokens.cornerRadius),
            sideBorderWidths(groupPosition, tokens.borderBand),
            // Clip the result dot texture to the rounded corner (P7.3). Safe to apply
            // regardless of `selected` now that the rings living outside this View no
            // longer share its clip.
            bandBackground ? styles.bandClip : null,
          ]}
        >
          {bandBackground}
          {children}
        </View>
        {/* Identity ring is outset, same geometry as the selection focus ring below —
         *  the ring *is* the cell's outer chrome, so when selected the outset white
         *  focus ring takes over instead of stacking a second outer ring in a
         *  different colour (especially the blue first palette swatch reading as a
         *  second "focus" border). Hue still shows via caption colour and
         *  connectors (§11.1) while selected. */}
        {identityHue && !selected ? (
          <View
            pointerEvents="none"
            testID={testID ? `${testID}-identity-ring` : undefined}
            style={[
              styles.identityRing,
              { borderColor: identityHue },
              // Same outer-edge-only rounding as the selection focus ring — a square
              // middle cell's identity ring stays square, not rounded past its edge.
              cornerRadii(groupPosition, tokens.cornerRadius + SELECTION_FOCUS_OUTSET),
            ]}
          />
        ) : null}
        {selected ? (
          <View
            pointerEvents="none"
            testID={testID ? `${testID}-selection-focus` : undefined}
            style={[
              styles.selectionFocus,
              { borderColor: selectionFocusColor },
              // Same outer-edge-only rounding as the band itself (a square middle
              // cell's focus ring stays square, not a rounded ring on a square cell).
              cornerRadii(groupPosition, tokens.cornerRadius + SELECTION_FOCUS_OUTSET),
              // §8.6: a `Select group`/`Select all` member merges its ring with flush
              // group siblings — no border on the interior seam, only the group's own
              // outer edge — so the whole selected chain reads as one big cell rather
              // than N individually-outlined ones. An ordinary single selection (not
              // part of a group) always gets the full ring regardless of chain
              // position, hence `'solo'` here when `groupSelected` is false.
              sideBorderWidths(groupSelected ? groupPosition : 'solo', SELECTION_FOCUS_WIDTH),
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Text style every glyph (digits, operators, `=`, parens) renders through, so a mixed row reads
 *  as sitting on one baseline: nudged `mathAxisOffset` below the cell's vertical centre (§1.2).
 *  `fontSize` is the one live, user-adjustable piece (§1.2 P7 preference) — subscribed
 *  reactively so every glyph cell repaints immediately on a Settings change; weight and the
 *  maths-axis offset stay fixed tokens, not user-adjustable. Not memoised with
 *  `StyleSheet.create` (that API is for static styles) — a plain object is fine here, same
 *  cost as the `[glyphTextStyle, { color }]` array every call site already allocates. */
export function useGlyphTextStyle(): TextStyle {
  const fontSize = usePreferencesStore((s) => s.numeralFontSize);
  return {
    fontSize,
    fontWeight: tokens.numeralFontWeight,
    marginTop: tokens.mathAxisOffset,
  };
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 2,
  },
  labelInput: {
    minWidth: 64,
    padding: 0,
    textAlign: 'center',
  },
  // Sized in the inline style array to exactly match the band (width/height are both live
  // per §12.5) so the band fills it completely. Unclipped, so the identity/selection rings
  // — its other two children, positioned outset against *this* box — stay visible even
  // when the band itself clips its own content for a `bandBackground` texture.
  cellOuter: {},
  band: {
    // height comes from the inline style array above — live per §12.5, not a static token.
    // Corner radii and left/right border widths come from `cornerRadii`/`sideBorderWidths`
    // in the inline style array (§1.1: group position decides those, not a static value).
    // Top/bottom border stays full-width on every cell regardless of group position.
    borderTopWidth: tokens.borderBand,
    borderBottomWidth: tokens.borderBand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandClip: {
    overflow: 'hidden',
  },
  identityRing: {
    position: 'absolute',
    top: -SELECTION_FOCUS_OUTSET,
    left: -SELECTION_FOCUS_OUTSET,
    right: -SELECTION_FOCUS_OUTSET,
    bottom: -SELECTION_FOCUS_OUTSET,
    borderWidth: IDENTITY_RING_WIDTH,
  },
  selectionFocus: {
    position: 'absolute',
    top: -SELECTION_FOCUS_OUTSET,
    left: -SELECTION_FOCUS_OUTSET,
    right: -SELECTION_FOCUS_OUTSET,
    bottom: -SELECTION_FOCUS_OUTSET,
    // Top/bottom stay full-width on every cell regardless of group selection — only
    // left/right (the interior seam) is ever suppressed, via `sideBorderWidths` in the
    // inline style array above (§8.6).
    borderTopWidth: SELECTION_FOCUS_WIDTH,
    borderBottomWidth: SELECTION_FOCUS_WIDTH,
  },
});
