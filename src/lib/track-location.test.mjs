import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getVirtualTrackLocation, getVirtualTrackRange, locateCurrentTrack } from './track-location.ts';

test('virtual location renders a distant current track and its entire viewport', () => {
  const location = getVirtualTrackLocation(1299, 1500, 72, 500);
  const range = getVirtualTrackRange(1500, 72, 500, location.scrollTop, 8);
  assert.ok(location.scrollTop > 90000);
  assert.ok(range.end > 1300);
  assert.ok(range.end >= Math.ceil((location.scrollTop + 500) / 72) + 8);
  assert.ok(1299 * 72 >= location.scrollTop);
  assert.ok(1300 * 72 <= location.scrollTop + 500);
});

test('virtual location clamps first and last rows at desktop and mobile heights', () => {
  for (const rowHeight of [66, 72]) {
    const first = getVirtualTrackLocation(0, 1500, rowHeight, 500);
    const last = getVirtualTrackLocation(1499, 1500, rowHeight, 500);
    assert.equal(first.scrollTop, 0);
    assert.equal(last.scrollTop, 1500 * rowHeight - 500);
    assert.equal(getVirtualTrackRange(1500, rowHeight, 500, last.scrollTop, 8).end, 1500);
  }
});

test('virtual location rejects missing tracks and handles short lists', () => {
  assert.equal(getVirtualTrackLocation(-1, 1500, 72, 500), null);
  assert.equal(getVirtualTrackLocation(1500, 1500, 72, 500), null);
  assert.equal(getVirtualTrackLocation(0, 0, 72, 500), null);
  assert.deepEqual(getVirtualTrackLocation(1, 2, 72, 500), { scrollTop: 0 });
});

test('virtual ranges reserve the full list height at every scroll position', () => {
  for (const rowHeight of [66, 72]) {
    for (const scrollTop of [0, 1, 13700, 50000, 99000, 200000]) {
      const range = getVirtualTrackRange(1500, rowHeight, 509, scrollTop, 8);
      assert.equal(range.totalHeight, 1500 * rowHeight);
      assert.equal(range.topHeight + (range.end - range.start) * rowHeight + range.bottomHeight, range.totalHeight);
      assert.ok(range.start < range.end);
      assert.ok(range.end - range.start <= Math.ceil(509 / rowHeight) + 17);
      assert.ok(range.bottomHeight >= 0);
    }
  }
});

test('direct jumps render the last row without loading intermediate batches', () => {
  const range = getVirtualTrackRange(100000, 72, 500, 100000 * 72, 8);
  assert.equal(range.end, 100000);
  assert.ok(range.start > 99900);
  assert.equal(range.bottomHeight, 0);
});

test('ranges clamp stale scroll positions after filtering or list removal', () => {
  assert.deepEqual(getVirtualTrackRange(0, 72, 500, 90000, 8), { start: 0, end: 0, totalHeight: 0, topHeight: 0, bottomHeight: 0 });
  assert.deepEqual(getVirtualTrackRange(2, 72, 500, 90000, 8), { start: 0, end: 2, totalHeight: 144, topHeight: 0, bottomHeight: 0 });
  const range = getVirtualTrackRange(201, 72, 500, 90000, 8);
  assert.equal(range.end, 201);
  assert.ok(range.start < 201);
});

test('locating centers only the list and focuses without selecting or playing', () => {
  const focusCalls = [];
  const scrollCalls = [];
  const row = { getBoundingClientRect: () => ({ top: 300, height: 72 }), scrollIntoView: options => scrollCalls.push(options), focus: options => focusCalls.push(options) };
  const list = { scrollTop: 200, clientTop: 1, clientHeight: 400, getBoundingClientRect: () => ({ top: 100 }), querySelector: () => row };
  assert.equal(locateCurrentTrack(list), true);
  assert.equal(list.scrollTop, 235);
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(scrollCalls, [{ block: 'nearest', inline: 'nearest', behavior: 'instant' }]);
});

test('locating an absent current track does not scroll or focus', () => {
  const list = { scrollTop: 200, querySelector: () => null };
  assert.equal(locateCurrentTrack(null), false);
  assert.equal(locateCurrentTrack(list), false);
  assert.equal(list.scrollTop, 200);
});

test('locating the first track never requests a negative scroll offset', () => {
  const row = { getBoundingClientRect: () => ({ top: 100, height: 36 }), scrollIntoView: () => {}, focus: () => {} };
  const list = { scrollTop: 0, clientTop: 0, clientHeight: 400, getBoundingClientRect: () => ({ top: 100 }), querySelector: () => row };
  assert.equal(locateCurrentTrack(list), true);
  assert.equal(list.scrollTop, 0);
});
