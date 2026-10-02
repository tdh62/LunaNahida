import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export default async function verifyTextSize(setup, output) {
  const track = { id: 1, title: '文字缩放测试 A Long Song Title', artist: 'RADWIMPS', album: '测试专辑', duration: 30, cover: '/covers/local.svg', genre: '', year: '', source: '/api/media/audio/1', path: 'C:/music/size.wav', lyrics: '[00:00.00]歌词使用独立字号' };
  const sizeOf = locator => locator.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const fits = async locator => {
    const overflow = await locator.evaluate(element => [...element.querySelectorAll('input, select, button')].filter(child => {
      const rect = child.getBoundingClientRect();
      return rect.width && (rect.left < -1 || rect.right > innerWidth + 1 || child.type !== 'range' && child.clientHeight < parseFloat(getComputedStyle(child).fontSize));
    }).map(child => child.outerHTML));
    assert.deepEqual(overflow, []);
  };
  for (const config of [
    { backend: true, desktop: true, viewport: { width: 1280, height: 960 } },
    { backend: true, textSize: 120, viewport: { width: 900, height: 850 } },
    { viewport: { width: 390, height: 844 } },
  ]) {
    const run = await setup({ ...config, tracks: [track], queue: [1], dictionary: 'missing' });
    const { page, state } = run;
    await page.getByRole('link', { name: '播放器设置', exact: true }).click();
    await page.getByRole('tab', { name: '外观', exact: true }).click();
    const select = page.getByRole('combobox', { name: '文字大小', exact: true });
    assert.equal(await select.inputValue(), String(config.textSize ?? 100));
    await select.selectOption('100');
    const heading = page.locator('.settings-heading h1');
    const baseline = await sizeOf(heading);
    const geometry = await page.locator('.settings-page').evaluate(element => ({ width: element.getBoundingClientRect().width, padding: getComputedStyle(element).padding }));
    for (const size of [90, 110, 120, 125, 100]) {
      await select.selectOption(String(size));
      assert.ok(Math.abs(await sizeOf(heading) - baseline * size / 100) < .02);
      assert.deepEqual(await page.locator('.settings-page').evaluate(element => ({ width: element.getBoundingClientRect().width, padding: getComputedStyle(element).padding })), geometry);
      await fits(page.locator('.text-size-setting'));
    }
    await select.focus();
    await select.press('End');
    assert.equal(await select.inputValue(), '125');
    await page.getByRole('button', { name: '搜索设置', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('文字大小');
    const result = page.locator('.settings-search-results > button').filter({ hasText: '文字大小' });
    assert.ok(Math.abs(await sizeOf(result) - 16.25) < .02, 'portaled search results scale');
    await result.click();
    assert.equal(await select.evaluate(element => element === document.activeElement), true);
    await page.waitForFunction(() => !document.querySelector('.settings-search-target'));
    for (const appearance of ['深色', '浅色']) {
      await page.getByRole('button', { name: appearance, exact: true }).click();
      await fits(page.locator('#settings-content'));
      await page.locator('.music-app').evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
      await page.screenshot({ path: resolve(output, `text-size-${config.viewport.width}-${appearance}.png`) });
    }
    if (config.backend) {
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-text-scale') === '1.25');
      if (state.settings.uiTextSize !== 125) await page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().postDataJSON()?.uiTextSize === 125);
      assert.equal(state.settings.uiTextSize, 125);
      await page.reload();
      await page.locator('.music-app').waitFor();
      assert.equal(await sizeOf(page.locator('.settings-heading h1')), baseline * 1.25);
      await page.getByRole('button', { name: '我的音乐', exact: true }).click();
      await page.locator('.library-row').first().waitFor();
      assert.ok(Math.abs(await sizeOf(page.locator('.library-track-name strong').first()) - 16.25) < .02);
      await fits(page.locator('.library-row').first());
      await page.screenshot({ path: resolve(output, `text-size-${config.viewport.width}-library.png`) });
      await page.locator('.library-play').first().click();
      await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      await page.getByRole('button', { name: '正在播放', exact: true }).click();
      assert.equal(await sizeOf(page.locator('.lyrics-window .lyric-line.current')), 16, 'lyrics keep their independent size');
      await page.locator('.effect-trigger').click();
      await page.getByRole('button', { name: '编辑音效', exact: true }).click();
      const dialog = page.locator('.processor-dialog');
      await dialog.waitFor();
      assert.ok(Math.abs(await sizeOf(dialog.locator('h2').first()) - 22.5) < .02, 'portaled dialog title scales');
      await fits(dialog);
      await dialog.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
      await page.screenshot({ path: resolve(output, `text-size-${config.viewport.width}-dialog.png`) });
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('tab', { name: '播放与歌词', exact: true }).click();
      await page.getByRole('tab', { name: '外观', exact: true }).click();
      assert.equal(await select.inputValue(), '125', 'Web keeps size during the session');
      await page.reload();
      await page.locator('.music-app').waitFor();
      assert.equal(await sizeOf(page.locator('.settings-heading h1')), baseline, 'standalone Web resets on reload');
    }
    if (config.desktop) {
      await page.getByRole('button', { name: '迷你模式', exact: true }).click();
      const mini = page.locator('.desktop-mini-player');
      await mini.waitFor();
      assert.equal(await sizeOf(mini.locator('strong')), 20);
      assert.deepEqual(await mini.evaluate(element => {
        const row = element.querySelector('.mini-now-playing');
        const bounds = row.getBoundingClientRect();
        return [...row.querySelectorAll('strong, small')].filter(child => child.getBoundingClientRect().bottom > bounds.bottom + 1).map(child => child.outerHTML);
      }), [], 'mini title and artist remain inside their row');
      await fits(mini);
      await page.screenshot({ path: resolve(output, 'text-size-mini-125.png') });
    }
    assert.deepEqual(run.errors, []);
    await page.close();
  }
  console.log('PASS text sizes: default, keyboard, all presets, search, persistence, Web session, lists, dialogs, mini player and responsive themes');
}
