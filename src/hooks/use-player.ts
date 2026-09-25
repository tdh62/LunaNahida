import { useEffect, useRef, useState } from 'react';
import { parseBlob } from 'music-metadata';
import { tracks, type Track } from '@/lib/music';

function renderDemo(id: number, duration: number) {
  const rate = 12000, length = duration * rate;
  const data = new ArrayBuffer(44 + length * 2), view = new DataView(data);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
  const notes = [0, 7, 12, 4, 9, 7, 4, 12, 0, 4, 7, 16, 12, 7, 9, 4], base = 130.81 * Math.pow(2, id / 12);
  for (let i = 0; i < length; i++) {
    const t = i / rate, phase = t % .6, freq = base * Math.pow(2, notes[Math.floor(t / .6) % notes.length] / 12);
    const melody = (Math.sin(t * freq * Math.PI * 2) + .2 * Math.sin(t * freq * Math.PI * 4)) * Math.exp(-phase * 4) * Math.min(1, phase * 100);
    const root = base * [1, .75, .89, .667][Math.floor(t / 9.6) % 4] / 2;
    const pad = (Math.sin(t * root * Math.PI * 2) + .4 * Math.sin(t * root * 3 * Math.PI)) * .3;
    view.setInt16(44 + i * 2, (melody * .2 + pad * .24) * Math.min(1, t / 2, (duration - t) / 3) * 32767, true);
  }
  return URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
}

const frequencies = [60, 230, 910, 3600, 12000];
const emptyBands = [0, 0, 0, 0, 0];
const emptyTrack: Track = { id: -1, title: '暂无歌曲', english: '', artist: '打开歌曲或文件夹', album: '本地音乐', duration: 0, cover: '/covers/local.svg', genre: '本地音频', year: '—', color: '#a5b5ff' };
const playable = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;
export const isAudioFile = (file: File) => playable.test(file.name);
type Graph = { context: AudioContext; filter: BiquadFilterNode; delay: DelayNode; wet: GainNode; bands: BiquadFilterNode[]; analyser: AnalyserNode };

let activePlayback: { element: HTMLAudioElement; stop: () => void } | null = null;

function releaseTrack(track: Track) {
  if (track.source) URL.revokeObjectURL(track.source);
  if (track.cover.startsWith('blob:')) URL.revokeObjectURL(track.cover);
}

async function loadFile(file: File, id: number): Promise<Track | null> {
  const source = URL.createObjectURL(file);
  const duration = await new Promise<number | null>(resolve => {
    const probe = new Audio();
    const done = (value: number | null) => {
      probe.onloadedmetadata = null; probe.onerror = null;
      probe.removeAttribute('src'); probe.load();
      resolve(value);
    };
    probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => done(null);
    probe.preload = 'metadata'; probe.src = source;
  });
  if (duration === null) { URL.revokeObjectURL(source); return null; }

  let title = file.name.replace(/\.[^.]+$/, '');
  let artist = '本地文件', album = '本地音乐', genre = '本地音频', year = '—', cover = '/covers/local.svg';
  let embeddedLyrics: string | undefined;
  let quality: Track['quality'];
  try {
    const { common, format } = await parseBlob(file, { duration: false });
    quality = { sampleRate: format.sampleRate, bitDepth: format.bitsPerSample, bitrate: format.bitrate, lossless: format.lossless, codec: format.codec };
    title = common.title?.trim() || title;
    artist = common.artist?.trim() || common.albumartist?.trim() || artist;
    album = common.album?.trim() || album;
    genre = common.genre?.find(value => value.trim())?.trim() || genre;
    year = common.year ? String(common.year) : year;
    const lyrics = common.lyrics?.find(item => item.text?.trim() || item.syncText?.length);
    if (lyrics) embeddedLyrics = lyrics.syncText?.length
      ? lyrics.syncText.map(line => `[${String(Math.floor((line.timestamp ?? 0) / 60000)).padStart(2, '0')}:${((line.timestamp ?? 0) % 60000 / 1000).toFixed(2).padStart(5, '0')}]${line.text}`).join('\n')
      : lyrics.text;
    const picture = common.picture?.find(item => /^image\/(jpeg|png|webp|gif)$/i.test(item.format));
    if (picture) cover = URL.createObjectURL(new Blob([new Uint8Array(picture.data)], { type: picture.format }));
  } catch {
    // Files without readable tags still remain playable.
  }
  return { id, title, english: 'LOCAL AUDIO', artist, album, duration, cover, lyrics: embeddedLyrics, genre, year, color: '#a5b5ff', source, fileName: file.name, quality };
}

