import React from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { ResultNode, STALE_RESULT_OPACITY } from './ResultNode';
import { RESULT_DOT_TILE } from './ResultDotTexture';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { setNodeRaw } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette, resultDotColor, tokens, nodeHeightFor } from '../ui/tokens';
import { widthOf } from '../chains/measure';
import { explainEngineError, explainCircularReference, CIRCULAR_UNLINK_LABEL, type EngineErrorKind } from '../engine/errors';
import type { ResultDerived, ResultNode as ResultNodeModel } from '../model/types';
import { CanvasViewportContext } from '../canvas/ViewportContext';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';
import { act } from 'react-test-renderer';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({ selectedNodeId: null });
  usePreferencesStore.setState({ autoPanToEditedCell: true });
}

/** Stub `<Canvas>` context, same shape `NumberNode.test.tsx` uses for the same purpose. */
function ViewportStub({
  children,
  panIntoView,
}: {
  children: React.ReactNode;
  panIntoView: (rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const zoom = useSharedValue(1);
  return (
    <CanvasViewportContext.Provider value={{ panX, panY, zoom, panIntoView }}>
      {children}
    </CanvasViewportContext.Provider>
  );
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
  test('renders its derived display with solid fill, border, and §1.2 dot texture', () => {
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

    // Dot texture is a decorative SVG sibling under the glyph (§11.3 / P7.3). Hue + border
    // still carry read-only-ness without it (decision #9) — the solid fill above is present.
    const texture = findHostByTestID(renderer.root, 'result-node-r1-texture');
    expect(texture).toBeTruthy();

    const pattern = renderer.root.findByProps({ accessibilityRole: 'Pattern' });
    expect(pattern.props.id).toBe('result-dots-r1');
    expect(pattern.props.width).toBe(RESULT_DOT_TILE);
    expect(pattern.props.height).toBe(RESULT_DOT_TILE);
    expect(pattern.props.patternUnits).toBe('userSpaceOnUse');

    const dots = pattern.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'Rect' &&
        node.props.fill === resultDotColor,
    );
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => ({ x: d.props.x, y: d.props.y, w: d.props.width, h: d.props.height }))).toEqual([
      { x: 1, y: 0, w: 1, h: 1 },
      { x: 3, y: 2, w: 1, h: 1 },
    ]);

    const fill = findHostByTestID(renderer.root, 'result-node-r1-texture-fill');
    expect(fill.props.fill).toBe('url(#result-dots-r1)');
    // Texture covers the inner band (outside the structural border).
    expect(fill.props.width).toBeGreaterThan(0);
    expect(fill.props.height).toBe(tokens.nodeHeight - 2 * tokens.borderBand);
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

  test('CircularReference names the cycle and offers Unlink (§11.2)', () => {
    addResultNode(
      resultWith({
        display: '1',
        computedAt: '2026-08-04T00:00:00.000Z',
        outcome: {
          status: 'error',
          error: 'CircularReference',
          cycle: {
            chainIds: ['c1', 'c2'],
            chainLabels: ['Alpha', 'Beta'],
            closingReferenceNodeId: 'ref-close',
          },
        },
      }),
    );

    const renderer = renderNode(<ResultNode id="r1" />);
    expect(contentText(renderer)).toBe(explainCircularReference(['Alpha', 'Beta']));
    expect(contentText(renderer)).not.toBe('?');
    expect(contentText(renderer)).not.toBe(explainEngineError('CircularReference'));

    const unlink = renderer.root.findByProps({ testID: 'result-node-r1-unlink' });
    expect(unlink.props.accessibilityLabel).toBe(CIRCULAR_UNLINK_LABEL);
  });

  test('Unlink deletes the closing reference via unlinkReference', () => {
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes['ref-close'] = {
        id: 'ref-close',
        kind: 'reference',
        position: { x: 0, y: 0 },
        chainId: 'c2',
        createdAt: 0,
        targetNodeId: 'r1',
      };
      draft.chains.c2 = { id: 'c2', anchor: { x: 0, y: 0 }, members: ['ref-close'] };
      draft.nodes.r1 = resultWith({
        display: '1',
        computedAt: '2026-08-04T00:00:00.000Z',
        outcome: {
          status: 'error',
          error: 'CircularReference',
          cycle: {
            chainIds: ['c1', 'c2'],
            chainLabels: ['A', 'B'],
            closingReferenceNodeId: 'ref-close',
          },
        },
      });
      draft.chains.c1 = { id: 'c1', anchor: { x: 0, y: 0 }, members: ['r1'] };
    });

    const renderer = renderNode(<ResultNode id="r1" />);
    const unlink = renderer.root.findByProps({ testID: 'result-node-r1-unlink' });
    act(() => {
      unlink.props.onPress();
    });
    expect(useDocumentStore.getState().document.nodes['ref-close']).toBeUndefined();
  });
});

describe('ResultNode auto-pan (§7 P7 follow-up)', () => {
  function selectedResult(): ResultNodeModel {
    return { ...resultWith({ display: '135290700000', computedAt: '2026-08-21T00:00:00.000Z' }), position: { x: 400, y: 60 } };
  }

  test('does not crash when rendered outside <Canvas> — no CanvasViewportContext provider', () => {
    addResultNode(selectedResult());
    useUiStore.setState({ selectedNodeId: 'r1' });
    expect(() => renderNode(<ResultNode id="r1" />)).not.toThrow();
  });

  test('calls panIntoView with the cell world rect once the result becomes selected (§8.7, right after =)', () => {
    addResultNode(selectedResult());
    useUiStore.setState({ selectedNodeId: 'r1' });
    const panIntoView = jest.fn();
    renderNode(
      <ViewportStub panIntoView={panIntoView}>
        <ResultNode id="r1" />
      </ViewportStub>,
    );

    const node = useDocumentStore.getState().document.nodes.r1!;
    const fontSize = usePreferencesStore.getState().numeralFontSize;
    expect(panIntoView).toHaveBeenCalledWith({
      x: 400,
      y: 60,
      width: widthOf(node, 'en-US', fontSize),
      height: nodeHeightFor(fontSize),
    });
  });

  test('does not call panIntoView for a result that is not selected', () => {
    addResultNode(selectedResult());
    const panIntoView = jest.fn();
    renderNode(
      <ViewportStub panIntoView={panIntoView}>
        <ResultNode id="r1" />
      </ViewportStub>,
    );

    expect(panIntoView).not.toHaveBeenCalled();
  });

  test('does not call panIntoView when the preference is turned off', () => {
    usePreferencesStore.setState({ autoPanToEditedCell: false });
    addResultNode(selectedResult());
    useUiStore.setState({ selectedNodeId: 'r1' });
    const panIntoView = jest.fn();
    renderNode(
      <ViewportStub panIntoView={panIntoView}>
        <ResultNode id="r1" />
      </ViewportStub>,
    );

    expect(panIntoView).not.toHaveBeenCalled();
  });
});
