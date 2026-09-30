import assert from 'node:assert/strict';
import test from 'node:test';
import { createMiniModeController, miniWindowSize } from './mini-mode.ts';

function windowFixture({ maximised = false, fullscreen = false } = {}) {
  const normal = { width: 1180, height: 740, x: 140, y: 90, resizable: true };
  const state = { ...normal, maximised, fullscreen, frameless: false, minWidth: 900, minHeight: 600, pinned: false };
  const calls = [];
  let failure;
  const native = Object.fromEntries(Object.entries({
    IsMaximised: () => state.maximised,
    IsFullscreen: () => state.fullscreen,
    Resizable: () => state.resizable,
    UnMaximise: () => { state.maximised = false; },
    UnFullscreen: () => { state.fullscreen = false; },
    Maximise: () => { state.maximised = true; },
    Fullscreen: () => { state.fullscreen = true; },
    Size: () => ({ width: state.width, height: state.height }),
    Position: () => ({ x: state.x, y: state.y }),
    SetSize: (width, height) => { state.width = Math.max(state.minWidth, width); state.height = Math.max(state.minHeight, height); },
    SetPosition: (x, y) => { state.x = x; state.y = y; },
    SetMinSize: (width, height) => { state.minWidth = width; state.minHeight = height; },
    SetFrameless: value => { state.frameless = value; },
    SetResizable: value => { state.resizable = value; },
    SetAlwaysOnTop: value => { state.pinned = value; },
  }).map(([name, action]) => [name, async (...args) => {
    calls.push(name);
    if (failure === name) { failure = undefined; throw new Error('window unavailable'); }
    return action(...args);
  }]));
  return { native, state, calls, normal, fail: name => { failure = name; } };
}

for (const mode of [{}, { maximised: true }, { fullscreen: true }]) {
  test(`mini mode restores normal geometry and window state ${JSON.stringify(mode)}`, async () => {
    const { native, state, normal } = windowFixture(mode);
    const controller = createMiniModeController(native);
    for (let pass = 0; pass < 2; pass++) {
      await controller.enter();
      assert.equal(state.frameless, true);
      assert.equal(state.resizable, false);
      assert.equal(state.maximised, false);
      assert.equal(state.fullscreen, false);
      assert.equal(state.width, miniWindowSize.width);
      assert.equal(state.height, miniWindowSize.height);
      // Moving/pinning the mini window must not change the saved full window.
      await native.SetPosition(600, 400);
      await native.SetAlwaysOnTop(true);
      await controller.exit();
      for (const [key, value] of Object.entries(normal)) assert.equal(state[key], value);
      assert.equal(state.frameless, false);
      assert.equal(state.pinned, false);
      assert.equal(state.minWidth, 900);
      assert.equal(state.minHeight, 600);
      assert.equal(state.maximised, mode.maximised ?? false);
      assert.equal(state.fullscreen, mode.fullscreen ?? false);
    }
  });
}

test('failed entry restores decorations and constraints, allowing another attempt', async () => {
  const fixture = windowFixture({ maximised: true });
  const controller = createMiniModeController(fixture.native);
  fixture.fail('SetSize');
  await assert.rejects(controller.enter(), /window unavailable/);
  assert.equal(fixture.state.frameless, false);
  assert.equal(fixture.state.minWidth, 900);
  assert.equal(fixture.state.maximised, true);
  await controller.enter();
  assert.equal(fixture.state.width, miniWindowSize.width);
  await controller.exit();
});

test('failed exit keeps the saved full window for retry', async () => {
  const fixture = windowFixture();
  const controller = createMiniModeController(fixture.native);
  await controller.enter();
  fixture.fail('SetFrameless');
  await assert.rejects(controller.exit(), /window unavailable/);
  await controller.exit();
  assert.equal(fixture.state.width, fixture.normal.width);
  assert.equal(fixture.state.frameless, false);
});
