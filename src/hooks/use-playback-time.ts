import { useSyncExternalStore } from 'react';
import type { PlaybackClock } from '@/lib/playback-clock';

const inactiveSubscribe = () => () => {};
export function usePlaybackTime(clock: PlaybackClock, active = true) {
  return useSyncExternalStore(active ? clock.subscribe : inactiveSubscribe, clock.getSnapshot, clock.getSnapshot);
}
