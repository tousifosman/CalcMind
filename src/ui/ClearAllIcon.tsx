// Hand-authored "AC" monogram for the Clear All mode-strip key (§8.5, P7.8). Heroicons has no
// letter-glyph icons, so this draws in the outline set's own visual language rather than
// importing from it: 24x24 viewBox, stroke-width 1.5, round caps/joins, fill: none, `color`
// resolved the same way `react-native-heroicons` resolves it (§11.3). The frame's corner
// radius (3.2 on an 18.8 square, ~1/6 of the side) matches the ratio Heroicons itself uses for
// StopIcon's rounded square rather than an arbitrary rounder guess - an earlier draft used 1/3
// and read as a pill next to the imported icons either side of it in the strip.
import Svg, { Path, Rect } from 'react-native-svg';

interface ClearAllIconProps {
  size?: number;
  color?: string;
}

export function ClearAllIcon({ size = 24, color }: ClearAllIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} color={color}>
      <Rect x={2.6} y={2.6} width={18.8} height={18.8} rx={3.2} />
      {/* "A": two legs meeting at an apex wide enough that the round join reads as a
          point, not a blob, plus a crossbar sized to the same interpolated width. */}
      <Path d="M9 7.7 6.2 16.3" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 7.7 11.8 16.3" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7.4 13h3.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* "C": radius matched to the A's cap height (7.7-16.3) so the two letters read as
          the same size - a radius fit to the available width instead reads noticeably
          smaller than the A next to it. */}
      <Path d="M18.75 9.55A4.35 4.35 0 1 0 18.75 14.45" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
