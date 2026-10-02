import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emptyLibrary } from '../src/lib/runtime.ts';
import { defaultWorkTimer } from '../src/lib/work-timer.ts';
import { defaultTimerReminders } from '../src/lib/timer-reminders.ts';

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

async function setup({ backend = false, desktop = false, lateDesktop = false, fontFamilies = [], nativeFonts = desktop, trackTitle = 'Native Song', tracks = [], queue = [], dictionary = 'available', viewport = { width: 1280, height: 800 } } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const requests = [];
  const dictionaryRequests = [];
  const state = emptyLibrary();
  state.tracks = tracks;
  state.queue = queue;
  state.settings.uiFontFamilies = fontFamilies;
  const nativeWindow = { width: viewport.width, height: viewport.height, x: 100, y: 80, frameless: true, resizable: true, pinned: false, calls: [] };
  state.settings.dropAction = 'watch';
  let disconnected = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() }); });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/search-dict/')) dictionaryRequests.push(new URL(request.url()).pathname); });
  if (dictionary !== 'available') await page.route('**/search-dict/**', async route => {
    const manifest = new URL(route.request().url()).pathname.endsWith('/manifest.json');
    if (manifest && dictionary !== 'missing') await route.fulfill({ json: { available: dictionary === 'corrupt' } });
    else await route.fulfill({ status: 404, body: '' });
  });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.addInitScript(({ desktop, lateDesktop }) => {
    if (desktop && !lateDesktop) window._wails = { environment: { OS: 'windows' }, flags: { enableFileDrop: false } };
    const revoke = URL.revokeObjectURL.bind(URL);
    window.releasedURLs = [];
    URL.revokeObjectURL = source => { window.releasedURLs.push(source); revoke(source); };
    const createAnalyser = AudioContext.prototype.createAnalyser;
    const createOscillator = AudioContext.prototype.createOscillator;
    window.timerTones = [];
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = time => { window.timerTones.push(oscillator.frequency.value); start(time); };
      return oscillator;
    };
    window.timerNotifications = [];
    window.notificationPermission = 'granted';
    window.Notification = class {
      static get permission() { return window.notificationPermission; }
      static async requestPermission() { return window.notificationPermission; }
      constructor(title, options) { window.timerNotifications.push({ title, options }); }
    };
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
    if (path === '/api/capabilities') await route.fulfill({ json: { application: 'LunaNahida', nativeFiles: desktop, nativeFolders: desktop, nativeCover: desktop, nativeBackup: desktop, nativeFonts } });
    else if (path === '/api/fonts') await route.fulfill({ json: ['Arial', 'Segoe UI', 'Microsoft YaHei', 'Yu Gothic'] });
    else if (path === '/api/state') await route.fulfill({ json: state });
    else if (path === '/api/timer') await route.fulfill({ json: { timer: defaultWorkTimer, serverNow: Date.now() } });
    else if (path === '/api/timer/reminders') await route.fulfill({ json: route.request().method() === 'PUT' ? route.request().postDataJSON() : defaultTimerReminders });
    else if (path === '/api/backups') await route.fulfill({json:{policy:{enabled:false,intervalHours:24,keepCount:7},files:[],events:[]}});
    else if (path === '/api/cache') await route.fulfill({ json: { coverBytes: 0, webviewBytes: 100, metadataBytes: 0, networkAudioBytes: 0, totalBytes: 100, webviewClearPending: false } });
    else if (path === '/api/dialog/files' || path === '/api/dialog/folder') await route.fulfill({ json: { paths: [] } });
    else if (path === '/api/conversion/inspect') await route.fulfill({ json: { paths: [] } });
    else if (path === '/api/import') {
      state.tracks = [{ id: 1, title: trackTitle, english: '', artist: '本地文件', album: 'Native Album', duration: 30, cover: '/covers/local.svg', genre: '', year: '', color: '#8daab0', source: '/api/media/audio/1', path: 'C:/music/native.wav' }];
      await route.fulfill({ json: state.tracks });
    } else if (path === '/api/media/audio/1') await route.fulfill({ contentType: 'audio/wav', body: audio });
    else if (path === '/api/settings') { state.settings = route.request().postDataJSON(); await route.fulfill({ json: state.settings }); }
    else await route.fulfill({ json: { ok: true } });
  });
  await page.goto(url);
  await page.locator('.music-app').waitFor();
  return { page, errors, requests, dictionaryRequests, nativeWindow, state, disconnect: () => { disconnected = true; } };
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
  await page.getByRole('tab', { name: '数据与备份', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '导出备份', exact: true }).isDisabled(), true);
  await page.getByRole('tab', { name: '音乐库', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '打开文件或文件夹处理方式' }).inputValue(), 'temporary');
  await page.getByRole('tab', { name: '外观', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '界面字体', exact: true }).count(), 0);
  assert.ok(!requests.some(request => request.path === '/api/fonts'));
  await page.getByRole('button', { name: '深色', exact: true }).click();
  assert.ok(await page.locator('.music-app').evaluate(element => element.classList.contains('mode-dark')));
  await page.screenshot({ path: resolve(output, 'web-settings.png') });
  await page.getByRole('button', { name: '搜索设置', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('歌词字体');
  await page.getByRole('searchbox', { name: '搜索设置', exact: true }).press('Enter');
  await page.getByRole('combobox', { name: '歌词字体', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '播放与歌词', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: '正在播放', exact: true }).click();
  await page.getByRole('button', { name: '音频工具箱', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '格式还原', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '曲库整理', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '计时器', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: '播放音效' }).isChecked(), false);
  assert.equal(await page.getByRole('checkbox', { name: '桌面通知' }).isChecked(), false);
  await page.getByRole('checkbox', { name: '播放音效' }).check();
  await page.getByRole('combobox', { name: '提醒音效' }).selectOption('bell');
  await page.getByRole('button', { name: '试听音效' }).click();
  await page.waitForFunction(() => window.timerTones.length === 3);
  await page.getByRole('checkbox', { name: '桌面通知' }).check();
  await page.getByRole('spinbutton', { name: '倒计时分钟' }).fill('0');
  await page.getByRole('spinbutton', { name: '倒计时秒' }).fill('2');
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
  await page.getByRole('button', { name: '开始计时', exact: true }).click();
  await page.getByRole('button', { name: '重新开始', exact: true }).waitFor();
  await page.waitForFunction(() => window.timerTones.length === 6 && window.timerNotifications.length === 1);
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: false }));
  assert.deepEqual(await page.evaluate(() => window.timerTones), [880, 1320, 1760, 880, 1320, 1760]);
  await page.screenshot({ path: resolve(output, 'timer-reminders.png') });
  await page.getByRole('checkbox', { name: '播放音效' }).uncheck();
  await page.getByRole('checkbox', { name: '桌面通知' }).uncheck();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.getByRole('button', { name: '重新开始', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.timerTones.length), 6);
  assert.equal(await page.evaluate(() => window.timerNotifications.length), 1);
  await page.getByRole('button', { name: '清除计时', exact: true }).click();
  await page.evaluate(() => { window.notificationPermission = 'denied'; });
  await page.getByRole('checkbox', { name: '桌面通知' }).click();
  await page.waitForFunction(() => !document.querySelector('.work-timer-option:last-child input').checked);
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

  const connected = await setup({ backend: true, nativeFonts: true, fontFamilies: ['Arial'] });
  assert.equal(await connected.page.getByRole('button', { name: '迷你模式', exact: true }).count(), 0);
  assert.equal(await connected.page.getByRole('button', { name: '我的音乐', exact: true }).isDisabled(), false);
  await connected.page.locator('input[type=file][multiple]').setInputFiles(file);
  await connected.page.locator('.album-title h2').filter({ hasText: 'browser-sample' }).waitFor();
  await connected.page.getByRole('button', { name: '我的音乐', exact: true }).click();
  assert.equal(await connected.page.locator('.library-row').count(), 0);
  await connected.page.getByRole('link', { name: '播放器设置', exact: true }).click();
  await connected.page.getByRole('tab', { name: '外观', exact: true }).click();
  assert.equal(await connected.page.getByRole('heading', { name: '界面字体', exact: true }).count(), 0);
  assert.ok(!connected.requests.some(request => request.path === '/api/fonts'));
  assert.ok(!await connected.page.locator('.music-app').evaluate(element => getComputedStyle(element).fontFamily.startsWith('Arial')));
  await connected.page.getByRole('tab', { name: '数据与备份', exact: true }).click();
  assert.equal(await connected.page.getByRole('button', { name: '导出备份', exact: true }).isDisabled(), false);
  await connected.page.getByRole('tab', { name: '音乐库', exact: true }).click();
  assert.equal(await connected.page.getByRole('button', { name: '添加文件夹', exact: true }).isDisabled(), true);
  assert.equal(await connected.page.getByPlaceholder('音乐库服务所在电脑的文件夹完整路径').isDisabled(), false);
  assert.ok(!connected.requests.some(request => ['/api/import', '/api/conversion/inspect', '/api/history'].includes(request.path)));
  assert.ok(!connected.requests.some(request => request.path === '/api/queue' && request.body !== '[]'));
  connected.disconnect();
  await connected.page.getByRole('button', { name: '正在播放', exact: true }).click();
  assert.equal(await connected.page.getByRole('button', { name: '我的音乐', exact: true }).isDisabled(), false);
  await connected.page.screenshot({ path: resolve(output, 'browser-backend.png') });
  assert.deepEqual(connected.errors, []);
  await connected.page.close();
  console.log('PASS browser with backend: temporary files do not enter the library, native dialogs disabled, backend controls retained');

  const searchTracks = [
    { title: '黑白配', artist: '范玮琪', album: '我们的纪念日' },
    { title: '紅豆', artist: '王菲', album: '唱遊' },
    { title: '前前前世', artist: 'RADWIMPS', album: '君の名は。' },
    { title: 'ギブス', artist: '椎名林檎', album: '勝訴ストリップ' },
  ].map((track, index) => ({ id: index + 1, english: '', duration: 180, cover: '/covers/local.svg', genre: '', year: '2016', color: '#8daab0', source: `/api/media/audio/${index + 1}`, customTags: ['夜晚'], ...track }));
  const phonetic = await setup({ backend: true, tracks: searchTracks });
  const searchPage = phonetic.page;
  await searchPage.getByRole('button', { name: '我的音乐', exact: true }).click();
  const songSearch = searchPage.getByRole('textbox', { name: '搜索歌曲、歌手、专辑或标签', exact: true });
  for (const [term, title] of [['hbp', '黑白配'], ['HEI BAI PEI', '黑白配'], ['fwq', '黑白配'], ['hongdou', '紅豆'], ['kmnnw', '前前前世'], ['zenzenzense', '前前前世'], ['shiinaringo', 'ギブス']]) {
    await songSearch.fill(term);
    await searchPage.waitForFunction(expected => {
      const names = [...document.querySelectorAll('.library-track-name strong')].map(element => element.textContent);
      return names.length === 1 && names[0] === expected;
    }, title);
  }
  await songSearch.fill('hbp');
  await searchPage.getByRole('button', { name: '组合筛选', exact: true }).click();
  await searchPage.getByLabel('歌手包含', { exact: true }).fill('fanweiqi');
  await searchPage.getByLabel('专辑包含', { exact: true }).fill('wmdjnr');
  assert.equal(await searchPage.locator('.library-row').count(), 1);
  await searchPage.getByRole('button', { name: '完成', exact: true }).click();
  await searchPage.screenshot({ path: resolve(output, 'phonetic-song-search.png') });
  await searchPage.getByRole('button', { name: '歌手', exact: true }).click();
  await searchPage.getByRole('textbox', { name: '搜索歌手', exact: true }).fill('shiinaringo');
  await searchPage.locator('.catalog-grid strong').filter({ hasText: '椎名林檎' }).waitFor();
  assert.equal(await searchPage.locator('.catalog-grid > button').count(), 1);
  await searchPage.getByRole('button', { name: '专辑', exact: true }).click();
  await searchPage.getByRole('textbox', { name: '搜索专辑', exact: true }).fill('kimi no na wa');
  await searchPage.locator('.catalog-grid strong').filter({ hasText: '君の名は。' }).waitFor();
  assert.equal(await searchPage.locator('.catalog-grid > button').count(), 1);
  assert.deepEqual(phonetic.errors, []);
  await searchPage.close();
  console.log('PASS phonetic search: pinyin, initials, traditional Chinese, kana/kanji romaji, asynchronous index updates, combined filters, artists and albums');

  for (const dictionary of ['missing', 'incomplete', 'corrupt']) {
    const optional = await setup({ backend: true, tracks: searchTracks, dictionary });
    await optional.page.getByRole('button', { name: '我的音乐', exact: true }).click();
    await optional.page.waitForFunction(() => document.querySelector('.library-row'));
    const search = optional.page.getByRole('textbox', { name: '搜索歌曲、歌手、专辑或标签', exact: true });
    await search.fill('hbp');
    await optional.page.locator('.library-track-name strong').filter({ hasText: '黑白配' }).waitFor();
    await search.fill('君の名は');
    await optional.page.locator('.library-track-name strong').filter({ hasText: '前前前世' }).waitFor();
    await search.fill('kiminonawa');
    assert.equal(await optional.page.locator('.library-row').count(), 0);
    await search.fill('ギブス');
    await optional.page.locator('.library-track-name strong').filter({ hasText: 'ギブス' }).waitFor();
    assert.deepEqual(optional.errors, []);
    if (dictionary !== 'corrupt') assert.ok(optional.dictionaryRequests.every(path => path.endsWith('manifest.json')), 'unavailable dictionaries must not start bulk downloads');
    await optional.page.close();
  }
  console.log('PASS optional dictionary: missing, incomplete and corrupt resources disable Japanese readings, literal and pinyin search remain usable');

  const fonts = await setup({ backend: true, desktop: true });
  const fontPage = fonts.page;
  await fontPage.getByRole('link', { name: '播放器设置', exact: true }).click();
  await fontPage.getByRole('tab', { name: '外观', exact: true }).click();
  for (const name of ['Arial', 'Microsoft YaHei', 'Yu Gothic']) {
    await fontPage.getByRole('button', { name: '添加字体', exact: true }).click();
    await fontPage.getByRole('searchbox', { name: '搜索系统字体', exact: true }).fill(name);
    await fontPage.locator('.system-font-results').getByRole('button', { name, exact: true }).click();
  }
  await fontPage.waitForFunction(() => getComputedStyle(document.querySelector('.music-app')).fontFamily.startsWith('Arial, "Microsoft YaHei", "Yu Gothic"'));
  const reorderedSaved = fontPage.waitForResponse(response => response.url().endsWith('/api/settings') && JSON.stringify(response.request().postDataJSON().uiFontFamilies) === '["Arial","Yu Gothic","Microsoft YaHei"]');
  await fontPage.getByRole('button', { name: '上移 Yu Gothic', exact: true }).click();
  await fontPage.waitForFunction(() => getComputedStyle(document.querySelector('.music-app')).fontFamily.startsWith('Arial, "Yu Gothic", "Microsoft YaHei"'));
  await fontPage.locator('.system-font-footer').scrollIntoViewIfNeeded();
  await fontPage.screenshot({ path: resolve(output, 'desktop-fonts.png') });
  await fontPage.getByRole('button', { name: '添加字体', exact: true }).click();
  assert.ok((await fontPage.locator('.system-font-dialog').evaluate(element => getComputedStyle(element).fontFamily)).startsWith('Arial, "Yu Gothic"'));
  await fontPage.locator('.system-font-dialog').evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
  await fontPage.screenshot({ path: resolve(output, 'desktop-font-picker.png') });
  await fontPage.keyboard.press('Escape');
  await reorderedSaved;
  await fontPage.reload();
  await fontPage.locator('.music-app').waitFor();
  assert.ok((await fontPage.locator('.music-app').evaluate(element => getComputedStyle(element).fontFamily)).startsWith('Arial, "Yu Gothic", "Microsoft YaHei"'));
  await fontPage.getByRole('button', { name: '迷你模式', exact: true }).click();
  await fontPage.locator('.desktop-mini-player').waitFor();
  assert.ok((await fontPage.locator('.desktop-mini-player').evaluate(element => getComputedStyle(element).fontFamily)).startsWith('Arial, "Yu Gothic"'));
  await fontPage.getByRole('button', { name: '退出迷你模式', exact: true }).click();
  await fontPage.getByRole('link', { name: '播放器设置', exact: true }).click();
  await fontPage.getByRole('tab', { name: '外观', exact: true }).click();
  await fontPage.getByRole('button', { name: '移除 Yu Gothic', exact: true }).click();
  await fontPage.getByRole('button', { name: '恢复默认', exact: true }).click();
  await fontPage.waitForFunction(() => !document.body.hasAttribute('data-ui-fonts'));
  assert.equal(await fontPage.locator('.system-font-row').count(), 0);
  assert.deepEqual(fonts.errors, []);
  await fontPage.close();
  console.log('PASS desktop system fonts: search, priority, persistence, dialogs, mini player and reset; Web modes hide and disable');

  const themed = await setup({ backend: true, desktop: true, tracks: searchTracks, queue: [1] });
  const themePage = themed.page;
  const backgrounds = [];
  const surfaceColors = async () => themePage.evaluate(() => {
    const resolveColor = token => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove(); return color;
    };
    const background = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
    return { page: background('.music-app'), body: background('body'), sidebar: background('.sidebar'), playback: background('.playback-bar'), expectedPage: resolveColor('--page-background'), expectedPanel: resolveColor('--panel-background'), expectedField: resolveColor('--field-background'), expectedHighlight: resolveColor('--light-highlight') };
  });
  const waitForTheme = async () => themePage.waitForFunction(() => {
    const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--page-background)'; document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor; probe.remove();
    return getComputedStyle(document.querySelector('.music-app')).backgroundColor === expected;
  });
  for (const [id, name] of [['dusk', '山间暮色'], ['anime', '星野放映室'], ['forest', '纳西妲之森'], ['custom', '自定义配色']]) {
    await themePage.getByRole('link', { name: '播放器设置', exact: true }).click();
    await themePage.getByRole('tab', { name: '外观', exact: true }).click();
    await themePage.getByRole('button', { name, exact: true }).click();
    if (id === 'custom') await themePage.getByLabel('自定义主题基色', { exact: true }).fill('#007aff');
    await waitForTheme();
    const colors = await surfaceColors();
    backgrounds.push(colors.page);
    assert.equal(colors.page, colors.expectedPage); assert.equal(colors.body, colors.expectedPage); assert.equal(colors.playback, colors.expectedPanel);
    assert.equal(await themePage.locator('.settings-navigation').evaluate(e => getComputedStyle(e).backgroundColor), colors.expectedPage);
    await themePage.getByRole('button', { name: '搜索设置', exact: true }).click();
    assert.equal(await themePage.locator('.settings-search-popover').evaluate(e => getComputedStyle(e).backgroundColor), colors.expectedPanel);
    await themePage.keyboard.press('Escape');
    await themePage.getByRole('button', { name: '我的音乐', exact: true }).click();
    await themePage.locator('.library-row').first().hover();
    await themePage.waitForFunction(expected => getComputedStyle(document.querySelector('.library-row')).backgroundColor === expected, colors.expectedHighlight);
    assert.equal(await themePage.locator('.library-row').first().evaluate(e => getComputedStyle(e).backgroundColor), colors.expectedHighlight);
    await themePage.screenshot({ path: resolve(output, `light-theme-${id}.png`) });
    await themePage.getByRole('button', { name: '音频工具箱', exact: true }).click();
    assert.equal(await themePage.locator('.toolbox-dialog').evaluate(e => getComputedStyle(e).backgroundColor), colors.expectedPanel);
    await themePage.keyboard.press('Escape');
    await themePage.getByRole('button', { name: '迷你模式', exact: true }).click();
    await themePage.locator('.desktop-mini-player').waitFor();
    assert.equal(await themePage.locator('.music-app').evaluate(e => getComputedStyle(e).backgroundColor), colors.expectedPage);
    await themePage.screenshot({ path: resolve(output, `light-theme-${id}-mini.png`) });
    await themePage.getByRole('button', { name: '退出迷你模式', exact: true }).click();
  }
  assert.equal(new Set(backgrounds).size, 4, 'every theme must change the main background');
  await themePage.getByRole('link', { name: '播放器设置', exact: true }).click();
  await themePage.getByRole('tab', { name: '外观', exact: true }).click();
  for (const color of ['#ffff00', '#ffffff', '#000000', '#ff3366']) {
    await themePage.getByLabel('自定义主题基色', { exact: true }).fill(color);
    await waitForTheme();
    const colors = await surfaceColors();
    assert.equal(colors.playback, colors.expectedPanel);
  }
  await themePage.screenshot({ path: resolve(output, 'custom-theme-picker.png') });
  const savedCustomTheme = themePage.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().postDataJSON().themeColor === '#ff3366' && response.request().postDataJSON().appearance === 'dark');
  await themePage.getByRole('button', { name: '深色', exact: true }).click();
  await waitForTheme();
  await themePage.waitForFunction(() => document.documentElement.style.colorScheme === 'dark');
  await themePage.screenshot({ path: resolve(output, 'custom-theme-dark.png') });
  await themePage.waitForFunction(() => window.innerWidth === 1280);
  // Wait for the saved settings request, then reload from the simulated persistent backend.
  await savedCustomTheme;
  await themePage.reload();
  await themePage.locator('.music-app.theme-custom.mode-dark').waitFor();
  await themePage.getByRole('link', { name: '播放器设置', exact: true }).click();
  await themePage.getByRole('tab', { name: '外观', exact: true }).click();
  assert.equal(await themePage.getByLabel('自定义主题基色', { exact: true }).inputValue(), '#ff3366');
  await themePage.getByRole('button', { name: '浅色', exact: true }).click();
  await themePage.getByRole('button', { name: '山间暮色', exact: true }).click();
  await waitForTheme();
  assert.equal(await themePage.evaluate(() => document.documentElement.style.getPropertyValue('--page-background')), '', 'preset themes must clear custom overrides');
  assert.deepEqual(themed.errors, []);
  await themePage.close();
  console.log('PASS theme palettes: all presets and custom colors update main pages, list hover, playback, search popovers, dialogs and mini mode; saved custom colors survive reload');

  const miniDropTrack = (id, title) => ({ id, title, english: '', artist: 'Drop Artist', album: 'Drop Album', duration: 30, cover: '/covers/local.svg', genre: '', year: '', color: '#8daab0', source: `/api/media/audio/${id}`, path: `C:/music/${title}.wav` });
  const droppedMini = await setup({ backend: true, desktop: true, tracks: [miniDropTrack(1, 'Previous Song')], queue: [1] });
  const { page: dropPage, state: dropState } = droppedMini;
  const normalDrop = miniDropTrack(2, 'Dropped Song');
  const convertedDrop = miniDropTrack(3, 'Converted Song');
  const nextDrop = miniDropTrack(4, 'Next Drop');
  const slowDrop = miniDropTrack(5, 'Slow Converted Song');
  await dropPage.route('**/api/media/audio/*', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await dropPage.route('**/api/conversion/inspect', route => route.fulfill({ json: { paths: route.request().postDataJSON().paths.filter(path => path.endsWith('.qmc0')) } }));
  await dropPage.route('**/api/import', route => {
    const {paths, mode, skipConversion} = route.request().postDataJSON();
    assert.equal(mode, 'library'); assert.equal(skipConversion, true);
    const imported = [normalDrop, nextDrop].filter(track => paths.includes(track.path));
    for (const track of imported) if (!dropState.tracks.some(item => item.id === track.id)) dropState.tracks.push(track);
    return route.fulfill({ json: imported });
  });
  await dropPage.route('**/api/conversion', async route => {
    const {path, addToLibrary} = route.request().postDataJSON();
    assert.equal(addToLibrary, true);
    if (path.endsWith('broken.qmc0')) return route.fulfill({ json: { source: path, status: 'failed', error: 'Test decode failure' } });
    const track = path.endsWith('slow.qmc0') ? slowDrop : convertedDrop;
    if (track === slowDrop) await new Promise(resolve => setTimeout(resolve, 200));
    if (!dropState.tracks.some(item => item.id === track.id)) dropState.tracks.push(track);
    return route.fulfill({ json: { source: path, output: track.path, status: 'converted', track } });
  });
  await dropPage.waitForFunction(() => typeof window._wails?.dispatchWailsEvent === 'function');
  await dropPage.getByRole('button', { name: '迷你模式', exact: true }).click();
  const dropMini = dropPage.getByRole('region', { name: '迷你播放器' });
  await dropMini.waitFor();
  const resizeCalls = droppedMini.nativeWindow.calls.filter(call => call.method === 33).length;
  const dropIntoMini = paths => dropPage.evaluate(paths => window._wails.dispatchWailsEvent({ name: 'lunanahida:files-dropped', data: paths }), paths);
  const waitDrop = async (title, ids) => {
    await dropMini.locator('strong').filter({ hasText: title }).waitFor();
    await dropMini.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await dropPage.waitForFunction(expected => {
      const queue = [...document.querySelectorAll('.queue-sortable .queue-track-label > span')].map(element => element.textContent);
      return JSON.stringify(queue) === JSON.stringify(expected);
    }, ids.map(id => [miniDropTrack(1, 'Previous Song'), normalDrop, convertedDrop, nextDrop, slowDrop].find(track => track.id === id).title));
    assert.deepEqual(dropPage.viewportSize(), { width: 400, height: 168 });
    assert.equal(droppedMini.nativeWindow.calls.filter(call => call.method === 33).length, resizeCalls);
    assert.equal(await dropPage.locator('.toolbox-dialog').count(), 0);
  };
  await dropIntoMini([normalDrop.path]);
  await waitDrop(normalDrop.title, [1, 2]);
  await dropIntoMini(['C:/music/secret.qmc0']);
  await waitDrop(convertedDrop.title, [1, 2, 3]);
  await dropIntoMini(['C:/music/broken.qmc0', nextDrop.path]);
  await waitDrop(nextDrop.title, [1, 2, 3, 4]);
  await dropIntoMini(['C:/music/slow.qmc0']);
  await dropIntoMini([normalDrop.path]);
  await waitDrop(normalDrop.title, [1, 2, 3, 4, 5]);
  assert.ok(droppedMini.requests.some(request => request.path === '/api/conversion' && JSON.parse(request.body).path.endsWith('broken.qmc0')));
  assert.deepEqual(droppedMini.errors, []);
  await dropPage.close();
  console.log('PASS mini file drops: direct import and conversion, append existing queue, immediate playback, partial failures, consecutive drops and unchanged window size');

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
    assert.equal(await mini.locator('.mini-title.is-scrolling').count(), 0);
    assert.equal(await mini.getByText('LunaNahida', { exact: true }).count(), 0);
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
    await mini.getByRole('button', { name: '取消置顶', exact: true }).click();
    await mini.getByRole('button', { name: '窗口置顶', exact: true }).waitFor();
    if (pass === 0) await mini.getByRole('button', { name: '退出迷你模式', exact: true }).click();
    else await native.page.keyboard.press('Escape');
    await native.page.locator('.music-app:not(.is-mini)').waitFor();
    assert.equal(native.nativeWindow.frameless, true);
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

  const longTitle = '一首很长的歌曲名称 / A long song title with a complete ending';
  const scrolling = await setup({ backend: true, desktop: true, trackTitle: longTitle });
  await scrolling.page.waitForFunction(() => typeof window._wails?.dispatchWailsEvent === 'function');
  await scrolling.page.evaluate(() => window._wails.dispatchWailsEvent({ name: 'lunanahida:files-dropped', data: ['C:/music/native.wav'] }));
  await scrolling.page.locator('.album-title h2').filter({ hasText: longTitle }).waitFor();
  await scrolling.page.getByRole('button', { name: '迷你模式', exact: true }).click();
  const scrollingTitle = scrolling.page.locator('.mini-title.is-scrolling');
  await scrollingTitle.waitFor();
  assert.equal(await scrollingTitle.innerText(), longTitle);
  const titleBounds = await scrollingTitle.evaluate(element => {
    const text = element.querySelector('span');
    const animation = text.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const beginning = text.getBoundingClientRect().left;
    animation.currentTime = animation.effect.getTiming().duration;
    return { beginning, end: text.getBoundingClientRect().right, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.clientWidth };
  });
  assert.ok(titleBounds.width <= 256);
  assert.ok(Math.abs(titleBounds.beginning - titleBounds.left) <= 1);
  assert.ok(Math.abs(titleBounds.end - titleBounds.right) <= 1, 'scrolling reveals the end of the complete title');
  await scrolling.page.screenshot({ path: resolve(output, 'mini-player-long-title.png') });
  await scrolling.page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await scrollingTitle.locator('span').evaluate(element => getComputedStyle(element).animationName), 'none');
  await scrolling.page.screenshot({ path: resolve(output, 'mini-player-reduced-motion.png') });
  assert.deepEqual(scrolling.errors, []);
  await scrolling.page.close();
  console.log('PASS mini layout: full title scrolling, clipped text bounds, stationary short titles and reduced-motion fallback');

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
  await mobile.page.getByRole('button', { name: '音频工具箱', exact: true }).click();
  await mobile.page.getByRole('button', { name: '计时器', exact: true }).click();
  await mobile.page.getByRole('button', { name: '试听音效' }).scrollIntoViewIfNeeded();
  await mobile.page.screenshot({ path: resolve(output, 'timer-reminders-mobile.png') });
  assert.deepEqual(await mobile.page.locator('.work-timer-reminders').evaluate(element => [...element.querySelectorAll('label, select, button, input')].filter(child => {
    const bounds = child.getBoundingClientRect();
    return bounds.left < 0 || bounds.right > innerWidth;
  }).map(child => child.outerHTML)), []);
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
