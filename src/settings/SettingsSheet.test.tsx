import { act } from 'react-test-renderer';
import { SettingsSheet, SettingsOverlay } from './SettingsSheet';
import { useUiStore } from '../store/uiStore';
import { renderNode, unmountAll } from '../nodes/testUtils';
import { version } from '../../package.json';

function resetStore() {
  useUiStore.setState({ settingsVisible: false });
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('SettingsSheet (mode-strip cog)', () => {
  test('opens on the root pane, with About as its only row', () => {
    const renderer = renderNode(<SettingsSheet onDismiss={jest.fn()} />);

    expect(renderer.root.findByProps({ testID: 'settings-row-about' })).toBeTruthy();
    // Nothing else pretends to be functional yet - only Done and the one row.
    expect(renderer.root.findAllByProps({ testID: 'settings-about-name' })).toHaveLength(0);
  });

  test('Done calls onDismiss', () => {
    const onDismiss = jest.fn();
    const renderer = renderNode(<SettingsSheet onDismiss={onDismiss} />);

    const done = renderer.root
      .findAll((n) => n.props.testID === 'settings-done')
      .find((n) => n.props.onPress !== undefined)!;
    act(() => {
      done.props.onPress();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('tapping About navigates to the about pane, showing name, version, and tagline', () => {
    const renderer = renderNode(<SettingsSheet onDismiss={jest.fn()} />);

    const aboutRow = renderer.root
      .findAll((n) => n.props.testID === 'settings-row-about')
      .find((n) => n.props.onPress !== undefined)!;
    act(() => {
      aboutRow.props.onPress();
    });

    expect(renderer.root.findByProps({ testID: 'settings-about-name' }).props.children).toBe(
      'CalcMind',
    );
    expect(renderer.root.findByProps({ testID: 'settings-about-version' }).props.children).toEqual(
      ['Version ', version],
    );
    expect(renderer.root.findByProps({ testID: 'settings-about-tagline' })).toBeTruthy();
    // The root row is gone now - the pane switched, it didn't stack.
    expect(renderer.root.findAllByProps({ testID: 'settings-row-about' })).toHaveLength(0);
  });

  test('Back from the about pane returns to the root pane', () => {
    const renderer = renderNode(<SettingsSheet onDismiss={jest.fn()} />);

    act(() => {
      renderer.root
        .findAll((n) => n.props.testID === 'settings-row-about')
        .find((n) => n.props.onPress !== undefined)!
        .props.onPress();
    });
    act(() => {
      renderer.root
        .findAll((n) => n.props.testID === 'settings-about-back')
        .find((n) => n.props.onPress !== undefined)!
        .props.onPress();
    });

    expect(renderer.root.findByProps({ testID: 'settings-row-about' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'settings-about-name' })).toHaveLength(0);
  });
});

describe('SettingsOverlay', () => {
  test('renders nothing when settings are closed', () => {
    const renderer = renderNode(<SettingsOverlay />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('opens when settingsVisible is set, and closeSettings dismisses it', () => {
    act(() => {
      useUiStore.getState().openSettings();
    });
    const renderer = renderNode(<SettingsOverlay />);
    expect(
      renderer.root.findAll((n) => n.props.testID === 'settings-screen').length,
    ).toBeGreaterThanOrEqual(1);

    act(() => {
      useUiStore.getState().closeSettings();
    });
    expect(renderer.root.findAllByProps({ testID: 'settings-screen' })).toHaveLength(0);
  });
});
