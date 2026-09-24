import { useEffect, useRef, useState } from 'react';
import { tracks } from '@/lib/music';

// Locally rendered instrumental demos keep the mock player independent of audio services.
function renderDemo(id: number, duration: number) {
  const rate = 12000, length = duration * rate;
  const data = new ArrayBuffer(44 + length * 2), view = new DataView(data);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
  const notes = [0, 7, 12, 4, 9, 7, 4, 12, 0, 4, 7, 16, 12, 7, 9, 4];
  const base = 130.81 * Math.pow(2, id / 12);
  for (let i = 0; i < length; i++) {
    const t = i / rate, beat = Math.floor(t / .6), phase = t % .6;
    const freq = base * Math.pow(2, notes[beat % notes.length] / 12);
    const melody = (Math.sin(t * freq * Math.PI * 2) + .2 * Math.sin(t * freq * Math.PI * 4)) * Math.exp(-phase * 4) * Math.min(1, phase * 100);
    const root = base * [1, .75, .89, .667][Math.floor(t / 9.6) % 4] / 2;
    const pad = (Math.sin(t * root * Math.PI * 2) + .4 * Math.sin(t * root * 3 * Math.PI)) * .3;
    const fade = Math.min(1, t / 2, (duration - t) / 3);
    view.setInt16(44 + i * 2, (melody * .2 + pad * .24) * fade * 32767, true);
  }
  return URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
}

export function usePlayer() {
  const [trackId, setTrackId] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(65);
  const [mode, setMode] = useState<'list' | 'repeat' | 'shuffle'>('list');
  const [effect, setEffect] = useState('原声');
  const audio = useRef<HTMLAudioElement | null>(null);
  const graph = useRef<{ context: AudioContext; filter: BiquadFilterNode; delay: DelayNode; wet: GainNode } | null>(null);
  const urls = useRef(new Map<number, string>());
  const shouldPlay = useRef(false);
  const nextRef = useRef<() => void>(() => {});
  const track = tracks[trackId];
  useEffect(() => {
    const element = new Audio(); audio.current = element;
    element.ontimeupdate = () => setTime(element.currentTime);
    element.onended = () => nextRef.current();
    element.onplay = () => setPlaying(true);
    element.onpause = () => setPlaying(false);
    return () => { element.pause(); element.src = ''; urls.current.forEach(URL.revokeObjectURL); graph.current?.context.close(); };
  }, []);
  const ensureGraph = () => {
    if (!graph.current && audio.current) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio.current);
      const filter = context.createBiquadFilter(); filter.type = 'lowshelf'; filter.frequency.value = 280;
      const delay = context.createDelay(); delay.delayTime.value = .19;
      const wet = context.createGain(); wet.gain.value = 0;
      source.connect(filter); filter.connect(context.destination); filter.connect(delay); delay.connect(wet); wet.connect(context.destination);
      graph.current = { context, filter, delay, wet };
    }
    void graph.current?.context.resume();
  };
  useEffect(() => {
    const el = audio.current; if (!el) return;
    if (!urls.current.has(trackId)) urls.current.set(trackId, renderDemo(trackId, track.duration));
    el.src = urls.current.get(trackId)!; setTime(0);
    if (shouldPlay.current) void el.play().catch(() => setPlaying(false));
  }, [trackId, track.duration]);
  useEffect(() => { if (audio.current) audio.current.volume = volume / 100; }, [volume]);
  useEffect(() => {
    const g = graph.current; if (!g) return;
    g.filter.type = effect === '温暖 Lo-fi' ? 'lowpass' : 'lowshelf';
    g.filter.frequency.value = effect === '温暖 Lo-fi' ? 1100 : 280;
    g.filter.gain.value = effect === '低音增强' ? 10 : 0;
    g.wet.gain.value = effect === '空间回响' ? .45 : 0;
  }, [effect, playing]);
  const select = (id: number) => {
    ensureGraph(); shouldPlay.current = true;
    if (id === trackId) { if (audio.current) { audio.current.currentTime = 0; void audio.current.play(); } }
    else setTrackId(id);
  };
  const next = () => select(mode === 'shuffle' ? (trackId + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length : (trackId + 1) % tracks.length);
  nextRef.current = () => { if (mode === 'repeat') select(trackId); else next(); };
  const toggle = () => {
    if (!audio.current) return; ensureGraph();
    if (playing) { audio.current.pause(); shouldPlay.current = false; }
    else { shouldPlay.current = true; void audio.current.play().catch(() => setPlaying(false)); }
  };
  const seek = (value: number) => { if (audio.current) audio.current.currentTime = value; setTime(value); };
  return { track, trackId, playing, time, volume, setVolume, mode, setMode, effect, setEffect, select, next, previous: () => select((trackId + tracks.length - 1) % tracks.length), toggle, seek };
}
