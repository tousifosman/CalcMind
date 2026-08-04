import {
  explainEngineError,
  explainCircularReference,
  CIRCULAR_UNLINK_LABEL,
  resultCellContent,
  type EngineErrorKind,
} from './errors';

describe('explainEngineError', () => {
  test.each([
    ['Incomplete', 'Incomplete expression'],
    ['InvalidSequence', 'Invalid sequence'],
    ['DivideByZero', 'Division by zero'],
    ['Overflow', 'Number too large'],
    ['NotANumber', 'Not a number'],
    ['CircularReference', 'Circular reference'],
  ] as const)('%s is explained, not a bare glyph', (kind, explanation) => {
    expect(explainEngineError(kind)).toBe(explanation);
    // §11.2: never a lone punctuation mark.
    expect(explainEngineError(kind)).not.toMatch(/^[?¿‽!]+$/);
    expect(explainEngineError(kind).length).toBeGreaterThan(1);
  });

  test('every §10.4 kind has a distinct explanation', () => {
    const kinds: EngineErrorKind[] = [
      'Incomplete',
      'InvalidSequence',
      'DivideByZero',
      'Overflow',
      'NotANumber',
      'CircularReference',
    ];
    const texts = kinds.map(explainEngineError);
    expect(new Set(texts).size).toBe(kinds.length);
  });
});

describe('explainCircularReference', () => {
  test('names the cycle as A → B → A', () => {
    expect(explainCircularReference(['Deposit', 'Interest'])).toBe(
      'Circular: Deposit → Interest → Deposit',
    );
  });

  test('empty labels fall back to the stub explanation', () => {
    expect(explainCircularReference([])).toBe(explainEngineError('CircularReference'));
  });
});

describe('resultCellContent', () => {
  test('undefined derived is empty', () => {
    expect(resultCellContent(undefined)).toEqual({ mode: 'empty', text: '' });
  });

  test('absent outcome is a normal value', () => {
    expect(
      resultCellContent({ display: '1204', computedAt: '2026-08-04T00:00:00.000Z' }),
    ).toEqual({ mode: 'value', text: '1204', dimmed: false });
  });

  test('stale keeps the previous value and marks it dimmed (§9)', () => {
    expect(
      resultCellContent({
        display: '1204',
        computedAt: '2026-08-04T00:00:00.000Z',
        outcome: { status: 'stale' },
      }),
    ).toEqual({ mode: 'stale', text: '1204', dimmed: true });
  });

  test('error shows the explanation, not the cached display', () => {
    expect(
      resultCellContent({
        display: '1204',
        computedAt: '2026-08-04T00:00:00.000Z',
        outcome: { status: 'error', error: 'DivideByZero' },
      }),
    ).toEqual({
      mode: 'error',
      text: 'Division by zero',
      dimmed: false,
      error: 'DivideByZero',
    });
  });

  test('CircularReference with cycle metadata names the cycle and reserves Unlink width', () => {
    const cycle = {
      chainIds: ['a', 'b'],
      chainLabels: ['Alpha', 'Beta'],
      closingReferenceNodeId: 'refB',
    };
    const content = resultCellContent({
      display: '1',
      computedAt: '2026-08-04T00:00:00.000Z',
      outcome: { status: 'error', error: 'CircularReference', cycle },
    });
    expect(content).toEqual({
      mode: 'error',
      text: `${explainCircularReference(['Alpha', 'Beta'])} ${CIRCULAR_UNLINK_LABEL}`,
      dimmed: false,
      error: 'CircularReference',
      cycle,
    });
    expect(content.mode === 'error' && content.text).not.toBe('?');
  });
});
