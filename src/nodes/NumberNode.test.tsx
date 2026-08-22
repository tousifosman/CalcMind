import React from 'react';
import { Platform, Text, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { useSharedValue } from 'react-native-reanimated';
import { NumberNode } from './NumberNode';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { addNumberNode, editNumberNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { rolePalette, nodeHeightFor } from '../ui/tokens';
import { widthOf } from '../chains/measure';
import { CanvasViewportContext } from '../canvas/ViewportContext';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  useUiStore.setState({ selectedNodeId: null, editingNodeId: null });
  usePreferencesStore.setState({ autoPanToEditedCell: true });
}

/** Stub `<Canvas>` context so the auto-pan effect (§7 P7 follow-up) has something to call.
 *  `panIntoView` is the jest.fn() tests assert against; panX/panY/zoom are unused by these
 *  tests but required by the type. */
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

describe('NumberNode', () => {
  test('renders the locale-formatted display value in the number palette', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1020');
    const renderer = renderNode(<NumberNode id={id} />);

    expect(renderer.root.findByType(Text).props.children).toBe('1,020');
    const band = findHostByTestID(renderer.root, `number-node-${id}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: rolePalette.number.fill,
          borderColor: rolePalette.number.border,
        }),
      ]),
    );
  });

  test('renders the label above the cell when present', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[id].label = 'Total';
    });

    const renderer = renderNode(<NumberNode id={id} />);
    const texts = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts).toContain('Total');
  });

  test('renders nothing for a missing node', () => {
    const renderer = renderNode(<NumberNode id="does-not-exist" />);
    expect(renderer.toJSON()).toBeNull();
  });
});

describe('NumberNode editing', () => {
  test('shows a Text glyph, not a TextInput, when not the edit target', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    const renderer = renderNode(<NumberNode id={id} />);
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(renderer.root.findByType(Text).props.children).toBe('5');
  });

  test('swaps to a focused TextInput showing the locale display when editing', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1020');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    const input = renderer.root.findByType(TextInput);
    expect(input.props.value).toBe('1,020');
    expect(input.props.showSoftInputOnFocus).toBe(false);
    expect(input.props.inputMode).toBe('none');
    expect(input.props.keyboardType).toBeUndefined();
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
  });

  test('typing normalises locale input to canonical raw', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onChangeText('3.'));

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '3.' });
  });

  test('an invalid keystroke is dropped rather than stored', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onChangeText('3..'));

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '3' });
  });

  test('backspace on an already-empty raw deletes the node and exits edit mode', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: 'Backspace' } }),
    );

    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('Escape while editing exits edit mode and discards an empty raw', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: 'Escape' } }),
    );

    expect(useDocumentStore.getState().document.nodes[id]).toBeUndefined();
    expect(useUiStore.getState().selectedNodeId).toBeNull();
  });

  test('blurring with a non-empty raw commits it rather than discarding', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '7');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onBlur());

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '7' });
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  test('a hardware operator key while editing continues the chain (P2.8, §8.5)', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '12');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '+' } }));

    const chainId = useDocumentStore.getState().document.nodes[id]!.chainId!;
    const chain = useDocumentStore.getState().document.chains[chainId];
    expect(chain.members).toHaveLength(3);
    expect(useDocumentStore.getState().document.nodes[chain.members[1]]).toMatchObject({
      kind: 'operator',
      op: '+',
    });
    // Dispatch moves the edit target to the fresh operand, so it's no longer this node.
    expect(useUiStore.getState().editingNodeId).toBe(chain.members[2]);
  });

  test('a dispatched command key calls preventDefault, so the browser cannot also insert it', () => {
    // Regression test for the P2.8 hardware-keyboard bug (docs/journal/2026-08-04.md): without
    // preventDefault, react-native-web still performs its native default text-insertion for the
    // keydown, and since dispatchEditorCommand synchronously moves editingNodeId to a *different*
    // node, that insertion lands on the freshly-created operand instead of vanishing - '-' is
    // valid canonical raw, so the leaked character survived as real (wrong) data. `+` isn't
    // canonical raw, so the same leak there was silently swallowed and never visible.
    const id = addNumberNode({ x: 0, y: 0 }, '3');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);
    const preventDefault = jest.fn();

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '-' }, preventDefault }),
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);

    const chainId = useDocumentStore.getState().document.nodes[id]!.chainId!;
    const chain = useDocumentStore.getState().document.chains[chainId];
    const newOperandId = chain.members[2];
    // The whole point: the fresh operand must start genuinely empty, not pre-loaded with '-'.
    expect(useDocumentStore.getState().document.nodes[newOperandId]).toMatchObject({ raw: '' });
  });

  test('a digit key does not call preventDefault, so native insertion + onChangeText still work', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);
    const preventDefault = jest.fn();

    act(() =>
      renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '2' }, preventDefault }),
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  test('a digit typed via a real keystroke is left to onChangeText, not double-applied', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    act(() => editNumberNode(id));
    const renderer = renderNode(<NumberNode id={id} />);

    act(() => renderer.root.findByType(TextInput).props.onKeyPress({ nativeEvent: { key: '2' } }));

    expect(useDocumentStore.getState().document.nodes[id]).toMatchObject({ raw: '1' });
  });
});

describe('NumberNode auto-pan-to-edited-cell (§7 P7 follow-up)', () => {
  test('does not crash when rendered outside <Canvas> — no CanvasViewportContext provider', () => {
    // Every other test in this file renders NumberNode this way (standalone, per this
    // file's own convention) - `useCanvasViewportOptional` (not the throwing
    // `useCanvasViewport`) is what keeps that working once this effect exists.
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    act(() => editNumberNode(id));
    expect(() => renderNode(<NumberNode id={id} />)).not.toThrow();
  });

  test('calls panIntoView with the cell world rect on entering edit mode', () => {
    const id = addNumberNode({ x: 40, y: 60 }, '1020');
    act(() => editNumberNode(id));
    const panIntoView = jest.fn();
    renderNode(
      <ViewportStub panIntoView={panIntoView}>
        <NumberNode id={id} />
      </ViewportStub>,
    );

    const node = useDocumentStore.getState().document.nodes[id]!;
    // Second arg (the blur/refocus callbacks - see NumberNode.tsx's own comment) is only
    // ever populated on a real web DOM ref, which react-test-renderer's TextInput mock
    // doesn't provide - `undefined` here is the correct, expected value under Jest, not a
    // gap in this test.
    expect(panIntoView).toHaveBeenCalledWith(
      {
        x: 40,
        y: 60,
        width: widthOf(node, 'en-US', usePreferencesStore.getState().numeralFontSize),
        height: nodeHeightFor(usePreferencesStore.getState().numeralFontSize),
      },
      undefined,
    );
  });

  test('does not call panIntoView for a cell that is not the edit target', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    const panIntoView = jest.fn();
    renderNode(
      <ViewportStub panIntoView={panIntoView}>
        <NumberNode id={id} />
      </ViewportStub>,
    );

    expect(panIntoView).not.toHaveBeenCalled();
  });

  test('does not call panIntoView when the preference is turned off', () => {
    usePreferencesStore.setState({ autoPanToEditedCell: false });
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    act(() => editNumberNode(id));
    const panIntoView = jest.fn();
    renderNode(
      <ViewportStub panIntoView={panIntoView}>
        <NumberNode id={id} />
      </ViewportStub>,
    );

    expect(panIntoView).not.toHaveBeenCalled();
  });

  test('re-checks as the cell grows while being typed into', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '1');
    act(() => editNumberNode(id));
    const panIntoView = jest.fn();
    const renderer = renderNode(
      <ViewportStub panIntoView={panIntoView}>
        <NumberNode id={id} />
      </ViewportStub>,
    );
    expect(panIntoView).toHaveBeenCalledTimes(1);

    act(() => renderer.root.findByType(TextInput).props.onChangeText('123456789'));

    expect(panIntoView).toHaveBeenCalledTimes(2);
    const node = useDocumentStore.getState().document.nodes[id]!;
    expect(panIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: widthOf(node, 'en-US', usePreferencesStore.getState().numeralFontSize),
      }),
      undefined,
    );
  });

  test('a real blur exits edit mode as before; the auto-pan\'s own blur during a pan does not', () => {
    // Regression test: `.blur()` called for the pan (below) fires this input's own
    // `onBlur={deselectNode}` just like a genuine blur would - without the suppression this
    // guards, panning while editing exited edit mode outright, and the *next* digit press
    // landed with nothing selected, which `dispatchEditorCommand` reads as "start a fresh
    // cell" - reported live as a stray extra cell appearing mid-type.
    const originalOS = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    try {
      const id = addNumberNode({ x: 0, y: 0 }, '5');
      act(() => editNumberNode(id));

      let capturedCallbacks: { onWillPan?: () => void; onSettled?: () => void } | undefined;
      const panIntoView = jest.fn(
        (
          _rect: unknown,
          callbacks?: { onWillPan?: () => void; onSettled?: () => void },
        ) => {
          capturedCallbacks = callbacks;
        },
      );
      const renderer = renderNode(
        <ViewportStub panIntoView={panIntoView}>
          <NumberNode id={id} />
        </ViewportStub>,
      );
      expect(capturedCallbacks?.onWillPan).toBeDefined();
      expect(capturedCallbacks?.onSettled).toBeDefined();

      // Pan starts: NumberNode's own onWillPan arms the guard and calls the (under Jest,
      // inert - there's no real DOM event system here) `.blur()`.
      act(() => capturedCallbacks!.onWillPan!());
      // A blur landing mid-pan (what `.blur()` above would trigger on a real device) must
      // not exit edit mode.
      act(() => renderer.root.findByType(TextInput).props.onBlur());
      expect(useUiStore.getState().editingNodeId).toBe(id);
      expect(useDocumentStore.getState().document.nodes[id]).toBeDefined();

      // Pan settles: refocuses, disarms the guard.
      act(() => capturedCallbacks!.onSettled!());
      // A blur after settling is a real one again.
      act(() => renderer.root.findByType(TextInput).props.onBlur());
      expect(useUiStore.getState().editingNodeId).toBeNull();
    } finally {
      (Platform as { OS: string }).OS = originalOS;
    }
  });
});
