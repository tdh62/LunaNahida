import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export default async function verifyResponsiveNavigation(setup, output) {
  const tracks = Array.from({ length: 1200 }, (_, index) => ({
    id: index + 1, title: `响应测试 ${String(index + 1).padStart(4, '0')}`, artist: '本地文件', album: '测试专辑',
    duration: 30, cover: '/covers/local.svg', genre: '', year: '', source: `/api/media/audio/${index + 1}`,
    path: `C:/music/${index + 1}.wav`, available: true, playbackStatus: 'playable', deletable: true,
    lyrics: '[00:00]第一行\n[00:02]第二行\n[00:05]第三行',
  }));
  const playlists = Array.from({ length: 9 }, (_, index) => ({
    id: `responsive-${index}`, name: `测试歌单 ${index}`, description: '', cover: '/covers/local.svg',
    coverMode: 'first-track', trackIds: tracks.map(track => track.id),
  }));
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const run = await setup({ backend: true, tracks, playlists, queue: tracks.map(track => track.id), viewport });
    const { page } = run;
    const navigate = label => page.getByRole('button', { name: label, exact: true }).evaluate(button => button.click());
    const active = route => page.locator(`[data-page-route="${route}"]:not([style*="display: none"])`);
    await page.waitForFunction(() => document.querySelectorAll('[data-page-route]').length >= 3);
    assert.ok(await page.locator('.queue-list .queue-track').count() < 80, 'large queues render a bounded window');
    await page.locator('.queue-list .queue-track').first().dblclick();
    await page.waitForFunction(() => Number(document.querySelector('.playback-bar input[aria-label="播放进度"]').value) > 0.5);
    await page.evaluate(() => {
      window.navigationMutations = 0;
      const observer = new MutationObserver(records => { window.navigationMutations += records.length; });
      observer.observe(document.querySelector('.sidebar'), { subtree: true, childList: true, attributes: true });
      window.navigationObserver = observer;
      window.playingDOM = document.querySelector('[data-page-route="/"] .listening-stage');
      window.spectrumDraws = 0;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.classList.contains('spectrum-canvas')) window.spectrumDraws++;
        return clear.apply(this, args);
      };
    });
    const start = await page.getByRole('slider', { name: '播放进度', exact: true }).inputValue();
    await page.waitForFunction(position => Number(document.querySelector('.playback-bar input[aria-label="播放进度"]').value) > Number(position) + 0.8, start);
    assert.equal(await page.evaluate(() => window.navigationMutations), 0, 'audio ticks never render navigation');

    await navigate('我的歌单');
    await active('/playlists').waitFor({ state: 'attached' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const draws = await page.evaluate(() => window.spectrumDraws);
    const beforeHidden = await page.getByRole('slider', { name: '播放进度', exact: true }).inputValue();
    await page.waitForFunction(position => Number(document.querySelector('.playback-bar input[aria-label="播放进度"]').value) > Number(position) + 0.8, beforeHidden);
    assert.equal(await page.evaluate(() => window.spectrumDraws), draws, 'hidden playback pages stop drawing while audio continues');
    await navigate('正在播放');
    assert.equal(await page.evaluate(() => window.playingDOM === document.querySelector('[data-page-route="/"] .listening-stage')), true, 'playing DOM survives navigation');

    await navigate('我的音乐');
    const library = active('/music');
    const search = page.getByRole('textbox', { name: '搜索歌曲、歌手、专辑或标签', exact: true });
    await search.fill('响应测试');
    await page.getByRole('combobox', { name: '歌曲排序', exact: true }).selectOption('title');
    await library.locator('.library-rows').evaluate(element => { element.scrollTop = 16000; });
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-page-route="/music"] .library-row .library-track-name strong');
      return Number(row?.textContent?.match(/\d+/)?.[0]) > 100;
    });
    await library.locator('.library-row').nth(8).click();
    const scroll = await library.locator('.library-rows').evaluate(element => element.scrollTop);
    assert.ok(scroll > 1000);
    const selection = await library.locator('.library-row[aria-selected="true"]').count();
    await page.evaluate(() => { window.libraryDOM = document.querySelector('[data-page-route="/music"] .library-rows'); });
    await navigate('我的歌单');
    await page.keyboard.press('Control+A');
    await navigate('我的音乐');
    assert.equal(await search.inputValue(), '响应测试');
    assert.equal(await page.getByRole('combobox', { name: '歌曲排序', exact: true }).inputValue(), 'title');
    assert.equal(await library.locator('.library-rows').evaluate(element => element.scrollTop), scroll);
    assert.equal(await library.locator('.library-row[aria-selected="true"]').count(), selection);
    assert.equal(await page.evaluate(() => window.libraryDOM === document.querySelector('[data-page-route="/music"] .library-rows')), true);

    // Retained views receive shared changes without requesting the full library.
    const stateRequests = run.requests.filter(request => request.path === '/api/state').length;
    await navigate('我的歌单');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('lunanahidatune-music-refreshed', { detail: { id: 1, key: '', value: { lyric: '[00:00]已更新的歌词' } } })));
    await navigate('正在播放');
    await page.getByRole('button', { name: '已更新的歌词', exact: true }).waitFor();
    assert.equal(run.requests.filter(request => request.path === '/api/state').length, stateRequests);

    // Virtual queues still reach their end and locate a current row outside the window.
    await page.locator('.queue-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.locator('.queue-list .queue-track-label > span').filter({ hasText: '响应测试 1200' }).waitFor();
    await page.locator('.queue-panel').getByRole('button', { name: '定位当前播放', exact: true }).click();
    await page.locator('.queue-list .queue-track.current').waitFor();
    if (viewport.width > 760) {
      await page.getByRole('button', { name: '播放队列', exact: true }).click();
      const quick = page.getByRole('region', { name: '播放队列', exact: true });
      await quick.locator('.queue-track.current').waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await quick.locator('.queue-track').count() < 80);
      await quick.locator('.quick-queue-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await quick.locator('.queue-track-label > span').filter({ hasText: '响应测试 1200' }).waitFor();
      await quick.getByRole('button', { name: '定位当前播放', exact: true }).click();
      await quick.locator('.queue-track.current').waitFor();
      await quick.getByRole('button', { name: '关闭播放队列', exact: true }).click();
    }

    for (let index = 0; index < playlists.length; index++) {
      await navigate('我的歌单');
      await active('/playlists').getByRole('button', { name: new RegExp(`^测试歌单 ${index}`) }).click();
      await active(`/playlists/responsive-${index}`).waitFor({ state: 'attached' });
    }
    assert.ok(await page.locator('[data-page-route^="/playlists/"]').count() <= 6, 'detail DOM retention stays bounded');
    await page.screenshot({ path: resolve(output, `responsive-navigation-${viewport.width}.png`) });
    assert.deepEqual(run.errors, []);
    await page.close();
  }
  console.log('PASS responsive navigation: retained DOM/search/sort/selection/scroll, independent progress, hidden spectrum suspension, incremental metadata, 1200-track queues and bounded details on desktop/mobile');
}
