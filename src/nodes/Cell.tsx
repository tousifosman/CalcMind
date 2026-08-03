// Shared chrome for every node kind (§1.1, §11.3): the fixed-height, coloured-band pill and its
// optional label. Plain RN `View`s with `borderRadius`/`borderWidth`, no SVG - the border band is
// drawn as a border rather than a nested inset View because that's the cheapest way to get a
// flush ring at an exact `borderBand` width without hand-computing an inner radius. Node-kind
// components (NumberNode etc.) own their palette, width and glyph content and render through
// this so the five of them don't each re-derive the same box model.
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { tokens, labelColor } from '../ui/tokens';

interface CellProps {
  width: number;
  fill: string;
  border: string;
  label?: string;
  testID?: string;
  children: ReactNode;
}

export function Cell({ width, fill, border, label, testID, children }: CellProps) {
  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      <View
        testID={testID}
        style={[styles.band, { width, borderColor: border, backgroundColor: fill }]}
      >
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
    color: labelColor,
    marginBottom: 2,
  },
  band: {
    height: tokens.nodeHeight,
    borderRadius: tokens.cornerRadius,
    borderWidth: tokens.borderBand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
