import { useEffect, useRef, useState } from 'react';
import { backend, type PlaybackState } from '@/lib/backend';
import { useRuntime } from '@/hooks/use-runtime';
import { BrowserTrackPool, isBrowserTrack } from '@/lib/browser-tracks';
import type { Track } from '@/lib/music';
import { toast } from 'sonner';
import { playbackCoordinator, type PlaybackOwner } from '@/lib/playback-coordinator';
import { useNoiseGenerator } from '@/hooks/use-noise-generator';
import { calculateFIRResponse, effectDefinitions, makeFrequencyImpulse, makeTimeImpulse, professionalGainLimit, selectedEffect, validateFilter, type CustomFilter, type FrequencyResponse, type SavedEffect } from '@/lib/audio-filter';

const frequencies = [60, 230, 910, 3600, 12000];
const emptyBands = [0, 0, 0, 0, 0];
const emptyTrack: Track = { id: -1, title: '暂无歌曲', english: '', artist: '打开歌曲或文件夹', album: '本地音乐', duration: 0, cover: '/covers/local.svg', genre: '', year: '', color: '#8daab0', source: '' };
type FilterLane = { node: ConvolverNode | null; gain: GainNode; signature?: string };
type Graph = { context: AudioContext; headroom: GainNode; bands: BiquadFilterNode[]; response: FrequencyResponse | null; timeLoad: number; frequencyInput: GainNode; timeInput: GainNode; analyser: AnalyserNode; scopeAnalyser: AnalyserNode; frequencyLane: FilterLane; timeLane: FilterLane };

function reserveHeadroom(g: Graph, equalizer: number[], releaseDelay = .12) {
  const count = g.response?.values.length ?? 4097;
  const frequencies = Float32Array.from({ length: count }, (_, i) => i * g.context.sampleRate / (2 * (count - 1)));
  const response = new Float32Array(count).fill(1), magnitude = new Float32Array(count), phase = new Float32Array(count);
  g.bands.forEach((band, index) => {
    const measuring = g.context.createBiquadFilter();
    measuring.type = band.type; measuring.frequency.value = band.frequency.value; measuring.Q.value = band.Q.value;
    measuring.gain.value = equalizer[index] ?? 0;
    measuring.getFrequencyResponse(frequencies, magnitude, phase);
    measuring.disconnect();
    for (let i = 0; i < count; i++) response[i] *= magnitude[i];
  });
  let peak = 1;
  for (let i = 0; i < count; i++) peak = Math.max(peak, response[i] * 10 ** ((g.response?.values[i] ?? 0) / 20) * g.timeLoad);
  const preamp = peak > 1.001 ? 10 ** (-1 / 20) / peak : 1;
  g.headroom.gain.cancelScheduledValues(g.context.currentTime);
  g.headroom.gain.setValueAtTime(Math.min(g.headroom.gain.value, preamp), g.context.currentTime);
  g.headroom.gain.setTargetAtTime(preamp, g.context.currentTime + releaseDelay, .04);
  return 20 * Math.log10(preamp);
}

