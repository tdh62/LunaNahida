import { toHiragana, toRomaji } from 'wanakana';

export type JapaneseToken = { surface_form: string; reading?: string; pronunciation?: string; pos?: string };

export const compactSearchText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/ü/g, 'v').normalize('NFD').replace(/\p{M}/gu, '').replace(/[\p{P}\p{Z}\s]/gu, '');

export function kanaSearchKeys(reading: string): string[] {
  const kana = toHiragana(reading);
  const syllables = toHiragana(reading.replace(/ー/g, '')).match(/[ぁ-ん][ゃゅょぁぃぅぇぉゎ]?|[a-z0-9]+/gi) ?? [];
  return [compactSearchText(toRomaji(kana)), syllables.filter(unit => unit !== 'っ').map(unit => toRomaji(unit)[0]).join('')];
}

// Compare both common keyboard spellings and Hepburn, including long vowels.
export const normalizeRomaji = (text: string) => compactSearchText(text)
  .replace(/(?:sha|sya)/g, 'sya').replace(/(?:shu|syu)/g, 'syu').replace(/(?:sho|syo)/g, 'syo')
  .replace(/(?:cha|tya|cya)/g, 'tya').replace(/(?:chu|tyu|cyu)/g, 'tyu').replace(/(?:cho|tyo|cyo)/g, 'tyo')
  .replace(/(?:ja|jya|zya)/g, 'zya').replace(/(?:ju|jyu|zyu)/g, 'zyu').replace(/(?:jo|jyo|zyo)/g, 'zyo')
  .replace(/shi/g, 'si').replace(/chi/g, 'ti').replace(/tsu/g, 'tu').replace(/ji/g, 'zi').replace(/fu/g, 'hu')
  .replace(/ou|oo/g, 'o').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/uu/g, 'u').replace(/ee/g, 'e');

export function japaneseSearchKeys(tokens: JapaneseToken[]): string[] {
  const reading = tokens.map(token => token.reading || token.surface_form).join('');
  const pronunciation = tokens.map(token => {
    if (token.pos === '助詞') return ({ は: 'ワ', へ: 'エ', を: 'オ' } as Record<string, string>)[token.surface_form] ?? token.pronunciation ?? token.reading ?? token.surface_form;
    return token.pronunciation || token.reading || token.surface_form;
  }).join('');
  return [...new Set([...kanaSearchKeys(reading), ...kanaSearchKeys(pronunciation)].filter(Boolean))];
}
