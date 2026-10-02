import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { addJapaneseSearchKeys, matchesSearch, setJapaneseSearchAvailable, warmSearchKeys } from '@/lib/phonetic-search';
import { trackTags, type Track } from '@/lib/music';

const indexed = new Set<string>();
const listeners = new Set<() => void>();
let matcher: typeof matchesSearch = matchesSearch;
let notification: ReturnType<typeof setTimeout> | undefined;
let worker: Worker | undefined;
let failed = false;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => matcher;

function ensureIndex(texts: readonly string[]) {
  const pending = [...new Set(texts)].filter(text => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) && !indexed.has(text));
  if (!pending.length || failed || typeof Worker === 'undefined') return;
  if (!worker) {
    try { worker = new Worker(new URL('../lib/japanese-search.worker.ts', import.meta.url), { type: 'module' }); }
    catch { failed = true; return; }
    const stop = () => { failed = true; setJapaneseSearchAvailable(false); worker?.terminate(); worker = undefined; };
    worker.onerror = stop;
    worker.onmessage = (event: MessageEvent<{ entries?: [string, string[]][]; failed?: boolean; ready?: boolean }>) => {
      if (event.data.failed) { stop(); return; }
      if (event.data.ready) setJapaneseSearchAvailable(true);
      for (const [text, keys] of event.data.entries ?? []) addJapaneseSearchKeys(text, keys);
      if (!notification) notification = setTimeout(() => {
        notification = undefined;
        matcher = (values, query) => matchesSearch(values, query);
        listeners.forEach(listener => listener());
      }, 80);
    };
  }
  pending.forEach(text => indexed.add(text));
  worker.postMessage(pending);
}

function usePrepareSearchIndex(texts: readonly string[]) {
  useEffect(() => {
    // Build small batches between frames; metadata changes get new keys automatically.
    let offset = 0;
    let cancelled = false;
    const build = () => {
      if (cancelled) return;
      warmSearchKeys(texts.slice(offset, offset + 100));
      offset += 100;
      if (offset < texts.length) timer = window.setTimeout(build, 0);
    };
    let timer = window.setTimeout(build, 0);
    ensureIndex(texts);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [texts]);
}

export function usePhoneticSearch(texts: readonly string[]) {
  usePrepareSearchIndex(texts);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function useTrackSearchTexts(tracks: readonly Track[]) {
  return useMemo(() => tracks.flatMap(track => [track.title, track.artist, track.album, ...trackTags(track)]), [tracks]);
}

export function usePrepareTrackSearchIndex(tracks: readonly Track[]) {
  usePrepareSearchIndex(useTrackSearchTexts(tracks));
}

export function useTrackSearchIndex(tracks: readonly Track[]) {
  return usePhoneticSearch(useTrackSearchTexts(tracks));
}
