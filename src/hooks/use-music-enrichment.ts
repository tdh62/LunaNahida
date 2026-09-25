import { useEffect, useRef, useState } from 'react';
import type { Track } from '@/lib/music';

export type TimedLine = { time: number; text: string; translation?: string };
type Enrichment = { cover?: string; lyric?: string; translation?: string };
type Entry = { value: Enrichment; expires: number; coverRequested?: boolean; lyricRequested?: boolean; override?: boolean };
const storageKey = 'lumatune-music-enrichment-v4';
const maxEntries = 200;

function readCache(): Record<string, Entry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function cacheKey(track: Track) {
  return `${track.title.trim().normalize('NFKC').toLowerCase()}\u0000${track.artist.trim().normalize('NFKC').toLowerCase()}`;
}

function saveCache(key: string, value: Enrichment, coverRequested: boolean, lyricRequested: boolean, override = false) {
  try {
    const entries = Object.entries(readCache()).filter(([, entry]) => entry?.expires > Date.now() && entry.value);
    const cache = Object.fromEntries(entries.slice(-(maxEntries - 1)));
    const previous = cache[key];
    const merged = override ? value : { ...previous?.value, ...value };
    const complete = (!coverRequested || !!merged.cover) && (!lyricRequested || !!merged.lyric);
    cache[key] = { value: merged, coverRequested: coverRequested || previous?.coverRequested, lyricRequested: lyricRequested || previous?.lyricRequested, override: override || previous?.override, expires: Date.now() + (complete ? 7 * 24 * 60 : 30) * 60 * 1000 };
    localStorage.setItem(storageKey, JSON.stringify(cache));
  } catch { /* Storage may be unavailable; playback continues normally. */ }
}

export async function refreshMusicInfo(track: Track) {
  if (!track.source || track.artist === '本地文件' || !track.title.trim()) throw new Error('歌曲缺少可匹配的曲名或歌手');
  const params = new URLSearchParams({ title: track.title, artist: track.artist, cover: '1', lyric: '1', refresh: '1' });
  const response = await fetch(`/api/music/enrich?${params}`);
  if (!response.ok) throw new Error('音乐源暂时不可用，请稍后重试');
  const value = await response.json() as Enrichment;
  if (!value.cover && !value.lyric) throw new Error('未找到与曲名和歌手匹配的资料');
  const key = cacheKey(track);
  saveCache(key, value, true, true, true);
  window.dispatchEvent(new CustomEvent('lumatune-music-refreshed', { detail: { key, value } }));
  return value;
}

function parseLrc(value: string): TimedLine[] {
  const lines: TimedLine[] = [];
  for (const row of value.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = row.replace(/\[(?:\d{1,3}:\d{2}(?:[.:]\d{1,3})?|[^\]]+)\]/g, '').trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3]) / 10 ** stamp[3].length : 0;
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, text });
    }
  }
  if (!lines.length && value.trim()) return value.split(/\r?\n/).map(text => ({ time: 0, text: text.trim() })).filter(line => line.text);
  return lines.sort((a, b) => a.time - b.time);
}

export function useMusicEnrichment(track: Track, playing: boolean) {
  const key = track.source ? cacheKey(track) : '';
  const [result, setResult] = useState<{ key: string; value: Enrichment } | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: Enrichment }>).detail;
      if (detail.key !== key) return;
      inFlight.current?.abort();
      setResult(detail);
    };
    window.addEventListener('lumatune-music-refreshed', onRefresh);
    return () => window.removeEventListener('lumatune-music-refreshed', onRefresh);
  }, [key]);
  const needCover = track.cover === '/covers/local.svg';
  const needLyrics = !track.lyrics;
  useEffect(() => {
    if (!key || !playing || (!needCover && !needLyrics) || track.artist === '本地文件' || !track.title.trim()) return;
    const stored = readCache()[key];
    const cached = stored?.expires > Date.now() ? stored : undefined;
    if (cached?.value && (!needCover || cached.coverRequested) && (!needLyrics || cached.lyricRequested)) {
      setResult({ key, value: cached.value });
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    const params = new URLSearchParams({ title: track.title, artist: track.artist, cover: needCover && !cached?.coverRequested ? '1' : '0', lyric: needLyrics && !cached?.lyricRequested ? '1' : '0' });
    if (params.get('cover') === '0' && params.get('lyric') === '0') return;
    fetch(`/api/music/enrich?${params}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('补全失败'); return response.json() as Promise<Enrichment>; })
      .then(value => { if (!controller.signal.aborted) { saveCache(key, value, needCover, needLyrics); setResult({ key, value: { ...cached?.value, ...value } }); } })
      .catch(() => {});
    return () => { controller.abort(); if (inFlight.current === controller) inFlight.current = null; };
  }, [key, playing, needCover, needLyrics, track.title, track.artist]);
  const entry = readCache()[key];
  const value = result?.key === key ? result.value : entry?.expires > Date.now() ? entry.value : undefined;
  const override = entry?.expires > Date.now() && entry.override;
  const lyric = (override && value?.lyric) || track.lyrics || value?.lyric || '';
  const lines = parseLrc(lyric);
  const translation = parseLrc(value?.translation ?? '');
  for (const line of lines) {
    const translated = translation.find(item => Math.abs(item.time - line.time) < 0.5);
    if (translated) line.translation = translated.text;
  }
  return { cover: (needCover || override) && value?.cover ? value.cover : track.cover, lines };
}
