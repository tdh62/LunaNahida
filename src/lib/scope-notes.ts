export type ScopeNotePreferences = { enabled: boolean; count: number };
export type ScopeNote = { midi: number; frequency: number; name: string };
export const scopeNoteStorageKey = 'luma-scope-note-markers';
export const defaultScopeNotePreferences: ScopeNotePreferences = { enabled: true, count: 24 };
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function noteFrequency(midi: number) { return 440 * 2 ** ((midi - 69) / 12); }
function noteName(midi: number) { return `${noteNames[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`; }

export function noteAt(frequency: number) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const cents = Math.round(1200 * Math.log2(frequency / noteFrequency(midi)));
  return `${noteName(midi)} ${cents >= 0 ? '+' : ''}${cents} 音分`;
}

export function readScopeNotePreferences(storage: Pick<Storage, 'getItem'>): ScopeNotePreferences {
  try {
    const saved = JSON.parse(storage.getItem(scopeNoteStorageKey) || 'null');
    return {
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : defaultScopeNotePreferences.enabled,
      count: Number.isFinite(saved?.count) ? Math.max(4, Math.min(128, Math.round(saved.count))) : defaultScopeNotePreferences.count,
    };
  } catch { return { ...defaultScopeNotePreferences }; }
}

export function getScopeNotes(minFrequency: number, maxFrequency: number, count: number): ScopeNote[] {
  if (!Number.isFinite(minFrequency) || !Number.isFinite(maxFrequency) || minFrequency <= 0 || maxFrequency <= minFrequency || !Number.isFinite(count) || count < 1) return [];
  const first = Math.ceil(69 + 12 * Math.log2(minFrequency / 440) - 1e-10);
  const last = Math.floor(69 + 12 * Math.log2(maxFrequency / 440) + 1e-10);
  const total = last - first + 1;
  if (total <= 0) return [];
  const limit = Math.min(total, Math.floor(count));
  const selected = new Set<number>();
  for (let index = 0; index < limit; index++) selected.add(first + (limit === 1 ? Math.floor((total - 1) / 2) : Math.round(index * (total - 1) / (limit - 1))));
  if (first <= 69 && last >= 69 && !selected.has(69)) {
    const nearest = [...selected].sort((left, right) => Math.abs(left - 69) - Math.abs(right - 69))[0];
    selected.delete(nearest);
    selected.add(69);
  }
  return [...selected].sort((left, right) => left - right).map(midi => ({ midi, frequency: noteFrequency(midi), name: noteName(midi) }));
}

export function layoutScopeNoteLabels(notes: ScopeNote[], minFrequency: number, maxFrequency: number, width: number, measure: (text: string) => number) {
  const rows: { left: number; right: number }[][] = [[], []];
  const priority = (note: ScopeNote) => note.midi === 69 ? 0 : note.midi % 12 === 0 ? 1 : note.name.includes('♯') ? 3 : 2;
  return [...notes].sort((left, right) => priority(left) - priority(right) || left.midi - right.midi).flatMap(note => {
    const text = note.midi === 69 ? 'A4 440 Hz' : note.name;
    const textWidth = measure(text);
    if (textWidth > width) return [];
    const x = Math.log(note.frequency / minFrequency) / Math.log(maxFrequency / minFrequency) * width;
    const left = Math.max(0, Math.min(width - textWidth, x - textWidth / 2));
    const right = left + textWidth;
    const row = rows.findIndex(occupied => occupied.every(label => right + 6 <= label.left || left >= label.right + 6));
    if (row < 0) return [];
    rows[row].push({ left, right });
    return [{ text, x: left + textWidth / 2, row }];
  });
}
