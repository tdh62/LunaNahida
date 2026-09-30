import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: "export { NoisePlayer } from './src/lib/noise-player'; export { playbackCoordinator } from './src/lib/playback-coordinator';", resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', alias: { '@': resolve('src') },
  plugins: [{ name: 'worklet-url', setup(builder) { builder.onResolve({ filter: /\?url/ }, () => ({ path: 'worklet', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: "export default '/noise-worklet.mjs';" })); } }],
});
globalThis.BroadcastChannel = class { postMessage() {} addEventListener() {} };
const { NoisePlayer, playbackCoordinator } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const contexts = [];
let modulePromise;
let moduleError;
class FakeNode {
  disconnected = false;
  onprocessorerror = null;
  port = { close() {} };
  connect() {}
  disconnect() { this.disconnected = true; }
}
class FakeContext {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: async () => { if (moduleError) throw moduleError; await modulePromise; } };
  gain = new FakeNode();
  constructor() {
    contexts.push(this);
    this.gain.gain = { value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; } };
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  createGain() { return this.gain; }
}
globalThis.AudioContext = FakeContext;
globalThis.AudioWorkletNode = FakeNode;

test('pause, resume and stop preserve volume without overlapping music', async () => {
  const statuses = [];
  const errors = [];
  const player = new NoisePlayer(status => statuses.push(status), error => errors.push(error));
  let musicStops = 0;
  playbackCoordinator().claim({ stop: () => musicStops++ });
  await player.start('pink');
  const context = contexts.at(-1);
  assert.equal(musicStops, 1);
  assert.equal(context.gain.gain.value, .2);
  player.pause();
  assert.equal(context.state, 'suspended');
  assert.equal(context.gain.gain.value, 0);
  player.setVolume(42);
  assert.equal(context.gain.gain.value, 0);
  await player.resume();
  assert.equal(context.gain.gain.value, .42);
  playbackCoordinator().claim({ stop() {} });
  assert.equal(context.gain.gain.value, 0);
  assert.equal(context.state, 'closed');
  assert.equal(statuses.at(-1), 'stopped');
  assert.deepEqual(errors, []);
});

test('stop or music playback cancels an asynchronous start', async () => {
  for (const cancel of ['stop', 'music']) {
    let finish;
    modulePromise = new Promise(resolvePromise => { finish = resolvePromise; });
    const statuses = [];
    const errors = [];
    const player = new NoisePlayer(status => statuses.push(status), error => errors.push(error));
    const started = player.start('white');
    const context = contexts.at(-1);
    if (cancel === 'stop') player.stop(); else playbackCoordinator().claim({ stop() {} });
    finish();
    await started;
    assert.equal(context.state, 'closed');
    assert.equal(statuses.includes('playing'), false);
    assert.deepEqual(errors, []);
  }
  modulePromise = undefined;
});

test('rapid type changes retire stale contexts', async () => {
  let finish;
  modulePromise = new Promise(resolvePromise => { finish = resolvePromise; });
  const statuses = [];
  const player = new NoisePlayer(status => statuses.push(status), () => assert.fail('unexpected error'));
  const first = player.start('white');
  const previous = contexts.at(-1);
  const second = player.start('brown');
  const current = contexts.at(-1);
  finish();
  await Promise.all([first, second]);
  assert.equal(previous.state, 'closed');
  assert.equal(current.state, 'running');
  assert.equal(statuses.filter(status => status === 'playing').length, 1);
  player.stop();
  modulePromise = undefined;
});

test('startup failures are reported and resources are released', async () => {
  moduleError = new Error('module unavailable');
  const statuses = [];
  const errors = [];
  const player = new NoisePlayer(status => statuses.push(status), error => errors.push(error));
  await player.start('brown');
  assert.equal(contexts.at(-1).state, 'closed');
  assert.equal(statuses.at(-1), 'stopped');
  assert.deepEqual(errors, ['module unavailable']);
  moduleError = undefined;
});

test('rapid pause and resume cannot reactivate a cancelled session', async () => {
  const statuses = [];
  const player = new NoisePlayer(status => statuses.push(status), () => assert.fail('unexpected error'));
  await player.start('white');
  player.pause();
  const resumed = player.resume();
  player.stop();
  await resumed;
  assert.equal(contexts.at(-1).state, 'closed');
  assert.equal(statuses.at(-1), 'stopped');
});
