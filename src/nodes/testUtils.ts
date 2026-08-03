// Test-only helpers shared by the node-view specs.
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { ReactElement } from 'react';
import type { ReactTestInstance } from 'react-test-renderer';

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

/** Renders inside `act` and registers the result for `unmountAll`. Node views subscribe to the
 *  Zustand store directly, so a renderer left mounted from a previous test still receives (and
 *  warns about, outside `act`) the next test's `resetStore()` - tests must unmount between runs,
 *  not just let the renderer go out of scope. */
export function renderNode(element: ReactElement): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  mountedRenderers.push(renderer);
  return renderer;
}

/** Call from `afterEach` in any spec using `renderNode`. */
export function unmountAll(): void {
  while (mountedRenderers.length > 0) {
    const renderer = mountedRenderers.pop()!;
    act(() => {
      renderer.unmount();
    });
  }
}

/** `Cell` forwards its own `testID` prop straight onto the host View it wraps, so
 *  `findByProps({ testID })` matches both the `Cell` composite and RN's `View` `forwardRef`
 *  wrapper as well as the host node - three instances share the same prop, and only the host
 *  one (a string `type`) carries the resolved `style` array these tests assert on. */
export function findHostByTestID(root: ReactTestInstance, testID: string): ReactTestInstance {
  const host = root
    .findAllByProps({ testID })
    .find((instance) => typeof instance.type === 'string');
  if (!host) throw new Error(`findHostByTestID: no host node with testID "${testID}"`);
  return host;
}
