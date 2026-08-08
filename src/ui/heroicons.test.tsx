import React from 'react';
import TrashIcon from 'react-native-heroicons/outline/TrashIcon';
import { findHostByTestID, renderNode, unmountAll } from '../nodes/testUtils';

afterEach(unmountAll);

/** Smoke: the Heroicons RN packaging resolves under Jest and mounts through the
 *  `react-native-svg` mock. Deep import matches §4 / §11.3 (avoids the style-barrel). */
describe('react-native-heroicons', () => {
  test('outline TrashIcon mounts with size and color props', () => {
    const renderer = renderNode(<TrashIcon size={20} color="#111827" testID="heroicon-trash" />);
    const icon = findHostByTestID(renderer.root, 'heroicon-trash');
    expect(icon.props.width).toBe(20);
    expect(icon.props.height).toBe(20);
    expect(icon.props.color).toBe('#111827');
    expect(icon.props.accessibilityRole).toBe('Svg');
  });
});
