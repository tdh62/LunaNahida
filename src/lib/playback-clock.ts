// Progress has its own subscriptions so audio time updates never render the app shell.
export function createPlaybackClock() {
  let position = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => position,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (value: number) => {
      const next = Number.isFinite(value) ? Math.max(0, value) : 0;
      if (position === next) return;
      position = next;
      listeners.forEach(listener => listener());
    },
  };
}

export type PlaybackClock = ReturnType<typeof createPlaybackClock>;
