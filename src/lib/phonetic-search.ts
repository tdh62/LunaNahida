import { pinyin } from 'pinyin-pro';
import { Converter } from 'opencc-js';
import { compactSearchText, kanaSearchKeys, normalizeRomaji } from './japanese-search.ts';

type SearchKeys = { original: string; compact: string; chinese: string[]; japanese: string[] };
type SearchTerm = { raw: string; compact: string; romaji: string };
const index = new Map<string, SearchKeys>();
const queries = new Map<string, SearchTerm[]>();
const han = /\p{Script=Han}/u;
const kana = /[\u3040-\u30ff]/u;
const toSimplified = Converter({ from: 'tw', to: 'cn' });

const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
function keysFor(text: string): SearchKeys {
  const cached = index.get(text);
  if (cached) return cached;
  const keys: SearchKeys = { original: normalize(text), compact: compactSearchText(text), chinese: [], japanese: [] };
  if (han.test(text)) {
    const chinese = toSimplified(text);
    for (const surname of ['off', 'all'] as const) {
      const options = { toneType: 'none', nonZh: 'consecutive', v: true, surname } as const;
      keys.chinese.push(compactSearchText(pinyin(chinese, options)), compactSearchText(pinyin(chinese, { ...options, pattern: 'first' })));
    }
    keys.chinese = [...new Set(keys.chinese)];
  }
  if (kana.test(text)) keys.japanese = kanaSearchKeys(text).map(normalizeRomaji);
  index.set(text, keys);
  return keys;
}

export function addJapaneseSearchKeys(text: string, readings: string[]) {
  keysFor(text).japanese = [...new Set(readings.map(normalizeRomaji))];
}

export function warmSearchKeys(texts: Iterable<string>) {
  for (const text of texts) keysFor(text);
}

export function matchesSearch(values: string | readonly string[], query?: string): boolean {
  if (!query?.trim()) return true;
  let terms = queries.get(query);
  if (!terms) {
    terms = [query.trim(), ...query.trim().split(/\s+/u)].map(term => ({ raw: normalize(term), compact: compactSearchText(term), romaji: normalizeRomaji(term) }));
    if (queries.size >= 128) queries.delete(queries.keys().next().value);
    queries.set(query, terms);
  }
  const fields = (typeof values === 'string' ? [values] : values).map(keysFor);
  const match = ({ raw, compact, romaji }: SearchTerm) => {
    return fields.some(keys => keys.original.includes(raw) || (compact && (keys.compact.includes(compact) || keys.chinese.some(key => key.includes(compact)) || keys.japanese.some(key => key.includes(romaji)))));
  };
  // A spaced pronunciation can also be a single phrase; separate words may span fields.
  return match(terms[0]) || terms.slice(1).every(match);
}
