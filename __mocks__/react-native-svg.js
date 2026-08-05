// Manual Jest mock. react-native-svg has no jest-environment fallback for the
// native / DOM backends it normally drives; component tests only need the
// element surface (tag name + props) so paths, markers and badges can be
// asserted without a real SVG runtime. Mirrored after the reanimated mock.
const React = require('react');
const { View, Text } = require('react-native');

function createSvgElement(displayName, Host = View) {
  function SvgElement(props) {
    const { children, ...rest } = props;
    return React.createElement(Host, { ...rest, accessibilityRole: displayName }, children);
  }
  SvgElement.displayName = displayName;
  return SvgElement;
}

module.exports = {
  __esModule: true,
  default: createSvgElement('Svg'),
  Svg: createSvgElement('Svg'),
  Path: createSvgElement('Path'),
  Defs: createSvgElement('Defs'),
  Marker: createSvgElement('Marker'),
  G: createSvgElement('G'),
  Circle: createSvgElement('Circle'),
  Rect: createSvgElement('Rect'),
  Line: createSvgElement('Line'),
  Text: createSvgElement('SvgText', Text),
  TSpan: createSvgElement('TSpan', Text),
};