export function usePlayer() {
  const [queue, setQueue] = useState<Track[]>(tracks), [trackId, setTrackId] = useState<number | null>(0);
  const [recent, setRecent] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const [volume, setVolume] = useState(65), [mode, setMode] = useState<'list' | 'repeat' | 'shuffle' | 'stop-track' | 'stop-list'>('list');
  const [effect, setEffect] = useState('原声'), [equalizer, setEqualizer] = useState<number[]>(emptyBands), [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), graph = useRef<Graph | null>(null);
  const demos = useRef(new Map<number, string>()), queueRef = useRef(queue), currentId = useRef(trackId), shouldPlay = useRef(false), nextRef = useRef<() => void>(() => {}), nextId = useRef(100);
  currentId.current = trackId;
  const track = queue.find(t => t.id === trackId) ?? null;
  const updateQueue = (value: Track[]) => { queueRef.current = value; setQueue(value); };

  useEffect(() => {
    const element = new Audio(); audio.current = element;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumatune-playback') : null;
    const stop = () => { shouldPlay.current = false; element.pause(); };
    channel?.addEventListener('message', event => { if (event.data === 'play') stop(); });
    element.ontimeupdate = () => setTime(element.currentTime); element.onended = () => nextRef.current();
    element.onplay = () => {
      if (activePlayback?.element !== element) activePlayback?.stop();
      activePlayback = { element, stop };
      channel?.postMessage('play');
      setPlaying(true);
      if (currentId.current !== null) setRecent(prev => [currentId.current!, ...prev.filter(id => id !== currentId.current)].slice(0, 50));
    };
    element.onpause = () => { if (activePlayback?.element === element) activePlayback = null; setPlaying(false); };
    return () => {
      stop(); channel?.close();
      if (activePlayback?.element === element) activePlayback = null;
      element.onplay = element.onpause = element.onended = element.ontimeupdate = null;
      element.removeAttribute('src'); element.load(); audio.current = null;
      demos.current.forEach(URL.revokeObjectURL); demos.current.clear(); queueRef.current.forEach(releaseTrack);
      void graph.current?.context.close(); graph.current = null;
    };
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
    const updateEnrichedCover = (event: Event) => {
      const { title, artist, value } = (event as CustomEvent<{ title: string; artist: string; value: { cover?: string } }>).detail;
      if (!value.cover) return;
      const normalize = (text: string) => text.trim().normalize('NFKC').toLowerCase();
      const updated = queueRef.current.map(item => normalize(item.title) === normalize(title) && normalize(item.artist) === normalize(artist) ? { ...item, cover: value.cover! } : item);
      if (updated.some((item, index) => item !== queueRef.current[index])) updateQueue(updated);
    };
    window.addEventListener('lumatune-music-refreshed', updateEnrichedCover);
    return () => window.removeEventListener('lumatune-music-refreshed', updateEnrichedCover);
  }, []);

  useEffect(() => {
    const el = audio.current; if (!el) return;
    el.pause(); el.removeAttribute('src'); el.load();
    if (trackId === null || !track) { setTime(0); return; }
    if (!track.source && !demos.current.has(track.id)) demos.current.set(track.id, renderDemo(track.id, track.duration));
    el.src = track.source ?? demos.current.get(track.id)!; setTime(0);
    if (shouldPlay.current) void el.play().catch(() => { if (el.paused) setPlaying(false); });
  }, [trackId]);
  useEffect(() => { if (audio.current) audio.current.volume = volume / 100; }, [volume]);
  useEffect(() => {
    const g = graph.current; if (!g) return;
    g.filter.type = effect === '温暖 Lo-fi' ? 'lowpass' : 'lowshelf'; g.filter.frequency.value = effect === '温暖 Lo-fi' ? 1100 : 280;
    g.filter.gain.value = effect === '低音增强' ? 10 : 0; g.wet.gain.value = effect === '空间回响' ? .45 : 0;
  }, [effect, playing]);
  useEffect(() => { graph.current?.bands.forEach((band, index) => { band.gain.setTargetAtTime(equalizer[index], graph.current!.context.currentTime, .04); }); }, [equalizer]);

  const select = (id: number) => {
    let list = queueRef.current;
    if (!list.some(t => t.id === id)) {
      const demo = tracks.find(t => t.id === id);
      if (!demo) return;
      list = [...list, demo]; updateQueue(list);
    }
    ensureGraph(); shouldPlay.current = true;
    currentId.current = id;
    if (id === trackId) { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => { if (audio.current?.paused) setPlaying(false); }); } }
    else { audio.current?.pause(); setTrackId(id); }
  };
  const next = () => {
    const list = queueRef.current; if (!list.length) return;
    const index = list.findIndex(t => t.id === trackId);
    const target = mode === 'shuffle' && list.length > 1 ? list[(index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length] : list[(index + 1) % list.length];
    select(target.id);
  };
  nextRef.current = () => {
    const list = queueRef.current;
    const atEnd = list.findIndex(t => t.id === trackId) === list.length - 1;
    if (mode === 'stop-track' || (mode === 'stop-list' && atEnd)) {
      shouldPlay.current = false;
      setPlaying(false);
      if (audio.current) audio.current.currentTime = 0;
      setTime(0);
    } else if (mode === 'repeat' && trackId !== null) select(trackId);
    else next();
  };
  const previous = () => { const list = queueRef.current; if (!list.length) return; const index = list.findIndex(t => t.id === trackId); select(list[(index - 1 + list.length) % list.length].id); };
  const toggle = () => { if (!audio.current || !track) return; ensureGraph(); if (playing) { audio.current.pause(); shouldPlay.current = false; } else { shouldPlay.current = true; void audio.current.play().catch(() => setPlaying(false)); } };
  const seek = (value: number) => { if (audio.current && track) audio.current.currentTime = value; setTime(value); };
  const setBand = (index: number, value: number) => setEqualizer(prev => prev.map((band, i) => i === index ? value : band));
  const resetEqualizer = () => setEqualizer([...emptyBands]);
  const clearQueue = () => {
    audio.current?.pause(); shouldPlay.current = false; setTrackId(null); setTime(0);
    const old = queueRef.current; updateQueue([]);
    old.forEach(releaseTrack);
  };
  const removeTracks = (ids: number[]) => {
    const removedIds = new Set(ids);
    const list = queueRef.current, removed = list.filter(t => removedIds.has(t.id));
    if (!removed.length) return;
    const remaining = list.filter(t => !removedIds.has(t.id));
    if (trackId !== null && removedIds.has(trackId)) {
      audio.current?.pause();
      const index = list.findIndex(t => t.id === trackId);
      const next = list.slice(index + 1).find(t => !removedIds.has(t.id)) ?? remaining[remaining.length - 1];
      if (next) setTrackId(next.id);
      else { shouldPlay.current = false; setTrackId(null); setTime(0); }
    }
    updateQueue(remaining);
    removed.forEach(releaseTrack);
  };
  const move = (from: number, to: number) => {
    const list = [...queueRef.current], start = list.findIndex(t => t.id === from), end = list.findIndex(t => t.id === to);
    if (start < 0 || end < 0 || start === end) return;
    list.splice(end, 0, list.splice(start, 1)[0]); updateQueue(list);
  };
  const addFiles = async (files: File[], replace = false, duplicates: 'append' | 'overwrite' | 'skip' = 'append') => {
    const audioFiles = files.filter(isAudioFile);
    const existingNames = new Set(queueRef.current.map(t => t.fileName?.toLowerCase()).filter((name): name is string => Boolean(name)));
    const chosen = duplicates === 'append' ? audioFiles : duplicates === 'skip'
      ? audioFiles.filter(file => { const name = file.name.toLowerCase(); if (existingNames.has(name)) return false; existingNames.add(name); return true; })
      : [...new Map(audioFiles.map(file => [file.name.toLowerCase(), file])).values()];
    const loaded: Track[] = [];
    for (let index = 0; index < chosen.length; index += 8) {
      const batch = await Promise.all(chosen.slice(index, index + 8).map(file => loadFile(file, nextId.current++)));
      loaded.push(...batch.filter((item): item is Track => item !== null));
    }
    if (!loaded.length) return 0;
    if (replace) {
      audio.current?.pause(); shouldPlay.current = false;
      const old = queueRef.current; updateQueue(loaded); setTrackId(loaded[0].id);
      old.forEach(releaseTrack);
    } else if (duplicates === 'overwrite') {
      const next = [...queueRef.current];
      let replacementId: number | null = null;
      for (const item of loaded) {
        const matches = next.filter(t => t.fileName?.toLowerCase() === item.fileName?.toLowerCase());
        if (!matches.length) { next.push(item); continue; }
        const position = next.indexOf(matches[0]);
        if (matches.some(t => t.id === trackId)) replacementId = item.id;
        matches.forEach(t => { next.splice(next.indexOf(t), 1); releaseTrack(t); });
        next.splice(position, 0, item);
      }
      const wasEmpty = queueRef.current.length === 0;
      updateQueue(next);
      if (replacementId !== null) setTrackId(replacementId);
      else if (wasEmpty) setTrackId(next[0].id);
    } else {
      const empty = queueRef.current.length === 0;
      updateQueue([...queueRef.current, ...loaded]);
      if (empty) setTrackId(loaded[0].id);
    }
    return loaded.length;
  };
  return { track: track ?? emptyTrack, hasTrack: Boolean(track), trackId, queue, recent, playing, time, volume, setVolume, mode, setMode, effect, setEffect, equalizer, setBand, resetEqualizer, analyser, select, next, previous, toggle, seek, clearQueue, removeTracks, move, addFiles };
}
