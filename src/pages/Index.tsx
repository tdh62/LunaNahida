import { type CSSProperties, type DragEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import LyricCalibration from '@/components/LyricCalibration';
import PlayerSettings from '@/components/PlayerSettings';
import ExpandedScope from '@/components/ExpandedScope';
import AudioProcessor from '@/components/AudioProcessor';
import Toolbox from '@/components/Toolbox';
import QueuePanel from '@/components/QueuePanel';
import LocateCurrentTrackButton from '@/components/LocateCurrentTrackButton';
import { locateCurrentTrack } from '@/lib/track-location';
import { scrollToCurrentLyric } from '@/lib/lyric-scroll';
import LibraryView from '@/components/LibraryView';
import TagsView from '@/components/TagsView';
import TrackTagEditor from '@/components/TrackTagEditor';
import PlaylistRuleEditor from '@/components/PlaylistRuleEditor';
import { queryTracks, validateTrackConditions } from '@/lib/track-query';
import PlaylistView from '@/components/PlaylistView';
import CatalogView from '@/components/CatalogView';
import TrackDetails from '@/components/TrackDetails';
import { useMusicEnrichment, refreshMusicInfo } from '@/hooks/use-music-enrichment';
import { artistKey, buildCatalog, normalizeName, type ArtistMapping } from '@/lib/catalog';
import { playlistCover, type PlaylistRules, type Playlist } from '@/lib/playlists';
import { backend, defaultScopeSettings, type ScopeSettings, type StoredSettings } from '@/lib/backend';
import { effectNames, frequencyResponseBounds, responseAt, type FrequencyResponse } from '@/lib/audio-filter';
import { useRuntime } from '@/hooks/use-runtime';
import { useMiniMode } from '@/hooks/use-mini-mode';
import { useSystemMedia } from '@/hooks/use-system-media';
import MiniPlayer, { MiniModeButton } from '@/components/MiniPlayer';
import PlaybackModeControl from '@/components/PlaybackModeControl';
import { isBrowserTrack } from '@/lib/browser-tracks';
import { toast } from 'sonner';
import '@/settings.css';
import '@/sleep-timer.css';
import { useWorkTimer } from '@/hooks/use-work-timer';
import TimerShortcut from '@/components/TimerShortcut';
import { AudioLines, Check, ChevronDown, ChevronsLeft, Disc3, X, FolderOpen, Globe2, Heart, ListMusic, Maximize2, Mic2, Minimize2, PanelLeftClose, PanelLeftOpen, Pause, PictureInPicture2, Play, Plus, Save, Settings2, SkipBack, SkipForward, SlidersHorizontal, Square, Tag, Timer, Volume2, VolumeX, Waves, Wrench } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMuteVolume } from '@/hooks/use-mute-volume';
import { usePlayer } from '@/hooks/use-player';
import { usePlaybackProbe } from '@/hooks/use-playback-probe';
import { formatTime, trackTags, type Track } from '@/lib/music';
import { hasTrackDrag, readTrackDrag } from '@/lib/track-drag';
import '@/player.css';
import '@/vinyl-playback.css';
import '@/quick-queue.css';
import '@/expanded-scope.css';
import '@/player-import.css';
import '@/library.css';
import '@/playlists.css';
import '@/catalog.css';
import '@/artist-mappings.css';
import '@/light-mode.css';
import '@/tags.css';
import '@/mini-player.css';

