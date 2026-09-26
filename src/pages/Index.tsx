import { type CSSProperties, type DragEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PlayerSettings from '@/components/PlayerSettings';
import QueuePanel from '@/components/QueuePanel';
import LibraryView from '@/components/LibraryView';
import PlaylistView from '@/components/PlaylistView';
import CatalogView from '@/components/CatalogView';
import { useMusicEnrichment, refreshMusicInfo } from '@/hooks/use-music-enrichment';
import { artistKey, buildCatalog, normalizeName, type ArtistMapping } from '@/lib/catalog';
import { type Playlist } from '@/lib/playlists';
import { backend, type StoredSettings } from '@/lib/backend';
import { Events } from '@wailsio/runtime';
import { toast } from 'sonner';
import '@/settings.css';
import '@/sleep-timer.css';
import { AudioLines, Check, ChevronDown, ChevronsLeft, Disc3, X, FolderOpen, Heart, ListEnd, ListMusic, Maximize2, Mic2, Minimize2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Repeat, Repeat1, Settings2, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Square, Timer, Volume2, VolumeX, Waves } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePlayer } from '@/hooks/use-player';
import { formatTime, type Track } from '@/lib/music';
import '@/player.css';
import '@/vinyl-playback.css';
import '@/quick-queue.css';
import '@/player-import.css';
import '@/library.css';
import '@/playlists.css';
import '@/catalog.css';
import '@/artist-mappings.css';
import '@/light-mode.css';

