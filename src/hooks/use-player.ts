import { useEffect, useRef, useState } from 'react';
import { backend } from '@/lib/backend';
import type { Track } from '@/lib/music';

const frequencies = [60, 230, 910, 3600, 12000];
const emptyBands = [0, 0, 0, 0, 0];
const emptyTrack: Track = { id: -1, title: '暂无歌曲', english: '', artist: '打开歌曲或文件夹', album: '本地音乐', duration: 0, cover: '/covers/local.svg', genre: '', year: '', color: '#8daab0', source: '' };
type Graph = { context: AudioContext; filter: BiquadFilterNode; delay: DelayNode; wet: GainNode; bands: BiquadFilterNode[]; analyser: AnalyserNode };
let activePlayback: { element: HTMLAudioElement; stop: () => void } | null = null;

export function usePlayer() {
  const [queue, setQueue] = useState<Track[]>([]), [trackId, setTrackId] = useState<number | null>(null);
  const [recent, setRecent] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const [volume, setVolume] = useState(65), [mode, setMode] = useState<'list' | 'repeat' | 'shuffle' | 'stop-track' | 'stop-list'>('list');
  const [effect, setEffect] = useState('原声'), [equalizer, setEqualizer] = useState<number[]>(emptyBands), [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), graph = useRef<Graph | null>(null);
  const queueRef = useRef(queue), catalogRef = useRef<Track[]>([]), currentId = useRef(trackId), shouldPlay = useRef(false), nextRef = useRef<() => void>(() => {});
  currentId.current = trackId;
  const track = queue.find(t => t.id === trackId) ?? null;
  const updateQueue = (value: Track[]) => { queueRef.current = value; setQueue(value); };
  const setCatalog = (items: Track[]) => { catalogRef.current = items; updateQueue(queueRef.current.map(item => items.find(track => track.id === item.id) ?? item)); };
  const hydrate = (items: Track[], ids: number[], history: number[], settings: { volume: number; mode: typeof mode; effect: string; equalizer: number[] }) => {
    catalogRef.current = items;
    updateQueue(ids.map(id => items.find(item => item.id === id)).filter((item): item is Track => Boolean(item)));
    setRecent(history); setVolume(settings.volume); setMode(settings.mode); setEffect(settings.effect); setEqualizer(settings.equalizer);
  };

  useEffect(() => {
    const element = new Audio(); audio.current = element;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumatune-playback') : null;
    const stop = () => { shouldPlay.current = false; element.pause(); };
    channel?.addEventListener('message', event => { if (event.data === 'play') stop(); });
    element.ontimeupdate = () => setTime(element.currentTime);
    element.onloadedmetadata = () => { const id = currentId.current; if (id !== null && Number.isFinite(element.duration)) { const updated = queueRef.current.map(item => item.id === id ? { ...item, duration: element.duration } : item); updateQueue(updated); if (id > 0) void backend.duration(id, element.duration).catch(() => {}); } };
    element.onended = () => nextRef.current();
    element.onplay = () => {
      if (activePlayback?.element !== element) activePlayback?.stop();
      activePlayback = { element, stop }; channel?.postMessage('play'); setPlaying(true);
      if (currentId.current !== null && currentId.current > 0) { const id = currentId.current; setRecent(prev => [id, ...prev.filter(item => item !== id)].slice(0, 50)); void backend.history(id).catch(() => {}); }
    };
    element.onpause = () => { if (activePlayback?.element === element) activePlayback = null; setPlaying(false); };
    return () => { stop(); channel?.close(); if (activePlayback?.element === element) activePlayback = null; element.removeAttribute('src'); element.load(); audio.current = null; void graph.current?.context.close(); graph.current = null; };
  }, []);

  useEffect(() => {
    const updateEnrichedTrack = (event: Event) => {
      const { id, value } = (event as CustomEvent<{ id: number; value: { cover?: string; lyric?: string; translation?: string } }>).detail;
      updateQueue(queueRef.current.map(item => item.id === id ? {
        ...item,
        cover: item.embeddedCover ? item.cover : value.cover || item.cover,
        lyrics: item.embeddedLyrics ? item.lyrics : value.lyric || item.lyrics,
        translation: item.embeddedLyrics ? item.translation : value.translation || item.translation,
      } : item));
    };
    window.addEventListener('lumatune-music-refreshed', updateEnrichedTrack);
    return () => window.removeEventListener('lumatune-music-refreshed', updateEnrichedTrack);
  }, []);

  const ensureGraph = () => {
    if (!graph.current && audio.current) {
      const context = new AudioContext(), source = context.createMediaElementSource(audio.current);
      const filter = context.createBiquadFilter(); filter.type = 'lowshelf'; filter.frequency.value = 280;
      const bands = frequencies.map((frequency, index) => { const band = context.createBiquadFilter(); band.type = index === 0 ? 'lowshelf' : index === frequencies.length - 1 ? 'highshelf' : 'peaking'; band.frequency.value = frequency; band.Q.value = 1; return band; });
      bands.forEach((band, index) => { if (index) bands[index - 1].connect(band); });
      const analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .82;
      const delay = context.createDelay(); delay.delayTime.value = .19;
      const wet = context.createGain(); wet.gain.value = 0;
      source.connect(filter); filter.connect(bands[0]); bands[bands.length - 1].connect(analyser); analyser.connect(context.destination);
      bands[bands.length - 1].connect(delay); delay.connect(wet); wet.connect(context.destination);
      graph.current = { context, filter, delay, wet, bands, analyser }; setAnalyser(analyser);
    }
    void graph.current?.context.resume();
  };
  useEffect(() => {
    const el = audio.current; if (!el) return;
    el.pause(); el.removeAttribute('src'); el.load();
    if (trackId === null || !track) { setTime(0); return; }
    el.src = track.source; setTime(0);
    if (shouldPlay.current) void el.play().catch(() => setPlaying(false));
  }, [trackId]);
  useEffect(() => { if (audio.current) audio.current.volume = volume / 100; }, [volume]);
  useEffect(() => { const g = graph.current; if (!g) return; g.filter.type = effect === '温暖 Lo-fi' ? 'lowpass' : 'lowshelf'; g.filter.frequency.value = effect === '温暖 Lo-fi' ? 1100 : 280; g.filter.gain.value = effect === '低音增强' ? 10 : 0; g.wet.gain.value = effect === '空间回响' ? .45 : 0; }, [effect, playing]);
  useEffect(() => { graph.current?.bands.forEach((band, index) => { band.gain.setTargetAtTime(equalizer[index], graph.current!.context.currentTime, .04); }); }, [equalizer]);

  const select = (id: number) => {
    let list = queueRef.current;
    if (!list.some(item => item.id === id)) { const item = catalogRef.current.find(item => item.id === id); if (!item || item.available === false) return; list = [...list, item]; updateQueue(list); }
    if (list.find(item => item.id === id)?.available === false) return;
    ensureGraph(); shouldPlay.current = true; currentId.current = id;
    if (id === trackId) { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setPlaying(false)); } }
    else { audio.current?.pause(); setTrackId(id); }
  };
  const next = () => { const list = queueRef.current.filter(item => item.available !== false); if (!list.length) return; const index = list.findIndex(item => item.id === trackId); const target = mode === 'shuffle' && list.length > 1 ? list[(index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length] : list[(index + 1) % list.length]; select(target.id); };
  nextRef.current = () => { const list = queueRef.current; const atEnd = list.findIndex(item => item.id === trackId) === list.length - 1; if (mode === 'stop-track' || (mode === 'stop-list' && atEnd)) { shouldPlay.current = false; setPlaying(false); if (audio.current) audio.current.currentTime = 0; setTime(0); } else if (mode === 'repeat' && trackId !== null) select(trackId); else next(); };
  const previous = () => { const list = queueRef.current.filter(item => item.available !== false); if (!list.length) return; const index = list.findIndex(item => item.id === trackId); select(list[(index - 1 + list.length) % list.length].id); };
  const toggle = () => { if (!audio.current || !track) return; ensureGraph(); if (playing) { audio.current.pause(); shouldPlay.current = false; } else { shouldPlay.current = true; void audio.current.play().catch(() => setPlaying(false)); } };
  const seek = (value: number) => { if (audio.current && track) audio.current.currentTime = value; setTime(value); };
  const setBand = (index: number, value: number) => setEqualizer(prev => prev.map((band, i) => i === index ? value : band));
  const resetEqualizer = () => setEqualizer([...emptyBands]);
  const clearQueue = () => { audio.current?.pause(); shouldPlay.current = false; setTrackId(null); setTime(0); updateQueue([]); };
  const removeTracks = (ids: number[]) => { const removed = new Set(ids); const remaining = queueRef.current.filter(item => !removed.has(item.id)); if (trackId !== null && removed.has(trackId)) { audio.current?.pause(); shouldPlay.current = false; setTrackId(remaining[0]?.id ?? null); } updateQueue(remaining); };
  const move = (from: number, to: number) => { const list = [...queueRef.current], start = list.findIndex(item => item.id === from), end = list.findIndex(item => item.id === to); if (start < 0 || end < 0 || start === end) return; list.splice(end, 0, list.splice(start, 1)[0]); updateQueue(list); };
  const addTracks = (items: Track[], replace = false) => { if (!items.length) return; const existing = new Set(queueRef.current.map(item => item.path)); const additions = items.filter(item => !existing.has(item.path)); if (replace) { audio.current?.pause(); shouldPlay.current = false; updateQueue(items); setTrackId(items[0].id); } else { const empty = queueRef.current.length === 0; updateQueue([...queueRef.current, ...additions]); if (empty && additions.length) setTrackId(additions[0].id); } };
  return { track: track ?? emptyTrack, hasTrack: Boolean(track), trackId, queue, recent, playing, time, volume, setVolume, mode, setMode, effect, setEffect, equalizer, setBand, resetEqualizer, analyser, select, next, previous, toggle, seek, clearQueue, removeTracks, move, addTracks, setCatalog, hydrate };
}
