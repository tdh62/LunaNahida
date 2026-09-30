import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaybackCoordinator } from './playback-coordinator.ts';

test('music and noise are exclusive, including pending playback', () => {
  const coordinator = createPlaybackCoordinator();
  const events = [];
  const music = { stop: () => events.push('music paused') };
  const noise = { stop: () => events.push('noise stopped') };
  coordinator.claim(music);
  coordinator.claim(noise);
  assert.deepEqual(events, ['music paused']);
  assert.equal(coordinator.owns(music), false);
  coordinator.release(music);
  assert.equal(coordinator.owns(noise), true);
  coordinator.claim(music);
  assert.deepEqual(events, ['music paused', 'noise stopped']);
  coordinator.claim(music);
  assert.equal(events.length, 2);
  coordinator.release(music);
  assert.equal(coordinator.owns(music), false);
});

test('cross-window playback stops the active owner without touching queues', () => {
  const posted = [];
  let receive;
  const coordinator = createPlaybackCoordinator({ postMessage: message => posted.push(message), addEventListener: (_type, listener) => { receive = listener; } });
  const queue = [1, 2, 3];
  let stops = 0;
  const owner = { stop: () => { stops++; } };
  coordinator.claim(owner);
  receive({ data: 'irrelevant' });
  assert.equal(stops, 0);
  receive({ data: 'play' });
  assert.equal(stops, 1);
  assert.equal(coordinator.owns(owner), false);
  receive({ data: 'play' });
  assert.equal(stops, 1);
  assert.deepEqual(queue, [1, 2, 3]);
  assert.deepEqual(posted, ['play']);
});
