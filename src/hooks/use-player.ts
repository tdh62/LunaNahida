import { useEffect, useRef, useState } from 'react';
import { backend } from '@/lib/backend';
import type { Track } from '@/lib/music';
import { toast } from 'sonner';
import { calculateFIRResponse, effectDefinitions, makeFrequencyImpulse, makeTimeImpulse, selectedEffect, validateFilter, type CustomFilter, type FrequencyResponse, type SavedEffect } from '@/lib/audio-filter';

const frequencies = [60, 230, 910, 3600, 12000];
const emptyBands = [0, 0, 0, 0, 0];
const emptyTrack: Track = { id: -1, title: '暂无歌曲', english: '', artist: '打开歌曲或文件夹', album: '本地音乐', duration: 0, cover: '/covers/local.svg', genre: '', year: '', color: '#8daab0', source: '' };
type FilterLane = { node: ConvolverNode | null; gain: GainNode };
type Graph = { context: AudioContext; bands: BiquadFilterNode[]; frequencyInput: GainNode; timeInput: GainNode; analyser: AnalyserNode; scopeAnalyser: AnalyserNode; frequencyLane: FilterLane; timeLane: FilterLane };
let activePlayback: { element: HTMLAudioElement; stop: () => void } | null = null;

export function usePlayer() {
  const [queue, setQueue] = useState<Track[]>([]), [trackId, setTrackId] = useState<number | null>(null);
  const [recent, setRecent] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const [volume, setVolume] = useState(65), [mode, setMode] = useState<'list' | 'repeat' | 'shuffle' | 'stop-track' | 'stop-list'>('list');
  const [effect, setEffect] = useState('原声'), [equalizer, setEqualizer] = useState<number[]>(emptyBands), [analyser, setAnalyser] = useState<AnalyserNode | null>(null), [scopeAnalyser, setScopeAnalyser] = useState<AnalyserNode | null>(null);
  const [customEffects, setCustomEffects] = useState<SavedEffect[]>([]), [previewFilter, setPreviewFilter] = useState<CustomFilter | null>(null), [filterError, setFilterError] = useState<string | null>(null);
  const [frequencyResponse, setFrequencyResponse] = useState<FrequencyResponse | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), graph = useRef<Graph | null>(null);
  const appliedFilter = useRef('');
  const queueRef = useRef(queue), catalogRef = useRef<Track[]>([]), currentId = useRef(trackId), shouldPlay = useRef(false), nextRef = useRef<() => void>(() => {});
  currentId.current = trackId;
  const track = queue.find(t => t.id === trackId) ?? null;
  const updateQueue = (value: Track[]) => { queueRef.current = value; setQueue(value); };
  const setCatalog = (items: Track[]) => {
    catalogRef.current = items;
    const byId = new Map(items.map(item => [item.id, item]));
    const next = queueRef.current.map(item => byId.get(item.id) ?? (item.temporary ? item : null)).filter((item): item is Track => item !== null);
    if (currentId.current !== null && !next.some(item => item.id === currentId.current)) {
      audio.current?.pause();
      shouldPlay.current = false;
      setTrackId(next[0]?.id ?? null);
    }
    updateQueue(next);
  };
  const updateTrack = (track: Track) => updateQueue(queueRef.current.map(item => item.id === track.id ? track : item));
  const hydrate = (items: Track[], ids: number[], history: number[], settings: { volume: number; mode: typeof mode; effect: string; equalizer: number[]; customEffects?: SavedEffect[] }) => {
    catalogRef.current = items;
    updateQueue(ids.map(id => items.find(item => item.id === id)).filter((item): item is Track => Boolean(item)));
    const saved = (settings.customEffects ?? []).filter(item => Array.isArray(item.filter?.frequencyBands) && item.filter.frequencyBands.length > 0);
    setRecent(history); setVolume(settings.volume); setMode(settings.mode);
    const requested = settings.effect;
    setEffect(effectDefinitions[requested] || saved.some(item => item.id === requested) ? requested : '原声');
    setEqualizer(settings.equalizer); setCustomEffects(saved);
  };

  useEffect(() => {
    const element = new Audio(); audio.current = element;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lunanahidatune-playback') : null;
    const stop = () => { shouldPlay.current = false; element.pause(); };
    channel?.addEventListener('message', event => { if (event.data === 'play') stop(); });
    element.ontimeupdate = () => setTime(element.currentTime);
    element.onloadedmetadata = () => { const id = currentId.current; if (id !== null && Number.isFinite(element.duration)) { const updated = queueRef.current.map(item => item.id === id ? { ...item, duration: element.duration } : item); updateQueue(updated); if (id > 0) void backend.duration(id, element.duration).catch(() => {}); } };
    element.oncanplay = () => { const id = currentId.current; if (id === null) return; const item = queueRef.current.find(track => track.id === id); if (item?.playbackStatus === 'playable') return; updateQueue(queueRef.current.map(track => track.id === id ? { ...track, playbackStatus: 'playable' } : track)); if (id > 0) void backend.playbackStatus(id, 'playable').then(() => window.dispatchEvent(new Event('lunanahida-library-changed'))).catch(() => {}); };
    element.onerror = () => {
      const id = currentId.current;
      if (id === null) return;
      const current = queueRef.current.find(track => track.id === id);
      if (current?.kind === 'network') {
        shouldPlay.current = false;
        setPlaying(false);
        toast.error('网络歌曲暂时无法播放');
        return;
      }
      if (![3, 4].includes(element.error?.code ?? 0)) return;
      shouldPlay.current = false;
      setPlaying(false);
      const source = current?.source;
      if (!source) return;
      void fetch(source, { method: 'HEAD' }).then(response => {
        if (currentId.current !== id || !response.ok) { window.dispatchEvent(new Event('lunanahida-library-changed')); return; }
        updateQueue(queueRef.current.map(track => track.id === id ? { ...track, playbackStatus: 'unplayable' } : track));
        if (id > 0) void backend.playbackStatus(id, 'unplayable').then(() => window.dispatchEvent(new Event('lunanahida-library-changed'))).catch(() => {});
      }).catch(() => {});
    };
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
        lyrics: item.embeddedLyrics || item.localLyrics ? item.lyrics : value.lyric || item.lyrics,
        translation: item.embeddedLyrics || item.localLyrics ? item.translation : value.translation || item.translation,
      } : item));
    };
    window.addEventListener('lunanahidatune-music-refreshed', updateEnrichedTrack);
    return () => window.removeEventListener('lunanahidatune-music-refreshed', updateEnrichedTrack);
  }, []);

  const ensureGraph = () => {
    if (!graph.current && audio.current) {
      const context = new AudioContext(), source = context.createMediaElementSource(audio.current);
      const bands = frequencies.map((frequency, index) => { const band = context.createBiquadFilter(); band.type = index === 0 ? 'lowshelf' : index === frequencies.length - 1 ? 'highshelf' : 'peaking'; band.frequency.value = frequency; band.Q.value = 1; band.gain.value = equalizer[index] ?? 0; return band; });
      bands.forEach((band, index) => { if (index) bands[index - 1].connect(band); });
      const analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .82;
      const scopeAnalyser = context.createAnalyser(); scopeAnalyser.fftSize = 8192; scopeAnalyser.smoothingTimeConstant = .72; scopeAnalyser.minDecibels = -100; scopeAnalyser.maxDecibels = -20;
      const frequencyInput = context.createGain(), timeInput = context.createGain();
      const makeLane = (input: AudioNode, output: AudioNode, buffer: AudioBuffer | null): FilterLane => {
        const node = buffer ? context.createConvolver() : null, gain = context.createGain();
        if (node && buffer) { node.normalize = false; node.buffer = buffer; input.connect(node); node.connect(gain); }
        else input.connect(gain);
        gain.connect(output);
        return { node, gain };
      };
      source.connect(bands[0]); bands[bands.length - 1].connect(frequencyInput);
      const frequencyLane = makeLane(frequencyInput, timeInput, null);
      const timeLane = makeLane(timeInput, analyser, null);
      analyser.connect(context.destination); analyser.connect(scopeAnalyser);
      graph.current = { context, bands, frequencyInput, timeInput, analyser, scopeAnalyser, frequencyLane, timeLane };
      setAnalyser(analyser); setScopeAnalyser(scopeAnalyser);
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
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    try {
      const definition = previewFilter ?? selectedEffect(effect, customEffects).filter;
      const signature = `${previewFilter ? 'preview' : effect}:${JSON.stringify(definition)}`;
      if (appliedFilter.current === signature) return;
      const { frequency, time, neutralFrequency } = validateFilter(definition, g.context.sampleRate);
      const frequencyBuffer = neutralFrequency ? null : makeFrequencyImpulse(g.context, frequency, definition.firSize);
      const timeBuffer = makeTimeImpulse(g.context, time, definition.durationMs, definition.delays);
      const neutralTime = timeBuffer.getChannelData(0).every((tap, index) => index === 0 || tap === 0);
      const replace = (kind: 'frequencyLane' | 'timeLane', input: AudioNode, output: AudioNode, buffer: AudioBuffer | null) => {
        const previous = g[kind];
        const node = buffer ? g.context.createConvolver() : null, gain = g.context.createGain();
        if (node && buffer) { node.normalize = false; node.buffer = buffer; }
        gain.gain.setValueAtTime(0, g.context.currentTime);
        if (node) { input.connect(node); node.connect(gain); } else input.connect(gain);
        gain.connect(output);
        gain.gain.linearRampToValueAtTime(1, g.context.currentTime + .06);
        previous.gain.gain.setValueAtTime(previous.gain.gain.value, g.context.currentTime);
        previous.gain.gain.linearRampToValueAtTime(0, g.context.currentTime + .06);
        g[kind] = { node, gain };
        window.setTimeout(() => { input.disconnect(previous.node ?? previous.gain); previous.node?.disconnect(); previous.gain.disconnect(); }, 100);
      };
      replace('frequencyLane', g.frequencyInput, g.timeInput, frequencyBuffer);
      replace('timeLane', g.timeInput, g.analyser, neutralTime ? null : timeBuffer);
      setFrequencyResponse(frequencyBuffer ? calculateFIRResponse(frequencyBuffer) : { sampleRate: g.context.sampleRate, values: new Float32Array(definition.firSize / 2 + 1) });
      appliedFilter.current = signature;
      setFilterError(null);
    } catch (error) { setFilterError(error instanceof Error ? error.message : '滤波器无法应用'); }
  }, [effect, customEffects, previewFilter, playing]);
  useEffect(() => { graph.current?.bands.forEach((band, index) => { band.gain.setTargetAtTime(equalizer[index], graph.current!.context.currentTime, .04); }); }, [equalizer]);

  const select = (id: number) => {
    let list = queueRef.current;
    if (!list.some(item => item.id === id)) { const item = catalogRef.current.find(item => item.id === id); if (!item || item.available === false || item.playbackStatus === 'unplayable') return; list = [...list, item]; updateQueue(list); }
    if (list.find(item => item.id === id)?.available === false || list.find(item => item.id === id)?.playbackStatus === 'unplayable') return;
    ensureGraph(); shouldPlay.current = true; currentId.current = id;
    if (id === trackId) { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setPlaying(false)); } }
    else { audio.current?.pause(); setTrackId(id); }
  };
  const playTracks = (items: Track[], startId?: number) => {
    const playable = items.filter(item => item.available !== false && item.playbackStatus !== 'unplayable');
    if (!playable.length) return false;
    const target = playable.find(item => item.id === startId) ?? playable[0];
    ensureGraph(); shouldPlay.current = true; currentId.current = target.id;
    updateQueue(playable);
    if (target.id === trackId) {
      if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setPlaying(false)); }
    } else { audio.current?.pause(); setTrackId(target.id); }
    return true;
  };
  const next = () => { const list = queueRef.current.filter(item => item.available !== false && item.playbackStatus !== 'unplayable'); if (!list.length) return; const index = list.findIndex(item => item.id === trackId); const target = mode === 'shuffle' && list.length > 1 ? list[(index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length] : list[(index + 1) % list.length]; select(target.id); };
  nextRef.current = () => { const list = queueRef.current; const atEnd = list.findIndex(item => item.id === trackId) === list.length - 1; if (mode === 'stop-track' || (mode === 'stop-list' && atEnd)) { shouldPlay.current = false; setPlaying(false); if (audio.current) audio.current.currentTime = 0; setTime(0); } else if (mode === 'repeat' && trackId !== null) select(trackId); else next(); };
  const previous = () => { const list = queueRef.current.filter(item => item.available !== false && item.playbackStatus !== 'unplayable'); if (!list.length) return; const index = list.findIndex(item => item.id === trackId); select(list[(index - 1 + list.length) % list.length].id); };
  const toggle = () => { if (!audio.current || !track) return; ensureGraph(); if (playing) { audio.current.pause(); shouldPlay.current = false; } else { shouldPlay.current = true; void audio.current.play().catch(() => setPlaying(false)); } };
  const seek = (value: number) => { if (audio.current && track) audio.current.currentTime = value; setTime(value); };
  const setBand = (index: number, value: number) => setEqualizer(prev => prev.map((band, i) => i === index ? value : band));
  const resetEqualizer = () => setEqualizer([...emptyBands]);
  const saveEffect = (name: string, filter: CustomFilter, id?: string) => {
    const nextId = id ?? `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    setCustomEffects(previous => id && previous.some(item => item.id === id)
      ? previous.map(item => item.id === id ? { id, name, filter } : item)
      : [...previous, { id: nextId, name, filter }]);
    setEffect(nextId);
  };
  const deleteEffect = (id: string) => {
    setCustomEffects(previous => previous.filter(item => item.id !== id));
    if (effect === id) setEffect('原声');
  };
  const clearQueue = () => { audio.current?.pause(); shouldPlay.current = false; setTrackId(null); setTime(0); updateQueue([]); };
  const removeTracks = (ids: number[]) => { const removed = new Set(ids); const remaining = queueRef.current.filter(item => !removed.has(item.id)); if (trackId !== null && removed.has(trackId)) { audio.current?.pause(); shouldPlay.current = false; setTrackId(remaining[0]?.id ?? null); } updateQueue(remaining); };
  const move = (from: number, to: number) => { const list = [...queueRef.current], start = list.findIndex(item => item.id === from), end = list.findIndex(item => item.id === to); if (start < 0 || end < 0 || start === end) return; list.splice(end, 0, list.splice(start, 1)[0]); updateQueue(list); };
  const markLyricsSaved = (saved: Track) => updateQueue(queueRef.current.map(item => item.id === saved.id ? { ...item, lyrics: saved.lyrics, translation: saved.translation, localLyrics: true, embeddedLyrics: false } : item));
  const addTracks = (items: Track[], replace = false) => { if (!items.length) return; if (replace) { audio.current?.pause(); shouldPlay.current = false; updateQueue(items); setTrackId(items[0].id); return; } const ids = new Set(queueRef.current.map(item => item.id)); const paths = new Set(queueRef.current.map(item => item.path).filter((path): path is string => Boolean(path))); const additions = items.filter(item => { if (ids.has(item.id) || (item.path && paths.has(item.path))) return false; ids.add(item.id); if (item.path) paths.add(item.path); return true; }); const empty = queueRef.current.length === 0; updateQueue([...queueRef.current, ...additions]); if (empty && additions.length) setTrackId(additions[0].id); };
  return { track: track ?? emptyTrack, hasTrack: Boolean(track), trackId, queue, recent, playing, time, volume, setVolume, mode, setMode, effect, effectName: selectedEffect(effect, customEffects).name, setEffect, setPreviewFilter, customEffects, saveEffect, deleteEffect, filterError, frequencyResponse, equalizer, setBand, resetEqualizer, analyser, scopeAnalyser, select, playTracks, next, previous, toggle, seek, clearQueue, removeTracks, move, addTracks, markLyricsSaved, setCatalog, updateTrack, hydrate };
}
