import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export default async function verifyLoadingFeedback(setup, output) {
  const track = { id: 1, title: '界面反馈测试', artist: '界面测试歌手', album: '界面测试专辑', duration: 30,
    cover: '/covers/local.svg', genre: '', year: '', source: '/api/media/audio/1', path: 'C:/music/1.wav' };
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const run = await setup({ backend: true, desktop: true, tracks: [track], viewport });
    const { page } = run;
    const navigate = label => page.getByRole('button', { name: label, exact: true }).evaluate(button => button.click());
    const skeleton = label => page.getByRole('status', { name: label, exact: true });
    const defer = async pattern => {
      let release;
      const response = new Promise(done => { release = done; });
      await page.route(pattern, async route => { await route.fulfill(await response); });
      return release;
    };
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Observe the entering animation in its first frame, with controls already available.
    const entrance = await page.getByRole('button', { name: '我的音乐', exact: true }).evaluate(button => {
      button.click();
      return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
        const page = document.querySelector('[data-page-route="/music"]');
        const animation = page.getAnimations({ subtree: true }).find(animation => animation.id === 'page-entrance');
        done({ duration: animation?.effect.getTiming().duration, opacity: animation?.effect.getKeyframes().map(frame => frame.opacity), disabled: page.querySelector('input').disabled });
      })));
    });
    assert.equal(entrance.duration, 160);
    assert.deepEqual(entrance.opacity, ['0.84', '1']);
    assert.equal(entrance.disabled, false);
    await page.getByRole('textbox', { name: '搜索歌曲、歌手、专辑或标签', exact: true }).fill('界面');
    await navigate('我的歌单');
    await navigate('我的音乐');
    assert.equal(await page.getByRole('textbox', { name: '搜索歌曲、歌手、专辑或标签', exact: true }).inputValue(), '界面');
    assert.equal(await page.locator('.loading-placeholder:visible').count(), 0, 'cached pages show their content immediately');
    assert.equal(await page.evaluate(() => document.getAnimations().some(animation => animation.id === 'page-entrance' && animation.effect.target.closest('[style*="display: none"]'))), false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.getAnimations().some(animation => animation.id === 'page-entrance'));
    await navigate('我的歌单');
    assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.id === 'page-entrance').length), 0);

    const artistResponse = { id: 'artist', name: track.artist, briefDesc: '这是已经读取完成的歌手介绍。', introduction: [] };
    let releaseArtist = await defer('**/api/music/artist?*');
    await navigate('歌手');
    await page.locator('.catalog-card:visible').first().click();
    await skeleton('正在加载歌手介绍…').waitFor();
    assert.equal(await skeleton('正在加载歌手介绍…').locator('.loading-placeholder-shapes').evaluate(element => getComputedStyle(element).animationName), 'none');
    await skeleton('正在加载歌手介绍…').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `loading-artist-${viewport.width}.png`) });
    releaseArtist({ json: artistResponse });
    await page.getByText(artistResponse.briefDesc, { exact: true }).waitFor();
    assert.equal(await skeleton('正在加载歌手介绍…').count(), 0);
    releaseArtist = await defer('**/api/music/artist?*');
    await page.getByRole('button', { name: '刷新资料', exact: true }).click();
    await page.getByText('正在更新歌手介绍…', { exact: true }).waitFor();
    assert.equal(await page.getByText(artistResponse.briefDesc, { exact: true }).isVisible(), true);
    assert.equal(await page.locator('.loading-placeholder:visible').count(), 0, 'refresh keeps existing information');
    releaseArtist({ json: artistResponse });
    await page.getByText('正在更新歌手介绍…', { exact: true }).waitFor({ state: 'hidden' });

    const releaseAlbum = await defer('**/api/music/album?*');
    await navigate('专辑');
    await page.locator('.catalog-card:visible').first().click();
    await page.getByRole('tab', { name: '专辑信息', exact: true }).click();
    await skeleton('正在加载专辑信息…').waitFor();
    releaseAlbum({ status: 503, json: { error: 'unavailable' } });
    await page.getByText('专辑资料暂时不可用', { exact: true }).waitFor();
    assert.equal(await skeleton('正在加载专辑信息…').count(), 0, 'failures stop the skeleton');

    const releaseCache = await defer('**/api/cache');
    const releaseBackup = await defer('**/api/backups');
    const releaseFonts = await defer('**/api/fonts');
    await page.getByRole('link', { name: '播放器设置', exact: true }).evaluate(link => link.click());
    await page.getByRole('tab', { name: '数据与备份', exact: true }).click();
    await skeleton('正在统计缓存空间…').waitFor();
    await skeleton('正在读取备份…').waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await skeleton('正在读取备份…').locator('.loading-placeholder-shapes').evaluate(element => getComputedStyle(element).animationName), 'loading-breathe');
    await page.screenshot({ path: resolve(output, `loading-settings-${viewport.width}.png`) });
    await skeleton('正在读取备份…').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `loading-backups-${viewport.width}.png`) });
    releaseCache({ status: 503, json: { error: '统计失败' } });
    releaseBackup({ json: { policy: { enabled: false, intervalHours: 24, keepCount: 7 }, files: [], events: [] } });
    await page.getByRole('button', { name: '重试统计', exact: true }).waitFor();
    await page.getByText('暂无备份', { exact: true }).waitFor();
    assert.equal(await page.locator('.loading-placeholder:visible').count(), 0);
    const retryCache = await defer('**/api/cache');
    await page.getByRole('button', { name: '重试统计', exact: true }).click();
    await skeleton('正在统计缓存空间…').waitFor();
    retryCache({ json: { coverBytes: 1024, webviewBytes: 0, metadataBytes: 0, networkAudioBytes: 0, totalBytes: 1024, webviewClearPending: false } });
    await page.getByRole('button', { name: '清理缓存', exact: true }).waitFor();
    assert.equal(await skeleton('正在统计缓存空间…').count(), 0);
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: '添加字体', exact: true }).click();
    await skeleton('正在读取系统字体…').waitFor();
    releaseFonts({ json: ['Arial', 'Segoe UI'] });
    await page.getByRole('button', { name: 'Arial', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('dialog').count(), 0);

    // Initial library loading has its own placeholder; it never masquerades as an empty library.
    const releaseStartup = await defer('**/api/state');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await skeleton('正在打开…').waitFor();
    await page.screenshot({ path: resolve(output, `loading-startup-${viewport.width}.png`) });
    releaseStartup({ json: run.state });
    await page.locator('.music-app').waitFor();
    assert.equal(await skeleton('正在打开…').count(), 0);
    assert.deepEqual(run.errors, []);
    await page.close();
  }
  console.log('PASS loading feedback: immediate interactive transitions, retained input, reduced motion, pending placeholders, cached refresh, error/retry and startup on desktop/mobile');
}
