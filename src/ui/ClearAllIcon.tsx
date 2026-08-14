// "AC" monogram for the Clear All mode-strip key (§8.5, P7.8). Real text, not a hand-drawn
// glyph: two rounds of hand-authored SVG letterforms (see git history) couldn't match what the
// platform's own font rasterizer gets for free at any size. Heroicons has no letter-glyph icon
// to import, so this instead reuses the app's own type convention - this codebase never loads a
// custom font anywhere (tokens.numeralFontWeight is plain system-font weight, same as every
// other Text in the app) - rather than adding a one-off custom typeface for two letters.
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from './tokens';

interface ClearAllIconProps {
  size?: number;
  color?: string;
}

export function ClearAllIcon({ size = 24, color = '#000000' }: ClearAllIconProps) {
  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          // ~1/6-1/5 of the side, the same neighbourhood as Heroicons' own StopIcon
          // (2.25 radius on a 13.5 square) - enough to read as a rounded square
          // without softening into a pill.
          borderRadius: size * 0.2,
          // Matches Heroicons' own 1.5-per-24 stroke ratio so the frame reads the
          // same weight as the imported icons either side of it in the strip.
          borderWidth: Math.max(1, size * (1.5 / 24)),
          borderColor: color,
        },
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[
          styles.label,
          { color, fontSize: size * 0.46, fontWeight: tokens.numeralFontWeight },
        ]}
      >
        AC
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
});
