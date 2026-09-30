import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emptyLibrary } from '../src/lib/runtime.ts';
import { defaultWorkTimer } from '../src/lib/work-timer.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve('dist');
const output = resolve('.output/web-compatibility');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) { response.writeHead(404).end(); return; }
  const file = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
  if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); response.end(await readFile(file)); }
  catch {
    if (extname(pathname)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'text/html'); response.end(await readFile(resolve(root, 'index.html')));
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;

// A real PCM fixture exercises HTML audio and the Web Audio graph.
function wav() {
  const samples = 44100 * 30;
  const value = Buffer.alloc(44 + samples * 2);
  value.write('RIFF'); value.writeUInt32LE(value.length - 8, 4); value.write('WAVE', 8);
  value.write('fmt ', 12); value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(44100, 24); value.writeUInt32LE(88200, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write('data', 36); value.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) value.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / 44100) * 2000), 44 + index * 2);
  return value;
}
const audio = wav();
const file = { name: 'browser-sample.wav', mimeType: 'audio/wav', buffer: audio };

async function setup({ backend = false, desktop = false, lateDesktop = false, viewport = { width: 1280, height: 800 } } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const requests = [];
  const state = emptyLibrary();
  const nativeWindow = { width: viewport.width, height: viewport.height, x: 100, y: 80, frameless: false, resizable: true, pinned: false, calls: [] };
  state.settings.dropAction = 'watch';
  let disconnected = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() }); });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.addInitScript(({ desktop, lateDesktop }) => {
    if (desktop && !lateDesktop) window._wails = { environment: { OS: 'windows' }, flags: { enableFileDrop: false } };
    const revoke = URL.revokeObjectURL.bind(URL);
    window.releasedURLs = [];
    URL.revokeObjectURL = source => { window.releasedURLs.push(source); revoke(source); };
    const createAnalyser = AudioContext.prototype.createAnalyser;
    window.analysisNodes = [];
    AudioContext.prototype.createAnalyser = function () {
      const node = createAnalyser.call(this);
      window.analysisNodes.push(node);
      return node;
    };
  }, { desktop, lateDesktop });
  if (desktop) await page.route('**/wails/runtime', async route => {
    const call = route.request().postDataJSON();
    nativeWindow.calls.push(call);
    let result = null;
    if (call.object === 6) {
      if (call.method === 0) result = { x: nativeWindow.x, y: nativeWindow.y };
      else if (call.method === 13 || call.method === 14) result = false;
      else if (call.method === 22) result = nativeWindow.resizable;
      else if (call.method === 37) result = { width: nativeWindow.width, height: nativeWindow.height };
      else if (call.method === 27) nativeWindow.frameless = call.args.frameless;
      else if (call.method === 25) nativeWindow.pinned = call.args.alwaysOnTop;
      else if (call.method === 32) nativeWindow.resizable = call.args.resizable;
      else if (call.method === 24) { nativeWindow.x = call.args.x; nativeWindow.y = call.args.y; }
      else if (call.method === 33) {
        nativeWindow.width = call.args.width; nativeWindow.height = call.args.height;
        await page.setViewportSize({ width: nativeWindow.width, height: nativeWindow.height });
      }
    }
    await route.fulfill({ json: result });
  });
  if (backend) await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (disconnected) { await route.fulfill({ status: 503, json: { error: 'test backend unavailable' } }); return; }
    if (path === '/api/capabilities') await route.fulfill({ json: { application: 'LunaNahida', nativeFiles: desktop, nativeFolders: desktop, nativeCover: desktop, nativeBackup: desktop } });
    else if (path === '/api/state') await route.fulfill({ json: state });
    else if (path === '/api/timer') await route.fulfill({ json: { timer: defaultWorkTimer, serverNow: Date.now() } });
    else if (path === '/api/cache') await route.fulfill({ json: { coverBytes: 0, webviewBytes: 100, metadataBytes: 0, networkAudioBytes: 0, totalBytes: 100, webviewClearPending: false } });
    else if (path === '/api/dialog/files' || path === '/api/dialog/folder') await route.fulfill({ json: { paths: [] } });
    else if (path === '/api/conversion/inspect') await route.fulfill({ json: { paths: [] } });
    else if (path === '/api/import') {
      state.tracks = [{ id: 1, title: 'Native Song', english: '', artist: '本地文件', album: 'Native Album', duration: 30, cover: '/covers/local.svg', genre: '', year: '', color: '#8daab0', source: '/api/media/audio/1', path: 'C:/music/native.wav' }];
      await route.fulfill({ json: state.tracks });
    } else if (path === '/api/media/audio/1') await route.fulfill({ contentType: 'audio/wav', body: audio });
    else await route.fulfill({ json: path === '/api/settings' ? JSON.parse(route.request().postData()) : { ok: true } });
  });
  await page.goto(url);
  await page.locator('.music-app').waitFor();
  return { page, errors, requests, nativeWindow, disconnect: () => { disconnected = true; } };
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const web = await setup();
  const { page, requests } = web;
  assert.equal(await page.getByRole('button', { name: '迷你模式', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '我的音乐', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '打开文件夹', exact: true }).isDisabled(), true);
  await page.locator('input[type=file][multiple]').setInputFiles(file);
  await page.locator('.album-title h2').filter({ hasText: 'browser-sample' }).waitFor();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.waitForFunction(() => window.analysisNodes.some(node => {
    const bins = new Uint8Array(node.frequencyBinCount);
    node.getByteFrequencyData(bins);
    return bins.some(value => value > 0);
  }));
  assert.equal(await page.getByRole('button', { name: '编辑这首歌的标签' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '存为歌单', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '示波器', exact: true }).click();
  await page.locator('.expanded-scope canvas').waitFor();
  await page.screenshot({ path: resolve(output, 'web-spectrum.png') });
  const pixels = await page.locator('.expanded-scope canvas').evaluate(canvas => {
    const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return values.some((value, index) => index % 4 === 3 && value !== 0);
  });
  assert.ok(pixels, 'spectrum canvas must render');
  await page.keyboard.press('Escape');
  await page.locator('.queue-sortable').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查看信息', exact: true }).click();
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('Session edit');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.album-title h2').innerText(), 'Session edit');
  await page.getByRole('link', { name: '播放器设置', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '导出备份', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('combobox', { name: '打开文件或文件夹处理方式' }).inputValue(), 'temporary');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  assert.ok(await page.locator('.music-app').evaluate(element => element.classList.contains('mode-dark')));
  await page.screenshot({ path: resolve(output, 'web-settings.png') });
  await page.getByRole('button', { name: '正在播放', exact: true }).click();
  await page.getByRole('button', { name: '音频工具箱', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '格式还原', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '曲库整理', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '计时器', exact: true }).click();
  await page.getByRole('spinbutton', { name: '倒计时分钟' }).fill('0');
  await page.getByRole('spinbutton', { name: '倒计时秒' }).fill('2');
  await page.getByRole('button', { name: '开始计时', exact: true }).click();
  await page.getByRole('button', { name: '重新开始', exact: true }).waitFor();
  await page.getByRole('button', { name: '清除计时', exact: true }).click();
  await page.getByRole('button', { name: '返回工具箱', exact: true }).click();
  await page.getByRole('button', { name: '噪音发生器', exact: true }).click();
  await page.getByRole('button', { name: '播放噪音', exact: true }).click();
  await page.getByRole('button', { name: '停止噪音', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '停止噪音', exact: true }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '清空播放队列', exact: true }).click();
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
  await page.locator('.listening-empty').waitFor();
  assert.equal(await page.evaluate(() => window.releasedURLs.length), 1);
  await page.evaluate(base64 => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'dropped.wav', { type: 'audio/wav' }));
    document.querySelector('.music-app').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, audio.toString('base64'));
  await page.locator('.album-title h2').filter({ hasText: 'dropped' }).waitFor();
  assert.deepEqual(requests.map(request => request.path), ['/api/capabilities']);
  assert.deepEqual(web.errors, []);
  await page.reload();
  await page.locator('.listening-empty').waitFor();
  assert.equal(await page.locator('.queue-sortable').count(), 0);
  await page.close();
  console.log('PASS static Web: playback, audio graph, scope, session metadata, settings, timer, noise, drag/drop, URL cleanup, refresh, no background API requests');

  const connected = await setup({ backend: true });
  assert.equal(await connected.page.getByRole('button', { name: '迷你模式', exact: true }).count(), 0);
  assert.equal(await connected.page.getByRole('button', { name: '我的音乐', exact: true }).isDisabled(), false);
  await connected.page.locator('input[type=file][multiple]').setInputFiles(file);
  await connected.page.locator('.album-title h2').filter({ hasText: 'browser-sample' }).waitFor();
  await connected.page.getByRole('button', { name: '我的音乐', exact: true }).click();
  assert.equal(await connected.page.locator('.library-row').count(), 0);
  await connected.page.getByRole('link', { name: '播放器设置', exact: true }).click();
  assert.equal(await connected.page.getByRole('button', { name: '导出备份', exact: true }).isDisabled(), false);
  assert.equal(await connected.page.getByRole('button', { name: '添加文件夹', exact: true }).isDisabled(), true);
  assert.equal(await connected.page.getByPlaceholder('后端可访问的文件夹绝对路径').isDisabled(), false);
  assert.ok(!connected.requests.some(request => ['/api/import', '/api/conversion/inspect', '/api/history'].includes(request.path)));
  assert.ok(!connected.requests.some(request => request.path === '/api/queue' && request.body !== '[]'));
  connected.disconnect();
  await connected.page.getByRole('button', { name: '正在播放', exact: true }).click();
  assert.equal(await connected.page.getByRole('button', { name: '我的音乐', exact: true }).isDisabled(), false);
  await connected.page.screenshot({ path: resolve(output, 'browser-backend.png') });
  assert.deepEqual(connected.errors, []);
  await connected.page.close();
  console.log('PASS browser with backend: temporary files do not enter the library, native dialogs disabled, backend controls retained');

  const native = await setup({ backend: true, desktop: true, lateDesktop: true });
  assert.equal(await native.page.getByRole('button', { name: '迷你模式', exact: true }).count(), 0);
  await native.page.evaluate(() => {
    window._wails = { environment: { OS: 'windows' }, flags: { enableFileDrop: false } };
    window.dispatchEvent(new Event('wails:runtime-config-ready'));
  });
  await native.page.getByRole('button', { name: '迷你模式', exact: true }).click();
  await native.page.getByRole('region', { name: '迷你播放器' }).waitFor();
  assert.equal(await native.page.getByRole('button', { name: '播放', exact: true }).isDisabled(), true);
  await native.page.getByRole('button', { name: '退出迷你模式', exact: true }).click();
  await native.page.getByRole('button', { name: '打开歌曲', exact: true }).click();
  assert.ok(native.requests.some(request => request.path === '/api/dialog/files'));
  assert.equal(await native.page.getByRole('button', { name: '打开文件夹', exact: true }).isDisabled(), false);
  await native.page.waitForFunction(() => typeof window._wails?.dispatchWailsEvent === 'function');
  await native.page.evaluate(() => window._wails.dispatchWailsEvent({ name: 'lunanahida:files-dropped', data: ['C:/music/native.wav'] }));
  await native.page.locator('.album-title h2').filter({ hasText: 'Native Song' }).waitFor();
  assert.ok(native.requests.some(request => request.path === '/api/import' && JSON.parse(request.body).mode === 'library'));
  await native.page.getByRole('button', { name: '播放', exact: true }).click();
  await native.page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  for (let pass = 0; pass < 2; pass++) {
    const playbackBefore = await native.page.locator('.seek-row input').inputValue();
    const streamsBefore = native.requests.filter(request => request.path === '/api/media/audio/1').length;
    await native.page.getByRole('button', { name: '迷你模式', exact: true }).click();
    const mini = native.page.getByRole('region', { name: '迷你播放器' });
    await mini.waitFor();
    assert.equal(native.nativeWindow.frameless, true);
    assert.equal(native.nativeWindow.resizable, false);
    assert.deepEqual(native.page.viewportSize(), { width: 400, height: 168 });
    assert.equal(await mini.locator('strong').innerText(), 'Native Song');
    assert.ok(Number(await mini.getByRole('slider', { name: '播放进度' }).inputValue()) >= Number(playbackBefore), 'switching preserves playback position');
    assert.equal(native.requests.filter(request => request.path === '/api/media/audio/1').length, streamsBefore, 'switching keeps the existing audio element and stream');
    await mini.getByRole('button', { name: '暂停', exact: true }).click();
    await mini.getByRole('button', { name: '播放', exact: true }).waitFor();
    await mini.getByRole('slider', { name: '播放进度' }).fill('5');
    await mini.getByRole('slider', { name: '音量' }).fill('30');
    await mini.getByRole('button', { name: '窗口置顶', exact: true }).click();
    await mini.getByRole('button', { name: '取消置顶', exact: true }).waitFor();
    assert.equal(native.nativeWindow.pinned, true);
    await mini.getByRole('button', { name: '播放', exact: true }).click();
    await mini.getByRole('button', { name: '暂停', exact: true }).waitFor();
    const bounds = await mini.evaluate(element => {
      const outside = [...element.querySelectorAll('button, input, img, strong, small')].filter(child => {
        const box = child.getBoundingClientRect();
        return box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight;
      });
      return { outside: outside.map(child => child.outerHTML), overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
    });
    assert.deepEqual(bounds, { outside: [], overflow: false });
    await native.page.screenshot({ path: resolve(output, `mini-player-${pass}.png`) });
    if (pass === 0) await mini.getByRole('button', { name: '退出迷你模式', exact: true }).click();
    else await native.page.keyboard.press('Escape');
    await native.page.locator('.music-app:not(.is-mini)').waitFor();
    assert.equal(native.nativeWindow.frameless, false);
    assert.equal(native.nativeWindow.pinned, false);
    assert.equal(native.nativeWindow.resizable, true);
    assert.deepEqual(native.page.viewportSize(), { width: 1280, height: 800 });
    assert.equal(await native.page.getByRole('slider', { name: '音量', exact: true }).inputValue(), '30');
  }
  await native.page.getByRole('button', { name: '音频工具箱', exact: true }).click();
  await native.page.getByRole('button', { name: '噪音发生器', exact: true }).click();
  await native.page.getByRole('button', { name: '播放噪音', exact: true }).click();
  await native.page.keyboard.press('Escape');
  await native.page.getByRole('button', { name: '迷你模式', exact: true }).click();
  const noiseMini = native.page.getByRole('region', { name: '迷你播放器' });
  await noiseMini.waitFor();
  assert.equal(await noiseMini.getByRole('slider', { name: '播放进度' }).isDisabled(), true);
  assert.equal(await noiseMini.getByRole('button', { name: '下一首', exact: true }).isDisabled(), true);
  await noiseMini.getByRole('button', { name: '暂停', exact: true }).click();
  await noiseMini.getByRole('button', { name: '播放', exact: true }).click();
  await noiseMini.getByRole('button', { name: '停止噪音', exact: true }).click();
  await noiseMini.locator('strong').filter({ hasText: 'Native Song' }).waitFor();
  await native.page.screenshot({ path: resolve(output, 'mini-player-paused.png') });
  await noiseMini.getByRole('button', { name: '退出迷你模式', exact: true }).click();
  assert.deepEqual(native.errors, []);
  await native.page.close();
  console.log('PASS simulated desktop: native dialogs, drops, mini window round trips, uninterrupted playback and compact controls');

  const failure = await browser.newPage();
  await failure.route('**/api/capabilities', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await failure.goto(url);
  await failure.getByRole('button', { name: '重试', exact: true }).waitFor();
  assert.equal(await failure.locator('.music-app').count(), 0);
  await failure.close();
  console.log('PASS backend startup failure: explicit retry instead of silent empty-library fallback');

  const mobile = await setup({ viewport: { width: 390, height: 844 } });
  await mobile.page.locator('input[type=file][multiple]').setInputFiles(file);
  await mobile.page.locator('.album-title h2').waitFor();
  await mobile.page.screenshot({ path: resolve(output, 'web-mobile.png'), fullPage: true });
  assert.deepEqual(mobile.errors, []);
  await mobile.page.close();
  console.log('PASS mobile Web render');
} catch (error) {
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
