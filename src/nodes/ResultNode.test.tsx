import React from 'react';
import { ResultNode, STALE_RESULT_OPACITY } from './ResultNode';
import { useDocumentStore } from '../store/documentStore';
import { setNodeRaw } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette } from '../ui/tokens';
import { explainEngineError, type EngineErrorKind } from '../engine/errors';
import type { ResultDerived, ResultNode as ResultNodeModel } from '../model/types';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
}

beforeEach(resetStore);
afterEach(unmountAll);

/** No factory exists for result nodes (P2.3 only covers CRUD-able kinds; a result is created by
 *  the engine, P4) - injected straight into the draft, the same way commands.test.ts builds
 *  chain fixtures it has no command for yet. */
function addResultNode(document: ResultNodeModel): void {
  useDocumentStore.getState().applyCommand((draft) => {
    draft.nodes[document.id] = document;
  });
}

function resultWith(derived: ResultDerived | undefined): ResultNodeModel {
  return {
    id: 'r1',
    kind: 'result',
    sourceChainId: 'c1',
    position: { x: 0, y: 0 },
    chainId: 'c1',
    createdAt: 0,
    derived,
  };
}

function contentText(renderer: ReturnType<typeof renderNode>): string {
  const content = findHostByTestID(renderer.root, 'result-node-r1-content');
  return content.props.children as string;
}

function contentStyle(renderer: ReturnType<typeof renderNode>): object | object[] {
  return findHostByTestID(renderer.root, 'result-node-r1-content').props.style;
}

describe('ResultNode', () => {
  test('renders its derived display, solid fill, no dot texture', () => {
    addResultNode(
      resultWith({ display: '1204', computedAt: '2026-08-03T00:00:00.000Z' }),
    );

    const renderer = renderNode(<ResultNode id="r1" />);

    expect(contentText(renderer)).toBe('1204');

    const band = findHostByTestID(renderer.root, 'result-node-r1');
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: rolePalette.result.fill,
          borderColor: rolePalette.result.border,
        }),
      ]),
    );
    // Solid fill only - no texture pattern/image sibling next to the glyph (§11.3, decision #9).
    expect(band.children).toHaveLength(1);
  });

  test('renders nothing for a missing node', () => {
    const renderer = renderNode(<ResultNode id="does-not-exist" />);
    expect(renderer.toJSON()).toBeNull();
  });

  test('is read-only: an edit attempt is rejected, not silently swallowed', () => {
    addResultNode(resultWith(undefined));

    expect(() => setNodeRaw('r1', '5')).toThrow(/read-only/);
    // The rejected attempt must not have mutated the node either.
    expect(useDocumentStore.getState().document.nodes.r1).toMatchObject({ kind: 'result' });
  });

  test('Stale keeps the previous value dimmed rather than flashing empty (§9)', () => {
    addResultNode(
      resultWith({
        display: '1204',
        computedAt: '2026-08-04T00:00:00.000Z',
        outcome: { status: 'stale' },
      }),
    );

    const renderer = renderNode(<ResultNode id="r1" />);
    expect(contentText(renderer)).toBe('1204');
    expect(contentStyle(renderer)).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: STALE_RESULT_OPACITY })]),
    );
  });

  test.each([
    'Incomplete',
    'InvalidSequence',
    'DivideByZero',
    'Overflow',
    'NotANumber',
  ] as const satisfies readonly EngineErrorKind[])(
    '%s renders its explanation distinguishably (§10.4, §11.2)',
    (error) => {
      addResultNode(
        resultWith({
          display: '99',
          computedAt: '2026-08-04T00:00:00.000Z',
          outcome: { status: 'error', error },
        }),
      );

      const renderer = renderNode(<ResultNode id="r1" />);
      const text = contentText(renderer);
      expect(text).toBe(explainEngineError(error));
      // Not the cached numeric display, and not a bare glyph.
      expect(text).not.toBe('99');
      expect(text).not.toMatch(/^[?¿‽!]+$/);
      // Errors are not dimmed — dimming is reserved for Stale's previous value.
      const flat = (Array.isArray(contentStyle(renderer))
        ? contentStyle(renderer)
        : [contentStyle(renderer)]) as Array<Record<string, unknown>>;
      expect(flat.some((s) => s && s.opacity === STALE_RESULT_OPACITY)).toBe(false);
    },
  );

  test('CircularReference renders an explanation stub (full cycle naming is P6.3)', () => {
    addResultNode(
      resultWith({
        display: '1',
        computedAt: '2026-08-04T00:00:00.000Z',
        outcome: { status: 'error', error: 'CircularReference' },
      }),
    );

    const renderer = renderNode(<ResultNode id="r1" />);
    expect(contentText(renderer)).toBe(explainEngineError('CircularReference'));
    expect(contentText(renderer)).not.toBe('?');
  });
});
