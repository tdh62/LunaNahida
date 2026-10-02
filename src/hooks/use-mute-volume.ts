import { useEffect, useRef } from 'react';

export function useMuteVolume(musicVolume: number, noiseVolume: number, noise: boolean, setVolume: (value: number) => void) {
  const remembered = useRef({ music: 65, noise: 20 });
  useEffect(() => {
    if (musicVolume > 0) remembered.current.music = musicVolume;
    if (noiseVolume > 0) remembered.current.noise = noiseVolume;
  }, [musicVolume, noiseVolume]);
  return () => {
    const key = noise ? 'noise' : 'music';
    const volume = noise ? noiseVolume : musicVolume;
    if (volume > 0) remembered.current[key] = volume;
    setVolume(volume > 0 ? 0 : remembered.current[key]);
  };
}
