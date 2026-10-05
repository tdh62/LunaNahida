import { useEffect, useRef } from 'react';
import { backend } from '@/lib/backend';
import { probePlayback } from '@/lib/playback-probe';
import type { Track } from '@/lib/music';

const probeKey = (track: Track) => JSON.stringify([track.id, track.source, track.path]);
const needsPlaybackCheck = (track: Track) => track.converted && (track.playbackStatus ?? 'unknown') === 'unknown';

export function usePlaybackProbe(tracks: Track[]) {
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const candidates = tracks.filter(track => track.id > 0 && track.kind !== 'network' && track.source && track.available !== false &&
      (needsPlaybackCheck(track) || !(track.duration > 0) && track.playbackStatus !== 'unplayable') && !attempted.current.has(probeKey(track)));
    if (!candidates.length) return;
    const controller = new AbortController();
    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length && !controller.signal.aborted) {
        const track = candidates[cursor++];
        const result = await probePlayback(track.source, controller.signal, Boolean(needsPlaybackCheck(track)));
        if (controller.signal.aborted) return;
        // Cancelled and not-yet-started tracks must remain eligible after a library update.
        attempted.current.add(probeKey(track));
        if (!result) continue;
        const changes: Partial<Track> = {};
        const writes: Promise<void>[] = [];
        if (result.duration !== undefined && result.duration !== track.duration) {
          const duration = result.duration;
          writes.push(backend.duration(track.id, duration).then(() => { changes.duration = duration; }));
        }
        if (result.playbackStatus) {
          const status = result.playbackStatus;
          writes.push(backend.playbackStatus(track.id, status).then(() => { changes.playbackStatus = status; }));
        }
        await Promise.allSettled(writes);
        if (Object.keys(changes).length) window.dispatchEvent(new CustomEvent('lunanahida-library-changed', { detail: [{ id: track.id, changes }] }));
      }
    };
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
  }, [tracks]);
}
