import {
  inferSliderRange,
  quantizeToStep,
  rawToSliderValue,
  sliderValueToRaw,
  valueAtTrackFraction,
} from './inferSliderRange';

describe('inferSliderRange (§8.8)', () => {
  test('zero → [0, 10]', () => {
    expect(inferSliderRange(0)).toEqual({ min: 0, max: 10 });
    expect(inferSliderRange(-0)).toEqual({ min: 0, max: 10 });
  });

  test('positive value → [0, 10^ceil(log10(v))]', () => {
    expect(inferSliderRange(3)).toEqual({ min: 0, max: 10 });
    expect(inferSliderRange(42)).toEqual({ min: 0, max: 100 });
    expect(inferSliderRange(999)).toEqual({ min: 0, max: 1000 });
  });

  test('exact power of ten keeps the value on the upper endpoint', () => {
    expect(inferSliderRange(1)).toEqual({ min: 0, max: 1 });
    expect(inferSliderRange(10)).toEqual({ min: 0, max: 10 });
    expect(inferSliderRange(100)).toEqual({ min: 0, max: 100 });
    expect(inferSliderRange(1000)).toEqual({ min: 0, max: 1000 });
  });

  test('negative value is symmetric about zero', () => {
    expect(inferSliderRange(-3)).toEqual({ min: -10, max: 10 });
    expect(inferSliderRange(-42)).toEqual({ min: -100, max: 100 });
    expect(inferSliderRange(-100)).toEqual({ min: -100, max: 100 });
  });

  test('fractional positives pick the enclosing decade', () => {
    expect(inferSliderRange(0.5)).toEqual({ min: 0, max: 1 });
    expect(inferSliderRange(0.01)).toEqual({ min: 0, max: 0.01 });
    expect(inferSliderRange(0.1)).toEqual({ min: 0, max: 0.1 });
  });

  test('non-finite falls back to the zero range', () => {
    expect(inferSliderRange(Number.NaN)).toEqual({ min: 0, max: 10 });
    expect(inferSliderRange(Number.POSITIVE_INFINITY)).toEqual({ min: 0, max: 10 });
  });
});

describe('rawToSliderValue / sliderValueToRaw', () => {
  test('mid-typing stubs are not scrubbable', () => {
    expect(rawToSliderValue('')).toBeNull();
    expect(rawToSliderValue('-')).toBeNull();
    expect(rawToSliderValue('.')).toBeNull();
    expect(rawToSliderValue('-.')).toBeNull();
  });

  test('complete raw parses', () => {
    expect(rawToSliderValue('12.5')).toBe(12.5);
    expect(rawToSliderValue('-3')).toBe(-3);
  });

  test('scrubbed values round-trip to canonical raw without trailing zeros', () => {
    expect(sliderValueToRaw(3)).toBe('3');
    expect(sliderValueToRaw(3.5)).toBe('3.5');
    expect(sliderValueToRaw(-10)).toBe('-10');
  });

  test('live scrub keeps a handful of significant digits, not toFixed(10) noise', () => {
    // Review #114: continuous drag used to land `4.4830503302` in the cell.
    expect(sliderValueToRaw(4.4830503302)).toBe('4.48305');
    expect(sliderValueToRaw(18.9661006604)).toBe('18.9661');
  });
});

describe('valueAtTrackFraction', () => {
  test('maps endpoints and midpoint', () => {
    const range = { min: 0, max: 100 };
    expect(valueAtTrackFraction(0, range, false)).toBe(0);
    expect(valueAtTrackFraction(1, range, false)).toBe(100);
    expect(valueAtTrackFraction(0.5, range, false)).toBe(50);
  });

  test('integer snap rounds', () => {
    const range = { min: 0, max: 10 };
    expect(valueAtTrackFraction(0.44, range, true)).toBe(4);
    expect(valueAtTrackFraction(0.45, range, true)).toBe(5);
  });
});

describe('quantizeToStep (§8.8 Step field)', () => {
  test('snaps to the nearest 0.1 without float drift', () => {
    const range = { min: 0, max: 10 };
    // 0.1 + 0.2 famously isn't 0.3 in plain float arithmetic - the Decimal grid
    // arithmetic must not reintroduce that.
    expect(quantizeToStep(0.23, 0.1, range)).toBe(0.2);
    expect(quantizeToStep(0.27, 0.1, range)).toBe(0.3);
    expect(quantizeToStep(4.4830503302, 0.1, range)).toBe(4.5);
  });

  test('grid is measured from range.min, not zero', () => {
    const range = { min: 0.5, max: 10.5 };
    expect(quantizeToStep(0.62, 0.1, range)).toBe(0.6);
    expect(quantizeToStep(0.65, 0.1, range)).toBe(0.7);
  });

  test('clamps the quantized value into range', () => {
    const range = { min: 0, max: 1 };
    expect(quantizeToStep(0.98, 0.1, range)).toBe(1);
    expect(quantizeToStep(-0.05, 0.1, range)).toBe(0);
  });

  test('a non-positive or non-finite step disables quantization (still range-clamped)', () => {
    const range = { min: 0, max: 10 };
    expect(quantizeToStep(4.483, 0, range)).toBe(4.483);
    expect(quantizeToStep(4.483, -1, range)).toBe(4.483);
    expect(quantizeToStep(4.483, Number.NaN, range)).toBe(4.483);
    expect(quantizeToStep(12, 0, range)).toBe(10);
  });

  test('a larger step steps by whole units', () => {
    const range = { min: 0, max: 100 };
    expect(quantizeToStep(23, 5, range)).toBe(25);
    expect(quantizeToStep(22, 5, range)).toBe(20);
  });
});
