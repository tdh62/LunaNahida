import kuromoji from 'kuromoji/build/kuromoji.js';
import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import { japaneseSearchKeys } from './japanese-search';

let tokenizer: Promise<Tokenizer<IpadicFeatures>>;
const initialize = () => tokenizer ??= new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: `${import.meta.env.BASE_URL}search-dict/` }).build((error, value) => error ? reject(error) : resolve(value));
});

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
