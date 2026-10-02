import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverRuntime, emptyLibrary, isDesktopEnvironment } from './runtime.ts';

const signal = () => new AbortController().signal;
const json = value => Response.json(value);

test('runtime object created by the JS package does not imply desktop', () => {
  assert.equal(isDesktopEnvironment({ _wails: { invoke() {} } }), false);
  assert.equal(isDesktopEnvironment({ _wails: { environment: { OS: 'windows' } } }), true);
});

test('static hosting and absent API enter an empty web session', async () => {
  for (const fetcher of [async () => new Response('missing', { status: 404 }), async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }), async () => { throw new TypeError('offline'); }]) {
    const runtime = await discoverRuntime(false, signal(), fetcher);
    assert.equal(runtime.mode, 'web');
    assert.equal(runtime.backend, false);
    assert.equal(runtime.nativeFonts, false);
    assert.deepEqual(runtime.initialState.tracks, []);
  }
});

test('browser backend retains state but cannot open native dialogs', async () => {
  const state = emptyLibrary();
  state.liked = [2];
  const runtime = await discoverRuntime(false, signal(), async path => json(path === '/api/state' ? state : { application: 'LunaNahida', nativeFiles: true, nativeFolders: true, nativeFonts: true }));
  assert.equal(runtime.mode, 'browser-backend');
  assert.equal(runtime.nativeFiles, false);
  assert.equal(runtime.nativeFolders, false);
  assert.equal(runtime.nativeFonts, false);
  assert.deepEqual(runtime.initialState.liked, [2]);
});

test('desktop honors advertised native capabilities', async () => {
  const runtime = await discoverRuntime(true, signal(), async path => json(path === '/api/state' ? emptyLibrary() : { application: 'LunaNahida', nativeFiles: true, nativeFolders: true, nativeCover: false, nativeFonts: true }));
  assert.equal(runtime.mode, 'desktop');
  assert.equal(runtime.nativeFiles, true);
  assert.equal(runtime.nativeFolders, true);
  assert.equal(runtime.nativeCover, false);
  assert.equal(runtime.nativeFonts, true);
});

test('known backend or desktop failures must not silently become web mode', async () => {
  await assert.rejects(discoverRuntime(true, signal(), async () => new Response('', { status: 404 })));
  await assert.rejects(discoverRuntime(false, signal(), async () => new Response('', { status: 503 })));
  await assert.rejects(discoverRuntime(false, signal(), async path => path === '/api/state' ? new Response('', { status: 500 }) : json({ application: 'LunaNahida' })));
  await assert.rejects(discoverRuntime(false, signal(), async path => json(path === '/api/state' ? {} : { application: 'LunaNahida' })));
});