export function usePlayer() {
  const [professionalAudio, setProfessionalAudio] = useState(false);
  const [preampDb, setPreampDb] = useState(0);
  const filterReadyAt = useRef(0);
  const [filterRevision, setFilterRevision] = useState(0);
  const runtime = useRuntime();
  const browserTracks = useRef(new BrowserTrackPool());
  const mounted = useRef(true);
  const noise = useNoiseGenerator();
  const musicOwner = useRef<PlaybackOwner | null>(null);
  const [queue, setQueue] = useState<Track[]>([]), [trackId, setTrackId] = useState<number | null>(null);
  const [recent, setRecent] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const [volume, setVolume] = useState(65), [mode, setMode] = useState<'list' | 'repeat' | 'shuffle' | 'stop-track' | 'stop-list'>('list');
  const [effect, setEffect] = useState('原声'), [equalizer, setEqualizer] = useState<number[]>(emptyBands), [analyser, setAnalyser] = useState<AnalyserNode | null>(null), [scopeAnalyser, setScopeAnalyser] = useState<AnalyserNode | null>(null);
  const [customEffects, setCustomEffects] = useState<SavedEffect[]>([]), [previewFilter, setPreviewFilter] = useState<CustomFilter | null>(null), [filterError, setFilterError] = useState<string | null>(null);
  const [frequencyResponse, setFrequencyResponse] = useState<FrequencyResponse | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), graph = useRef<Graph | null>(null);
  const pendingResume = useRef<PlaybackState | null>(null);
  const audioTrackId = useRef<number | null>(null);
  const appliedFilter = useRef('');
  const queueRef = useRef(queue), catalogRef = useRef<Track[]>([]), currentId = useRef(trackId), shouldPlay = useRef(false), nextRef = useRef<() => void>(() => {});
  currentId.current = trackId;
  const track = queue.find(t => t.id === trackId) ?? null;
  const updateQueue = (value: Track[]) => { queueRef.current = value; setQueue(value); };
  const setCatalog = (items: Track[], remappedIds: Record<string, number> = {}) => {
    catalogRef.current = items;
    const byId = new Map(items.map(item => [item.id, item]));
    const seen = new Set<number>();
    const next = queueRef.current.map(item => byId.get(remappedIds[item.id] ?? item.id) ?? (item.temporary ? item : null)).filter((item): item is Track => { if (!item || seen.has(item.id)) return false; seen.add(item.id); return true; });
    const selectedId = currentId.current === null ? null : remappedIds[currentId.current] ?? currentId.current;
    if (selectedId !== null && !next.some(item => item.id === selectedId)) {
      audio.current?.pause();
      shouldPlay.current = false;
      setTrackId(next[0]?.id ?? null);
    } else if (selectedId !== currentId.current) {
      currentId.current = selectedId;
      setTrackId(selectedId);
    }
    if (Object.keys(remappedIds).length) setRecent(previous => [...new Set(previous.map(id => remappedIds[id] ?? id))]);
    updateQueue(next);
  };
  const updateTrack = (track: Track) => updateQueue(queueRef.current.map(item => item.id === track.id ? track : item));
  const hydrate = (items: Track[], ids: number[], history: number[], settings: { volume: number; mode: typeof mode; effect: string; equalizer: number[]; customEffects?: SavedEffect[]; professionalAudio?: boolean; resumePlayback?: boolean }, playback?: PlaybackState) => {
    if (settings.resumePlayback !== false && playback?.trackId > 0) {
      const restored = items.find(item => item.id === playback.trackId && item.available !== false && item.playbackStatus !== 'unplayable');
      if (restored) {
        if (!ids.includes(restored.id)) ids = [...ids, restored.id];
        pendingResume.current = playback; currentId.current = restored.id; setTrackId(restored.id); setTime(playback.position);
      }
    }
    setProfessionalAudio(settings.professionalAudio ?? false);
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
    const coordinator = playbackCoordinator();
    const owner = { stop: () => { shouldPlay.current = false; element.pause(); setPlaying(false); } };
    musicOwner.current = owner;
    element.ontimeupdate = () => setTime(element.currentTime);
    element.onloadedmetadata = () => {
      if (pendingResume.current?.trackId === currentId.current) {
        const position = Math.max(0, Math.min(pendingResume.current.position, Number.isFinite(element.duration) ? element.duration : pendingResume.current.position));
        element.currentTime = position; setTime(position); pendingResume.current = null;
      }
      const id = currentId.current; if (id !== null && Number.isFinite(element.duration)) { const updated = queueRef.current.map(item => item.id === id ? { ...item, duration: element.duration } : item); updateQueue(updated); if (id > 0 && runtime.backend) void backend.duration(id, element.duration).catch(() => {}); } };
    element.oncanplay = () => { const id = currentId.current; if (id === null) return; const item = queueRef.current.find(track => track.id === id); if (item?.playbackStatus === 'playable') return; updateQueue(queueRef.current.map(track => track.id === id ? { ...track, playbackStatus: 'playable' } : track)); if (id > 0 && runtime.backend) void backend.playbackStatus(id, 'playable').then(() => window.dispatchEvent(new Event('lunanahida-library-changed'))).catch(() => {}); };
    element.onerror = () => {
      const id = currentId.current;
      if (id === null) return;
      const current = queueRef.current.find(track => track.id === id);
      if (current && isBrowserTrack(current)) {
        shouldPlay.current = false;
        setPlaying(false);
        if ([3, 4].includes(element.error?.code ?? 0)) {
          updateQueue(queueRef.current.map(track => track.id === id ? { ...track, playbackStatus: 'unplayable' } : track));
        }
        toast.error('当前浏览器无法播放这个音频文件');
        return;
      }
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
        if (id > 0 && runtime.backend) void backend.playbackStatus(id, 'unplayable').then(() => window.dispatchEvent(new Event('lunanahida-library-changed'))).catch(() => {});
      }).catch(() => {});
    };
    element.onended = () => { if (shouldPlay.current) nextRef.current(); };
    element.onplay = () => {
      if (!shouldPlay.current || !coordinator.owns(owner)) { element.pause(); return; }
      setPlaying(true);
      if (currentId.current !== null && currentId.current > 0 && runtime.backend) { const id = currentId.current; setRecent(prev => [id, ...prev.filter(item => item !== id)].slice(0, 50)); void backend.history(id).catch(() => {}); }
    };
    element.onpause = () => { if (!shouldPlay.current) coordinator.release(owner); setPlaying(false); };
    return () => { owner.stop(); coordinator.release(owner); musicOwner.current = null; element.removeAttribute('src'); element.load(); audio.current = null; void graph.current?.context.close(); graph.current = null; };
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

  useEffect(() => {
    if (!runtime.backend) return;
    const save = () => {
      const id = currentId.current;
      if (!id || id < 0 || queueRef.current.find(item => item.id === id)?.temporary || pendingResume.current || audioTrackId.current !== id || !audio.current?.readyState) return;
      void backend.savePlayback({ trackId: id, position: audio.current?.currentTime ?? 0 }).catch(() => {});
    };
    const interval = window.setInterval(save, 5000);
    const element = audio.current;
    element?.addEventListener('pause', save);
    element?.addEventListener('loadedmetadata', save);
    window.addEventListener('pagehide', save);
    return () => { window.clearInterval(interval); element?.removeEventListener('pause', save); element?.removeEventListener('loadedmetadata', save); window.removeEventListener('pagehide', save); };
  }, [runtime.backend]);
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
      const headroom = context.createGain();
      const protection = context.createDynamicsCompressor();
      protection.threshold.value = -1; protection.knee.value = 0; protection.ratio.value = 20;
      protection.attack.value = .003; protection.release.value = .08;
      source.connect(headroom); headroom.connect(bands[0]); bands[bands.length - 1].connect(frequencyInput);
      const frequencyLane = makeLane(frequencyInput, timeInput, null);
      const timeLane = makeLane(timeInput, analyser, null);
      analyser.connect(protection); protection.connect(context.destination); analyser.connect(scopeAnalyser);
      graph.current = { context, headroom, bands, response: null, timeLoad: 1, frequencyInput, timeInput, analyser, scopeAnalyser, frequencyLane, timeLane };
      setAnalyser(analyser); setScopeAnalyser(scopeAnalyser);
    }
    void graph.current?.context.resume();
  };
  useEffect(() => {
    const el = audio.current; if (!el) return;
    audioTrackId.current = null;
    el.pause(); el.removeAttribute('src'); el.load();
    if (trackId === null || !track) { setTime(0); return; }
    el.src = track.source; audioTrackId.current = trackId; setTime(pendingResume.current?.trackId === trackId ? pendingResume.current.position : 0);
    if (shouldPlay.current) void el.play().catch(() => setPlaying(false));
  }, [trackId]);
  useEffect(() => {
    browserTracks.current.retain(new Set([...queue.map(track => track.source), audio.current?.src ?? '']));
  }, [queue, trackId]);
  useEffect(() => {
    const pool = browserTracks.current;
    mounted.current = true;
    return () => { mounted.current = false; pool.dispose(); };
  }, []);
  useEffect(() => { if (audio.current) audio.current.volume = volume / 100; }, [volume]);
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    const remaining = filterReadyAt.current - performance.now();
    if (remaining > 0) {
      const timer = window.setTimeout(() => setFilterRevision(value => value + 1), remaining + 1);
      return () => window.clearTimeout(timer);
    }
    try {
      const definition = previewFilter ?? selectedEffect(effect, customEffects).filter;
      const { gainMin, gainMax, ...audioDefinition } = definition;
      const signature = `${professionalAudio}:${previewFilter ? 'preview' : effect}:${JSON.stringify(audioDefinition)}`;
      if (appliedFilter.current === signature) return;
      const { frequency, time, neutralFrequency } = validateFilter(definition, g.context.sampleRate, professionalGainLimit);
      const effectiveFrequency = (hz: number) => Math.max(professionalAudio ? -professionalGainLimit : -24, Math.min(professionalAudio ? professionalGainLimit : 24, frequency(hz)));
      const frequencyBuffer = neutralFrequency ? null : makeFrequencyImpulse(g.context, effectiveFrequency, definition.firSize, professionalGainLimit);
      const timeBuffer = makeTimeImpulse(g.context, time, definition.durationMs, definition.delays);
      const neutralTime = timeBuffer.getChannelData(0).every((tap, index) => index === 0 || tap === 0);
      const absoluteSum = (buffer: AudioBuffer | null) => buffer ? buffer.getChannelData(0).reduce((sum, tap) => sum + Math.abs(tap), 0) : 1;
      g.timeLoad = absoluteSum(neutralTime ? null : timeBuffer);
      g.response = frequencyBuffer ? calculateFIRResponse(frequencyBuffer) : null;
      const warmup = frequencyBuffer ? definition.firSize / (2 * g.context.sampleRate) + .02 : 0;
      setPreampDb(reserveHeadroom(g, equalizer, warmup + .12));
      const replace = (kind: 'frequencyLane' | 'timeLane', input: AudioNode, output: AudioNode, buffer: AudioBuffer | null) => {
        const previous = g[kind];
        const laneSignature = kind === 'timeLane' ? JSON.stringify([definition.time, definition.durationMs, definition.delays]) : signature;
        if (previous.signature === laneSignature) return;
        const start = g.context.currentTime + (kind === 'frequencyLane' ? warmup : 0);
        const node = buffer ? g.context.createConvolver() : null, gain = g.context.createGain();
        if (node && buffer) { node.normalize = false; node.buffer = buffer; }
        gain.gain.setValueAtTime(0, g.context.currentTime);
        gain.gain.setValueAtTime(0, start);
        if (node) { input.connect(node); node.connect(gain); } else input.connect(gain);
        gain.connect(output);
        gain.gain.linearRampToValueAtTime(1, start + .06);
        previous.gain.gain.cancelScheduledValues(g.context.currentTime);
        previous.gain.gain.setValueAtTime(previous.gain.gain.value, start);
        previous.gain.gain.linearRampToValueAtTime(0, start + .06);
        g[kind] = { node, gain, signature: laneSignature };
        window.setTimeout(() => { input.disconnect(previous.node ?? previous.gain); previous.node?.disconnect(); previous.gain.disconnect(); }, (start - g.context.currentTime + .1) * 1000);
      };
      replace('frequencyLane', g.frequencyInput, g.timeInput, frequencyBuffer);
      replace('timeLane', g.timeInput, g.analyser, neutralTime ? null : timeBuffer);
      setFrequencyResponse(g.response ?? { sampleRate: g.context.sampleRate, values: new Float32Array(definition.firSize / 2 + 1) });
      appliedFilter.current = signature;
      filterReadyAt.current = performance.now() + (warmup + .1) * 1000;
      setFilterError(null);
    } catch (error) { setFilterError(error instanceof Error ? error.message : '滤波器无法应用'); }
  }, [effect, customEffects, previewFilter, playing, professionalAudio, filterRevision]);
  useEffect(() => {
    const g = graph.current; if (!g) return;
    setPreampDb(reserveHeadroom(g, equalizer, Math.max(.12, (filterReadyAt.current - performance.now()) / 1000 + .04)));
    g.bands.forEach((band, index) => band.gain.setTargetAtTime(equalizer[index], g.context.currentTime, .04));
  }, [equalizer, playing]);

  const claimMusic = () => {
    noise.stop();
    if (musicOwner.current) playbackCoordinator().claim(musicOwner.current);
    shouldPlay.current = true;
    ensureGraph();
  };
  const select = (id: number) => {
    let list = queueRef.current;
    if (!list.some(item => item.id === id)) { const item = catalogRef.current.find(item => item.id === id); if (!item || item.available === false || item.playbackStatus === 'unplayable') return; list = [...list, item]; updateQueue(list); }
    if (list.find(item => item.id === id)?.available === false || list.find(item => item.id === id)?.playbackStatus === 'unplayable') return;
    pendingResume.current = null; claimMusic(); currentId.current = id;
    if (id === trackId) { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setPlaying(false)); } }
    else { audio.current?.pause(); setTrackId(id); }
  };
  const playTracks = (items: Track[], startId?: number) => {
    const playable = items.filter(item => item.available !== false && item.playbackStatus !== 'unplayable');
    if (!playable.length) return false;
    const target = playable.find(item => item.id === startId) ?? playable[0];
    pendingResume.current = null; claimMusic(); currentId.current = target.id;
    updateQueue(playable);
    if (target.id === trackId) {
      if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setPlaying(false)); }
    } else { audio.current?.pause(); setTrackId(target.id); }
    return true;
  };
  const next = () => { const list = queueRef.current.filter(item => item.available !== false && item.playbackStatus !== 'unplayable'); if (!list.length) return; const index = list.findIndex(item => item.id === trackId); const target = mode === 'shuffle' && list.length > 1 ? list[(index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length] : list[(index + 1) % list.length]; select(target.id); };
  nextRef.current = () => { const list = queueRef.current; const atEnd = list.findIndex(item => item.id === trackId) === list.length - 1; if (mode === 'stop-track' || (mode === 'stop-list' && atEnd)) { shouldPlay.current = false; setPlaying(false); if (audio.current) audio.current.currentTime = 0; setTime(0); } else if (mode === 'repeat' && trackId !== null) select(trackId); else next(); };
  const previous = () => { const list = queueRef.current.filter(item => item.available !== false && item.playbackStatus !== 'unplayable'); if (!list.length) return; const index = list.findIndex(item => item.id === trackId); select(list[(index - 1 + list.length) % list.length].id); };
  const toggle = () => { if (noise.active) { noise.toggle(); return; } if (!audio.current || !track) return; if (playing) { shouldPlay.current = false; audio.current.pause(); } else { claimMusic(); void audio.current.play().catch(() => setPlaying(false)); } };
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
  const clearQueue = () => { audio.current?.pause(); shouldPlay.current = false; setTrackId(null); setTime(0); updateQueue([]); if (runtime.backend) void backend.savePlayback({trackId:0,position:0}).catch(() => {}); };
  const removeTracks = (ids: number[]) => { const removed = new Set(ids); const remaining = queueRef.current.filter(item => !removed.has(item.id)); if (trackId !== null && removed.has(trackId)) { audio.current?.pause(); shouldPlay.current = false; setTrackId(remaining[0]?.id ?? null); } updateQueue(remaining); };
  const move = (from: number, to: number) => { const list = [...queueRef.current], start = list.findIndex(item => item.id === from), end = list.findIndex(item => item.id === to); if (start < 0 || end < 0 || start === end) return; list.splice(end, 0, list.splice(start, 1)[0]); updateQueue(list); };
  const markLyricsSaved = (saved: Track) => updateQueue(queueRef.current.map(item => item.id === saved.id ? { ...item, lyrics: saved.lyrics, translation: saved.translation, localLyrics: true, embeddedLyrics: false } : item));
  const addTracks = (items: Track[], replace = false) => { if (!items.length) return; if (replace) { audio.current?.pause(); shouldPlay.current = false; updateQueue(items); setTrackId(items[0].id); return; } const ids = new Set(queueRef.current.map(item => item.id)); const paths = new Set(queueRef.current.map(item => item.path).filter((path): path is string => Boolean(path))); const additions = items.filter(item => { if (ids.has(item.id) || (item.path && paths.has(item.path))) return false; ids.add(item.id); if (item.path) paths.add(item.path); return true; }); const empty = queueRef.current.length === 0; updateQueue([...queueRef.current, ...additions]); if (empty && additions.length) setTrackId(additions[0].id); };
  const addFiles = async (files: File[]) => {
    const result = await browserTracks.current.add(files);
    if (!mounted.current) { browserTracks.current.dispose(); return { tracks: [], rejected: [] }; }
    addTracks(result.tracks);
    return result;
  };
  return { professionalAudio, setProfessionalAudio, preampDb, track: track ?? emptyTrack, hasTrack: Boolean(track), trackId, queue, recent, playing, time, volume, setVolume, mode, setMode, effect, effectName: selectedEffect(effect, customEffects).name, setEffect, setPreviewFilter, customEffects, saveEffect, deleteEffect, filterError, frequencyResponse, equalizer, setBand, resetEqualizer, analyser, scopeAnalyser, select, playTracks, next, previous, toggle, seek, clearQueue, removeTracks, move, addTracks, addFiles, markLyricsSaved, setCatalog, updateTrack, hydrate, noise };
}
