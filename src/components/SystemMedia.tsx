import { useSystemMedia } from '@/hooks/use-system-media';
import { usePlaybackTime } from '@/hooks/use-playback-time';
import type { PlaybackClock } from '@/lib/playback-clock';

export default function SystemMedia({ clock, ...state }: Omit<Parameters<typeof useSystemMedia>[0], 'position'> & { clock: PlaybackClock }) {
  const position = usePlaybackTime(clock, !state.noise);
  useSystemMedia({ ...state, position });
  return null;
}
