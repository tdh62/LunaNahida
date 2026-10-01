import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGainSegment, curveFrequency, drawGainStroke, validGainSegments } from './gain-curve.ts';
import { defaultCustomFilter, makeFrequencyImpulse, calculateFIRResponse, responseAt, validateFilter } from './audio-filter.ts';

const baseline = hz => 3 * Math.log2(hz / 1000);
const stroke = [{ hz: 300, db: 8 }, { hz: 700, db: 10 }, { hz: 1500, db: 4 }];

test('local strokes leave all other frequencies intact and join at both ends', () => {
  const curve = drawGainStroke([], stroke, baseline);
  const frequency = curveFrequency(curve, baseline);
  for (const hz of [20, 299, 1501, 20000]) assert.equal(frequency(hz), baseline(hz));
  for (const hz of [300, 1500]) assert.ok(Math.abs(frequency(hz) - baseline(hz)) < 1e-9);
  assert.ok(frequency(700) > 9);
  assert.ok(Math.abs(frequency(300.0001) - frequency(299.9999)) < .001);
});

test('overlapping strokes replace gains and preserve the previous curve outside the new range', () => {
  const first = drawGainStroke([], stroke, baseline), before = curveFrequency(first, baseline);
  const second = drawGainStroke(first, [{ hz: 500, db: -6 }, { hz: 900, db: -6 }], baseline);
  const after = curveFrequency(second, baseline);
  assert.ok(Math.abs(after(700) + 6) < .01);
  for (const hz of [20, 320, 450, 499.999, 900.001, 1000, 1400, 20000]) assert.ok(Math.abs(after(hz) - before(hz)) < 1e-8, `${hz}: ${after(hz)} != ${before(hz)}`);
  assert.ok(validGainSegments(second, 60));
});

test('reverse strokes work and the last pass over a frequency wins', () => {
  const reverse = drawGainStroke([], [...stroke].reverse(), baseline);
  assert.ok(curveFrequency(reverse, baseline)(700) > 9);
  const revised = drawGainStroke([], [{ hz: 100, db: 10 }, { hz: 1000, db: 10 }, { hz: 100, db: -6 }], () => 0, 0);
  assert.ok(Math.abs(curveFrequency(revised, () => 0)(300) - (-6 + 16 * Math.log10(3))) < .001);
});

test('shape preservation prevents interpolated gain overshoot', () => {
  const evaluate = compileGainSegment({ points: [{ hz: 20, db: -60 }, { hz: 200, db: 60 }, { hz: 2000, db: -60 }] });
  for (let hz = 20; hz <= 2000; hz *= 1.01) assert.ok(Math.abs(evaluate(hz)) <= 60);
});

test('smoothing reduces pen jitter while retaining the broad shape', () => {
  const pen = Array.from({ length: 100 }, (_, i) => ({ hz: 100 * 2 ** (i / 30), db: 5 + (i % 2 ? 2 : -2) }));
  const rough = drawGainStroke([], pen, () => 0, 0), smooth = drawGainStroke([], pen, () => 0, 1);
  const roughFn = curveFrequency(rough, () => 0), smoothFn = curveFrequency(smooth, () => 0);
  const deviation = fn => pen.slice(10, -10).reduce((sum, point) => sum + Math.abs(fn(point.hz) - 5), 0);
  assert.ok(deviation(smoothFn) < deviation(roughFn) * .7);
});

test('professional gain survives persistence and FIR synthesis at common rates', () => {
  const filter = JSON.parse(JSON.stringify({ ...defaultCustomFilter, frequencyMode: 'curve', gainMin: -60, gainMax: 60, gainCurve: [{ points: [{ hz: 20, db: 36 }, { hz: 192000, db: 36 }] }] }));
  assert.throws(() => validateFilter(filter, 48000));
  for (const sampleRate of [44100, 48000, 96000]) {
    const { frequency } = validateFilter(filter, sampleRate, 60);
    assert.equal(frequency(1000), 36);
    const context = { sampleRate, createBuffer: (_, length) => { const data = new Float32Array(length); return { length, sampleRate, getChannelData: () => data }; } };
    const response = calculateFIRResponse(makeFrequencyImpulse(context, frequency, filter.firSize, 60));
    assert.ok(Math.abs(responseAt(response, 1000) - 36) < .01);
  }
  assert.throws(() => validateFilter({ ...defaultCustomFilter, frequencyBands: [{ expression: '61', startHz: 0, endHz: null, transitionHz: 0 }] }, 48000, 60));
});

test('malformed points and overlapping saved segments are rejected', () => {
  assert.equal(validGainSegments([{ points: [{ hz: 200, db: 0 }, { hz: 100, db: 0 }] }], 60), false);
  assert.equal(validGainSegments([{ points: [{ hz: 100, db: NaN }, { hz: 200, db: 0 }] }], 60), false);
  assert.equal(validGainSegments([{ points: [{ hz: 100, db: 0 }, { hz: 200, db: 0 }] }, { points: [{ hz: 150, db: 0 }, { hz: 250, db: 0 }] }], 60), false);
  assert.deepEqual(drawGainStroke([], [{ hz: 100, db: 1 }], baseline), []);
});

test('formula and drawing are exclusive and switching retains both sets of settings', () => {
  const filter = { ...defaultCustomFilter, frequencyBands: [{ expression: '10', startHz: 0, endHz: null, transitionHz: 0 }], gainCurve: [{ points: [{ hz: 500, db: -6 }, { hz: 2000, db: -6 }] }] };
  const formula = validateFilter({ ...filter, frequencyMode: 'formula' }, 48000);
  assert.equal(formula.frequency(1000), 10);
  const drawing = validateFilter({ ...filter, frequencyMode: 'curve' }, 48000);
  assert.equal(drawing.frequency(1000), -6);
  assert.equal(drawing.frequency(100), 0);
  assert.equal(drawing.frequency(10000), 0);
  assert.equal(validateFilter({ ...filter, frequencyMode: 'curve', frequencyBands: [{ ...filter.frequencyBands[0], expression: 'invalid' }] }, 48000).frequency(1000), -6);
});
