import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaybackClock } from './playback-clock.ts';

test('seeking publishes immediately and detached views stop receiving progress', () => {
  const clock = createPlaybackClock();
  const seen = [];
  const detach = clock.subscribe(() => seen.push(clock.getSnapshot()));
  clock.set(12.5);
  clock.set(12.5);
  detach();
  clock.set(15);
  assert.deepEqual(seen, [12.5]);
  assert.equal(clock.getSnapshot(), 15);
  const resumed = [];
  const stop = clock.subscribe(() => resumed.push(clock.getSnapshot()));
  clock.set(16);
  stop();
  assert.deepEqual(resumed, [16]);
});

test('invalid and negative audio positions never propagate to progress controls', () => {
  const clock = createPlaybackClock();
  for (const value of [-1, NaN, Infinity]) {
    clock.set(10);
    clock.set(value);
    assert.equal(clock.getSnapshot(), 0);
  }
});
