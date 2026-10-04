import type { CSSProperties } from 'react';
import type { PlaybackClock } from '@/lib/playback-clock';
import { usePlaybackTime } from '@/hooks/use-playback-time';
import { formatTime } from '@/lib/music';

export default function PlaybackProgress({ clock, duration, available, noise, onSeek }: {
  clock: PlaybackClock; duration: number; available: boolean; noise: boolean; onSeek: (time: number) => void;
}) {
  const time = usePlaybackTime(clock, !noise);
  return <div className="seek-row"><span>{noise ? '—' : formatTime(time)}</span><input aria-label="播放进度" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={noise ? 0 : time} disabled={!available || noise} onChange={event => onSeek(Number(event.target.value))} style={{ '--fill': `${noise ? 0 : time / Math.max(1, duration) * 100}%` } as CSSProperties} /><span>{noise ? '—' : formatTime(duration)}</span></div>;
}
