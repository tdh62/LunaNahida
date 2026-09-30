import { useCallback, useEffect, useRef, useState } from 'react';
import { NoisePlayer, type NoiseStatus, type NoiseType } from '@/lib/noise-player';

export function useNoiseGenerator() {
  const [type, setType] = useState<NoiseType>('white');
  const [volume, setVolumeState] = useState(20);
  const [status, setStatus] = useState<NoiseStatus>('stopped');
  const [error, setError] = useState('');
  const player = useRef<NoisePlayer | null>(null);
  useEffect(() => {
    const instance = new NoisePlayer(setStatus, setError);
    player.current = instance;
    return () => { instance.stop(); player.current = null; };
  }, []);
  const stop = useCallback(() => player.current?.stop(), []);
  const pause = useCallback(() => player.current?.pause(), []);
  const start = () => { setError(''); void player.current?.start(type); };
  const resume = () => { setError(''); void player.current?.resume(); };
  const changeType = (next: NoiseType) => {
    if (next === type) return;
    setType(next);
    setError('');
    if (status === 'playing' || status === 'starting') void player.current?.start(next);
    else if (status === 'paused') stop();
  };
  const setVolume = (value: number) => {
    const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    setVolumeState(safe);
    player.current?.setVolume(safe);
  };
  const toggle = () => { if (status === 'paused') resume(); else if (status !== 'stopped') pause(); else start(); };
  return { type, name: { white: '白噪音', pink: '粉红噪音', brown: '褐噪音' }[type], volume, status, error, active: status !== 'stopped', playing: status === 'playing' || status === 'starting', start, stop, pause, resume, toggle, changeType, setVolume };
}

export type NoiseControls = ReturnType<typeof useNoiseGenerator>;
