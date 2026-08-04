import { filenameForExport } from './exportFilename';

describe('filenameForExport', () => {
  test('uses document name when present, sanitized', () => {
    expect(
      filenameForExport(
        'doc_a',
        JSON.stringify({ name: 'Kitchen remodel / v2' }),
      ),
    ).toBe('Kitchen remodel _ v2.calcmind.json');
  });

  test('falls back to id when name missing or JSON corrupt', () => {
    expect(filenameForExport('doc_x', '{"id":"doc_x"}')).toBe(
      'doc_x.calcmind.json',
    );
    expect(filenameForExport('doc_y', 'not-json')).toBe('doc_y.calcmind.json');
  });
});
