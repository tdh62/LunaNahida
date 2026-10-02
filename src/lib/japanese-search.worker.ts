import kuromoji from 'kuromoji/build/kuromoji.js';
import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import { japaneseSearchKeys } from './japanese-search';

let tokenizer: Promise<Tokenizer<IpadicFeatures>>;
const initialize = () => tokenizer ??= (async () => {
  const path = `${import.meta.env.BASE_URL}search-dict/`;
  const response = await fetch(`${path}manifest.json`, { cache: 'no-store' });
  if (!response.ok || !(await response.json()).available) throw new Error('Japanese dictionary unavailable');
  const value = await new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) => {
    kuromoji.builder({ dicPath: path }).build((error, value) => error ? reject(error) : resolve(value));
  });
  self.postMessage({ ready: true });
  return value;
})();

self.onmessage = async (event: MessageEvent<string[]>) => {
  try {
    const analyzer = await initialize();
    for (let start = 0; start < event.data.length; start += 100) {
      const entries = event.data.slice(start, start + 100).map(text => [text, japaneseSearchKeys(analyzer.tokenize(text))]);
      self.postMessage({ entries });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } catch {
    self.postMessage({ failed: true });
  }
};