const eqNames = ['低音', '低中', '中音', '高中', '高音'];
function IconButton({ children, label, onClick, active = false, className = '' }: { children: ReactNode; label: string; onClick?: () => void; active?: boolean; className?: string }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`icon-button ${active ? 'is-active' : ''} ${className}`}>{children}</button>;
}
function Spectrum({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
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
      }
      if (active) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(() => { if (!active) draw(); });
    observer.observe(element);
    draw();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [analyser, active]);
  return <canvas ref={canvas} className="spectrum-canvas" aria-label="实时频谱" />;
}
export default function Index() {
  const p = usePlayer();
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const isSettings = pathname === '/settings';
  const isPlaylists = pathname === '/playlists' || pathname.startsWith('/playlists/');
  const isArtists = pathname === '/artists' || pathname.startsWith('/artists/');
  const isAlbums = pathname === '/albums' || pathname.startsWith('/albums/');
  const catalogPath = pathname.split('/');
  const playlistId = pathname.startsWith('/playlists/') ? decodeURIComponent(pathname.slice('/playlists/'.length)) : null;
  const view = ({ '/music': '我的音乐', '/liked': '我喜欢的', '/recent': '最近播放' } as Record<string, string>)[pathname] ?? '正在播放';
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [mappings, setMappings] = useState<ArtistMapping[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [storedSettings, setStoredSettings] = useState<StoredSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [deletePlaylistId, setDeletePlaylistId] = useState<string | null>(null);
  const [playlistNavExpanded, setPlaylistNavExpanded] = useState(false);
  const [recentPlaylistIds, setRecentPlaylistIds] = useState<string[]>([]);
  const [theme, setTheme] = useState('dusk'), [lyricEffect, setLyricEffect] = useState('流动'), [lyricScroll, setLyricScroll] = useState('平滑'), [visual, setVisual] = useState('频谱');
  const [appearance, setAppearance] = useState<'dark' | 'light'>('dark');
  const [lyricAppearance, setLyricAppearance] = useState({ font: 'default', size: 16, lineHeight: 57, spacing: 0 });
  const [liked, setLiked] = useState<number[]>([]);
  const [detailTrack, setDetailTrack] = useState<Track | null>(null), [focus, setFocus] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'expanded' | 'collapsed' | 'hidden'>('expanded');
  const [queueOpen, setQueueOpen] = useState(false);
  const [sleep, setSleep] = useState(0), [showTranslation, setShowTranslation] = useState(true);
  const [browsingLyrics, setBrowsingLyrics] = useState(false);
  const lyricsWindow = useRef<HTMLDivElement>(null);
  const lyricDrag = useRef<{ pointerId: number; y: number; scrollTop: number; moved: boolean } | null>(null);
  const suppressLyricClick = useRef(false);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const [dropActive, setDropActive] = useState(false);
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  useEffect(() => {
    const updatePlaylistCover = (event: Event) => {
      const { id, previousCover, cover } = (event as CustomEvent<{ id: number; previousCover: string; cover: string }>).detail;
      setPlaylists(previous => previous.map(item => item.trackIds[0] === id && item.cover === previousCover ? { ...item, cover } : item));
    };
    window.addEventListener('lumatune-track-cover-updated', updatePlaylistCover);
    return () => window.removeEventListener('lumatune-track-cover-updated', updatePlaylistCover);
  }, []);

  useEffect(() => {
    backend.state().then(state => {
      setLibraryTracks(state.tracks); setPlaylists(state.playlists); setLiked(state.liked); setFolders(state.folders);
      setTheme(state.settings.theme); setAppearance(state.settings.appearance); setVisual(state.settings.visual);
      setLyricEffect(state.settings.lyricEffect); setLyricScroll(state.settings.lyricScroll);
      setShowTranslation(state.settings.showTranslation); setLyricAppearance(state.settings.lyricAppearance);
      setMappings(state.settings.artistMappings); setStoredSettings(state.settings);
      p.hydrate(state.tracks, state.queue, state.recent, state.settings); setReady(true);
    }).catch(error => toast.error(error instanceof Error ? error.message : '音乐库加载失败'));
  }, []);
  useEffect(() => { if (ready) p.setCatalog(libraryTracks); }, [libraryTracks, ready]);
  useEffect(() => { if (ready) void backend.playlists(playlists).catch(error => toast.error(error.message)); }, [playlists, ready]);
  useEffect(() => { if (ready) void backend.liked(liked).catch(error => toast.error(error.message)); }, [liked, ready]);
  useEffect(() => { if (ready) void backend.queue(p.queue.filter(track => !track.temporary).map(track => track.id)).catch(error => toast.error(error.message)); }, [p.queue.map(track => track.id).join(','), ready]);
  useEffect(() => {
    if (!ready || !storedSettings) return;
    const next: StoredSettings = { ...storedSettings, theme, appearance, visual, lyricEffect, lyricScroll, showTranslation, lyricAppearance, artistMappings: mappings, volume: p.volume, mode: p.mode, effect: p.effect, equalizer: p.equalizer };
    const timer = window.setTimeout(() => void backend.settings(next).catch(error => toast.error(error.message)), 250);
    return () => window.clearTimeout(timer);
  }, [ready, storedSettings, theme, appearance, visual, lyricEffect, lyricScroll, showTranslation, lyricAppearance, mappings, p.volume, p.mode, p.effect, p.equalizer]);
  useEffect(() => {
    document.documentElement.classList.toggle('mode-light', appearance === 'light');
    document.documentElement.style.colorScheme = appearance;
    return () => { document.documentElement.classList.remove('mode-light'); document.documentElement.style.colorScheme = ''; };
  }, [appearance]);
  const reloadLibrary = async () => { const state = await backend.state(); setLibraryTracks(state.tracks); setFolders(state.folders); };
  const importPaths = async (paths: string[], mode: 'temporary' | 'library' | 'watch') => {
    if (!paths.length) return;
    try {
      const imported = await backend.import(paths, mode);
      if (mode !== 'temporary') await reloadLibrary();
      p.addTracks(imported);
      toast.success(`已处理 ${imported.length} 首歌曲`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '导入失败'); }
  };
  const handlePaths = (paths: string[]) => { if (!paths.length) return; if (storedSettings?.dropAction === 'ask' || !storedSettings) setPendingPaths(paths); else void importPaths(paths, storedSettings.dropAction); };
  const chooseFiles = () => { void backend.chooseFiles().then(result => handlePaths(result.paths)).catch(error => toast.error(error.message)); };
  const chooseFolder = () => { void backend.chooseFolder().then(result => handlePaths(result.paths.filter(Boolean))).catch(error => toast.error(error.message)); };
  useEffect(() => {
    const offDrop = Events.On('luma:files-dropped', event => handlePaths(event.data as string[]));
    const offScan = Events.On('luma:scan-complete', () => void reloadLibrary());
    return () => { offDrop(); offScan(); };
  }, [storedSettings]);
  useEffect(() => {
    const settingsChanged = (event: Event) => setStoredSettings((event as CustomEvent<StoredSettings>).detail);
    const libraryChanged = () => void reloadLibrary();
    window.addEventListener('luma-settings-updated', settingsChanged);
    window.addEventListener('luma-library-changed', libraryChanged);
    return () => { window.removeEventListener('luma-settings-updated', settingsChanged); window.removeEventListener('luma-library-changed', libraryChanged); };
  }, []);
  const dropFiles = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDropActive(false); };
  const refreshInfo = (track: Track) => {
    toast.promise(refreshMusicInfo(track), {
      loading: `正在刷新《${track.title}》的信息`,
      success: result => result.cover && result.lyric ? '封面和歌词已更新' : result.cover ? '封面已更新，未找到歌词' : '歌词已更新，未找到封面',
      error: error => error instanceof Error ? error.message : '刷新失败',
    });
  };
  const enrichment = useMusicEnrichment(p.track, p.playing);
  const timedLines = enrichment.lines;
  const lines = timedLines.map(line => line.text);
  const translations = timedLines.map(line => line.translation ?? '');
  const wordLines = lines.map(() => [] as { text: string; start: number; end: number }[]);
  const hasLyrics = lines.length > 0;
  const lineLength = hasLyrics ? p.track.duration / (lines.length + 1) || 1 : 1;
  const activeLine = hasLyrics ? timedLines.every(line => line.time === 0) ? 0 : Math.max(0, timedLines.reduce((index, line, i) => p.time >= line.time ? i : index, 0)) : 0;
  const activeWord = hasLyrics && wordLines[activeLine]?.length ? wordLines[activeLine].findIndex((word, i) => p.time >= word.start && (p.time < word.end || i === wordLines[activeLine].length - 1)) : -1;
  const cover = enrichment.cover;
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
  useEffect(() => {
    const windowElement = lyricsWindow.current;
    if (!windowElement || browsingLyrics) return;
    const line = windowElement.querySelectorAll<HTMLButtonElement>('.lyric-line')[activeLine];
    if (line) windowElement.scrollTo({ top: line.offsetTop + line.offsetHeight / 2 - windowElement.clientHeight / 2, behavior: lyricScroll === '即时' ? 'instant' : 'smooth' });
  }, [activeLine, browsingLyrics, lyricScroll, p.trackId, view]);
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
  const toggleTrackLike = (id: number) => setLiked(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  const toggleLike = () => { if (p.trackId !== null) toggleTrackLike(p.trackId); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="slider"]')) return;

      if (event.key === 'Escape') {
        if (focus) { event.preventDefault(); setFocus(false); }
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        p.setVolume(Math.max(0, Math.min(100, p.volume + (event.key === 'ArrowUp' ? 5 : -5))));
        return;
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault(); p.setVolume(p.volume ? 0 : 65); return;
      }
      if (!p.hasTrack) return;
      switch (event.key) {
        case ' ': case 'k': case 'K': case 'MediaPlayPause':
          event.preventDefault(); if (!event.repeat) p.toggle(); break;
        case 'ArrowRight': case 'l': case 'L':
          event.preventDefault(); p.seek(Math.min(p.time + (event.key === 'ArrowRight' ? 5 : 10), p.track.duration)); break;
        case 'ArrowLeft': case 'j': case 'J':
          event.preventDefault(); p.seek(Math.max(p.time - (event.key === 'ArrowLeft' ? 5 : 10), 0)); break;
        case 'Home': event.preventDefault(); p.seek(0); break;
        case 'End': event.preventDefault(); p.seek(p.track.duration); break;
        case 'n': case 'N': case 'MediaTrackNext':
          event.preventDefault(); if (!event.repeat) p.next(); break;
        case 'p': case 'P': case 'MediaTrackPrevious':
          event.preventDefault(); if (!event.repeat) p.previous(); break;
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [p, focus]);
  useEffect(() => { if (!sleep) return; const timer = window.setInterval(() => setSleep(v => Math.max(0, v - 1)), 1000); return () => window.clearInterval(timer); }, [sleep > 0]);
  useEffect(() => { if (sleep === 1 && p.playing) p.toggle(); }, [sleep]);
  const allTracks = libraryTracks;
  const catalog = useMemo(() => buildCatalog(allTracks, mappings), [allTracks, mappings]);
  const selectedArtist = isArtists && catalogPath[2] ? catalog.artists.find(item => item.key === decodeURIComponent(catalogPath[2])) : undefined;
  const selectedAlbum = isAlbums && catalogPath[2] && catalogPath[3] ? catalog.albums.find(item => item.artistKey === decodeURIComponent(catalogPath[2]) && item.key === decodeURIComponent(catalogPath[3])) : undefined;
  const openArtist = (name: string) => { setDetailTrack(null); navigate(`/artists/${encodeURIComponent(artistKey(name, mappings))}`); };
  const openAlbum = (track: Track) => { setDetailTrack(null); navigate(`/albums/${encodeURIComponent(artistKey(track.artist, mappings))}/${encodeURIComponent(normalizeName(track.album))}`); };
  const visibleTracks = view === '我喜欢的' ? allTracks.filter(t => liked.includes(t.id)) : view === '最近播放' ? p.recent.map(id => allTracks.find(t => t.id === id)).filter((t): t is Track => Boolean(t)) : allTracks;
  const activePlaylist = playlists.find(item => item.id === playlistId);
  const recentPlaylists = [...recentPlaylistIds.map(id => playlists.find(item => item.id === id)).filter((item): item is Playlist => Boolean(item)), ...playlists.filter(item => !recentPlaylistIds.includes(item.id))];
  const sidebarPlaylists = recentPlaylists.slice(0, playlistNavExpanded ? 10 : 2);
  const overviewPlaylists = [...playlists].sort((a, b) => a.id === (playlistId ?? recentPlaylistIds[0]) ? -1 : b.id === (playlistId ?? recentPlaylistIds[0]) ? 1 : 0);
  const openPlaylist = (id: string) => {
    setRecentPlaylistIds(previous => [id, ...previous.filter(item => item !== id)]);
    navigate(`/playlists/${id}`);
  };
  const createPlaylist = () => {
    const name = playlistName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setPlaylists(prev => [...prev, { id, name, description: '我的歌单', trackIds: [], cover: '/covers/local.svg' }]);
    setPlaylistName(''); setCreatePlaylistOpen(false);
    navigate(`/playlists/${id}`);
    toast.success('歌单已创建');
  };
  const addToPlaylist = (id: string, ids: number[]) => {
    const playlist = playlists.find(item => item.id === id);
    if (!playlist) return;
    const additions = ids.filter(trackId => !playlist.trackIds.includes(trackId));
    if (!additions.length) { toast.info('歌曲已在歌单中'); return; }
    setPlaylists(prev => prev.map(item => item.id === id ? { ...item, trackIds: [...item.trackIds, ...additions], cover: item.trackIds.length ? item.cover : allTracks.find(track => track.id === additions[0])?.cover ?? item.cover } : item));
    toast.success(`已添加 ${additions.length} 首到「${playlist.name}」`);
  };
  const removeFromPlaylist = (id: string, ids: number[]) => {
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
  return <div ref={appRef} className={`music-app theme-${theme} mode-${appearance} ${focus ? 'focus-mode' : ''} sidebar-${sidebarMode}`} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDropActive(true); } }} onDragLeave={event => { if (event.dataTransfer.types.includes('Files') && --dragDepth.current <= 0) { dragDepth.current = 0; setDropActive(false); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { void dropFiles(event); }}>
    <aside className="sidebar flex flex-col">
      
      <div className="nav-label">音乐库</div><nav className="space-y-1">{[{ title: '正在播放', path: '/', icon: AudioLines }, { title: '我的音乐', path: '/music', icon: Disc3 }, { title: '歌手', path: '/artists', icon: Mic2 }, { title: '专辑', path: '/albums', icon: Disc3 }, { title: '我喜欢的', path: '/liked', icon: Heart }, { title: '最近播放', path: '/recent', icon: ListMusic }].map(({ title, path, icon: Icon }) => <button key={title} title={title} onClick={() => navigate(path)} className={`nav-item ${!isSettings && (pathname === path || (path === '/artists' && isArtists) || (path === '/albums' && isAlbums)) ? 'selected' : ''}`}><Icon size={18} />{title}{title === '正在播放' && p.playing && <span className="tiny-bars" aria-hidden="true"><i /><i /><i /></span>}{title === '我喜欢的' && <small>{liked.length}</small>}</button>)}</nav>
      <Link to="/settings" title="播放器设置" className={`nav-item settings-nav ${isSettings ? 'selected' : ''}`}><Settings2 size={18} />播放器设置</Link>
      <div className="playlist-nav-heading"><button type="button" onClick={() => navigate('/playlists')} className="nav-label" title="查看全部歌单">歌单</button><button type="button" className="playlist-nav-add" title="新建歌单" aria-label="新建歌单" onClick={() => setCreatePlaylistOpen(true)}><Plus size={16} /></button></div>
      <nav className="playlist-nav"><button type="button" title="我的歌单" className={`nav-item ${pathname === '/playlists' ? 'selected' : ''}`} onClick={() => navigate('/playlists')}><ListMusic size={18} />我的歌单<small>{playlists.length}</small></button>{sidebarPlaylists.map(item => <button type="button" key={item.id} title={item.name} className={`nav-item playlist-nav-entry ${playlistId === item.id ? 'selected' : ''}`} onClick={() => openPlaylist(item.id)}><img src={item.cover} alt="" /><span>{item.name}</span></button>)}{recentPlaylists.length > 2 && <button type="button" className="playlist-nav-more" onClick={() => setPlaylistNavExpanded(value => !value)}>{playlistNavExpanded ? '收起' : '展开'}</button>}{recentPlaylists.length > 10 && playlistNavExpanded && <button type="button" className="playlist-nav-more" onClick={() => navigate('/playlists')}>查看全部</button>}</nav>
      <div className="nav-label mt-10">本地音乐</div><div className="import-actions"><button title="打开歌曲" className="nav-item" onClick={chooseFiles}><Plus size={18} />打开歌曲</button><button title="打开文件夹" className="nav-item" onClick={chooseFolder}><FolderOpen size={18} />打开文件夹</button></div>
      <div className="sidebar-controls sidebar-bottom-controls"><button type="button" className="sidebar-now-playing" title="返回正在播放" aria-label="返回正在播放" onClick={() => navigate('/')}><AudioLines size={17} /></button><button type="button" className="sidebar-toggle" title={sidebarMode === 'collapsed' ? '展开侧栏' : '折叠为图标'} aria-label={sidebarMode === 'collapsed' ? '展开侧栏' : '折叠为图标'} onClick={() => setSidebarMode(sidebarMode === 'collapsed' ? 'expanded' : 'collapsed')}>{sidebarMode === 'collapsed' ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>{view === '正在播放' && !isSettings && <button type="button" className="sidebar-toggle" title="完全隐藏侧栏" aria-label="完全隐藏侧栏" onClick={() => setSidebarMode('hidden')}><ChevronsLeft size={17} /></button>}</div>
    </aside>
    {sidebarMode === 'hidden' && <button type="button" className="sidebar-restore" title="展开侧栏" aria-label="展开侧栏" onClick={() => setSidebarMode('expanded')}><PanelLeftOpen size={19} /></button>}
    <main className={`workspace min-w-0 ${isSettings ? 'settings-workspace' : ''} ${isArtists || isAlbums ? 'catalog-workspace' : ''} ${isPlaylists || pathname === '/music' || pathname === '/liked' || pathname === '/recent' ? 'scrolling-workspace' : ''}`}>
      {isSettings ? <PlayerSettings theme={theme} setTheme={setTheme} appearance={appearance} setAppearance={setAppearance} visual={visual} setVisual={setVisual} lyricEffect={lyricEffect} setLyricEffect={setLyricEffect} lyricScroll={lyricScroll} setLyricScroll={setLyricScroll} showTranslation={showTranslation} setShowTranslation={setShowTranslation} sleep={sleep} setSleep={setSleep} effect={p.effect} setEffect={p.setEffect} equalizer={p.equalizer} setBand={p.setBand} resetEqualizer={p.resetEqualizer} mappings={mappings} setMappings={setMappings} lyricAppearance={lyricAppearance} setLyricAppearance={setLyricAppearance} artistNames={[...new Set(allTracks.map(track => track.artist))]} /> : isArtists || isAlbums ? <CatalogView onRefreshInfo={refreshInfo} kind={isArtists ? 'artists' : 'albums'} artists={catalog.artists} albums={catalog.albums} artist={selectedArtist} album={selectedAlbum} currentId={p.trackId} liked={liked} playlists={playlists} onPlay={id => { p.select(id); navigate('/'); }} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onAddToPlaylist={addToPlaylist} onArtist={openArtist} onAlbum={openAlbum} /> : isPlaylists ? <PlaylistView onRefreshInfo={refreshInfo} playlists={overviewPlaylists} playlist={activePlaylist} tracks={allTracks} currentId={p.trackId} liked={liked} onCreate={() => setCreatePlaylistOpen(true)} onDelete={setDeletePlaylistId} onPlay={id => { p.select(id); navigate('/'); }} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onArtist={openArtist} onAlbum={openAlbum} onAddToPlaylist={addToPlaylist} onRemoveFromPlaylist={removeFromPlaylist} onEditPlaylist={edited => setPlaylists(prev => prev.map(item => item.id === edited.id ? edited : item))} /> : view !== '正在播放' ? <LibraryView onRefreshInfo={refreshInfo} key={view} title={view} tracks={visibleTracks} currentId={p.trackId} liked={liked} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onArtist={openArtist} onAlbum={openAlbum} playlists={playlists} onAddToPlaylist={addToPlaylist} onPlay={id => { p.select(id); navigate('/'); }} /> : <>
      <div className="main-columns"><section className="listening-stage">
        {p.hasTrack ? <div className={`listening-content ${!hasLyrics ? 'without-lyrics' : ''}`}><div className="album-column"><div className={`album-art ${visual === '唱片' ? 'vinyl' : ''}`}><img src={cover} alt={`${p.track.album}专辑封面`} /></div><div className="album-title flex items-center justify-between"><h2>{p.track.title}</h2>{!p.track.temporary && <IconButton label={favorite ? '取消喜欢' : '喜欢这首歌'} active={favorite} onClick={toggleLike}><Heart size={21} fill={favorite ? 'currentColor' : 'none'} /></IconButton>}</div><p className="artist-name"><button type="button" className="track-meta-link" onClick={() => openArtist(p.track.artist)}>{p.track.artist}</button><span> · </span><button type="button" className="track-meta-link" onClick={() => openAlbum(p.track)}>{p.track.album}</button></p><div className="track-tags"><span>{p.track.temporary ? '本次播放' : '本地文件'}</span>{p.track.genre && <span>{p.track.genre.split(' / ')[0]}</span>}</div><div className={`visualizer ${p.playing ? 'animated' : ''} ${visual === '呼吸' ? 'breathing' : ''}`} aria-label="音乐频谱">{visual === '频谱' ? <Spectrum analyser={p.analyser} active={p.playing} /> : Array.from({ length: 48 }, (_, i) => <i key={i} style={{ height: `${8 + Math.sin(i * .65) ** 2 * 23 + Math.sin(i * .2) ** 2 * 13}px`, animationDelay: `${i * -.13}s`, animationDuration: `${.65 + i % 5 * .2}s` }} />)}</div></div>
          {hasLyrics && (
            <div className={`lyrics-column lyric-${lyricEffect} ${lyricScroll === '即时' ? 'lyric-scroll-instant' : ''} ${browsingLyrics ? 'is-browsing' : ''}`}><IconButton className="lyrics-immersive-toggle" label="沉浸模式" onClick={() => setFocus(true)}><Maximize2 size={16} /></IconButton>
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
                        p.seek(p.track.source ? timedLines[i].time : i * lineLength);
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
              {translations.length > 0 && <button type="button" title={showTranslation ? '隐藏翻译' : '显示翻译'} aria-label={showTranslation ? '隐藏翻译' : '显示翻译'} aria-pressed={showTranslation} onClick={() => setShowTranslation(!showTranslation)} className={`translation-toggle ${showTranslation ? 'is-active' : ''}`}>文</button>}<Link to="/settings" className="lyrics-settings-toggle" title="歌词设置" aria-label="歌词设置"><Settings2 size={15} /></Link>
            </div>
          )}
        </div> : <div className="listening-empty"><img src="/covers/local.svg" alt="" /><h2>播放队列为空</h2></div>}
        <div className="stage-toolbar flex items-center justify-between"><Popover><PopoverTrigger asChild><button className="toolbar-button"><SlidersHorizontal size={14} /> 音效 <span>{p.effect}</span><ChevronDown size={12} /></button></PopoverTrigger><PopoverContent className="player-popover w-56">{['原声', '低音增强', '空间回响', '温暖 Lo-fi'].map(e => <button className="popover-item" key={e} onClick={() => p.setEffect(e)}>{e}{p.effect === e && <Check size={14} />}</button>)}</PopoverContent></Popover><Link to="/settings" className="toolbar-button"><Settings2 size={14} /> 播放器样式</Link><Popover><PopoverTrigger asChild><button className="toolbar-button eq-trigger"><Waves size={15} /> 均衡器</button></PopoverTrigger><PopoverContent className="player-popover eq-popover"><div className="eq-heading"><h3>五段均衡器</h3><button onClick={p.resetEqualizer}>重置</button></div><div className="eq-sliders">{eqNames.map((name, i) => <label key={name}><span>{p.equalizer[i] > 0 ? '+' : ''}{p.equalizer[i]}</span><input type="range" min="-12" max="12" value={p.equalizer[i]} onChange={e => p.setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{name}</small></label>)}</div></PopoverContent></Popover></div>
      </section><QueuePanel player={p} onViewInfo={setDetailTrack} onRefreshInfo={refreshInfo} /></div>
      </>}
    </main>
    <Dialog open={createPlaylistOpen} onOpenChange={open => { setCreatePlaylistOpen(open); if (!open) setPlaylistName(''); }}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>新建歌单</DialogTitle><DialogDescription>给你的新歌单取个名字。</DialogDescription><form onSubmit={event => { event.preventDefault(); createPlaylist(); }}><Input autoFocus maxLength={40} placeholder="歌单名称" aria-label="歌单名称" value={playlistName} onChange={event => setPlaylistName(event.target.value)} /><button type="submit" className="playlist-primary" disabled={!playlistName.trim()}>创建歌单</button></form></DialogContent></Dialog>
    <Dialog open={deletePlaylistId !== null} onOpenChange={open => { if (!open) setDeletePlaylistId(null); }}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>删除歌单？</DialogTitle><DialogDescription>「{playlists.find(item => item.id === deletePlaylistId)?.name}」将从歌单列表移除，歌曲不会从音乐库删除。</DialogDescription><div className="playlist-dialog-actions"><button type="button" onClick={() => setDeletePlaylistId(null)}>取消</button><button type="button" className="playlist-danger" onClick={deletePlaylist}>删除歌单</button></div></DialogContent></Dialog>
    {dropActive && <div className="file-drop-overlay"><Plus size={32} /><strong>打开本地音乐</strong></div>}
    <Dialog open={pendingPaths.length > 0} onOpenChange={open => { if (!open) setPendingPaths([]); }}><DialogContent className="music-dialog folder-dialog"><DialogTitle>如何处理这些文件？</DialogTitle><DialogDescription>{pendingPaths.length} 个本地路径</DialogDescription><div className="folder-dialog-actions"><button onClick={() => { void importPaths(pendingPaths, 'temporary'); setPendingPaths([]); }}>仅本次播放</button><button onClick={() => { void importPaths(pendingPaths, 'library'); setPendingPaths([]); }}>加入音乐库</button><button onClick={() => { void importPaths(pendingPaths, 'watch'); setPendingPaths([]); }}>监听所在文件夹</button></div></DialogContent></Dialog>
    <footer className="playback-bar"><div className="mini-track"><button type="button" className="mini-cover-link" aria-label="前往正在播放" title="前往正在播放" onClick={() => navigate('/')}><img className="mini-cover" src={cover} alt="" /></button><div><strong>{p.track.title}</strong><small>{p.track.artist}</small></div>{p.hasTrack && !p.track.source && <IconButton label="喜欢" onClick={toggleLike} active={favorite}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></IconButton>}</div><div className="transport"><div className="transport-buttons"><IconButton label="随机播放" active={p.mode === 'shuffle'} onClick={() => p.setMode(p.mode === 'shuffle' ? 'list' : 'shuffle')}><Shuffle size={17} /></IconButton><IconButton label="上一首" onClick={p.previous}><SkipBack size={20} fill="currentColor" /></IconButton><button className="play-button" disabled={!p.hasTrack} aria-label={p.playing ? '暂停' : '播放'} onClick={p.toggle}>{p.playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><IconButton label="下一首" onClick={p.next}><SkipForward size={20} fill="currentColor" /></IconButton><IconButton label={({ list: '列表循环', repeat: '单曲循环', shuffle: '列表循环', 'stop-track': '播完单曲停止', 'stop-list': '播完列表停止' })[p.mode]} active={p.mode !== 'list' && p.mode !== 'shuffle'} onClick={() => { const modes = ['list', 'repeat', 'stop-track', 'stop-list'] as const; p.setMode(modes[(modes.indexOf(p.mode as typeof modes[number]) + 1) % modes.length]); }}>{p.mode === 'repeat' ? <Repeat1 size={18} /> : p.mode === 'stop-track' ? <Square size={18} /> : p.mode === 'stop-list' ? <ListEnd size={18} /> : <Repeat size={18} />}</IconButton></div><div className="seek-row"><span>{formatTime(p.time)}</span><input aria-label="播放进度" type="range" min="0" max={Math.max(1, p.track.duration)} step="0.1" value={p.time} disabled={!p.hasTrack} onChange={e => p.seek(Number(e.target.value))} style={{ '--fill': `${p.time / Math.max(1, p.track.duration) * 100}%` } as React.CSSProperties} /><span>{formatTime(p.track.duration)}</span></div></div><div className="playback-extras">{p.track.quality && <span className="quality-badge" title={[p.track.quality.sampleRate && `${(p.track.quality.sampleRate / 1000).toFixed(1)} kHz`, p.track.quality.bitDepth && `${p.track.quality.bitDepth}-bit`, p.track.quality.bitrate && `${Math.round(p.track.quality.bitrate / 1000)} kbps`, p.track.quality.codec].filter(Boolean).join(' · ')}>{p.track.quality.lossless ? p.track.quality.sampleRate && p.track.quality.sampleRate >= 88200 ? 'Hi-Res' : '无损' : p.track.quality.bitrate ? `${Math.round(p.track.quality.bitrate / 1000)} kbps` : '音频'}</span>}<Popover><PopoverTrigger asChild><button type="button" className={`icon-button ${sleep > 0 ? 'is-active' : ''}`} aria-label="睡眠定时" title={sleep > 0 ? `睡眠定时：${formatTime(sleep)}` : '睡眠定时'}><Timer size={19} /></button></PopoverTrigger><PopoverContent align="end" className="sleep-quick-popover"><strong>睡眠定时</strong><p>{sleep > 0 ? `剩余 ${formatTime(sleep)}` : '到时间后暂停播放'}</p><div className="sleep-quick-options">{[5, 10, 15, 30, 45, 60].map(minutes => <button key={minutes} type="button" onClick={() => setSleep(minutes * 60)}>{minutes} 分钟</button>)}</div><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const minutes = Number(form.get('minutes')); if (Number.isFinite(minutes) && minutes > 0) setSleep(Math.round(minutes * 60)); }}><label>自定义分钟<input name="minutes" type="number" min="1" max="1440" step="1" defaultValue="20" /></label><button type="submit">设置</button></form>{sleep > 0 && <button type="button" className="sleep-quick-cancel" onClick={() => setSleep(0)}>关闭定时</button>}</PopoverContent></Popover><IconButton label={p.volume ? '静音' : '恢复音量'} onClick={() => p.setVolume(p.volume ? 0 : 65)}>{p.volume ? <Volume2 size={19} /> : <VolumeX size={19} />}</IconButton><input aria-label="音量" type="range" min="0" max="100" value={p.volume} onChange={e => p.setVolume(Number(e.target.value))} style={{ '--fill': `${p.volume}%` } as React.CSSProperties} /><span className="header-separator" /><IconButton label="播放队列" onClick={() => setQueueOpen(true)}><ListMusic size={20} /></IconButton></div></footer>
    {queueOpen && <section className="quick-queue-panel" aria-label="播放队列"><header><div><h2>播放队列</h2><span>{p.queue.length} 首歌曲</span></div><button type="button" aria-label="关闭播放队列" onClick={() => setQueueOpen(false)}><X size={17} /></button></header><div className="quick-queue-list">{p.queue.map((track, index) => <button type="button" key={track.id} className={'queue-track ' + (p.trackId === track.id ? 'current' : '')} aria-current={p.trackId === track.id ? 'true' : undefined} onClick={() => p.select(track.id)}><span className="track-number">{p.trackId === track.id ? <AudioLines size={14} /> : String(index + 1).padStart(2, '0')}</span><img src={track.cover} alt="" /><span className="queue-track-label"><span>{track.title}</span><small>{track.artist}</small></span><span className="track-duration">{formatTime(track.duration)}</span></button>)}{p.queue.length === 0 && <div className="queue-empty">队列为空</div>}</div></section>}
    {focus && p.hasTrack && <section className="immersive-overlay"><img src={cover} alt="" className="immersive-backdrop" /><div className="immersive-shade" /><header><span>{p.track.title} <small>沉浸模式</small></span><IconButton label="退出沉浸模式" onClick={() => setFocus(false)}><Minimize2 size={20} /></IconButton></header><div className="immersive-main"><div className="immersive-art"><img src={cover} alt={`${p.track.album}专辑封面`} /><Spectrum analyser={p.analyser} active={p.playing} /></div><div className="immersive-lyrics"><span className="eyebrow">{p.track.album} · {p.track.artist}</span><h1>{p.track.title}</h1>{hasLyrics && <div>{lines.map((line, i) => <p key={i} className={i === activeLine ? 'current' : ''}>{lyricEffect === '逐字' && i === activeLine && wordLines[i].length > 0 ? wordLines[i].map((word, wi) => <span key={wi} className={wi < activeWord ? 'spoken' : wi === activeWord ? 'speaking' : ''}>{word.text}</span>) : line}</p>)}</div>}</div></div></section>}
    {detailTrack && <Dialog open onOpenChange={open => { if (!open) setDetailTrack(null); }}><DialogContent className={`music-dialog theme-${theme}`}><DialogTitle>关于这首歌</DialogTitle><DialogDescription>{detailTrack.temporary ? '本次播放' : '本地音乐库'}</DialogDescription><div className="detail-modal"><img src={detailTrack.cover} alt={`${detailTrack.album}封面`} /><div><span className="eyebrow">LOCAL AUDIO</span><h2>{detailTrack.title}</h2><p><button type="button" className="track-meta-link" onClick={() => openArtist(detailTrack.artist)}>{detailTrack.artist}</button></p><dl><dt>专辑</dt><dd><button type="button" className="track-meta-link" onClick={() => openAlbum(detailTrack)}>{detailTrack.album}</button></dd><dt>音乐风格</dt><dd>{detailTrack.genre || '未标注'}</dd><dt>发行年份</dt><dd>{detailTrack.year || '未知'}</dd><dt>时长</dt><dd>{formatTime(detailTrack.duration)}</dd><dt>路径</dt><dd>{detailTrack.path}</dd></dl></div></div></DialogContent></Dialog>}
  </div>;
}
