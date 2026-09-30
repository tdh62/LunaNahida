import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrollToCurrentLyric } from './lyric-scroll.ts';

test('lyrics center relative to their scrolling window, not an offset parent', () => {
  const calls = [];
  const container = { scrollTop: 400, clientTop: 1, clientHeight: 300, getBoundingClientRect: () => ({ top: 100 }), scrollTo: options => calls.push(options) };
  const line = { getBoundingClientRect: () => ({ top: 900, height: 50 }) };
  assert.equal(scrollToCurrentLyric(container, line, 'instant'), true);
  assert.deepEqual(calls, [{ top: 1074, behavior: 'instant' }]);
});

test('normal lyric following preserves the smooth scrolling preference', () => {
  const calls = [];
  const container = { scrollTop: 300, clientTop: 0, clientHeight: 300, getBoundingClientRect: () => ({ top: 100 }), scrollTo: options => calls.push(options) };
  const line = { getBoundingClientRect: () => ({ top: 500, height: 40 }) };
  scrollToCurrentLyric(container, line, 'smooth');
  assert.deepEqual(calls, [{ top: 570, behavior: 'smooth' }]);
});

test('lyrics near the beginning never request negative scroll positions', () => {
  const calls = [];
  const container = { scrollTop: 0, clientTop: 0, clientHeight: 300, getBoundingClientRect: () => ({ top: 100 }), scrollTo: options => calls.push(options) };
  scrollToCurrentLyric(container, { getBoundingClientRect: () => ({ top: 110, height: 40 }) }, 'instant');
  assert.equal(calls[0].top, 0);
});

test('missing lyric lines leave the scrolling window unchanged', () => {
  assert.equal(scrollToCurrentLyric({ scrollTo: () => assert.fail('should not scroll') }, undefined, 'instant'), false);
});
