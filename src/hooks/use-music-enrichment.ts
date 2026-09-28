import { useEffect, useState } from 'react';
import type { Track } from '@/lib/music';
import { backend } from '@/lib/backend';

export type TimedLine = { time: number; text: string; translation?: string };
type Enrichment = { cover?: string; lyric?: string; translation?: string };
const current = new Map<string, Enrichment>();
const keyOf = (track: Track) => `${track.title.trim().normalize('NFKC').toLowerCase()}\u0000${track.artist.trim().normalize('NFKC').toLowerCase()}\u0000${track.album.trim().normalize('NFKC').toLowerCase()}`;
const albumOf = (track: Track) => track.album.trim() === '未知专辑' ? '' : track.album.trim();

export async function refreshMusicInfo(track: Track) {
  if (!track.source || !track.title.trim() || !track.artist.trim()) throw new Error('歌曲缺少可匹配的曲名或歌手');
  if (track.embeddedCover && (track.embeddedLyrics || track.localLyrics)) return { cover: track.cover, lyric: track.lyrics };
  const params = new URLSearchParams({ title: track.title, artist: track.artist, album: albumOf(track), cover: track.embeddedCover ? '0' : '1', lyric: track.embeddedLyrics || track.localLyrics ? '0' : '1', refresh: '1' });
  if (track.provider && track.providerId) { params.set('source', track.provider); params.set('id', track.providerId); }
  const response = await fetch(`/api/music/enrich?${params}`);
  if (!response.ok) throw new Error('音乐源暂时不可用，请稍后重试');
  const value = await response.json() as Enrichment;
  if (!value.cover && !value.lyric) throw new Error('未找到与曲名和歌手匹配的资料');
  if (track.id > 0) { await backend.enrichment(track.id, value.cover ?? '', value.lyric ?? '', value.translation ?? ''); window.dispatchEvent(new Event('luma-library-changed')); }
  const key = keyOf(track); current.set(key, value);
  window.dispatchEvent(new CustomEvent('lumatune-music-refreshed', { detail: { id: track.id, key, value } }));
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
  const key = track.source ? keyOf(track) : '';
  const [result, setResult] = useState<{ key: string; value: Enrichment } | null>(null);
  useEffect(() => {
    const refresh = (event: Event) => { const detail = (event as CustomEvent<{ key: string; value: Enrichment }>).detail; if (detail.key === key) setResult(detail); };
    const clear = () => { current.clear(); setResult(null); };
    window.addEventListener('lumatune-music-refreshed', refresh);
    window.addEventListener('luma-cache-cleared', clear);
    return () => { window.removeEventListener('lumatune-music-refreshed', refresh); window.removeEventListener('luma-cache-cleared', clear); };
  }, [key]);
  const needCover = !track.embeddedCover && track.cover === '/covers/local.svg';
  const needLyrics = !track.embeddedLyrics && !track.localLyrics && !track.lyrics;
  useEffect(() => {
    if (!key || !playing || (!needCover && !needLyrics) || track.artist === '未知歌手') return;
    const controller = new AbortController();
    const params = new URLSearchParams({ title: track.title, artist: track.artist, album: albumOf(track), cover: needCover ? '1' : '0', lyric: needLyrics ? '1' : '0' });
    if (track.provider && track.providerId) { params.set('source', track.provider); params.set('id', track.providerId); }
    fetch(`/api/music/enrich?${params}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('补全失败'); return response.json() as Promise<Enrichment>; })
      .then(async value => { if (!controller.signal.aborted) { if (track.id > 0 && (value.cover || value.lyric || value.translation)) { await backend.enrichment(track.id, value.cover ?? '', value.lyric ?? '', value.translation ?? ''); window.dispatchEvent(new Event('luma-library-changed')); } current.set(key, value); setResult({ key, value }); window.dispatchEvent(new CustomEvent('lumatune-music-refreshed', { detail: { id: track.id, key, value } })); } })
      .catch(() => {});
    return () => controller.abort();
  }, [key, playing, needCover, needLyrics, track.id, track.title, track.artist, track.album]);
  const value = result?.key === key ? result.value : current.get(key);
  const lines = parseLrc(track.lyrics || (track.embeddedLyrics || track.localLyrics ? '' : value?.lyric) || '');
  const translations = parseLrc(track.embeddedLyrics || track.localLyrics ? '' : track.translation || value?.translation || '');
  for (const line of lines) { const translated = translations.find(item => Math.abs(item.time - line.time) < 0.5); if (translated) line.translation = translated.text; }
  return { cover: track.embeddedCover ? track.cover : value?.cover || track.cover, lines };
}
