// §1.2 / §11.3 result-cell decoration: a 4×4 unit tile with 1-unit dots at (1,0)
// and (3,2) in `resultDotColor`. Pattern via react-native-svg so web and native
// share one definition (same geometry as docs/assets/formula-reference.svg).
// Decorative only — the solid role fill and border still carry read-only-ness
// without it (decision #9).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { resultDotColor, tokens } from '../ui/tokens';

/** Tile edge in SVG user units — matches §1.2 and the reference pattern. */
export const RESULT_DOT_TILE = 4;

interface ResultDotTextureProps {
  /** Inner band width (cell width minus the structural border on both sides). */
  width: number;
  /** Inner band height (nodeHeight minus the structural border on both sides). */
  height: number;
  /** SVG pattern id — must be unique per on-screen cell (web shares one DOM). */
  patternId: string;
  testID?: string;
}

export function ResultDotTexture({
  width,
  height,
  patternId,
  testID,
}: ResultDotTextureProps) {
  if (width <= 0 || height <= 0) return null;

  return (
    <View
      pointerEvents="none"
      testID={testID}
      // Decorative: keep out of the accessibility tree (hue + border already
      // announce read-only via the cell; texture adds no information).
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        StyleSheet.absoluteFill,
        {
          // Match the fill's inner corner so overflow:hidden on the band clips
          // cleanly; without this the square SVG would square off the pill.
          borderRadius: Math.max(0, tokens.cornerRadius - tokens.borderBand),
        },
      ]}
    >
      <Svg width={width} height={height} testID={testID ? `${testID}-svg` : undefined}>
        <Defs>
          <Pattern
            id={patternId}
            width={RESULT_DOT_TILE}
            height={RESULT_DOT_TILE}
            patternUnits="userSpaceOnUse"
          >
            <Rect x={1} y={0} width={1} height={1} fill={resultDotColor} />
            <Rect x={3} y={2} width={1} height={1} fill={resultDotColor} />
          </Pattern>
        </Defs>
        <Rect
          width={width}
          height={height}
          fill={`url(#${patternId})`}
          testID={testID ? `${testID}-fill` : undefined}
        />
      </Svg>
    </View>
  );
}
