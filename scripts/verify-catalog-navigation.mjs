import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export default async function verifyCatalogNavigation(setup, output) {
  const tracks = Array.from({ length: 81 }, (_, index) => ({
    id: index + 1, title: `歌曲 ${index + 1}`, artist: `${index < 80 ? '保留' : '其他'}歌手 ${String(index + 1).padStart(2, '0')}`,
    album: `${index < 80 ? '保留' : '其他'}专辑 ${String(index + 1).padStart(2, '0')}`, year: String(1990 + index % 30),
    duration: 30, cover: '/covers/local.svg', genre: '', source: `/api/media/audio/${index + 1}`, path: `C:/music/${index + 1}.wav`,
  }));
  const position = page => page.locator('.catalog-page:visible').evaluate(element => matchMedia('(max-width: 760px)').matches ? document.scrollingElement.scrollTop : element.closest('.catalog-workspace').scrollTop);
  for (const config of [
    { desktop: true, viewport: { width: 1280, height: 800 } },
    { textSize: 125, viewport: { width: 900, height: 850 } },
    { viewport: { width: 390, height: 844 } },
  ]) {
    const run = await setup({ backend: true, tracks, dictionary: 'missing', ...config });
    const { page } = run;
    await page.route(/\/api\/music\/(artist|album)\?/, async route => {
      const url = new URL(route.request().url());
      const name = url.searchParams.get('name');
      await route.fulfill({ json: url.pathname.endsWith('artist')
        ? { id: name, name, briefDesc: '', introduction: [] }
        : { id: name, name, artist: url.searchParams.get('artist'), type: '', subType: '', company: '', size: 1, aliases: [], tags: [], description: '', songs: [] } });
    });
    // Avoid Playwright scrolling the mobile document to reach its navigation menu.
    const navigateList = label => page.getByRole('button', { name: label, exact: true }).evaluate(button => button.click());
    const snapshots = new Map();
    for (const [label, sort] of [['歌手', 'name'], ['专辑', 'year']]) {
      await navigateList(label);
      const search = page.getByRole('textbox', { name: `搜索${label}`, exact: true });
      assert.equal(await search.inputValue(), '', 'each list starts with its own search');
      const query = label === '歌手' ? 'baoliugeshou' : '保留专辑';
      await search.fill(query);
      await page.getByRole('combobox', { name: `${label}排序`, exact: true }).selectOption(sort);
      await page.waitForFunction(() => [...document.querySelectorAll('.catalog-card')].filter(card => card.getClientRects().length).length === 80);
      const order = await page.locator('.catalog-card:visible strong').allTextContents();
      const card = page.locator('.catalog-card:visible').nth(22);
      await card.scrollIntoViewIfNeeded();
      const scrollTop = await position(page);
      assert.ok(scrollTop > 200);
      await card.click();
      await page.locator('.catalog-hero:visible').waitFor();
      assert.ok(await position(page) < 1, 'details open at the top');
      await page.getByRole('link', { name: `返回${label}`, exact: true }).click();
      await page.waitForFunction(expected => {
        const list = [...document.querySelectorAll('.catalog-page')].find(page => page.getClientRects().length);
        const container = matchMedia('(max-width: 760px)').matches ? document.scrollingElement : list.closest('.catalog-workspace');
        return Math.abs(container.scrollTop - expected) < 2;
      }, scrollTop);
      assert.equal(await search.inputValue(), query);
      assert.equal(await page.getByRole('combobox', { name: `${label}排序`, exact: true }).inputValue(), sort);
      assert.deepEqual(await page.locator('.catalog-card:visible strong').allTextContents(), order);
      snapshots.set(label, { scrollTop, order, sort, query });
      // Browser back/forward follows the same list restoration as the page's return link.
      await card.click();
      await page.locator('.catalog-hero:visible').waitFor();
      await page.goBack();
      await search.waitFor();
      assert.ok(Math.abs(await position(page) - scrollTop) < 2);
      await page.goForward();
      await page.locator('.catalog-hero:visible').waitFor();
      await page.goBack();
      await search.waitFor();
    }
    // A related album causes the artist view to unmount; its list state must survive.
    await navigateList('歌手');
    assert.ok(Math.abs(await position(page) - snapshots.get('歌手').scrollTop) < 2);
    await page.locator('.catalog-card:visible').nth(22).click();
    await page.locator('.catalog-related:visible .catalog-card').first().click();
    await page.getByRole('link', { name: '返回专辑', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '搜索专辑', exact: true }).inputValue(), snapshots.get('专辑').query);
    assert.equal(await page.getByRole('combobox', { name: '专辑排序', exact: true }).inputValue(), 'year');
    assert.ok(Math.abs(await position(page) - snapshots.get('专辑').scrollTop) < 2);
    await navigateList('我的音乐');
    await navigateList('歌手');
    assert.equal(await page.getByRole('textbox', { name: '搜索歌手', exact: true }).inputValue(), snapshots.get('歌手').query);
    assert.ok(Math.abs(await position(page) - snapshots.get('歌手').scrollTop) < 2);
    await page.screenshot({ path: resolve(output, `catalog-restored-${config.viewport.width}.png`) });
    assert.deepEqual(run.errors, []);
    await page.close();
  }
  console.log('PASS catalog navigation: separate search/sort state, list scroll, return links, browser back/forward, related albums, other pages and mobile document scrolling');
}
