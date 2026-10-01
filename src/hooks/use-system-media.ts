import { useEffect, useRef } from 'react';

type MediaState = {
  desktop: boolean; available: boolean; playing: boolean; title: string; artist: string; album: string; cover: string;
  duration: number; position: number; noise: boolean;
  toggle: () => void; previous: () => void; next: () => void; seek: (position: number) => void;
};

export function useSystemMedia(state: MediaState) {
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    if (!state.available) { session.metadata = null; session.playbackState = 'none'; return; }
    session.metadata = new MediaMetadata({ title: state.title, artist: state.artist, album: state.album, artwork: state.cover ? [{ src: new URL(state.cover, location.href).href }] : [] });
    return () => { session.metadata = null; };
  }, [state.available, state.title, state.artist, state.album, state.cover]);
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    session.playbackState = state.available ? state.playing ? 'playing' : 'paused' : 'none';
    if (state.noise || !state.available || !Number.isFinite(state.duration) || state.duration <= 0) session.setPositionState?.();
    else session.setPositionState?.({ duration: state.duration, playbackRate: 1, position: Math.max(0, Math.min(state.position, state.duration)) });
  }, [state.available, state.playing, state.duration, state.position, state.noise]);
  useEffect(() => {
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { if (!latest.current.playing) latest.current.toggle(); },
      pause: () => { if (latest.current.playing) latest.current.toggle(); },
      previoustrack: () => { if (!latest.current.noise) latest.current.previous(); },
      nexttrack: () => { if (!latest.current.noise) latest.current.next(); },
      seekto: event => { if (!latest.current.noise && event.seekTime !== undefined) latest.current.seek(event.seekTime); },
    };
    const session = navigator.mediaSession;
    const installed: MediaSessionAction[] = [];
    for (const [action, handler] of Object.entries(handlers)) {
      try { session?.setActionHandler(action as MediaSessionAction, handler!); installed.push(action as MediaSessionAction); } catch { /* Some runtimes support only a subset of media actions. */ }
    }
    let cancelled = false;
    let remove: (() => void) | undefined;
    if (state.desktop) void import('@wailsio/runtime').then(({ Events }) => {
      if (cancelled) return;
      remove = Events.On('lunanahida:media-command', event => {
        const current = latest.current;
        if (event.data === 'toggle') current.toggle();
        else if (!current.noise && event.data === 'previous') current.previous();
        else if (!current.noise && event.data === 'next') current.next();
      });
    });
    return () => { cancelled = true; remove?.(); installed.forEach(action => session?.setActionHandler(action, null)); };
  }, [state.desktop]);
}
