// §11.4: identity hue map is derived once per `document.nodes` identity, not
// once per mounted node subscriber.
import { createEmptyDocument, createNumberNode } from '../model/factories';
import { assignIdentityHues } from '../engine/identity';
import { identityHues } from '../ui/tokens';
import {
  identityHueMapFor,
  resetIdentityHueCacheForTests,
} from './useIdentityHue';

jest.mock('../engine/identity', () => {
  const actual = jest.requireActual('../engine/identity') as typeof import('../engine/identity');
  return {
    ...actual,
    assignIdentityHues: jest.fn(actual.assignIdentityHues),
  };
});

const assignMock = assignIdentityHues as jest.MockedFunction<typeof assignIdentityHues>;

beforeEach(() => {
  resetIdentityHueCacheForTests();
  assignMock.mockClear();
});

describe('identityHueMapFor cache (§11.4)', () => {
  test('reuses the map for the same nodes record; recomputes when the record identity changes', () => {
    const doc = createEmptyDocument();
    const a = createNumberNode({ x: 0, y: 0 }, '1');
    a.label = 'A';
    doc.nodes[a.id] = a;

    const first = identityHueMapFor(doc.nodes);
    const second = identityHueMapFor(doc.nodes);
    expect(second).toBe(first);
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(first.get(a.id)).toBe(identityHues[0]);

    // Immer-style: a new nodes record invalidates the cache.
    const nextNodes = { ...doc.nodes };
    const third = identityHueMapFor(nextNodes);
    expect(third).not.toBe(first);
    expect(assignMock).toHaveBeenCalledTimes(2);
  });
});
