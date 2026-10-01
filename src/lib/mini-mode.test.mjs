import assert from 'node:assert/strict';
import test from 'node:test';
import { createMiniModeController, miniWindowSize, miniWindowStorageKey } from './mini-mode.ts';

function windowFixture({ maximised = false, fullscreen = false } = {}) {
  const normal = { width: 1180, height: 740, x: 140, y: 90, resizable: true };
  const state = { ...normal, maximised, fullscreen, frameless: true, minWidth: 900, minHeight: 600, pinned: false };
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
    Center: () => { state.x = 760; state.y = 436; },
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
      assert.equal(state.frameless, true);
      assert.equal(state.pinned, false);
      assert.equal(state.minWidth, 900);
      assert.equal(state.minHeight, 600);
      assert.equal(state.maximised, mode.maximised ?? false);
      assert.equal(state.fullscreen, mode.fullscreen ?? false);
    }
  });
}

test('failed entry preserves the frameless window and restores constraints, allowing another attempt', async () => {
  const fixture = windowFixture({ maximised: true });
  const controller = createMiniModeController(fixture.native);
  fixture.fail('SetSize');
  await assert.rejects(controller.enter(), /window unavailable/);
  assert.equal(fixture.state.frameless, true);
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
  assert.equal(fixture.state.frameless, true);
});

function preferenceFixture(saved = null) {
  const values = new Map(saved ? [[miniWindowStorageKey, JSON.stringify(saved)]] : []);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const areas = [{ X: 0, Y: 0, Width: 1920, Height: 1040 }, { X: -1280, Y: 0, Width: 1280, Height: 984 }];
  return { storage, getWorkAreas: async () => areas };
}

test('mini geometry and pin preference survive exit and a new controller', async () => {
  const { native, state, normal } = windowFixture();
  const options = preferenceFixture();
  const controller = createMiniModeController(native, options);
  assert.equal(await controller.enter(), false);
  await native.SetPosition(-900, 300);
  await controller.setPinned(true);
  await controller.exit();
  assert.equal(state.pinned, false);
  assert.equal(state.x, normal.x);
  const reopened = createMiniModeController(native, options);
  assert.equal(await reopened.enter(), true);
  assert.equal(state.x, -900);
  assert.equal(state.y, 300);
  assert.equal(state.pinned, true);
  await reopened.setPinned(false);
  await reopened.exit();
  assert.equal(await createMiniModeController(native, options).enter(), false);
});

for (const position of [{ x: 2500, y: 100 }, { x: 1800, y: 100 }, { x: 300, y: 950 }]) {
  test(`unavailable mini position is centered ${JSON.stringify(position)}`, async () => {
    const { native, state, calls } = windowFixture();
    const controller = createMiniModeController(native, preferenceFixture({ ...position, pinned: true }));
    assert.equal(await controller.enter(), true);
    assert.equal(calls.includes('Center'), true);
    assert.equal(state.x, 760);
    assert.equal(state.y, 436);
    assert.equal(state.pinned, true);
  });
}

test('remember before closing persists current mini position and pin state', async () => {
  const { native } = windowFixture();
  const options = preferenceFixture();
  const controller = createMiniModeController(native, options);
  await controller.enter();
  await native.SetPosition(400, 200);
  await controller.setPinned(true);
  await controller.remember();
  assert.deepEqual(JSON.parse(options.storage.getItem(miniWindowStorageKey)), { x: 400, y: 200, pinned: true });
});

test('exit retry preserves mini preferences captured before partial restoration', async () => {
  const fixture = windowFixture();
  const options = preferenceFixture();
  const controller = createMiniModeController(fixture.native, options);
  await controller.enter();
  await fixture.native.SetPosition(400, 200);
  await controller.setPinned(true);
  fixture.fail('SetPosition');
  await assert.rejects(controller.exit());
  await controller.exit();
  assert.deepEqual(JSON.parse(options.storage.getItem(miniWindowStorageKey)), { x: 400, y: 200, pinned: true });
});

test('corrupt preferences and unavailable storage or screens allow mini mode', async () => {
  for (const storage of [
    { getItem: () => '{', setItem() {} },
    { getItem: () => JSON.stringify({ x: 'invalid', y: 0, pinned: true }), setItem() {} },
    { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } },
  ]) {
    const { native, state } = windowFixture();
    const controller = createMiniModeController(native, { storage, getWorkAreas: async () => { throw Error('unavailable'); } });
    assert.equal(await controller.enter(), false);
    assert.equal(state.x, 760);
    await controller.exit();
  }
});
