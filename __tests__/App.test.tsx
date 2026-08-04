/**
 * @format
 */

jest.mock('@dr.pogodin/react-native-fs');

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders correctly', async () => {
  let root: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    root = ReactTestRenderer.create(<App />);
  });
  // Unmount so AppShell's startAutosave cleanup detaches AppState listeners.
  await ReactTestRenderer.act(() => {
    root!.unmount();
  });
});
