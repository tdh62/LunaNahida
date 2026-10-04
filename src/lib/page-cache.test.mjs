import assert from 'node:assert/strict';
import test from 'node:test';
import { DETAIL_PAGE_LIMIT, primaryPages, retainPage } from './page-cache.ts';

test('revisiting a detail protects it while older detail pages are evicted', () => {
  let pages = [...primaryPages];
  for (let i = 0; i < DETAIL_PAGE_LIMIT; i++) pages = retainPage(pages, `/playlists/${i}`);
  pages = retainPage(pages, '/playlists/0');
  pages = retainPage(pages, '/playlists/new');
  assert.ok(pages.includes('/playlists/0'));
  assert.ok(!pages.includes('/playlists/1'));
  assert.deepEqual(pages.filter(page => primaryPages.includes(page)).sort(), [...primaryPages].sort());
  assert.equal(pages.length, primaryPages.length + DETAIL_PAGE_LIMIT);
});

test('primary navigation never duplicates pages or consumes the detail budget', () => {
  let pages = ['/'];
  for (let i = 0; i < 100; i++) pages = retainPage(pages, primaryPages[i % primaryPages.length]);
  assert.equal(pages.length, primaryPages.length);
  assert.equal(new Set(pages).size, pages.length);
});
