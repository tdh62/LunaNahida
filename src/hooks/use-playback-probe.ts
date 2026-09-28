import { useEffect, useRef } from 'react';
import { backend } from '@/lib/backend';
import type { Track } from '@/lib/music';

type Status = 'playable' | 'unplayable';

function probe(track: Track, signal: AbortSignal): Promise<Status | null> {
  return new Promise(resolve => {
    const audio = new Audio();
    let settled = false;
    const finish = (status: Status | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.oncanplay = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      resolve(status);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    signal.addEventListener('abort', () => finish(null), { once: true });
    audio.oncanplay = () => finish('playable');
    audio.onerror = () => {
      if (![3, 4].includes(audio.error?.code ?? 0)) { finish(null); return; }
      void fetch(track.source, { method: 'HEAD', signal }).then(response => finish(response.ok ? 'unplayable' : null)).catch(() => finish(null));
    };
    audio.preload = 'auto';
    audio.src = track.source;
    audio.load();
  });
}

export function usePlaybackProbe(tracks: Track[]) {
  const attempted = useRef(new Set<number>());
  useEffect(() => {
    const candidates = tracks.filter(track => track.id > 0 && track.converted && track.available !== false && (track.playbackStatus ?? 'unknown') === 'unknown' && !attempted.current.has(track.id));
    if (!candidates.length) return;
    candidates.forEach(track => attempted.current.add(track.id));
    const controller = new AbortController();
    let cursor = 0;
    let changed = false;
    const worker = async () => {
      while (cursor < candidates.length && !controller.signal.aborted) {
        const track = candidates[cursor++];
        const status = await probe(track, controller.signal);
        if (!status || controller.signal.aborted) continue;
        try { await backend.playbackStatus(track.id, status); changed = true; } catch { /* The next scan can retry. */ }
      }
    };
    void Promise.all([worker(), worker()]).then(() => { if (changed && !controller.signal.aborted) window.dispatchEvent(new Event('luma-library-changed')); });
    return () => controller.abort();
  }, [tracks]);
}
