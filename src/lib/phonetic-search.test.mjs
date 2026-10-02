import test from 'node:test';
import assert from 'node:assert/strict';
import kuromoji from 'kuromoji';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { addJapaneseSearchKeys, matchesSearch, setJapaneseSearchAvailable, warmSearchKeys } from './phonetic-search.ts';
import { japaneseSearchKeys } from './japanese-search.ts';
import { queryTracks } from './track-query.ts';

test('Chinese full pinyin, initials, spacing, mixed scripts and traditional names', () => {
  for (const query of ['黑白配', 'heibaipei', 'hei bai pei', 'HEIBAI', 'hbp', 'bp']) assert.ok(matchesSearch('黑白配', query), query);
  assert.ok(matchesSearch(['黑白配', '范玮琪'], 'hbp fanweiqi'));
  assert.ok(matchesSearch('重慶森林', 'chongqing'));
  assert.ok(matchesSearch('重慶森林', 'cqsl'));
  assert.ok(matchesSearch('音乐', 'yinyue'));
  assert.ok(matchesSearch('单依纯', 'shanyichun'));
  assert.ok(matchesSearch('单依纯', 'syc'));
  assert.ok(matchesSearch('绿色', 'lvse'));
  assert.ok(matchesSearch('绿色', 'lüse'));
  assert.ok(matchesSearch('黑白配 RADWIMPS', 'hbp radwimps'));
  assert.ok(matchesSearch('ＡＢＣ－１２３', 'abc123'));
  assert.ok(matchesSearch('Café', 'cafe'));
  assert.ok(matchesSearch('黑白配', '   '));
  assert.equal(matchesSearch('黑白配', 'hbp other'), false);
  assert.equal(matchesSearch(['黑', '白', '配'], 'hbp'), false);
});

test('Japanese kana supports common keyboard spellings, small kana, gemination and long vowels', () => {
  setJapaneseSearchAvailable(true);
  for (const query of ['shugaasongu', 'shugasongu', 'syuga songu', 'sgsng']) assert.ok(matchesSearch('シュガーソング', query), query);
  for (const query of ['shinjitsu', 'sinzitu']) assert.ok(matchesSearch('しんじつ', query), query);
  assert.ok(matchesSearch('キット', 'kitto'));
  assert.ok(matchesSearch('トウキョウ', 'tokyo'));
  assert.ok(matchesSearch('トウキョウ', 'tookyoo'));
  assert.equal(matchesSearch('キット', 'kito'), false);
});

test('local dictionary supplies kanji readings, particles and initials', async () => {
  setJapaneseSearchAvailable(true);
  const analyzer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: join(dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict') }).build((error, tokenizer) => error ? reject(error) : resolve(tokenizer)));
  for (const [title, queries] of [
    ['君の名は。', ['kiminonawa', 'kimi no na wa', 'kiminonaha', 'kmnnw']],
    ['東京', ['toukyou', 'tokyo', 'tookyoo', 'tōkyō']],
    ['前前前世', ['zenzenzense']],
    ['椎名林檎', ['shiinaringo']],
  ]) {
    addJapaneseSearchKeys(title, japaneseSearchKeys(analyzer.tokenize(title)));
    for (const query of queries) assert.ok(matchesSearch(title, query), `${title}: ${query}`);
  }
  assert.equal(matchesSearch('君の名は。', 'kiminonawa another'), false);
});

test('missing dictionary disables Japanese readings and preserves literal and pinyin search', () => {
  setJapaneseSearchAvailable(false);
  addJapaneseSearchKeys('君の名は。', ['kiminonawa']);
  assert.equal(matchesSearch('君の名は。', 'kiminonawa'), false);
  assert.equal(matchesSearch('シュガーソング', 'shugasongu'), false);
  assert.ok(matchesSearch('君の名は。', '君の名'));
  assert.ok(matchesSearch('シュガーソング', 'シュガー'));
  assert.ok(matchesSearch('黑白配', 'hbp'));
  setJapaneseSearchAvailable(true);
  assert.ok(matchesSearch('シュガーソング', 'shugasongu'), 'cached kana keys recover when the dictionary is enabled');
});

test('phonetic terms still intersect filters and metadata edits use fresh keys', () => {
  const song = { id: 1, title: '黑白配', english: 'Black and White', artist: '范玮琪', album: '我们的纪念日', duration: 180, year: '2006', source: 'song.flac', customTags: ['夜晚'] };
  warmSearchKeys([song.title, song.artist, song.album]);
  assert.equal(queryTracks([song], { keyword: 'hbp', artist: 'fwq', album: 'wmdjnr', tags: ['夜晚'], favorite: 'liked' }, [1], 'original', false, matchesSearch).length, 1);
  assert.equal(queryTracks([song], { keyword: 'hbp', favorite: 'liked' }, [], 'original', false, matchesSearch).length, 0);
  assert.equal(queryTracks([{ ...song, title: '红豆' }], { keyword: 'hbp' }, [], 'original', false, matchesSearch).length, 0);
  assert.equal(queryTracks([{ ...song, title: '红豆' }], { keyword: 'hongdou' }, [], 'original', false, matchesSearch).length, 1);
  assert.equal(queryTracks([song], { keyword: 'hbp' }, []).length, 0, 'stored playlist conditions retain literal matching');
  assert.equal(queryTracks([song], { keyword: '黑白配' }, []).length, 1);
});
