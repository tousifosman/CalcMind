import React from 'react';
import { Text } from 'react-native';
import { NumberNode } from './NumberNode';
import { ResultNode } from './ResultNode';
import { ReferenceNode } from './ReferenceNode';
import { useDocumentStore } from '../store/documentStore';
import { addNumberNode, continueFromResult, appendEqualsNode } from '../store/commands';
import { createEmptyDocument } from '../model/factories';
import { assignIdentityHues } from '../engine/identity';
import { identityBorderFor, identityHues, rolePalette } from '../ui/tokens';
import { renderNode, unmountAll, findHostByTestID } from './testUtils';
import { resetIdentityHueCacheForTests } from './useIdentityHue';
import type { ResultNode as ResultNodeModel } from '../model/types';

jest.mock('../ui/locale', () => ({ getDeviceLocale: () => 'en-US' }));

function resetStore() {
  useDocumentStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [] });
  resetIdentityHueCacheForTests();
}

beforeEach(resetStore);
afterEach(unmountAll);

describe('identity hue rendering (P6.5 / §11.1)', () => {
  test('unlabelled unreferenced number has no identity ring', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '5');
    const renderer = renderNode(<NumberNode id={id} />);
    expect(
      renderer.root.findAllByProps({ testID: `number-node-${id}-identity-ring` }),
    ).toHaveLength(0);
  });

  test('labelling a number alone grants an identity ring in the first palette hue', () => {
    const id = addNumberNode({ x: 0, y: 0 }, '100');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[id].label = 'Initial Deposit';
    });

    const renderer = renderNode(<NumberNode id={id} />);
    const ring = findHostByTestID(renderer.root, `number-node-${id}-identity-ring`);
    expect(ring.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: identityHues[0] })]),
    );
    // Label caption picks up the identity hue (§11.1 / §6).
    const label = renderer.root
      .findAllByType(Text)
      .find((t) => t.props.children === 'Initial Deposit');
    expect(label?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: identityHues[0] })]),
    );
    // Role fill is preserved — identity is a ring, not a recolour of the declaring cell.
    const band = findHostByTestID(renderer.root, `number-node-${id}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: rolePalette.number.fill }),
      ]),
    );
  });

  test('referencing a result fills the reference with the result\'s hue and rings the result', () => {
    // Build `7 =` → result, then continue with `+` so the new chain starts with a reference.
    const a = addNumberNode({ x: 0, y: 0 }, '7');
    appendEqualsNode(a);
    const beforeRef = useDocumentStore.getState().document;
    const resultNode = Object.values(beforeRef.nodes).find(
      (n) => n.kind === 'result',
    ) as ResultNodeModel;
    expect(resultNode).toBeDefined();
    expect(assignIdentityHues(beforeRef.nodes, identityHues).get(resultNode.id)).toBeUndefined();

    const { referenceId } = continueFromResult(resultNode.id, '+');
    const hue = assignIdentityHues(
      useDocumentStore.getState().document.nodes,
      identityHues,
    ).get(resultNode.id);
    expect(hue).toBe(identityHues[0]);

    const resultRenderer = renderNode(<ResultNode id={resultNode.id} />);
    const ring = findHostByTestID(
      resultRenderer.root,
      `result-node-${resultNode.id}-identity-ring`,
    );
    expect(ring.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: hue })]),
    );

    const refRenderer = renderNode(<ReferenceNode id={referenceId} />);
    const band = findHostByTestID(refRenderer.root, `reference-node-${referenceId}`);
    expect(band.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: hue,
          borderColor: identityBorderFor(hue!),
        }),
      ]),
    );
    expect(identityBorderFor(hue!)).not.toBe(hue);
  });

  test('two references to the same source share one hue; a second identity takes another slot', () => {
    const a = addNumberNode({ x: 0, y: 0 }, '1');
    appendEqualsNode(a);
    const resultA = Object.values(useDocumentStore.getState().document.nodes).find(
      (n) => n.kind === 'result',
    ) as ResultNodeModel;
    const { referenceId: ref1 } = continueFromResult(resultA.id, '+');
    const labelled = addNumberNode({ x: 200, y: 0 }, '99');
    useDocumentStore.getState().applyCommand((draft) => {
      draft.nodes[labelled].label = 'Other';
    });
    const { referenceId: ref2 } = continueFromResult(resultA.id, '×');

    const hues = assignIdentityHues(
      useDocumentStore.getState().document.nodes,
      identityHues,
    );
    const sourceHue = hues.get(resultA.id);
    const labelledHue = hues.get(labelled);
    expect(sourceHue).toBeDefined();
    expect(labelledHue).toBeDefined();
    expect(sourceHue).not.toBe(labelledHue);

    expect(
      findHostByTestID(renderNode(<ReferenceNode id={ref1} />).root, `reference-node-${ref1}`)
        .props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: sourceHue })]),
    );
    expect(
      findHostByTestID(renderNode(<ReferenceNode id={ref2} />).root, `reference-node-${ref2}`)
        .props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: sourceHue })]),
    );
    expect(
      findHostByTestID(
        renderNode(<NumberNode id={labelled} />).root,
        `number-node-${labelled}-identity-ring`,
      ).props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: labelledHue })]),
    );
  });
});
