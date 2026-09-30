import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultScopeNotePreferences, getScopeNotes, layoutScopeNoteLabels, noteAt, readScopeNotePreferences, scopeNoteStorageKey } from './scope-notes.ts';

test('full spectrum marks multiple standard notes and preserves A4 at every density', () => {
  for (const count of [4, 8, 24, 48, 128]) {
    const notes = getScopeNotes(20, 20000, count);
    assert.equal(notes.length, Math.min(count, getScopeNotes(20, 20000, 128).length));
    assert.equal(new Set(notes.map(note => note.midi)).size, notes.length);
    assert.ok(notes.every((note, index) => note.frequency >= 20 && note.frequency <= 20000 && (!index || note.frequency > notes[index - 1].frequency)));
    assert.deepEqual(notes.find(note => note.midi === 69), { midi: 69, frequency: 440, name: 'A4' });
  }
  assert.ok(getScopeNotes(20, 20000, 128).some(note => note.name === 'C♯4'));
  assert.ok(getScopeNotes(20, 20000, 128).some(note => note.name === 'D♯10'));
});

test('markers follow the chosen range and include exact note boundaries', () => {
  assert.deepEqual(getScopeNotes(440, 880, 128).map(note => note.midi), Array.from({ length: 13 }, (_, index) => 69 + index));
  assert.ok(getScopeNotes(2000, 5000, 24).every(note => note.frequency >= 2000 && note.frequency <= 5000));
  assert.equal(getScopeNotes(441, 442, 24).length, 0);
  for (const [from, to, count] of [[0, 100, 24], [100, 10, 24], [20, Infinity, 24], [20, 20000, NaN], [20, 20000, 0]]) assert.deepEqual(getScopeNotes(from, to, count), []);
});

test('pointer readout uses the same standard pitch reference', () => {
  assert.equal(noteAt(440), 'A4 +0 音分');
  assert.equal(noteAt(880), 'A5 +0 音分');
  assert.equal(noteAt(440 * 2 ** (25 / 1200)), 'A4 +25 音分');
  assert.equal(noteAt(440 * 2 ** (-25 / 1200)), 'A4 -25 音分');
});

test('labels fit both chart edges without overlapping and keep A4 visible', () => {
  const notes = getScopeNotes(20, 20000, 128);
  const measure = text => text.length * 7;
  for (const width of [200, 296, 600, 1100]) {
    const labels = layoutScopeNoteLabels(notes, 20, 20000, width, measure);
    assert.ok(labels.some(label => label.text === 'A4 440 Hz'));
    assert.ok(labels.every(label => label.x - measure(label.text) / 2 >= 0 && label.x + measure(label.text) / 2 <= width));
    for (const row of [0, 1]) {
      const ordered = labels.filter(label => label.row === row).sort((left, right) => left.x - right.x);
      for (let index = 1; index < ordered.length; index++) assert.ok(ordered[index].x - measure(ordered[index].text) / 2 >= ordered[index - 1].x + measure(ordered[index - 1].text) / 2 + 6 - 1e-8);
    }
  }
  assert.deepEqual(layoutScopeNoteLabels(notes, 20, 20000, 1, measure), []);
});

test('preferences restore independently and tolerate corrupt or unavailable storage', () => {
  const read = saved => readScopeNotePreferences({ getItem(key) { assert.equal(key, scopeNoteStorageKey); return saved; } });
  assert.deepEqual(read(null), defaultScopeNotePreferences);
  assert.deepEqual(read('{bad'), defaultScopeNotePreferences);
  assert.deepEqual(read('null'), defaultScopeNotePreferences);
  assert.deepEqual(read('{"enabled":false,"count":48}'), { enabled: false, count: 48 });
  assert.deepEqual(read('{"enabled":"no","count":1000}'), { enabled: true, count: 128 });
  assert.deepEqual(read('{"count":1}'), { enabled: true, count: 4 });
  assert.deepEqual(read('{"count":15.7}'), { enabled: true, count: 16 });
  assert.deepEqual(read('{"count":"48"}'), defaultScopeNotePreferences);
  assert.deepEqual(readScopeNotePreferences({ getItem() { throw new Error('blocked'); } }), defaultScopeNotePreferences);
});
