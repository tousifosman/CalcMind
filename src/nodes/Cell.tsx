// Shared chrome for every node kind (§1.1, §11.3): the fixed-height, coloured-band pill and its
// optional label. Plain RN `View`s with `borderRadius`/`borderWidth`, no SVG - the border band is
// drawn as a border rather than a nested inset View because that's the cheapest way to get a
// flush ring at an exact `borderBand` width without hand-computing an inner radius. Node-kind
// components (NumberNode etc.) own their palette, width and glyph content and render through
// this so the five of them don't each re-derive the same box model.
//
// Identity (§11.1 / P6.5 / P6b.1): when `identityHue` is set, a ring is drawn inset on the cell
// and the label (if any) uses that hue. References pass the hue as their fill/border instead and
// leave `identityHue` unset — the ring is for declaring cells, the fill is for reference cells.
// References that still show the identity caption pass `labelHue` so the caption matches without
// drawing a ring. In-place label editing (P6b.1) swaps the caption Text for a TextInput.
import { ReactNode, useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { tokens, labelColor } from '../ui/tokens';

/** Inset identity ring width — matches the structural `borderBand` so the ring reads as
 *  part of the same chrome language, not a thicker selection outline. */
export const IDENTITY_RING_WIDTH = tokens.borderBand;

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
  onLabelChange?: (text: string) => void;
  onLabelBlur?: () => void;
  testID?: string;
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
  onLabelChange,
  onLabelBlur,
  testID,
  children,
}: CellProps) {
  const captionColor = labelHue ?? identityHue ?? labelColor;
  const showCaption = isEditingLabel || (label !== undefined && label.length > 0);
  const labelInputRef = useRef<TextInput>(null);

  // Same web-only Space/Enter trap as NumberNode: gesture-handler's KeyboardEventManager
  // treats a bubbling Space/Enter on a GestureDetector ancestor as tap activation, which
  // steals focus mid-label (Space → only the first word survives). Stop propagation on the
  // real <input> before that listener sees it; Enter still finishes via onSubmitEditing.
  useEffect(() => {
    if (Platform.OS !== 'web' || !isEditingLabel) return;
    const inputNode: any = labelInputRef.current;
    if (!inputNode || typeof inputNode.addEventListener !== 'function') return;

    function onNativeKeyDown(e: any): void {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.stopPropagation();
    }
    inputNode.addEventListener('keydown', onNativeKeyDown);
    return () => inputNode.removeEventListener('keydown', onNativeKeyDown);
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
      <View
        testID={testID}
        style={[
          styles.band,
          { width, borderColor: border, backgroundColor: fill },
          // Clip the inset ring to the rounded corner only when a ring is present —
          // keep overflow visible otherwise so shared Cell chrome never hides a
          // future focus/selection affordance that paints past the band bounds.
          identityHue ? styles.bandClip : null,
        ]}
      >
        {identityHue ? (
          <View
            pointerEvents="none"
            testID={testID ? `${testID}-identity-ring` : undefined}
            style={[
              styles.identityRing,
              {
                borderColor: identityHue,
                // Inner radius: outer corner minus the structural band so the ring
                // sits flush inside the fill rather than clipping the outer curve.
                borderRadius: Math.max(0, tokens.cornerRadius - tokens.borderBand),
              },
            ]}
          />
        ) : null}
        {children}
      </View>
    </View>
  );
}

/** Text style every glyph (digits, operators, `=`, parens) renders through, so a mixed row reads
 *  as sitting on one baseline: nudged `mathAxisOffset` below the cell's vertical centre (§1.2). */
export const glyphTextStyle = StyleSheet.create({
  glyph: {
    fontSize: tokens.numeralFontSize,
    fontWeight: tokens.numeralFontWeight,
    marginTop: tokens.mathAxisOffset,
  },
}).glyph;

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
  band: {
    height: tokens.nodeHeight,
    borderRadius: tokens.cornerRadius,
    borderWidth: tokens.borderBand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandClip: {
    overflow: 'hidden',
  },
  identityRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: IDENTITY_RING_WIDTH,
  },
});
