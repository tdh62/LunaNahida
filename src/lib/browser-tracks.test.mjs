import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserTrackPool, isBrowserTrack } from './browser-tracks.ts';

test('browser files are session tracks without paths, and deduplicate within the live queue', async () => {
  let created = 0;
  const released = [];
  const pool = new BrowserTrackPool({ createObjectURL: () => `blob:test-${created++}`, revokeObjectURL: url => released.push(url) });
  const file = new File(['audio'], 'sample.mp3', { lastModified: 1 });
  const { tracks } = await pool.add([file, file]);
  assert.equal(tracks[0].id, tracks[1].id);
  assert.equal(created, 1);
  assert.equal(tracks[0].temporary, true);
  assert.ok(tracks[0].id < 0);
  assert.equal(tracks[0].path, undefined);
  assert.ok(isBrowserTrack(tracks[0]));
  pool.retain(new Set([tracks[0].source]));
  assert.deepEqual(released, []);
  pool.dispose();
  assert.deepEqual(released, ['blob:test-0']);
  const again = await pool.add([file]);
  assert.notEqual(again.tracks[0].id, tracks[0].id);
  pool.dispose();
});

test('encrypted, empty, and non-audio files never acquire an object URL', async () => {
  const pool = new BrowserTrackPool({ createObjectURL: () => { throw new Error('unexpected allocation'); }, revokeObjectURL() {} });
  const result = await pool.add([new File(['x'], 'song.ncm', { type: 'audio/mpeg' }), new File(['x'], 'notes.txt'), new File([], 'empty.mp3')]);
  assert.equal(result.tracks.length, 0);
  assert.equal(result.rejected.length, 3);
});

test('releasing removed files preserves remaining and currently loaded files', async () => {
  let created = 0;
  const released = [];
  const pool = new BrowserTrackPool({ createObjectURL: () => `blob:${created++}`, revokeObjectURL: url => released.push(url) });
  const result = await pool.add([new File(['a'], 'a.mp3'), new File(['b'], 'b.mp3')]);
  pool.retain(new Set([result.tracks[1].source]));
  assert.deepEqual(released, ['blob:0']);
  pool.dispose();
  assert.deepEqual(released, ['blob:0', 'blob:1']);
});
