export type PlaybackProbeResult = { duration?: number; playbackStatus?: 'playable' | 'unplayable' };

// Read metadata without starting playback. Only converted files need a decode check.
export function probePlayback(source: string, signal: AbortSignal, checkPlayback: boolean): Promise<PlaybackProbeResult | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const audio = new Audio();
    let settled = false;
    const duration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
    const onAbort = () => finish(null);
    const finish = (result: PlaybackProbeResult | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.oncanplay = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      resolve(result);
    };
    const metadata = () => {
      const value = duration();
      if (!checkPlayback && value !== undefined) finish({ duration: value });
    };
    const timer = window.setTimeout(() => finish(duration() === undefined ? null : { duration: duration() }), 8000);
    signal.addEventListener('abort', onAbort, { once: true });
    audio.onloadedmetadata = metadata;
    audio.ondurationchange = metadata;
    audio.oncanplay = () => finish({ duration: duration(), ...(checkPlayback ? { playbackStatus: 'playable' } : {}) });
    audio.onerror = () => {
      if (!checkPlayback || ![3, 4].includes(audio.error?.code ?? 0)) { finish(null); return; }
      void fetch(source, { method: 'HEAD', signal }).then(response => finish(response.ok ? { playbackStatus: 'unplayable' } : null)).catch(() => finish(null));
    };
    audio.preload = checkPlayback ? 'auto' : 'metadata';
    audio.src = source;
    audio.load();
  });
}
