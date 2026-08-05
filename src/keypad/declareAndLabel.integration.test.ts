// P6b.2 — declare-and-label idiom (§1.3): type a trivial `10,000 = [10,000]`,
// label the result, continue from it. One integration test walks the path a
// user types, including locale display (§10.3) and onward reference (§8.7).
import { dispatchEditorCommand } from './keymap';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { setNodeLabel, editNodeLabel } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { formatForDisplay } from '../engine/format';
import { labelForNode } from '../engine/identity';
import type { NumberNode, ReferenceNode, ResultNode } from '../model/types';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStores() {
  useDocumentStore.setState({
    document: createEmptyDocument(),
    undoStack: [],
    redoStack: [],
  });
  useUiStore.setState({
    selectedNodeId: null,
    editingNodeId: null,
    editingLabelNodeId: null,
    lastInteractionPoint: { x: 40, y: 40 },
  });
}

beforeEach(resetStores);

describe('declare-and-label idiom (P6b.2 / §1.3)', () => {
  test('type 10000 =, label Initial Deposit, continue — locale + reference hold', () => {
    // 1. Type the declaration digits. Storage stays canonical; display groups.
    for (const d of ['1', '0', '0', '0', '0'] as const) {
      dispatchEditorCommand({ region: 'digit', value: d });
    }
    const editingId = useUiStore.getState().editingNodeId!;
    const typing = useDocumentStore.getState().document.nodes[editingId] as NumberNode;
    expect(typing).toMatchObject({ kind: 'number', raw: '10000' });
    expect(formatForDisplay(typing.raw, 'en-US')).toBe('10,000');

    // 2. `=` evaluates the trivial expression and selects the result (§8.7 / P6b.2).
    dispatchEditorCommand({ region: 'equals' });
    const afterEquals = useDocumentStore.getState().document;
    const result = Object.values(afterEquals.nodes).find(
      (n): n is ResultNode => n.kind === 'result',
    );
    expect(result).toBeDefined();
    expect(result!.derived?.display).toBe('10,000');
    expect(useUiStore.getState().selectedNodeId).toBe(result!.id);

    // Input number still stores canonical raw; result display stays grouped.
    const input = Object.values(afterEquals.nodes).find(
      (n): n is NumberNode => n.kind === 'number' && n.raw === '10000',
    )!;
    expect(input.raw).toBe('10000');
    expect(formatForDisplay(input.raw, 'en-US')).toBe('10,000');

    // 3. Label the declaration (context-menu Label → in-place edit).
    editNodeLabel(result!.id);
    expect(useUiStore.getState().editingLabelNodeId).toBe(result!.id);
    setNodeLabel(result!.id, 'Initial Deposit');
    expect(useDocumentStore.getState().document.nodes[result!.id]).toMatchObject({
      label: 'Initial Deposit',
    });

    // 4. Continue from the labelled result — reference inherits the caption (§11.1).
    dispatchEditorCommand({ region: 'operator', op: '+' });
    const afterContinue = useDocumentStore.getState().document;
    const ref = Object.values(afterContinue.nodes).find(
      (n): n is ReferenceNode => n.kind === 'reference',
    );
    expect(ref).toBeDefined();
    expect(ref!.targetNodeId).toBe(result!.id);
    expect(labelForNode(afterContinue.nodes, ref!.id)).toBe('Initial Deposit');
    expect(labelForNode(afterContinue.nodes, result!.id)).toBe('Initial Deposit');

    // 5. Finish the consumer chain: `… + 2 =` uses the live referenced value.
    dispatchEditorCommand({ region: 'digit', value: '2' });
    dispatchEditorCommand({ region: 'equals' });
    const finalDoc = useDocumentStore.getState().document;
    const consumer = Object.values(finalDoc.nodes).find(
      (n): n is ResultNode => n.kind === 'result' && n.id !== result!.id,
    );
    expect(consumer?.derived?.display).toBe('10,002');

    // Locale still holds on the declaration after the whole walk.
    const stillInput = finalDoc.nodes[input.id] as NumberNode;
    expect(stillInput.raw).toBe('10000');
    expect(formatForDisplay(stillInput.raw, 'en-US')).toBe('10,000');
    expect((finalDoc.nodes[result!.id] as ResultNode).derived?.display).toBe('10,000');
  });
});
