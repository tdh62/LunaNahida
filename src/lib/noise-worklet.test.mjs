import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoiseSampler } from './noise-worklet.mjs';

function seededRandom(seed) {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function spectrumSlope(sample, rate) {
  const size = 4096;
  const frequencies = [250, 500, 1000, 2000, 4000];
  const powers = frequencies.map(() => 0);
  for (let warmup = 0; warmup < rate * 2; warmup++) sample();
  for (let segment = 0; segment < 32; segment++) {
    const values = Float64Array.from({ length: size }, (_value, index) => sample() * (.5 - .5 * Math.cos(2 * Math.PI * index / (size - 1))));
    frequencies.forEach((frequency, position) => {
      for (const offset of [-2, -1, 0, 1, 2]) {
        const bin = Math.round(frequency * size / rate) + offset;
        const coefficient = 2 * Math.cos(2 * Math.PI * bin / size);
        let previous = 0;
        let older = 0;
        for (const value of values) { const next = value + coefficient * previous - older; older = previous; previous = next; }
        powers[position] += previous * previous + older * older - coefficient * previous * older;
      }
    });
  }
  const logarithms = powers.map(power => Math.log2(power));
  const mean = logarithms.reduce((sum, value) => sum + value, 0) / logarithms.length;
  return logarithms.reduce((sum, value, index) => sum + (index - 2) * (value - mean), 0) / 10;
}

for (const type of ['white', 'pink', 'brown']) {
  test(`${type} noise is continuous, finite, bounded and centered`, () => {
    const sample = createNoiseSampler(type, 48000, seededRandom(17));
    let sum = 0;
    let squared = 0;
    const count = 480000;
    for (let index = 0; index < count; index++) {
      const value = sample();
      assert.ok(Number.isFinite(value) && Math.abs(value) <= .9);
      sum += value;
      squared += value * value;
    }
    assert.ok(Math.abs(sum / count) < .04);
    const rms = Math.sqrt(squared / count);
    assert.ok(rms > .1 && rms < .2, `RMS ${rms}`);
  });
  for (const rate of [44100, 48000, 96000]) {
    test(`${type} noise has the expected spectral slope at ${rate} Hz`, () => {
      const slope = spectrumSlope(createNoiseSampler(type, rate, seededRandom(947)), rate);
      const expected = { white: 0, pink: -1, brown: -2 }[type];
      assert.ok(Math.abs(slope - expected) < .4, `slope ${slope}, expected ${expected}`);
    });
  }
}

test('invalid generator settings are rejected', () => {
  assert.throws(() => createNoiseSampler('unsupported'));
  assert.throws(() => createNoiseSampler('white', 0));
});

test('processor fills every render frame, with identical stereo channels', async () => {
  let Processor;
  globalThis.AudioWorkletProcessor = class {};
  globalThis.sampleRate = 48000;
  globalThis.registerProcessor = (name, processor) => { assert.equal(name, 'lunanahida-noise'); Processor = processor; };
  try {
    await import('./noise-worklet.mjs?processor-test');
    for (const type of ['white', 'pink', 'brown']) {
      const processor = new Processor({ processorOptions: { type } });
      const outputs = [[new Float32Array(128), new Float32Array(128)]];
      assert.equal(processor.process([], outputs), true);
      assert.deepEqual(outputs[0][0], outputs[0][1]);
      assert.ok(outputs[0][0].some(value => value !== 0));
      const previous = outputs[0][0].slice();
      processor.process([], outputs);
      assert.notDeepEqual(outputs[0][0], previous);
      assert.equal(processor.process([], [[]]), true);
    }
  } finally {
    delete globalThis.AudioWorkletProcessor;
    delete globalThis.sampleRate;
    delete globalThis.registerProcessor;
  }
});
