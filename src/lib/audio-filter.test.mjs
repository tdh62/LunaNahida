import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFIRResponse, compileExpression, defaultCustomFilter, effectDefinitions, makeFrequencyImpulse, makeTimeImpulse, responseAt, selectedEffect, validateFilter } from './audio-filter.ts';

function context(sampleRate = 48000) {
  return {
    sampleRate,
    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      return { length, sampleRate, getChannelData: () => data };
    },
  };
}

test('expression grammar evaluates arithmetic without code execution', () => {
  assert.equal(compileExpression('2^3 + max(1, f/100)', 'f')(300), 11);
  assert.equal(compileExpression('-2^2', 'f')(0), -4);
  assert.throws(() => compileExpression('globalThis.alert(1)', 'f'));
  assert.throws(() => compileExpression('f; 1', 'f'));
});

test('all built-in FIR effects validate at common sample rates', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const filter of Object.values(effectDefinitions)) {
      const { frequency, time } = validateFilter(filter, sampleRate);
      assert.equal(makeFrequencyImpulse(context(sampleRate), frequency, filter.firSize).length, filter.firSize);
      assert.ok(makeTimeImpulse(context(sampleRate), time, filter.durationMs, filter.delays).length > 1);
    }
  }
});

test('flat frequency response and delay impulse preserve their expected taps', () => {
  const audio = context();
  const flat = makeFrequencyImpulse(audio, compileExpression('0', 'f')).getChannelData(0);
  assert.ok(Math.abs(flat[4096] - 1) < 0.00001);
  assert.ok(flat.every((tap, index) => index === 4096 || Math.abs(tap) < 0.00001));
  const response = makeTimeImpulse(audio, compileExpression('0', 't'), 400, [{ ms: 190, gain: 0.45 }]).getChannelData(0);
  assert.equal(response[0], 1);
  assert.ok(Math.abs(response[9120] - 0.45) < 0.00001);
  const curve = calculateFIRResponse(makeFrequencyImpulse(audio, compileExpression('0', 'f')));
  for (const hz of [20, 100, 1000, 10000, 20000]) assert.ok(Math.abs(responseAt(curve, hz)) < 0.001);
});

test('FIR size follows the selected effect setting', () => {
  for (const firSize of [2048, 4096, 8192, 16384]) {
    const filter = { ...defaultCustomFilter, firSize };
    const { frequency } = validateFilter(filter, 48000);
    const impulse = makeFrequencyImpulse(context(), frequency, firSize);
    assert.equal(impulse.length, firSize);
    assert.ok(Math.abs(impulse.getChannelData(0)[firSize / 2] - 1) < 0.00001);
  }
});

test('frequency bands fade at shared edges and leave gaps neutral', () => {
  const filter = { ...defaultCustomFilter, frequencyBands: [
    { expression: '12', startHz: 0, endHz: 1000, transitionHz: 200 },
    { expression: '-6', startHz: 1000, endHz: 2000, transitionHz: 200 },
  ] };
  const { frequency } = validateFilter(filter, 48000);
  assert.equal(frequency(500), 12);
  assert.equal(frequency(1000), 3);
  assert.equal(frequency(1500), -6);
  assert.equal(frequency(3000), 0);
  assert.ok(frequency(900) > frequency(950));
});

test('zero frequency gain is marked for FIR bypass', () => {
  assert.equal(validateFilter(defaultCustomFilter, 48000).neutralFrequency, true);
  assert.equal(validateFilter(effectDefinitions['空间回响'], 48000).neutralFrequency, true);
  assert.equal(validateFilter(effectDefinitions['低音增强'], 48000).neutralFrequency, false);
});

test('overlapping bands add dB gains and reject excessive totals', () => {
  const filter = { ...defaultCustomFilter, frequencyBands: [
    { expression: '10', startHz: 0, endHz: null, transitionHz: 80 },
    { expression: '5', startHz: 0, endHz: null, transitionHz: 80 },
  ] };
  assert.equal(validateFilter(filter, 48000).frequency(1000), 15);
  assert.throws(() => validateFilter({ ...filter, frequencyBands: filter.frequencyBands.map(band => ({ ...band, expression: '15' })) }, 48000));
});

test('saved effects resolve by id and preserve their names', () => {
  const saved = [{ id: 'custom:one', name: '私有曲线', filter: defaultCustomFilter }];
  assert.equal(selectedEffect('custom:one', saved).name, '私有曲线');
  assert.equal(selectedEffect('missing', saved).name, '原声');
});

test('invalid or excessive gain is rejected', () => {
  assert.throws(() => validateFilter({ ...defaultCustomFilter, frequencyBands: [{ expression: '1/0', startHz: 0, endHz: null, transitionHz: 80 }] }, 48000));
  assert.throws(() => validateFilter({ ...defaultCustomFilter, delays: [{ ms: 190, gain: 2 }] }, 48000));
  assert.throws(() => makeTimeImpulse(context(), compileExpression('20', 't'), 1000));
});