const eqNames = ['低音', '低中', '中音', '高中', '高音'];
function IconButton({ children, label, onClick, active = false, className = '' }: { children: ReactNode; label: string; onClick?: () => void; active?: boolean; className?: string }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`icon-button ${active ? 'is-active' : ''} ${className}`}>{children}</button>;
}
function Spectrum({ analyser, response, active }: { analyser: AnalyserNode | null; response: FrequencyResponse | null; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const bounds = frequencyResponseBounds(response);
    const element = canvas.current; if (!element) return;
    const context = element.getContext('2d'); if (!context) return;
    const data = new Uint8Array(analyser?.frequencyBinCount ?? 64);
    let frame = 0;
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) {
        const scale = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
        if (element.width !== pixelWidth || element.height !== pixelHeight) {
          element.width = pixelWidth; element.height = pixelHeight;
        }
        context.clearRect(0, 0, pixelWidth, pixelHeight);
        if (analyser && active) analyser.getByteFrequencyData(data);
        const bars = 34, gap = Math.min(5 * scale, pixelWidth / (bars * 3));
        const barWidth = (pixelWidth - gap * (bars - 1)) / bars;
        context.fillStyle = getComputedStyle(element).color;
        for (let i = 0; i < bars; i++) {
          const value = analyser && active ? data[Math.floor(i * data.length / bars)] / 255 : .1;
          const barHeight = Math.max(3 * scale, value * pixelHeight * .9);
          context.globalAlpha = .38 + value * .62;
          context.fillRect(i * (barWidth + gap), pixelHeight - barHeight, barWidth, barHeight);
        }
        context.globalAlpha = 1;
        if (analyser && active && response) {
          context.strokeStyle = '#eab17c'; context.lineWidth = Math.max(1.5, 1.5 * scale);
          context.beginPath();
          for (let x = 0; x <= pixelWidth; x += Math.max(1, Math.round(scale))) {
            const hz = x / pixelWidth * analyser.context.sampleRate / 2;
            const gain = responseAt(response, hz);
            const y = pixelHeight * (bounds.maximum - gain) / (bounds.maximum - bounds.minimum);
            if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          context.stroke();
        }
      }
      if (active) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(() => { if (!active) draw(); });
    observer.observe(element);
    draw();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [analyser, response, active]);
  return <canvas ref={canvas} className="spectrum-canvas" aria-label="实时频谱" />;
}
export default function Index() {
  const runtime = useRuntime();
  const mini = useMiniMode(runtime.mode === 'desktop');
  const p = usePlayer();
  const workTimer = useWorkTimer();
  const outputPlaying = p.playing || p.noise.playing;
  const outputVolume = p.noise.active ? p.noise.volume : p.volume;
  const setOutputVolume = p.noise.active ? p.noise.setVolume : p.setVolume;
  const toggleMute = useMuteVolume(p.volume, p.noise.volume, p.noise.active, setOutputVolume);
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const search = useLocation().search;
  const selectedTag = pathname === '/music' ? new URLSearchParams(search).get('tag') ?? '' : '';
  const isSettings = pathname === '/settings';
  const isPlaylists = pathname === '/playlists' || pathname.startsWith('/playlists/');
  const isArtists = pathname === '/artists' || pathname.startsWith('/artists/');
  const isAlbums = pathname === '/albums' || pathname.startsWith('/albums/');
  const isTags = pathname === '/tags';
  const catalogPath = pathname.split('/');
  const playlistId = pathname.startsWith('/playlists/') ? decodeURIComponent(pathname.slice('/playlists/'.length)) : null;
  const view = ({ '/music': '我的音乐', '/tags': '标签', '/liked': '我喜欢的', '/recent': '最近播放' } as Record<string, string>)[pathname] ?? '正在播放';
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [mappings, setMappings] = useState<ArtistMapping[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [storedSettings, setStoredSettings] = useState<StoredSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistRules, setPlaylistRules] = useState<PlaylistRules | null>(null);
  const [playlistQueueSnapshot, setPlaylistQueueSnapshot] = useState<{ ids: number[]; skipped: number } | null>(null);
  const [deletePlaylistId, setDeletePlaylistId] = useState<string | null>(null);
  const [deleteTrackIds, setDeleteTrackIds] = useState<number[]>([]);
  const [playlistNavExpanded, setPlaylistNavExpanded] = useState(false);
  const [recentPlaylistIds, setRecentPlaylistIds] = useState<string[]>([]);
  const [theme, setTheme] = useState('forest'), [lyricEffect, setLyricEffect] = useState('流动'), [lyricScroll, setLyricScroll] = useState('平滑'), [visual, setVisual] = useState('频谱');
  const [appearance, setAppearance] = useState<'dark' | 'light'>('light');
  const [lyricAppearance, setLyricAppearance] = useState({ font: 'default', size: 16, lineHeight: 57, spacing: 0 });
  const [scopeSettings, setScopeSettings] = useState<ScopeSettings>(defaultScopeSettings);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [effectEditorOpen, setEffectEditorOpen] = useState(false);
  const [liked, setLiked] = useState<number[]>([]);
  const [detailTrack, setDetailTrack] = useState<Track | null>(null), [focus, setFocus] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'expanded' | 'collapsed' | 'hidden'>('expanded');
  const [queueOpen, setQueueOpen] = useState(false);
  const [sleep, setSleep] = useState(0), [showTranslation, setShowTranslation] = useState(true);
  const [browsingLyrics, setBrowsingLyrics] = useState(false);
  const lyricsWindow = useRef<HTMLDivElement>(null);
  const immersiveLyricsWindow = useRef<HTMLDivElement>(null);
  const previousLyricsWindow = useRef<HTMLDivElement>(null);
  const previousImmersiveLyricsWindow = useRef<HTMLDivElement>(null);
  const lyricDrag = useRef<{ pointerId: number; y: number; scrollTop: number; moved: boolean } | null>(null);
  const suppressLyricClick = useRef(false);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const [trackDropTarget, setTrackDropTarget] = useState<string | null>(null);
  const [trackDragging, setTrackDragging] = useState(false);
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [networkURL, setNetworkURL] = useState('');
  const [networkLoading, setNetworkLoading] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [toolboxLaunchRequest, setToolboxLaunchRequest] = useState<{ tool: 'conversion' | 'timer' | null; revision: number }>({ tool: null, revision: 0 });
  const [toolboxPaths, setToolboxPaths] = useState<string[]>([]);
  const [toolboxAddToLibrary, setToolboxAddToLibrary] = useState(false);
  const [toolboxQueueOnConvert, setToolboxQueueOnConvert] = useState(false);
  const [toolboxAutoClose, setToolboxAutoClose] = useState(false);
  usePlaybackProbe(libraryTracks);
  const quickQueueRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const enter = () => {
      setFocus(false); setScopeOpen(false); setQueueOpen(false); setDetailTrack(null); setEffectEditorOpen(false);
      setToolboxOpen(false); setCreatePlaylistOpen(false); setDeletePlaylistId(null); setDeleteTrackIds([]); setPendingPaths([]); setNetworkOpen(false);
      void mini.change(true);
    };
    window.addEventListener('lunanahida:enter-mini-mode', enter);
    return () => window.removeEventListener('lunanahida:enter-mini-mode', enter);
  }, [mini.change]);
  useEffect(() => {
    if (!queueOpen || p.trackId === null) return;
    const list = document.querySelector<HTMLDivElement>('.quick-queue-list');
    const row = list?.querySelector<HTMLButtonElement>('.queue-track.current');
    if (!list || !row) return;
    row.focus({ preventScroll: true });
    const listBounds = list.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.top < listBounds.top) list.scrollTop -= listBounds.top - rowBounds.top;
    else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
  }, [queueOpen, p.trackId]);
  useEffect(() => {
    const state = runtime.initialState;
    setLibraryTracks(state.tracks); setCustomTags(state.tags); setPlaylists(state.playlists); setLiked(state.liked); setFolders(state.folders);
    setTheme(state.settings.theme); setAppearance(state.settings.appearance); setVisual(state.settings.visual);
    setScopeSettings(state.settings.scope ?? defaultScopeSettings);
    setLyricEffect(state.settings.lyricEffect); setLyricScroll(state.settings.lyricScroll);
    setShowTranslation(state.settings.showTranslation); setLyricAppearance(state.settings.lyricAppearance);
    setMappings(state.settings.artistMappings); setStoredSettings(state.settings);
    p.hydrate(state.tracks, state.queue, state.recent, state.settings, state.playback); setReady(true);
  }, []);
  useEffect(() => { if (ready) p.setCatalog(libraryTracks); }, [libraryTracks, ready]);
  useEffect(() => { if (ready && runtime.backend) void backend.playlists(playlists).catch(error => toast.error(error.message)); }, [playlists, ready, runtime.backend]);
  useEffect(() => { if (ready && runtime.backend) void backend.liked(liked).catch(error => toast.error(error.message)); }, [liked, ready, runtime.backend]);
  useEffect(() => { if (ready && runtime.backend) void backend.queue(p.queue.filter(track => !track.temporary).map(track => track.id)).catch(error => toast.error(error.message)); }, [p.queue.map(track => track.id).join(','), ready, runtime.backend]);
  useEffect(() => {
    if (!ready || !storedSettings || !runtime.backend) return;
    const next: StoredSettings = { ...storedSettings, theme, appearance, visual, scope: scopeSettings, lyricEffect, lyricScroll, showTranslation, lyricAppearance, artistMappings: mappings, volume: p.volume, mode: p.mode, effect: p.effect, professionalAudio: p.professionalAudio, equalizer: p.equalizer, customEffects: p.customEffects };
    const timer = window.setTimeout(() => void backend.settings(next).catch(error => toast.error(error.message)), 250);
    return () => window.clearTimeout(timer);
  }, [ready, storedSettings, theme, appearance, visual, scopeSettings, lyricEffect, lyricScroll, showTranslation, lyricAppearance, mappings, p.volume, p.mode, p.effect, p.professionalAudio, p.equalizer, p.customEffects, runtime.backend]);
  useEffect(() => {
    document.documentElement.classList.toggle('mode-light', appearance === 'light');
    document.documentElement.style.colorScheme = appearance;
    return () => { document.documentElement.classList.remove('mode-light'); document.documentElement.style.colorScheme = ''; };
  }, [appearance]);
  const reloadLibrary = async () => { if (!runtime.backend) return; const state = await backend.state(); setLibraryTracks(state.tracks); setCustomTags(state.tags); setFolders(state.folders); };
  const importPaths = async (paths: string[], mode: 'temporary' | 'library' | 'watch', options: { addToQueue?: boolean; skipConversion?: boolean; quietEmpty?: boolean } = {}) => {
    if (!paths.length) return;
    try {
      const imported = await backend.import(paths, mode, options.skipConversion);
      if (mode !== 'temporary') await reloadLibrary();
      if (imported.length === 0) { if (!options.quietEmpty) toast.info('没有找到可导入的音频文件'); return; }
      if (options.addToQueue !== false) p.addTracks(imported);
      toast.success(`已处理 ${imported.length} 首歌曲`);
    } catch (error) { void reloadLibrary().catch(() => {}); toast.error(error instanceof Error ? error.message : '导入失败'); }
  };
  const handlePaths = async (paths: string[], dropped = false) => {
    if (!paths.length) return;
    let encrypted: string[] = [];
    if (dropped || !storedSettings?.autoConvert) {
      try {
        encrypted = (await backend.inspectConversion(paths)).paths;
      } catch (error) { toast.error(error instanceof Error ? error.message : '无法检查文件格式'); return; }
    }
    if (dropped) {
      await importPaths(paths, 'library', { addToQueue: pathname === '/', skipConversion: true, quietEmpty: encrypted.length > 0 });
      if (encrypted.length) {
        setToolboxPaths(previous => [...new Set([...previous, ...encrypted])]);
        setToolboxAddToLibrary(true);
        setToolboxQueueOnConvert(pathname === '/');
        setToolboxAutoClose(true);
        setToolboxLaunchRequest(previous => ({ tool: 'conversion', revision: previous.revision + 1 }));
        setToolboxOpen(true);
      }
      return;
    }
    if (encrypted.length) {
      setToolboxPaths(previous => [...new Set([...previous, ...encrypted])]);
      setToolboxAddToLibrary(false);
      setToolboxQueueOnConvert(false);
      setToolboxAutoClose(false);
      setToolboxLaunchRequest(previous => ({ tool: 'conversion', revision: previous.revision + 1 }));
      setToolboxOpen(true);
      const encryptedSet = new Set(encrypted);
      paths = paths.filter(path => !encryptedSet.has(path));
    }
    if (!paths.length) return;
    if (storedSettings?.dropAction === 'ask' || !storedSettings) setPendingPaths(paths);
    else void importPaths(paths, storedSettings.dropAction);
  };
  const openBrowserFiles = async (files: File[]) => {
    try {
      const result = await p.addFiles(files);
      if (result.tracks.length) { p.select(result.tracks[0].id); navigate('/'); }
      if (result.rejected.length) toast.warning(`${result.rejected.length} 个文件无法临时播放`, { description: '加密音频请使用桌面版格式还原。' });
    } catch (error) { toast.error(error instanceof Error ? error.message : '文件打开失败'); }
  };
  const chooseFiles = () => {
    if (!runtime.nativeFiles) { fileInput.current?.click(); return; }
    void backend.chooseFiles().then(result => handlePaths(result.paths)).catch(error => toast.error(error.message));
  };
  const chooseFolder = () => { if (runtime.nativeFolders) void backend.chooseFolder().then(result => handlePaths(result.paths.filter(Boolean))).catch(error => toast.error(error.message)); };
  const openNetworkSong = async () => {
    if (!networkURL.trim() || networkLoading) return;
    setNetworkLoading(true);
    try {
      const track = await backend.importNetwork(networkURL.trim());
      await reloadLibrary();
      p.addTracks([track]);
      p.select(track.id);
      setNetworkOpen(false);
      setNetworkURL('');
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法打开网络歌曲');
    } finally {
      setNetworkLoading(false);
    }
  };
  useEffect(() => {
    if (runtime.mode !== 'desktop') return;
    let disposed = false;
    let cleanups: (() => void)[] = [];
    void import('@wailsio/runtime').then(({ Events }) => {
      if (disposed) return;
      cleanups = [
        Events.On('lunanahida:files-dropped', event => {
          dragDepth.current = 0; setDropActive(false);
          const paths = event.data as string[];
          if (mini.active) { void mini.change(false).then(restored => { if (restored) void handlePaths(paths, true); }); }
          else if (toolboxOpen) window.dispatchEvent(new CustomEvent('lunanahida-toolbox-drop', { detail: paths }));
          else void handlePaths(paths, true);
        }),
        Events.On('lunanahida:scan-complete', () => void reloadLibrary().catch(() => {})),
      ];
    }).catch(error => toast.error(error.message));
    return () => { disposed = true; cleanups.forEach(off => off()); };
  }, [storedSettings, toolboxOpen, pathname, runtime.mode, mini.active]);
  useEffect(() => {
    if (!runtime.backend) return;
    const settingsChanged = (event: Event) => setStoredSettings((event as CustomEvent<StoredSettings>).detail);
    const libraryChanged = () => void reloadLibrary().catch(error => toast.error(error.message, { id: 'library-unavailable' }));
    const backupImported = () => void backend.state().then(state => {
      setLibraryTracks(state.tracks); setCustomTags(state.tags); setPlaylists(state.playlists); setLiked(state.liked); setFolders(state.folders);
      p.addTracks(state.queue.map(id => state.tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track)));
    }).catch(error => toast.error(error instanceof Error ? error.message : '刷新音乐库失败'));
    window.addEventListener('lunanahida-settings-updated', settingsChanged);
    window.addEventListener('lunanahida-library-changed', libraryChanged);
    window.addEventListener('lunanahida-backup-imported', backupImported);
    return () => { window.removeEventListener('lunanahida-settings-updated', settingsChanged); window.removeEventListener('lunanahida-library-changed', libraryChanged); window.removeEventListener('lunanahida-backup-imported', backupImported); };
  }, []);
  const dropFiles = (event: DragEvent) => {
    event.preventDefault(); dragDepth.current = 0; setDropActive(false);
    if (runtime.mode === 'desktop' || !event.dataTransfer.types.includes('Files')) return;
    const directory = [...event.dataTransfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory);
    if (directory) toast.info('浏览器暂不支持拖入文件夹，请选择音乐文件');
    const files = [...event.dataTransfer.files];
    if (files.length) void openBrowserFiles(files);
  };
  const refreshInfo = (track: Track) => {
    if (!runtime.backend) return;
    if (track.embeddedCover && (track.embeddedLyrics || track.localLyrics)) { toast.info('已使用本地封面和歌词'); return; }
    toast.promise(refreshMusicInfo(track), {
      loading: `正在刷新《${track.title}》的信息`,
      success: result => result.cover && result.lyric ? '封面和歌词已更新' : result.cover ? '封面已更新，未找到歌词' : '歌词已更新，未找到封面',
      error: error => error instanceof Error ? error.message : '刷新失败',
    });
  };
  const saveLyrics = (track: Track) => {
    if (!runtime.backend || isBrowserTrack(track)) return;
    toast.promise(backend.saveLyrics(track).then(async saved => {
      p.markLyricsSaved(saved);
      if (saved.id > 0) await reloadLibrary();
      return saved;
    }), {
      loading: `正在保存《${track.title}》的歌词`,
      success: '歌词已保存到歌曲所在文件夹',
      error: error => error instanceof Error ? error.message : '歌词保存失败',
    });
  };
  const enrichment = useMusicEnrichment(p.track, p.playing);
  const lyricOffset = p.track.lyricOffsetMs ?? 0;
  const calibrateLyrics = async (offset: number) => {
    const updated = {...p.track, lyricOffsetMs: offset};
    try {
      if (runtime.backend && updated.id > 0 && !updated.temporary) await backend.lyricOffset(updated.id, offset);
      p.updateTrack(updated); setLibraryTracks(items => items.map(item => item.id === updated.id ? {...item, lyricOffsetMs: offset} : item));
    } catch (error) { toast.error(error instanceof Error ? error.message : '歌词校准保存失败'); }
  };
  const timedLines = enrichment.lines.map(line => ({...line, time: line.time + lyricOffset / 1000}));
  const lines = timedLines.map(line => line.text);
  const translations = timedLines.map(line => line.translation ?? '');
  const wordLines = lines.map(() => [] as { text: string; start: number; end: number }[]);
  const hasLyrics = lines.length > 0;
  const lineLength = hasLyrics ? p.track.duration / (lines.length + 1) || 1 : 1;
  const activeLine = hasLyrics ? enrichment.lines.every(line => line.time === 0) ? 0 : Math.max(0, timedLines.reduce((index, line, i) => p.time >= line.time ? i : index, 0)) : 0;
  const activeWord = hasLyrics && wordLines[activeLine]?.length ? wordLines[activeLine].findIndex((word, i) => p.time >= word.start && (p.time < word.end || i === wordLines[activeLine].length - 1)) : -1;
  const cover = enrichment.cover;
  useSystemMedia({ desktop: runtime.mode === 'desktop', available: p.hasTrack || p.noise.active, playing: outputPlaying,
    title: p.noise.active ? p.noise.name : p.track.title, artist: p.noise.active ? '后台噪音' : p.track.artist,
    album: p.noise.active ? '' : p.track.album, cover: p.noise.active ? '/covers/local.svg' : cover,
    duration: p.track.duration, position: p.time, noise: p.noise.active, toggle: p.toggle, previous: p.previous, next: p.next, seek: p.seek });
  const openScope = () => { if (!p.hasTrack) return; setFocus(false); setScopeOpen(true); };
  useEffect(() => { if (pathname !== '/') setScopeOpen(false); }, [pathname]);
  useEffect(() => { if (!p.hasTrack) setScopeOpen(false); }, [p.hasTrack]);
  const pauseLyricFollow = () => {
    setBrowsingLyrics(true);
    if (followTimer.current) clearTimeout(followTimer.current);
    followTimer.current = setTimeout(() => setBrowsingLyrics(false), 5000);
  };
  useEffect(() => {
    setBrowsingLyrics(false);
    if (followTimer.current) clearTimeout(followTimer.current);
  }, [p.trackId]);
  useEffect(() => () => { if (followTimer.current) clearTimeout(followTimer.current); }, []);
  useLayoutEffect(() => {
    const windowElement = lyricsWindow.current;
    const entering = windowElement !== previousLyricsWindow.current;
    previousLyricsWindow.current = windowElement;
    if (!windowElement || (browsingLyrics && !entering)) return;
    if (entering) {
      if (followTimer.current) clearTimeout(followTimer.current);
      setBrowsingLyrics(false);
      lyricDrag.current = null;
    }
    const line = windowElement.querySelectorAll<HTMLButtonElement>('.lyric-line')[activeLine];
    scrollToCurrentLyric(windowElement, line, entering || lyricScroll === '即时' ? 'instant' : 'smooth');
  }, [activeLine, browsingLyrics, lyricScroll, p.trackId, pathname, scopeOpen, focus, hasLyrics, lyricAppearance]);
  useLayoutEffect(() => {
    const windowElement = immersiveLyricsWindow.current;
    const entering = windowElement !== previousImmersiveLyricsWindow.current;
    previousImmersiveLyricsWindow.current = windowElement;
    if (!focus || !hasLyrics || !windowElement) return;
    const line = windowElement.querySelectorAll<HTMLParagraphElement>('p')[activeLine];
    scrollToCurrentLyric(windowElement, line, entering || lyricScroll === '即时' ? 'instant' : 'smooth');
  }, [focus, hasLyrics, activeLine, lyricScroll, p.trackId, pathname, lyricAppearance]);
  const onLyricWheel = () => pauseLyricFollow();
  const onLyricPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') { pauseLyricFollow(); return; }
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    lyricDrag.current = { pointerId: event.pointerId, y: event.clientY, scrollTop: event.currentTarget.scrollTop, moved: false };
  };
  const onLyricPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') { pauseLyricFollow(); return; }
    const drag = lyricDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientY - drag.y) > 5) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (drag.moved) {
      event.currentTarget.scrollTop = drag.scrollTop + drag.y - event.clientY;
      pauseLyricFollow();
    }
  };
  const onLyricPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (lyricDrag.current?.pointerId !== event.pointerId) return;
    if (lyricDrag.current.moved) {
      suppressLyricClick.current = true;
      window.setTimeout(() => { suppressLyricClick.current = false; }, 0);
    }
    lyricDrag.current = null;
  };
  const favorite = liked.includes(p.trackId ?? -1);
  const toggleTrackLike = (id: number) => { if (runtime.backend && libraryTracks.some(track => track.id === id && !track.temporary)) setLiked(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]); };
  const toggleLike = () => { if (p.trackId !== null) toggleTrackLike(p.trackId); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const mediaKey = ['MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious'].includes(event.key);
      if (!mediaKey && target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="slider"], .work-timer-trigger')) return;
      const handled = () => { event.preventDefault(); event.stopPropagation(); };

      if (event.key === 'Escape') {
        if (mini.active) { handled(); void mini.change(false); }
        else if (scopeOpen) { handled(); setScopeOpen(false); }
        else if (focus) { handled(); setFocus(false); }
        return;
      }
      if (event.key.toLowerCase() === 'o' && !mini.active && pathname === '/' && p.hasTrack) {
        handled(); setFocus(false); setScopeOpen(value => !value); return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        handled();
        setOutputVolume(Math.max(0, Math.min(100, outputVolume + (event.key === 'ArrowUp' ? 5 : -5))));
        return;
      }
      if (event.key.toLowerCase() === 'm') {
        handled(); toggleMute(); return;
      }
      if (!p.hasTrack && !p.noise.active) return;
      switch (event.key) {
        case ' ': case 'k': case 'K': case 'MediaPlayPause':
          handled(); if (!event.repeat) p.toggle(); break;
        case 'ArrowRight': case 'l': case 'L':
          handled(); if (!p.noise.active) p.seek(Math.min(p.time + (event.key === 'ArrowRight' ? 5 : 10), p.track.duration)); break;
        case 'ArrowLeft': case 'j': case 'J':
          handled(); if (!p.noise.active) p.seek(Math.max(p.time - (event.key === 'ArrowLeft' ? 5 : 10), 0)); break;
        case 'Home': handled(); if (!p.noise.active) p.seek(0); break;
        case 'End': handled(); if (!p.noise.active) p.seek(p.track.duration); break;
        case 'n': case 'N': case 'MediaTrackNext':
          handled(); if (!event.repeat) p.next(); break;
        case 'p': case 'P': case 'MediaTrackPrevious':
          handled(); if (!event.repeat) p.previous(); break;
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [p, focus, scopeOpen, pathname, mini.active]);
  useEffect(() => { if (!sleep) return; const timer = window.setInterval(() => setSleep(v => Math.max(0, v - 1)), 1000); return () => window.clearInterval(timer); }, [sleep > 0]);
  useEffect(() => { if (sleep === 1 && outputPlaying) p.toggle(); }, [sleep]);
  const allTracks = libraryTracks;
  const catalog = useMemo(() => buildCatalog(allTracks, mappings), [allTracks, mappings]);
  const selectedArtist = isArtists && catalogPath[2] ? catalog.artists.find(item => item.key === decodeURIComponent(catalogPath[2])) : undefined;
  const selectedAlbum = isAlbums && catalogPath[2] && catalogPath[3] ? catalog.albums.find(item => item.artistKey === decodeURIComponent(catalogPath[2]) && item.key === decodeURIComponent(catalogPath[3])) : undefined;
  const openArtist = (name: string) => { if (!runtime.backend) return; setDetailTrack(null); navigate(`/artists/${encodeURIComponent(artistKey(name, mappings))}`); };
  const openAlbum = (track: Track) => { if (!runtime.backend) return; setDetailTrack(null); navigate(`/albums/${encodeURIComponent(artistKey(track.artist, mappings))}/${encodeURIComponent(normalizeName(track.album))}`); };
  const visibleTracks = view === '我喜欢的' ? allTracks.filter(t => liked.includes(t.id)) : view === '最近播放' ? p.recent.map(id => allTracks.find(t => t.id === id)).filter((t): t is Track => Boolean(t)) : allTracks;
  const shuffleLibrary = (items: Track[] = allTracks) => {
    const playable = items.filter(track => track.available !== false && track.playbackStatus !== 'unplayable');
    if (!playable.length) return;
    const first = playable[Math.floor(Math.random() * playable.length)];
    if (p.playTracks(playable, first.id)) { p.setMode('shuffle'); navigate('/'); }
  };
  const allTagNames = [...new Map([...customTags, ...allTracks.flatMap(track => track.embeddedTags ?? [])].map(name => [name.toLocaleLowerCase(), name])).values()].sort((a, b) => a.localeCompare(b));
  const openTag = (name: string) => { if (runtime.backend) navigate(`/music?tag=${encodeURIComponent(name)}`); };
  const createTag = async (name: string) => {
    try { await backend.createTag(name); await reloadLibrary(); toast.success('标签已创建'); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : '创建标签失败'); return false; }
  };
  const renameTag = async (oldName: string, newName: string) => {
    try { await backend.renameTag(oldName, newName); await reloadLibrary(); toast.success('标签已重命名'); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : '重命名失败'); return false; }
  };
  const deleteTag = async (name: string) => {
    try { await backend.deleteTag(name); await reloadLibrary(); toast.success('标签已删除'); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : '删除标签失败'); return false; }
  };
  const setTrackTag = async (ids: number[], name: string, add: boolean) => {
    try {
      await backend.changeTrackTag(ids, name, add);
      await reloadLibrary();
      toast.success(add ? '已添加标签' : '已移除标签');
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : '更新标签失败'); void reloadLibrary().catch(() => {}); return false; }
  };
  const createTrackTag = async (id: number, name: string) => {
    try {
      await backend.createTag(name);
      await backend.changeTrackTag([id], name, true);
      await reloadLibrary();
      toast.success('已创建并添加标签');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建标签失败');
      void reloadLibrary().catch(() => {});
      return false;
    }
  };
  const displayPlaylists = useMemo(() => playlists.map(item => {
    const resolved = item.rules ? {...item, trackIds: queryTracks(allTracks,item.rules.conditions,liked,item.rules.sort,item.rules.descending).map(track=>track.id)} : item;
    return {...resolved,cover:playlistCover(resolved,allTracks)};
  }), [playlists, allTracks, liked]);
  const activePlaylist = displayPlaylists.find(item => item.id === playlistId);
  const recentPlaylists = [...recentPlaylistIds.map(id => displayPlaylists.find(item => item.id === id)).filter((item): item is Playlist => Boolean(item)), ...displayPlaylists.filter(item => !recentPlaylistIds.includes(item.id))];
  const sidebarPlaylists = recentPlaylists.slice(0, trackDragging ? recentPlaylists.length : playlistNavExpanded ? 10 : 2);
  const overviewPlaylists = [...displayPlaylists].sort((a, b) => a.id === (playlistId ?? recentPlaylistIds[0]) ? -1 : b.id === (playlistId ?? recentPlaylistIds[0]) ? 1 : 0);
  const openPlaylist = (id: string) => {
    setRecentPlaylistIds(previous => [id, ...previous.filter(item => item !== id)]);
    navigate(`/playlists/${id}`);
  };
  const createPlaylist = () => {
    const name = playlistName.trim();
    if (!name) return;
    try { if(playlistRules) validateTrackConditions(playlistRules.conditions); } catch(error) {toast.error(error instanceof Error ? error.message : '歌单条件无效'); return;}
    const id = crypto.randomUUID();
    setPlaylists(prev => [...prev, { id, name, description: playlistRules ? '按条件自动收录' : '我的歌单', rules: playlistRules ?? undefined, trackIds: playlistQueueSnapshot?.ids ?? [], cover: '', coverMode: 'first-track' }]);
    setPlaylistName(''); setPlaylistRules(null); setPlaylistQueueSnapshot(null); setCreatePlaylistOpen(false);
    navigate(`/playlists/${id}`);
    toast.success(playlistQueueSnapshot ? '播放队列已保存为歌单' : '歌单已创建');
  };
  const saveQueueAsPlaylist = () => {
    const ids = [...new Set(p.queue.filter(track => track.id > 0 && !track.temporary).map(track => track.id))];
    if (!ids.length) { toast.info('播放队列中没有可保存的音乐库歌曲'); return; }
    setPlaylistQueueSnapshot({ ids, skipped: p.queue.filter(track => track.id <= 0 || track.temporary).length });
    setQueueOpen(false);
    setCreatePlaylistOpen(true);
  };
  const addToPlaylist = (id: string, ids: number[]) => {
    const playlist = playlists.find(item => item.id === id);
    if (!playlist) return;
    if (playlist.rules) { toast.info('条件歌单自动收录歌曲，请编辑条件'); return; }
    const additions = [...new Set(ids)].filter(trackId => libraryTracks.some(track => track.id === trackId) && !playlist.trackIds.includes(trackId));
    if (!additions.length) { toast.info(ids.some(trackId => libraryTracks.some(track => track.id === trackId)) ? '歌曲已在歌单中' : '临时歌曲不能添加到歌单'); return; }
    setPlaylists(prev => prev.map(item => item.id === id ? { ...item, trackIds: [...item.trackIds, ...additions] } : item));
    toast.success(`已添加 ${additions.length} 首到「${playlist.name}」`);
  };
  const draggedLibraryIds = (event: DragEvent) => readTrackDrag(event.dataTransfer).filter(id => libraryTracks.some(track => track.id === id));
  const onTrackDragOver = (event: DragEvent, target: string) => {
    if (!hasTrackDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
    setTrackDropTarget(target);
  };
  const onDropToLiked = (event: DragEvent) => {
    if (!hasTrackDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); setTrackDropTarget(null);
    const ids = draggedLibraryIds(event).filter(id => !liked.includes(id));
    if (!ids.length) { toast.info('没有可添加的歌曲'); return; }
    setLiked(prev => [...new Set([...prev, ...ids])]);
    toast.success(`已添加 ${ids.length} 首到我喜欢的`);
  };
  const onDropToPlaylist = (event: DragEvent, id: string) => {
    if (!hasTrackDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); setTrackDropTarget(null);
    const ids = draggedLibraryIds(event);
    if (!ids.length) { toast.info('临时歌曲不能添加到歌单'); return; }
    addToPlaylist(id, ids);
  };
  const addToQueue = (ids: number[]) => {
    const queued = new Set(p.queue.map(track => track.id));
    const queuedPaths = new Set(p.queue.map(track => track.path).filter((path): path is string => Boolean(path)));
    const additions: Track[] = [];
    for (const id of ids) {
      const track = libraryTracks.find(item => item.id === id);
      if (!track || queued.has(id) || (track.path && queuedPaths.has(track.path)) || track.available === false || track.playbackStatus === 'unplayable') continue;
      additions.push(track); queued.add(id);
      if (track.path) queuedPaths.add(track.path);
    }
    if (!additions.length) { toast.info('没有可添加的歌曲'); return; }
    p.addTracks(additions);
    toast.success(`已添加 ${additions.length} 首到播放队列`);
  };
  const onDropToQueue = (event: DragEvent) => {
    if (!hasTrackDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); setTrackDropTarget(null);
    addToQueue(readTrackDrag(event.dataTransfer));
  };
  const removeFromPlaylist = (id: string, ids: number[]) => {
    if (playlists.find(item=>item.id===id)?.rules) {toast.info('请修改歌单条件以调整收录歌曲');return;}
    setPlaylists(prev => prev.map(item => item.id === id ? { ...item, trackIds: item.trackIds.filter(trackId => !ids.includes(trackId)) } : item));
    toast.success('已从歌单移除');
  };
  const deletePlaylist = () => {
    if (!deletePlaylistId) return;
    setPlaylists(prev => prev.filter(item => item.id !== deletePlaylistId));
    setDeletePlaylistId(null);
    navigate('/playlists');
    toast.success('歌单已删除');
  };
  const deleteTracks = async () => {
    const ids = deleteTrackIds;
    if (!ids.length) return;
    try {
      await backend.deleteTracks(ids);
      p.removeTracks(ids);
      setLiked(prev => prev.filter(id => !ids.includes(id)));
      setPlaylists(prev => prev.map(item => ({ ...item, trackIds: item.trackIds.filter(id => !ids.includes(id)) })));
      await reloadLibrary();
      setDeleteTrackIds([]);
      toast.success(`已从曲库移除 ${ids.length} 首歌曲`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '移除歌曲失败'); }
  };
  if (!runtime.backend && pathname !== '/' && !isSettings) return <Navigate to="/" replace />;
  return <div ref={appRef} data-file-drop-target className={`music-app theme-${theme} mode-${appearance} ${mini.active ? 'is-mini' : ''} ${focus ? 'focus-mode' : ''} sidebar-${sidebarMode} ${trackDragging ? 'is-track-dragging' : ''}`} onDragStart={event => { if (hasTrackDrag(event.dataTransfer)) setTrackDragging(true); }} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDropActive(true); } }} onDragLeave={event => { if (event.dataTransfer.types.includes('Files') && --dragDepth.current <= 0) { dragDepth.current = 0; setDropActive(false); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragEndCapture={() => { setTrackDropTarget(null); setTrackDragging(false); }} onDrop={event => { setTrackDropTarget(null); setTrackDragging(false); void dropFiles(event); }}>
    {mini.active && <MiniPlayer title={p.noise.active ? p.noise.name : p.track.title} artist={p.noise.active ? `后台噪音 · ${p.noise.playing ? '播放中' : '已暂停'}` : p.track.artist} cover={p.noise.active ? '/covers/local.svg' : cover} playing={outputPlaying} available={p.hasTrack || p.noise.active} noise={p.noise.active} favorite={favorite} canLike={!p.noise.active && p.hasTrack && runtime.backend && libraryTracks.some(track => track.id === p.trackId && !track.temporary)} onToggleLike={toggleLike} time={p.time} duration={p.track.duration} volume={outputVolume} busy={mini.busy} pinned={mini.pinned} onRestore={() => void mini.change(false)} onPin={() => void mini.pin()} onMinimise={mini.minimise} onClose={mini.close} onToggle={p.toggle} onPrevious={p.previous} onNext={p.next} onSeek={p.seek} onVolume={setOutputVolume} onMute={toggleMute} onStopNoise={p.noise.stop} />}
    <input ref={fileInput} type="file" multiple accept="audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.aiff,.aif,.wma,.webm" hidden onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void openBrowserFiles(files); }} />
    <aside className="sidebar flex flex-col">
      <div className="nav-label">音乐库</div><nav className="library-nav">{[{ title: '正在播放', path: '/', icon: AudioLines }, { title: '我的音乐', path: '/music', icon: Disc3 }, { title: '标签', path: '/tags', icon: Tag }, { title: '歌手', path: '/artists', icon: Mic2 }, { title: '专辑', path: '/albums', icon: Disc3 }, { title: '我喜欢的', path: '/liked', icon: Heart }, { title: '最近播放', path: '/recent', icon: ListMusic }].map(({ title, path, icon: Icon }) => <button key={title} title={!runtime.backend && path !== '/' ? '需要连接音乐库服务' : title} disabled={!runtime.backend && path !== '/'} onClick={() => navigate(path)} onDragOver={title === '我喜欢的' || title === '正在播放' ? event => onTrackDragOver(event, title === '我喜欢的' ? 'liked' : 'queue') : undefined} onDragLeave={title === '我喜欢的' || title === '正在播放' ? () => setTrackDropTarget(null) : undefined} onDrop={title === '我喜欢的' ? onDropToLiked : title === '正在播放' ? onDropToQueue : undefined} className={`nav-item ${path === '/artists' || path === '/albums' ? 'nav-item-paired' : ''} ${!isSettings && (pathname === path || (path === '/artists' && isArtists) || (path === '/albums' && isAlbums)) ? 'selected' : ''} ${trackDropTarget === (title === '我喜欢的' ? 'liked' : title === '正在播放' ? 'queue' : '') ? 'track-drop-target' : ''}`}><Icon size={18} />{title}{title === '正在播放' && p.playing && <span className="tiny-bars" aria-hidden="true"><i /><i /><i /></span>}{title === '我喜欢的' && <small>{liked.length}</small>}</button>)}</nav>
      <Link to="/settings" title="播放器设置" className={`nav-item settings-nav ${isSettings ? 'selected' : ''}`}><Settings2 size={18} />播放器设置</Link>
      <div className="playlist-nav-heading"><button type="button" disabled={!runtime.backend} onClick={() => navigate('/playlists')} className="nav-label" title="查看全部歌单">歌单</button><button type="button" className="playlist-nav-add" disabled={!runtime.backend} title={runtime.backend ? '新建歌单' : '需要连接音乐库服务'} aria-label="新建歌单" onClick={() => setCreatePlaylistOpen(true)}><Plus size={16} /></button></div>
      <nav className="playlist-nav"><button type="button" title={runtime.backend ? '我的歌单' : '需要连接音乐库服务'} disabled={!runtime.backend} className={`nav-item ${pathname === '/playlists' ? 'selected' : ''}`} onClick={() => navigate('/playlists')}><ListMusic size={18} />我的歌单<small>{playlists.length}</small></button>{sidebarPlaylists.map(item => <button type="button" key={item.id} title={item.name} className={`nav-item playlist-nav-entry ${playlistId === item.id ? 'selected' : ''} ${trackDropTarget === item.id ? 'track-drop-target' : ''}`} onClick={() => openPlaylist(item.id)} onDragOver={event => onTrackDragOver(event, item.id)} onDragLeave={() => setTrackDropTarget(null)} onDrop={event => onDropToPlaylist(event, item.id)}><img src={item.cover} alt="" onError={event => { if (!event.currentTarget.src.endsWith('/covers/local.svg')) event.currentTarget.src = '/covers/local.svg'; }} /><span>{item.name}</span></button>)}{recentPlaylists.length > 2 && <button type="button" className="playlist-nav-more" onClick={() => setPlaylistNavExpanded(value => !value)}>{playlistNavExpanded ? '收起' : '展开'}</button>}{recentPlaylists.length > 10 && playlistNavExpanded && <button type="button" className="playlist-nav-more" onClick={() => navigate('/playlists')}>查看全部</button>}</nav>
      {(!storedSettings?.hideLocalMusicActions || !storedSettings?.hideNetworkMusicActions) && <div className="import-actions">{!storedSettings?.hideLocalMusicActions && <><button title="打开歌曲" className="nav-item" onClick={chooseFiles}><Plus size={18} />打开歌曲</button><button title={runtime.nativeFolders ? '打开文件夹' : '浏览器无法读取本地文件夹路径'} disabled={!runtime.nativeFolders} className="nav-item" onClick={chooseFolder}><FolderOpen size={18} />打开文件夹</button></>}{!storedSettings?.hideNetworkMusicActions && <button title={runtime.backend ? '打开网络歌曲' : '需要连接音乐库服务'} disabled={!runtime.backend} className="nav-item" onClick={() => setNetworkOpen(true)}><Globe2 size={18} />网络歌曲</button>}</div>}
      <div className="sidebar-controls sidebar-bottom-controls"><button type="button" className="sidebar-toggle" title={sidebarMode === 'collapsed' ? '展开侧栏' : '折叠为图标'} aria-label={sidebarMode === 'collapsed' ? '展开侧栏' : '折叠为图标'} onClick={() => setSidebarMode(sidebarMode === 'collapsed' ? 'expanded' : 'collapsed')}>{sidebarMode === 'collapsed' ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>{view === '正在播放' && !isSettings && <button type="button" className="sidebar-toggle" title="完全隐藏侧栏" aria-label="完全隐藏侧栏" onClick={() => setSidebarMode('hidden')}><ChevronsLeft size={17} /></button>}</div>
    </aside>
    {sidebarMode === 'hidden' && <button type="button" className="sidebar-restore" title="展开侧栏" aria-label="展开侧栏" onClick={() => setSidebarMode('expanded')}><PanelLeftOpen size={19} /></button>}
    <main className={`workspace min-w-0 ${isSettings ? 'settings-workspace' : ''} ${isArtists || isAlbums ? 'catalog-workspace' : ''} ${isPlaylists || isTags || pathname === '/music' || pathname === '/liked' || pathname === '/recent' ? 'scrolling-workspace' : ''} ${pathname === '/music' || pathname === '/liked' || pathname === '/recent' ? 'library-workspace' : ''}`}>
      {isSettings ? <PlayerSettings theme={theme} setTheme={setTheme} appearance={appearance} setAppearance={setAppearance} visual={visual} setVisual={setVisual} lyricEffect={lyricEffect} setLyricEffect={setLyricEffect} lyricScroll={lyricScroll} setLyricScroll={setLyricScroll} showTranslation={showTranslation} setShowTranslation={setShowTranslation} sleep={sleep} setSleep={setSleep} effectName={p.effectName} onEditEffects={() => setEffectEditorOpen(true)} professionalAudio={p.professionalAudio} setProfessionalAudio={p.setProfessionalAudio} equalizer={p.equalizer} setBand={p.setBand} resetEqualizer={p.resetEqualizer} mappings={mappings} setMappings={setMappings} lyricAppearance={lyricAppearance} setLyricAppearance={setLyricAppearance} artistNames={[...new Set(allTracks.map(track => track.artist))]} />
      : isArtists || isAlbums ? <CatalogView onRefreshInfo={refreshInfo} onSaveLyrics={saveLyrics} kind={isArtists ? 'artists' : 'albums'} artists={catalog.artists} albums={catalog.albums} artist={selectedArtist} album={selectedAlbum} currentId={p.trackId} liked={liked} playlists={displayPlaylists} onPlayTracks={(tracks, startId) => { if (p.playTracks(tracks, startId)) navigate('/'); }} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onAddToPlaylist={addToPlaylist} onArtist={openArtist} onAlbum={openAlbum} />
      : isPlaylists ? <PlaylistView onRefreshInfo={refreshInfo} onSaveLyrics={saveLyrics} playlists={overviewPlaylists} playlist={activePlaylist} displayCover={activePlaylist ? playlistCover(activePlaylist, allTracks) : undefined} tracks={allTracks} currentId={p.trackId} liked={liked} onCreate={() => setCreatePlaylistOpen(true)} onDelete={setDeletePlaylistId} onPlayPlaylist={(tracks, startId) => { if (p.playTracks(tracks, startId)) navigate('/'); }} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onArtist={openArtist} onAlbum={openAlbum} onAddToPlaylist={addToPlaylist} onRemoveFromPlaylist={removeFromPlaylist} onEditPlaylist={edited => setPlaylists(prev => prev.map(item => item.id === edited.id ? edited : item))} />
      : isTags ? <TagsView tracks={allTracks} customTags={customTags} onCreate={createTag} onRename={renameTag} onDelete={deleteTag} onOpen={openTag} />
      : view !== '正在播放' ? <LibraryView onRefreshInfo={refreshInfo} onSaveLyrics={saveLyrics} key={view} title={view} tracks={visibleTracks} currentId={p.trackId} liked={liked} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onArtist={openArtist} onAlbum={openAlbum} playlists={displayPlaylists} onAddToPlaylist={addToPlaylist} onDeleteTracks={setDeleteTrackIds} customTags={customTags} allTagNames={pathname === '/music' ? allTagNames : undefined} selectedTag={selectedTag} onTagFilter={name => navigate(name ? `/music?tag=${encodeURIComponent(name)}` : '/music')} onSetTrackTag={setTrackTag} onPlay={id => { p.select(id); navigate('/'); }} onPlayMany={tracks => { if (p.playTracks(tracks)) navigate('/'); }} onShufflePlay={pathname === '/music' ? shuffleLibrary : undefined} /> : <>
      <div className="main-columns"><section className="listening-stage">
        {p.hasTrack ? scopeOpen ? <ExpandedScope browserFile={isBrowserTrack(p.track)} key={p.trackId} analyser={p.scopeAnalyser} response={p.frequencyResponse} active={p.playing} trackId={p.trackId} title={p.track.title} artist={p.track.artist} sampleRate={p.track.quality?.sampleRate} settings={scopeSettings} onSettingsChange={setScopeSettings} onClose={() => setScopeOpen(false)} /> : <div className={`listening-content ${!hasLyrics ? 'without-lyrics' : ''}`}><div className="album-column"><div className={`album-art ${visual === '唱片' ? 'vinyl' : ''}`}><img src={cover} alt={`${p.track.album}专辑封面`} /></div><div className="album-title flex items-center justify-between"><h2>{p.track.title}</h2>{!p.track.temporary && <IconButton label={favorite ? '取消喜欢' : '喜欢这首歌'} active={favorite} onClick={toggleLike}><Heart size={21} fill={favorite ? 'currentColor' : 'none'} /></IconButton>}</div><p className="artist-name"><button type="button" className="track-meta-link" disabled={!runtime.backend} onClick={() => openArtist(p.track.artist)}>{p.track.artist}</button><span> · </span><button type="button" className="track-meta-link" disabled={!runtime.backend} onClick={() => openAlbum(p.track)}>{p.track.album}</button></p><div className="track-tags">{trackTags(p.track).map(name => <button type="button" key={name} onClick={() => openTag(name)}>{name}</button>)}<TrackTagEditor key={p.track.id} track={p.track} theme={theme} customTags={customTags} onToggle={(id, name, add) => setTrackTag([id], name, add)} onCreate={createTrackTag} /></div><div className={`visualizer ${p.playing ? 'animated' : ''} ${visual === '呼吸' ? 'breathing' : ''}`} role="button" tabIndex={0} title="双击展开示波视图" aria-label="展开示波视图" onDoubleClick={openScope} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openScope(); } }}>{visual === '频谱' ? <Spectrum analyser={p.analyser} response={p.frequencyResponse} active={p.playing} /> : Array.from({ length: 48 }, (_, i) => <i key={i} style={{ height: `${8 + Math.sin(i * .65) ** 2 * 23 + Math.sin(i * .2) ** 2 * 13}px`, animationDelay: `${i * -.13}s`, animationDuration: `${.65 + i % 5 * .2}s` }} />)}</div></div>
          {hasLyrics && (
            <div className={`lyrics-column lyric-${lyricEffect} ${lyricScroll === '即时' ? 'lyric-scroll-instant' : ''} ${browsingLyrics ? 'is-browsing' : ''}`}><LyricCalibration key={p.track.id} offset={lyricOffset} persistent={runtime.backend && p.track.id > 0 && !p.track.temporary} onChange={calibrateLyrics} /><IconButton className="lyrics-immersive-toggle" label="展开歌词" onClick={() => setFocus(true)}><Maximize2 size={16} /></IconButton>
              <div
                ref={lyricsWindow}
                className="lyrics-window"
                style={{ '--lyric-font': lyricAppearance.font === 'serif' ? 'Georgia, "Noto Serif SC", serif' : lyricAppearance.font === 'sans' ? 'Arial, "Noto Sans SC", sans-serif' : '"DM Sans", "Noto Sans SC", sans-serif', '--lyric-size': `${lyricAppearance.size}px`, '--lyric-row-height': `${lyricAppearance.lineHeight}px`, '--lyric-spacing': `${lyricAppearance.spacing}px` } as CSSProperties}
                onWheel={onLyricWheel}
                onPointerDown={onLyricPointerDown}
                onPointerMove={onLyricPointerMove}
                onPointerUp={onLyricPointerUp}
                onPointerCancel={onLyricPointerUp}
                onClickCapture={event => {
                  if (suppressLyricClick.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    suppressLyricClick.current = false;
                  }
                }}
              >
                <div className="lyrics-track">
                  {lines.map((line, i) => (
                    <button
                      key={`${p.trackId}-${i}`}
                      className={`lyric-line ${i === activeLine ? 'current' : ''} ${Math.abs(i - activeLine) > 2 ? 'distant' : ''}`}
                      onClick={() => {
                        p.seek(Math.max(0, p.track.source ? timedLines[i].time : i * lineLength));
                        setBrowsingLyrics(false);
                        if (followTimer.current) clearTimeout(followTimer.current);
                      }}
                    >
                      <span>{lyricEffect === '逐字' && i === activeLine && wordLines[i].length > 0 ? wordLines[i].map((word, wi) => <span key={wi} className={`lyric-word ${wi < activeWord ? 'spoken' : ''} ${wi === activeWord ? 'speaking' : ''}`} style={{ animationDuration: `${Math.max(.1, word.end - word.start)}s` }}>{word.text}</span>) : line}</span>
                      {i === activeLine && showTranslation && translations[i] && <small>{translations[i]}</small>}
                    </button>
                  ))}
                </div>
              </div>
              {translations.length > 0 && <button type="button" title={showTranslation ? '隐藏翻译' : '显示翻译'} aria-label={showTranslation ? '隐藏翻译' : '显示翻译'} aria-pressed={showTranslation} onClick={() => setShowTranslation(!showTranslation)} className={`translation-toggle ${showTranslation ? 'is-active' : ''}`}>文</button>}<Link to="/settings#lyrics-layout" className="lyrics-settings-toggle" title="歌词设置" aria-label="歌词设置"><Settings2 size={15} /></Link>
            </div>
          )}
        </div> : <div className="listening-empty"><img src="/covers/local.svg" alt="" /><h2>播放队列为空</h2></div>}
        <div className="stage-toolbar flex items-center justify-between">
          <Popover><PopoverTrigger asChild><button className="toolbar-button effect-trigger"><SlidersHorizontal size={14} /> 音效 <span>{p.effectName}</span><ChevronDown size={12} /></button></PopoverTrigger><PopoverContent className="player-popover w-56">{effectNames.map(e => <button className="popover-item" key={e} onClick={() => p.setEffect(e)}>{e}{p.effect === e && <Check size={14} />}</button>)}{p.customEffects.map(item => <button className="popover-item" key={item.id} onClick={() => p.setEffect(item.id)}>{item.name}{p.effect === item.id && <Check size={14} />}</button>)}<button type="button" className="popover-item" onClick={() => setEffectEditorOpen(true)}><SlidersHorizontal size={14} />编辑音效</button></PopoverContent></Popover>
          <button type="button" className="toolbar-button" title="示波器 (O)" disabled={!p.hasTrack} onClick={openScope}><Waves size={15} />示波器</button><Link to="/settings#player-style" className="toolbar-button"><Settings2 size={14} /> 播放器样式</Link>
          <Popover><PopoverTrigger asChild><button className="toolbar-button eq-trigger"><Waves size={15} /> 均衡器</button></PopoverTrigger><PopoverContent className="player-popover eq-popover"><div className="eq-heading"><h3>五段均衡器</h3><button onClick={p.resetEqualizer}>重置</button></div><div className="eq-sliders">{eqNames.map((name, i) => <label key={name}><span>{p.equalizer[i] > 0 ? '+' : ''}{p.equalizer[i]}</span><input type="range" min="-12" max="12" value={p.equalizer[i]} onChange={e => p.setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{name}</small></label>)}</div></PopoverContent></Popover>
        </div>
      </section><QueuePanel player={p} onViewInfo={setDetailTrack} onRefreshInfo={refreshInfo} onSaveLyrics={saveLyrics} onSaveQueue={saveQueueAsPlaylist} onAddTracks={addToQueue} /></div>
      </>}
    </main>
    <AudioProcessor professionalAudio={p.professionalAudio} preampDb={p.preampDb} open={effectEditorOpen} onOpenChange={setEffectEditorOpen} effect={p.effect} setEffect={p.setEffect} customEffects={p.customEffects} onSave={p.saveEffect} onDelete={p.deleteEffect} onPreview={p.setPreviewFilter} filterError={p.filterError} sampleRate={p.analyser?.context.sampleRate ?? 44100} hasTrack={p.hasTrack} trackTitle={p.track.title} playing={p.playing} time={p.time} duration={p.track.duration} onToggle={p.toggle} onSeek={p.seek} />
    <Dialog open={createPlaylistOpen} onOpenChange={open => { setCreatePlaylistOpen(open); if (!open) { setPlaylistName(''); setPlaylistRules(null); setPlaylistQueueSnapshot(null); } }}><DialogContent className={`music-dialog playlist-dialog theme-${theme}`}><DialogTitle>{playlistQueueSnapshot ? '播放队列存为歌单' : '新建歌单'}</DialogTitle><DialogDescription className={playlistQueueSnapshot ? undefined : 'sr-only'}>{playlistQueueSnapshot ? `将 ${playlistQueueSnapshot.ids.length} 首歌曲保存为新歌单。${playlistQueueSnapshot.skipped ? `${playlistQueueSnapshot.skipped} 首临时歌曲不会保存。` : ''}` : '新建歌单'}</DialogDescription><form onSubmit={event => { event.preventDefault(); createPlaylist(); }}>{!playlistQueueSnapshot && <label className="playlist-field">歌单类型<select aria-label="歌单类型" value={playlistRules ? 'conditions' : 'manual'} onChange={event => setPlaylistRules(event.target.value === 'conditions' ? {conditions:{},sort:'title',descending:false} : null)}><option value="manual">普通歌单</option><option value="conditions">条件歌单（自动收录）</option></select></label>}{playlistRules && <PlaylistRuleEditor value={playlistRules} onChange={setPlaylistRules} tracks={allTracks} liked={liked} />}<div className="playlist-create-row"><Input autoFocus maxLength={40} placeholder="歌单名称" aria-label="歌单名称" value={playlistName} onChange={event => setPlaylistName(event.target.value)} /><button type="submit" className="playlist-primary" disabled={!playlistName.trim()}>{playlistQueueSnapshot ? '确认保存' : '确认创建'}</button></div></form></DialogContent></Dialog>
    <Dialog open={deletePlaylistId !== null} onOpenChange={open => { if (!open) setDeletePlaylistId(null); }}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>删除歌单？</DialogTitle><DialogDescription>「{playlists.find(item => item.id === deletePlaylistId)?.name}」将从歌单列表移除，歌曲不会从音乐库删除。</DialogDescription><div className="playlist-dialog-actions"><button type="button" onClick={() => setDeletePlaylistId(null)}>取消</button><button type="button" className="playlist-danger" onClick={deletePlaylist}>删除歌单</button></div></DialogContent></Dialog>
    <Dialog open={deleteTrackIds.length > 0} onOpenChange={open => { if (!open) setDeleteTrackIds([]); }}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>从曲库移除{deleteTrackIds.length} 首歌曲？</DialogTitle><DialogDescription>歌曲将从曲库、歌单和播放队列中移除。本地音频文件不会删除。</DialogDescription><div className="playlist-dialog-actions"><button type="button" onClick={() => setDeleteTrackIds([])}>取消</button><button type="button" className="playlist-danger" onClick={() => void deleteTracks()}>移除歌曲</button></div></DialogContent></Dialog>
    {dropActive && <div className="file-drop-overlay"><Plus size={32} /><strong>{runtime.mode !== 'desktop' ? '仅本次播放' : toolboxOpen ? '添加文件或文件夹' : pathname === '/' ? '加入音乐库和播放队列' : '加入音乐库'}</strong></div>}
    <Toolbox open={toolboxOpen} launchRequest={toolboxLaunchRequest} theme={theme} noise={p.noise} timer={workTimer} autoClose={toolboxAutoClose} onOpenChange={setToolboxOpen} paths={toolboxPaths} setPaths={setToolboxPaths} addToLibrary={toolboxAddToLibrary} onAddToLibraryChange={setToolboxAddToLibrary} onChanged={async tracks => { await reloadLibrary(); if (toolboxQueueOnConvert) p.addTracks(tracks); }} onOrganized={async result => { const state = await backend.state(); for (const track of result.temporaryTracks) p.updateTrack(track); p.setCatalog(state.tracks, result.remappedIds); setLibraryTracks(state.tracks); setCustomTags(state.tags); setPlaylists(state.playlists); setLiked(state.liked); setFolders(state.folders); }} />
    <Dialog open={pendingPaths.length > 0 && !toolboxOpen} onOpenChange={open => { if (!open) setPendingPaths([]); }}><DialogContent className="music-dialog folder-dialog"><DialogTitle>如何处理这些文件？</DialogTitle><DialogDescription>{pendingPaths.length} 个本地路径</DialogDescription><div className="folder-dialog-actions"><button onClick={() => { void importPaths(pendingPaths, 'temporary'); setPendingPaths([]); }}>仅本次播放</button><button onClick={() => { void importPaths(pendingPaths, 'library'); setPendingPaths([]); }}>加入音乐库</button><button onClick={() => { void importPaths(pendingPaths, 'watch'); setPendingPaths([]); }}>监听所在文件夹</button></div></DialogContent></Dialog>
    <Dialog open={networkOpen} onOpenChange={setNetworkOpen}><DialogContent className="music-dialog folder-dialog"><DialogTitle>打开网络歌曲</DialogTitle><DialogDescription>HTTP 或 HTTPS 音频文件地址</DialogDescription><form className="network-song-form" onSubmit={event => { event.preventDefault(); void openNetworkSong(); }}><Input type="url" autoFocus required value={networkURL} onChange={event => setNetworkURL(event.target.value)} placeholder="https://example.com/music/song.mp3" aria-label="网络歌曲地址" /><div className="folder-dialog-actions"><button type="button" onClick={() => setNetworkOpen(false)}>取消</button><button type="submit" disabled={networkLoading || !networkURL.trim()}>{networkLoading ? '正在打开' : '打开并播放'}</button></div></form></DialogContent></Dialog>
    <footer className={`playback-bar ${p.noise.active ? 'noise-active' : ''} ${workTimer.active ? 'timer-active' : ''}`}>
      <div className="mini-track"><button type="button" className="mini-cover-link" aria-label="前往正在播放" title="前往正在播放" onClick={() => navigate('/')}><img className="mini-cover" src={p.noise.active ? '/covers/local.svg' : cover} alt="" /></button><div><strong>{p.noise.active ? p.noise.name : p.track.title}</strong><small>{p.noise.active ? p.noise.status === 'paused' ? '后台噪音 · 已暂停' : '后台噪音 · 原队列保留' : p.track.artist}</small></div>{!p.noise.active && p.hasTrack && !p.track.source && <IconButton label="喜欢" onClick={toggleLike} active={favorite}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></IconButton>}</div>
      <div className="transport"><div className="transport-buttons"><IconButton label="上一首" onClick={p.previous}><SkipBack size={20} fill="currentColor" /></IconButton><button className="play-button" disabled={!p.hasTrack && !p.noise.active} aria-label={outputPlaying ? '暂停' : '播放'} onClick={p.toggle}>{outputPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><IconButton label="下一首" onClick={p.next}><SkipForward size={20} fill="currentColor" /></IconButton><PlaybackModeControl mode={p.mode} onChange={p.setMode} disabled={p.noise.active} /></div><div className="seek-row"><span>{p.noise.active ? '—' : formatTime(p.time)}</span><input aria-label="播放进度" type="range" min="0" max={Math.max(1, p.track.duration)} step="0.1" value={p.time} disabled={!p.hasTrack || p.noise.active} onChange={e => p.seek(Number(e.target.value))} style={{ '--fill': `${p.time / Math.max(1, p.track.duration) * 100}%` } as React.CSSProperties} /><span>{p.noise.active ? '—' : formatTime(p.track.duration)}</span></div></div>
      <div className="playback-extras">{!p.noise.active && p.track.quality && <span className="quality-badge" title={[p.track.quality.sampleRate && `${(p.track.quality.sampleRate / 1000).toFixed(1)} kHz`, p.track.quality.bitDepth && `${p.track.quality.bitDepth}-bit`, p.track.quality.bitrate && `${Math.round(p.track.quality.bitrate / 1000)} kbps`, p.track.quality.codec].filter(Boolean).join(' · ')}>{p.track.quality.lossless ? p.track.quality.sampleRate && p.track.quality.sampleRate >= 88200 ? 'Hi-Res' : '无损' : p.track.quality.bitrate ? `${Math.round(p.track.quality.bitrate / 1000)} kbps` : '音频'}</span>}
        {runtime.mode === 'desktop' && <MiniModeButton label="迷你模式" disabled={mini.busy} onClick={() => window.dispatchEvent(new Event('lunanahida:enter-mini-mode'))}><PictureInPicture2 size={19} /></MiniModeButton>}
        {p.noise.active && <IconButton label="停止噪音" className="noise-stop-trigger" onClick={p.noise.stop}><Square size={17} /></IconButton>}
        <IconButton label="音频工具箱" className="toolbox-trigger" active={toolboxOpen} onClick={() => { setToolboxAddToLibrary(false); setToolboxQueueOnConvert(false); setToolboxAutoClose(false); setToolboxLaunchRequest(previous => ({ tool: null, revision: previous.revision + 1 })); setToolboxOpen(true); }}><Wrench size={19} /></IconButton>
        <TimerShortcut timer={workTimer} onOpen={() => { setToolboxAutoClose(false); setToolboxLaunchRequest(previous => ({ tool: 'timer', revision: previous.revision + 1 })); setToolboxOpen(true); }} />
        <Popover><PopoverTrigger asChild><button type="button" className={`icon-button ${sleep > 0 ? 'is-active' : ''}`} aria-label="睡眠定时" title={sleep > 0 ? `睡眠定时：${formatTime(sleep)}` : '睡眠定时'}><Timer size={19} /></button></PopoverTrigger><PopoverContent side="top" align="end" sideOffset={12} collisionPadding={12} className="sleep-quick-popover"><strong>定时暂停</strong>{sleep > 0 && <p>剩余 {formatTime(sleep)}</p>}<div className="sleep-quick-options">{[5, 10, 15, 30, 45, 60].map(minutes => <button key={minutes} type="button" onClick={() => setSleep(minutes * 60)}>{minutes} 分钟</button>)}</div><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const minutes = Number(form.get('minutes')); if (Number.isFinite(minutes) && minutes > 0) setSleep(Math.round(minutes * 60)); }}><label>自定义分钟<input name="minutes" type="number" min="1" max="1440" step="1" defaultValue="20" /></label><button type="submit">设置</button></form>{sleep > 0 && <button type="button" className="sleep-quick-cancel" onClick={() => setSleep(0)}>关闭定时</button>}</PopoverContent></Popover><IconButton label={outputVolume ? '静音' : '恢复音量'} className="volume-trigger" onClick={() => toggleMute()}>{outputVolume ? <Volume2 size={19} /> : <VolumeX size={19} />}</IconButton><input aria-label="音量" type="range" min="0" max="100" value={outputVolume} onChange={e => setOutputVolume(Number(e.target.value))} style={{ '--fill': `${outputVolume}%` } as React.CSSProperties} /><span className="header-separator" /><IconButton label="播放队列" onClick={() => setQueueOpen(true)}><ListMusic size={20} /></IconButton>
      </div>
    </footer>
    {queueOpen && <section className={`quick-queue-panel ${trackDropTarget === 'queue' ? 'track-drop-target' : ''}`} aria-label="播放队列" onDragOver={event => onTrackDragOver(event, 'queue')} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setTrackDropTarget(null); }} onDrop={onDropToQueue}><header><div><h2>播放队列</h2><span>{p.queue.length} 首歌曲</span></div><div className="quick-queue-actions"><LocateCurrentTrackButton iconOnly available={p.trackId !== null && p.queue.some(track => track.id === p.trackId)} onLocate={() => locateCurrentTrack(quickQueueRef.current)} /><button type="button" aria-label="存为歌单" title="存为歌单" disabled={!p.queue.some(track => track.id > 0 && !track.temporary)} onClick={saveQueueAsPlaylist}><Save size={17} /></button><button type="button" aria-label="关闭播放队列" onClick={() => setQueueOpen(false)}><X size={17} /></button></div></header><div ref={quickQueueRef} className="quick-queue-list">{p.queue.map((track, index) => <button type="button" key={track.id} className={'queue-track ' + (p.trackId === track.id ? 'current' : '')} aria-current={p.trackId === track.id ? 'true' : undefined} onClick={() => p.select(track.id)}><span className="track-number">{p.trackId === track.id ? <AudioLines size={14} /> : String(index + 1).padStart(2, '0')}</span><img src={track.cover} alt="" /><span className="queue-track-label"><span>{track.title}</span><small>{track.artist}</small></span><span className="track-duration">{formatTime(track.duration)}</span></button>)}{p.queue.length === 0 && <div className="queue-empty">队列为空</div>}</div></section>}
    {focus && p.hasTrack && <section className="immersive-overlay"><img src={cover} alt="" className="immersive-backdrop" /><div className="immersive-shade" /><header><span>{p.track.title}</span><IconButton label="收起歌词" onClick={() => setFocus(false)}><Minimize2 size={20} /></IconButton></header><div className="immersive-main"><div className="immersive-art"><img src={cover} alt={`${p.track.album}专辑封面`} /><Spectrum analyser={p.analyser} response={p.frequencyResponse} active={p.playing} /></div><div className="immersive-lyrics"><span className="eyebrow">{p.track.album} · {p.track.artist}</span><h1>{p.track.title}</h1>{hasLyrics && <div ref={immersiveLyricsWindow}>{lines.map((line, i) => <p key={i} className={i === activeLine ? 'current' : ''}>{lyricEffect === '逐字' && i === activeLine && wordLines[i].length > 0 ? wordLines[i].map((word, wi) => <span key={wi} className={wi < activeWord ? 'spoken' : wi === activeWord ? 'speaking' : ''}>{word.text}</span>) : line}</p>)}</div>}</div></div></section>}
    {detailTrack && <TrackDetails track={detailTrack} theme={theme} onClose={() => setDetailTrack(null)} onSaved={updated => { p.updateTrack(updated); if (!updated.temporary) setLibraryTracks(tracks => tracks.map(track => track.id === updated.id ? updated : track)); setDetailTrack(updated); }} onArtist={openArtist} onAlbum={openAlbum} onTag={name => { setDetailTrack(null); openTag(name); }} />}
  </div>;
}
