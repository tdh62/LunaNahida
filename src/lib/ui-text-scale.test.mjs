import assert from 'node:assert/strict';
import test from 'node:test';
import postcss from 'postcss';
import textScale from '../../scripts/text-scale-postcss.mjs';
import { normalizeUITextSize } from './ui-text-scale.ts';

test('old or invalid preferences use the original text size', () => {
  for (const value of [undefined, null, 0, 89, 126, NaN, '125']) assert.equal(normalizeUITextSize(value), 100);
  for (const value of [90, 100, 110, 120, 125]) assert.equal(normalizeUITextSize(value), value);
});

test('compiled typography scales once, including utilities and monospace shorthand, without resizing layout or lyrics', async () => {
  const source = '.row { width: 100px; padding: 1rem; font-size: 12px; line-height: 18px; } .text-sm { font-size: .875rem; } .clock { font: 600 10px/14px "DM Mono"; } .relative { font-size: .8em; line-height: 1.5; } .hidden { font-size: 0px; } .lyric-line small { font-size: 9px; } .current { font-size: var(--lyric-size, 16px); }';
  const first = await postcss([textScale()]).process(source, { from: undefined });
  const twice = await postcss([textScale()]).process(first.css, { from: undefined });
  assert.equal(twice.css, first.css);
  assert.match(first.css, /width: 100px; padding: 1rem; font-size: calc\(12px \* var\(--ui-text-scale, 1\)\); line-height: calc\(18px \* var\(--ui-text-scale, 1\)\)/);
  assert.match(first.css, /font-size: calc\(\.875rem \* var\(--ui-text-scale, 1\)\)/);
  assert.match(first.css, /font: 600 calc\(10px \* var\(--ui-text-scale, 1\)\)\/calc\(14px \* var\(--ui-text-scale, 1\)\) "DM Mono"/);
  assert.ok(first.css.includes('.relative { font-size: .8em; line-height: 1.5; }'));
  assert.ok(first.css.includes('.hidden { font-size: 0px; }'));
  assert.ok(first.css.includes('.lyric-line small { font-size: 9px; }'));
  assert.ok(first.css.includes('.current { font-size: var(--lyric-size, 16px); }'));
});

test('fluid headings scale while immersive lyric text retains its own responsive size', async () => {
  const source = '.immersive-lyrics h1 { font-size: clamp(24px, 3vw, 42px); } .immersive-lyrics p { font-size: clamp(14px, 1.45vw, 19px); }';
  const result = await postcss([textScale()]).process(source, { from: undefined });
  assert.ok(result.css.includes('h1 { font-size: calc(clamp(24px, 3vw, 42px) * var(--ui-text-scale, 1)); }'));
  assert.ok(result.css.includes('p { font-size: clamp(14px, 1.45vw, 19px); }'));
});
