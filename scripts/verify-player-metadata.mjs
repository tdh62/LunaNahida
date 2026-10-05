import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export default async function verifyPlayerMetadata(setup, output, makeTrack) {
  const tracks = Array.from({ length: 6 }, (_, index) => ({ ...makeTrack(index + 1, `未播放 ${index + 1}`), source: '/api/media/audio/1', duration: 0 }));
  const run = await setup({ backend: true, tracks, queue: tracks.map(track => track.id) });
  const { page } = run;
  await page.getByRole('button', { name: '我的音乐', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.library-duration')].length === 6 && [...document.querySelectorAll('.library-duration')].every(node => node.textContent === '00:30'));
  assert.equal(run.requests.filter(request => request.path === '/api/history').length, 0, 'metadata reads must not play tracks');
  assert.equal(new Set(run.requests.filter(request => request.path.endsWith('/duration')).map(request => request.path)).size, 6, 'all tracks persist duration even when updates cancel an in-flight batch');
  await page.screenshot({ path: resolve(output, 'unplayed-track-durations.png') });
  assert.deepEqual(run.errors, []);
  await page.close();

  // A nonzero stale duration skips the background probe, exercising the player itself.
  const playback = await setup({ backend: true, tracks: [{ ...makeTrack(1, '播放时长同步'), duration: 1 }], queue: [1] });
  const playingPage = playback.page;
  await playingPage.evaluate(() => {
    window.testAudio = [];
    const load = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () { window.testAudio.push(this); return load.call(this); };
  });
  await playingPage.locator('.queue-list .queue-track').first().dblclick();
  await playingPage.waitForFunction(() => document.querySelector('.seek-row span:last-child')?.textContent === '00:30');
  await playingPage.waitForFunction(() => Number(document.querySelector('.playback-bar input[aria-label="播放进度"]').value) > 0.5);
  await playingPage.getByRole('button', { name: '我的音乐', exact: true }).click();
  await playingPage.waitForFunction(() => document.querySelector('.library-duration')?.textContent === '00:30');
  await playingPage.evaluate(() => {
    const audio = window.testAudio.find(element => element.currentSrc.endsWith('/api/media/audio/1'));
    Object.defineProperty(audio, 'duration', { configurable: true, value: 45 });
    audio.dispatchEvent(new Event('durationchange'));
  });
  await playingPage.waitForFunction(() => document.querySelector('.seek-row span:last-child')?.textContent === '00:45' && document.querySelector('.library-duration')?.textContent === '00:45');
  await playingPage.evaluate(() => window.dispatchEvent(new Event('lunanahida-library-changed')));
  await playingPage.waitForFunction(() => document.querySelector('.library-duration')?.textContent === '00:45');
  assert.deepEqual(playback.errors, []);
  await playingPage.close();
  console.log('PASS track durations: unplayed library metadata, complete batches, persisted values, playback progress and later duration changes');

  for (const viewport of [{ width: 1280, height: 800 }, { width: 1000, height: 600 }, { width: 390, height: 844 }]) {
    const organizer = await setup({ backend: true, viewport, textSize: 125 });
    const toolsPage = organizer.page;
    await toolsPage.route('**/api/organizer/preview', route => route.fulfill({ json: {
      id: 'preview', mode: 'rename', scanned: 10, warnings: [], groups: [],
      moves: Array.from({ length: 10 }, (_, index) => ({ source: `C:/music/long-album-folder/song-${index}.flac`, destination: `C:/music/long-album-folder/artist - song-${index}.flac`, companions: [] })),
    } }));
    await toolsPage.getByRole('button', { name: '音频工具箱', exact: true }).click();
    await toolsPage.getByRole('button', { name: '曲库整理', exact: true }).click();
    await toolsPage.locator('#organizer-source').fill('C:/music');
    await toolsPage.getByRole('button', { name: '添加来源路径', exact: true }).click();
    await toolsPage.getByRole('button', { name: '预览整理', exact: true }).click();
    await toolsPage.getByRole('checkbox').check();
    const execute = toolsPage.getByRole('button', { name: '确认并执行', exact: true });
    await execute.scrollIntoViewIfNeeded();
    await execute.click({ trial: true });
    const dialog = await toolsPage.getByRole('dialog').boundingBox();
    const bar = await toolsPage.locator('.playback-bar').boundingBox();
    assert.ok(dialog.y >= 15 && dialog.y + dialog.height <= bar.y - 15, `organizer must fit above playback controls: ${JSON.stringify({ viewport, dialog, bar })}`);
    assert.ok(await toolsPage.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth), 'organizer must fit the window width');
    await toolsPage.screenshot({ path: resolve(output, `organizer-above-player-${viewport.width}.png`) });
    assert.deepEqual(organizer.errors, []);
    await toolsPage.close();
  }
  console.log('PASS organizer layout: long preview, large text, short desktop window and narrow window keep action buttons above playback controls');
}
