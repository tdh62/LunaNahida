import { type ChangeEvent, type DragEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PlayerSettings from '@/components/PlayerSettings';
import QueuePanel from '@/components/QueuePanel';
import LibraryView from '@/components/LibraryView';
import PlaylistView from '@/components/PlaylistView';
import CatalogView from '@/components/CatalogView';
import { artistKey, buildCatalog, normalizeName, type ArtistMapping } from '@/lib/catalog';
import { mockPlaylists, type Playlist } from '@/lib/playlists';
import { droppedAudioFiles } from '@/lib/local-files';
import { isAudioFile } from '@/hooks/use-player';
import { toast } from 'sonner';
import '@/settings.css';
import '@/sleep-timer.css';
import { AudioLines, Check, ChevronDown, ChevronsLeft, Disc3, X, FolderOpen, Heart, ListEnd, ListMusic, Maximize2, Mic2, Minimize2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Repeat, Repeat1, Settings2, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Square, Timer, Volume2, VolumeX, Waves } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePlayer } from '@/hooks/use-player';
import { formatTime, lyricSets, lyricTranslations, tracks, wordLyricSets, type Track } from '@/lib/music';
import '@/player.css';
import '@/vinyl-playback.css';
import '@/quick-queue.css';
import '@/player-import.css';
import '@/library.css';
import '@/playlists.css';
import '@/catalog.css';
import '@/artist-mappings.css';

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
  const [playlists, setPlaylists] = useState<Playlist[]>(mockPlaylists);
  const [mappings, setMappings] = useState<ArtistMapping[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('luma-artist-mappings') ?? '[]');
      return Array.isArray(saved) ? saved.filter((item): item is ArtistMapping => item && typeof item.root === 'string' && Array.isArray(item.aliases) && item.aliases.every((alias: unknown) => typeof alias === 'string')) : [];
    } catch { return []; }
  });
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [deletePlaylistId, setDeletePlaylistId] = useState<string | null>(null);
  const [playlistNavExpanded, setPlaylistNavExpanded] = useState(false);
  const [recentPlaylistIds, setRecentPlaylistIds] = useState<string[]>([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('luma-theme') || 'dusk'), [lyricEffect, setLyricEffect] = useState('流动'), [lyricScroll, setLyricScroll] = useState('平滑'), [visual, setVisual] = useState('频谱');
  const [liked, setLiked] = useState<number[]>([2]);
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
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const [pendingFolder, setPendingFolder] = useState<File[]>([]), [folderOpen, setFolderOpen] = useState(false), [dropActive, setDropActive] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<File[]>([]), [duplicateCount, setDuplicateCount] = useState(0);
  useEffect(() => { localStorage.setItem('luma-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('luma-artist-mappings', JSON.stringify(mappings)); }, [mappings]);
  useEffect(() => { folderInput.current?.setAttribute('webkitdirectory', ''); }, []);
  const importFiles = async (files: File[], replace = false, duplicates: 'append' | 'overwrite' | 'skip' = 'append') => {
    const count = await p.addFiles(files, replace, duplicates);
    if (count) toast.success(duplicates === 'overwrite' ? `已处理 ${count} 首歌曲` : `已添加 ${count} 首歌曲`);
    else if (duplicates === 'skip') toast.info('重复歌曲已忽略');
    else toast.error('未找到可播放的音频文件');
  };
  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void importFiles(files); };
  const chooseFolder = (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files ?? []).filter(isAudioFile); event.target.value = ''; if (!files.length) { toast.error('文件夹中没有可播放的音频文件'); return; } setPendingFolder(files); setFolderOpen(true); };
  const dropFiles = async (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); dragDepth.current = 0; setDropActive(false);
    const { files, folder } = await droppedAudioFiles(event.dataTransfer);
    const audioFiles = files.filter(isAudioFile);
    if (!audioFiles.length) { toast.error('未找到可播放的音频文件'); return; }
    const names = new Set(p.queue.map(track => track.fileName?.toLowerCase()).filter((name): name is string => Boolean(name)));
    let repeated = 0;
    audioFiles.forEach(file => { const name = file.name.toLowerCase(); if (names.has(name)) repeated++; names.add(name); });
    if (repeated) { setPendingDrop(audioFiles); setDuplicateCount(repeated); }
    else if (folder) { setPendingFolder(audioFiles); setFolderOpen(true); }
    else void importFiles(audioFiles);
  };
  const confirmDrop = (duplicates: 'append' | 'overwrite' | 'skip') => {
    const files = pendingDrop;
    setPendingDrop([]);
    void importFiles(files, false, duplicates);
  };
  const confirmFolder = (replace: boolean) => { void importFiles(pendingFolder, replace); setFolderOpen(false); setPendingFolder([]); };
  const lines = p.track.source || !p.hasTrack ? [] : lyricSets[p.trackId ?? 0] ?? [];
  const translations = p.track.source || !p.hasTrack ? [] : lyricTranslations[p.trackId ?? -1] ?? [];
  const wordLines = p.track.source || !p.hasTrack ? [] : wordLyricSets[p.trackId ?? 0] ?? [];
  const hasLyrics = lines.length > 0;
  const lineLength = hasLyrics ? p.track.duration / (lines.length + 1) || 1 : 1;
  const activeLine = hasLyrics ? Math.min(lines.length - 1, Math.floor(p.time / lineLength)) : 0;
  const activeWord = hasLyrics ? wordLines[activeLine].findIndex((word, i) => p.time >= word.start && (p.time < word.end || i === wordLines[activeLine].length - 1)) : -1;
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
    const key = (e: KeyboardEvent) => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return; if (e.code === 'Space') { e.preventDefault(); p.toggle(); } if (e.code === 'ArrowRight') p.seek(Math.min(p.time + 5, p.track.duration)); if (e.code === 'ArrowLeft') p.seek(Math.max(p.time - 5, 0)); if (e.key === 'Escape') setFocus(false); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [p]);
  useEffect(() => { if (!sleep) return; const timer = window.setInterval(() => setSleep(v => Math.max(0, v - 1)), 1000); return () => window.clearInterval(timer); }, [sleep > 0]);
  useEffect(() => { if (sleep === 1 && p.playing) p.toggle(); }, [sleep]);
  const allTracks = useMemo(() => [...tracks, ...p.queue.filter(t => t.source)], [p.queue]);
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
  return <div ref={appRef} className={`music-app theme-${theme} ${focus ? 'focus-mode' : ''} sidebar-${sidebarMode}`} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDropActive(true); } }} onDragLeave={event => { if (event.dataTransfer.types.includes('Files') && --dragDepth.current <= 0) { dragDepth.current = 0; setDropActive(false); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { void dropFiles(event); }}>
    <aside className="sidebar flex flex-col">
      
      <div className="nav-label">音乐库</div><nav className="space-y-1">{[{ title: '正在播放', path: '/', icon: AudioLines }, { title: '我的音乐', path: '/music', icon: Disc3 }, { title: '歌手', path: '/artists', icon: Mic2 }, { title: '专辑', path: '/albums', icon: Disc3 }, { title: '我喜欢的', path: '/liked', icon: Heart }, { title: '最近播放', path: '/recent', icon: ListMusic }].map(({ title, path, icon: Icon }) => <button key={title} title={title} onClick={() => navigate(path)} className={`nav-item ${!isSettings && (pathname === path || (path === '/artists' && isArtists) || (path === '/albums' && isAlbums)) ? 'selected' : ''}`}><Icon size={18} />{title}{title === '正在播放' && p.playing && <span className="tiny-bars" aria-hidden="true"><i /><i /><i /></span>}{title === '我喜欢的' && <small>{liked.length}</small>}</button>)}</nav>
      <Link to="/settings" title="播放器设置" className={`nav-item settings-nav ${isSettings ? 'selected' : ''}`}><Settings2 size={18} />播放器设置</Link>
      <div className="playlist-nav-heading"><button type="button" onClick={() => navigate('/playlists')} className="nav-label" title="查看全部歌单">歌单</button><button type="button" className="playlist-nav-add" title="新建歌单" aria-label="新建歌单" onClick={() => setCreatePlaylistOpen(true)}><Plus size={16} /></button></div>
      <nav className="playlist-nav"><button type="button" title="我的歌单" className={`nav-item ${pathname === '/playlists' ? 'selected' : ''}`} onClick={() => navigate('/playlists')}><ListMusic size={18} />我的歌单<small>{playlists.length}</small></button>{sidebarPlaylists.map(item => <button type="button" key={item.id} title={item.name} className={`nav-item playlist-nav-entry ${playlistId === item.id ? 'selected' : ''}`} onClick={() => openPlaylist(item.id)}><img src={item.cover} alt="" /><span>{item.name}</span></button>)}{recentPlaylists.length > 2 && <button type="button" className="playlist-nav-more" onClick={() => setPlaylistNavExpanded(value => !value)}>{playlistNavExpanded ? '收起' : '展开'}</button>}{recentPlaylists.length > 10 && playlistNavExpanded && <button type="button" className="playlist-nav-more" onClick={() => navigate('/playlists')}>查看全部</button>}</nav>
      <div className="nav-label mt-10">本地音乐</div><div className="import-actions"><button title="打开歌曲" className="nav-item" onClick={() => fileInput.current?.click()}><Plus size={18} />打开歌曲</button><button title="打开文件夹" className="nav-item" onClick={() => folderInput.current?.click()}><FolderOpen size={18} />打开文件夹</button></div>
      <div className="sidebar-controls sidebar-bottom-controls"><button type="button" className="sidebar-toggle" title={sidebarMode === 'collapsed' ? '展开侧栏' : '折叠为图标'} aria-label={sidebarMode === 'collapsed' ? '展开侧栏' : '折叠为图标'} onClick={() => setSidebarMode(sidebarMode === 'collapsed' ? 'expanded' : 'collapsed')}>{sidebarMode === 'collapsed' ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>{view === '正在播放' && !isSettings && <button type="button" className="sidebar-toggle" title="完全隐藏侧栏" aria-label="完全隐藏侧栏" onClick={() => setSidebarMode('hidden')}><ChevronsLeft size={17} /></button>}</div>
    </aside>
    {sidebarMode === 'hidden' && <button type="button" className="sidebar-restore" title="展开侧栏" aria-label="展开侧栏" onClick={() => setSidebarMode('expanded')}><PanelLeftOpen size={19} /></button>}
    <main className={`workspace min-w-0 ${isSettings ? 'settings-workspace' : ''} ${isArtists || isAlbums ? 'catalog-workspace' : ''} ${isPlaylists || pathname === '/music' || pathname === '/liked' || pathname === '/recent' ? 'scrolling-workspace' : ''}`}>
      {isSettings ? <PlayerSettings theme={theme} setTheme={setTheme} visual={visual} setVisual={setVisual} lyricEffect={lyricEffect} setLyricEffect={setLyricEffect} lyricScroll={lyricScroll} setLyricScroll={setLyricScroll} showTranslation={showTranslation} setShowTranslation={setShowTranslation} sleep={sleep} setSleep={setSleep} effect={p.effect} setEffect={p.setEffect} equalizer={p.equalizer} setBand={p.setBand} resetEqualizer={p.resetEqualizer} mappings={mappings} setMappings={setMappings} artistNames={[...new Set(allTracks.map(track => track.artist))]} /> : isArtists || isAlbums ? <CatalogView kind={isArtists ? 'artists' : 'albums'} artists={catalog.artists} albums={catalog.albums} artist={selectedArtist} album={selectedAlbum} currentId={p.trackId} liked={liked} playlists={playlists} onPlay={id => { p.select(id); navigate('/'); }} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onAddToPlaylist={addToPlaylist} onArtist={openArtist} onAlbum={openAlbum} /> : isPlaylists ? <PlaylistView playlists={overviewPlaylists} playlist={activePlaylist} tracks={allTracks} currentId={p.trackId} liked={liked} onCreate={() => setCreatePlaylistOpen(true)} onDelete={setDeletePlaylistId} onPlay={id => { p.select(id); navigate('/'); }} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onArtist={openArtist} onAlbum={openAlbum} onAddToPlaylist={addToPlaylist} onRemoveFromPlaylist={removeFromPlaylist} onEditPlaylist={edited => setPlaylists(prev => prev.map(item => item.id === edited.id ? edited : item))} /> : view !== '正在播放' ? <LibraryView key={view} title={view} tracks={visibleTracks} currentId={p.trackId} liked={liked} onToggleLike={toggleTrackLike} onViewInfo={setDetailTrack} onArtist={openArtist} onAlbum={openAlbum} playlists={playlists} onAddToPlaylist={addToPlaylist} onPlay={id => { p.select(id); navigate('/'); }} /> : <>
      <div className="main-columns"><section className="listening-stage">
        {p.hasTrack ? <div className={`listening-content ${!hasLyrics ? 'without-lyrics' : ''}`}><div className="album-column"><div className={`album-art ${visual === '唱片' ? 'vinyl' : ''}`}><img src={p.track.cover} alt={`${p.track.album}专辑封面`} />{!p.track.source && <><span className="album-print">{p.track.english}</span><span className="cover-corner">VOL. 0{(p.trackId ?? 0) + 1}</span></>}</div><div className="album-title flex items-center justify-between"><h2>{p.track.title}</h2>{!p.track.source && <IconButton label={favorite ? '取消喜欢' : '喜欢这首歌'} active={favorite} onClick={toggleLike}><Heart size={21} fill={favorite ? 'currentColor' : 'none'} /></IconButton>}</div><p className="artist-name"><button type="button" className="track-meta-link" onClick={() => openArtist(p.track.artist)}>{p.track.artist}</button><span> · </span><button type="button" className="track-meta-link" onClick={() => openAlbum(p.track)}>{p.track.album}</button></p><div className="track-tags"><span>{p.track.source ? '本地文件' : '演示曲目'}</span><span>{p.track.genre.split(' / ')[0]}</span></div><div className={`visualizer ${p.playing ? 'animated' : ''} ${visual === '呼吸' ? 'breathing' : ''}`} aria-label="音乐频谱">{visual === '频谱' ? <Spectrum analyser={p.analyser} active={p.playing} /> : Array.from({ length: 48 }, (_, i) => <i key={i} style={{ height: `${8 + Math.sin(i * .65) ** 2 * 23 + Math.sin(i * .2) ** 2 * 13}px`, animationDelay: `${i * -.13}s`, animationDuration: `${.65 + i % 5 * .2}s` }} />)}</div></div>
          {hasLyrics && (
            <div className={`lyrics-column lyric-${lyricEffect} ${lyricScroll === '即时' ? 'lyric-scroll-instant' : ''} ${browsingLyrics ? 'is-browsing' : ''}`}><IconButton className="lyrics-immersive-toggle" label="沉浸模式" onClick={() => setFocus(true)}><Maximize2 size={16} /></IconButton>
              <div
                ref={lyricsWindow}
                className="lyrics-window"
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
                        p.seek(i * lineLength);
                        setBrowsingLyrics(false);
                        if (followTimer.current) clearTimeout(followTimer.current);
                      }}
                    >
                      <span>{lyricEffect === '逐字' && i === activeLine ? wordLines[i].map((word, wi) => <span key={wi} className={`lyric-word ${wi < activeWord ? 'spoken' : ''} ${wi === activeWord ? 'speaking' : ''}`} style={{ animationDuration: `${Math.max(.1, word.end - word.start)}s` }}>{word.text}</span>) : line}</span>
                      {i === activeLine && showTranslation && translations[i] && <small>{translations[i]}</small>}
                    </button>
                  ))}
                </div>
              </div>
              {translations.length > 0 && <button type="button" title={showTranslation ? '隐藏翻译' : '显示翻译'} aria-label={showTranslation ? '隐藏翻译' : '显示翻译'} aria-pressed={showTranslation} onClick={() => setShowTranslation(!showTranslation)} className={`translation-toggle ${showTranslation ? 'is-active' : ''}`}>文</button>}
            </div>
          )}
        </div> : <div className="listening-empty"><img src="/covers/local.svg" alt="" /><h2>播放队列为空</h2></div>}
        <div className="stage-toolbar flex items-center justify-between"><Popover><PopoverTrigger asChild><button className="toolbar-button"><SlidersHorizontal size={14} /> 音效 <span>{p.effect}</span><ChevronDown size={12} /></button></PopoverTrigger><PopoverContent className="player-popover w-56">{['原声', '低音增强', '空间回响', '温暖 Lo-fi'].map(e => <button className="popover-item" key={e} onClick={() => p.setEffect(e)}>{e}{p.effect === e && <Check size={14} />}</button>)}</PopoverContent></Popover><Link to="/settings" className="toolbar-button"><Settings2 size={14} /> 播放器样式</Link><Popover><PopoverTrigger asChild><button className="toolbar-button eq-trigger"><Waves size={15} /> 均衡器</button></PopoverTrigger><PopoverContent className="player-popover eq-popover"><div className="eq-heading"><h3>五段均衡器</h3><button onClick={p.resetEqualizer}>重置</button></div><div className="eq-sliders">{eqNames.map((name, i) => <label key={name}><span>{p.equalizer[i] > 0 ? '+' : ''}{p.equalizer[i]}</span><input type="range" min="-12" max="12" value={p.equalizer[i]} onChange={e => p.setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{name}</small></label>)}</div></PopoverContent></Popover></div>
      </section><QueuePanel player={p} onViewInfo={setDetailTrack} /></div>
      </>}
    </main>
    <input ref={fileInput} className="sr-only" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm" multiple onChange={chooseFiles} />
    <input ref={folderInput} className="sr-only" type="file" multiple onChange={chooseFolder} />
    <Dialog open={createPlaylistOpen} onOpenChange={open => { setCreatePlaylistOpen(open); if (!open) setPlaylistName(''); }}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>新建歌单</DialogTitle><DialogDescription>给你的新歌单取个名字。</DialogDescription><form onSubmit={event => { event.preventDefault(); createPlaylist(); }}><Input autoFocus maxLength={40} placeholder="歌单名称" aria-label="歌单名称" value={playlistName} onChange={event => setPlaylistName(event.target.value)} /><button type="submit" className="playlist-primary" disabled={!playlistName.trim()}>创建歌单</button></form></DialogContent></Dialog>
    <Dialog open={deletePlaylistId !== null} onOpenChange={open => { if (!open) setDeletePlaylistId(null); }}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>删除歌单？</DialogTitle><DialogDescription>「{playlists.find(item => item.id === deletePlaylistId)?.name}」将从歌单列表移除，歌曲不会从音乐库删除。</DialogDescription><div className="playlist-dialog-actions"><button type="button" onClick={() => setDeletePlaylistId(null)}>取消</button><button type="button" className="playlist-danger" onClick={deletePlaylist}>删除歌单</button></div></DialogContent></Dialog>
    {dropActive && <div className="file-drop-overlay"><Plus size={32} /><strong>添加到播放队列</strong></div>}
    <Dialog open={pendingDrop.length > 0} onOpenChange={open => { if (!open) setPendingDrop([]); }}><DialogContent className="music-dialog folder-dialog"><DialogTitle>发现重复歌曲</DialogTitle><DialogDescription>拖入的 {pendingDrop.length} 个音频文件中，有 {duplicateCount} 个文件名与播放列表或本次拖入的文件重复。如何处理？</DialogDescription><div className="folder-dialog-actions duplicate-dialog-actions"><button onClick={() => confirmDrop('overwrite')}>覆盖同名歌曲</button><button onClick={() => confirmDrop('append')}>全部追加</button><button onClick={() => confirmDrop('skip')}>忽略重复</button></div></DialogContent></Dialog>
    <Dialog open={folderOpen} onOpenChange={open => { setFolderOpen(open); if (!open) setPendingFolder([]); }}><DialogContent className="music-dialog folder-dialog"><DialogTitle>导入文件夹</DialogTitle><DialogDescription>找到 {pendingFolder.length} 个音频文件。如何处理现有播放队列？</DialogDescription><div className="folder-dialog-actions"><button onClick={() => confirmFolder(false)}>追加到队列</button><button onClick={() => confirmFolder(true)}>替换队列</button></div></DialogContent></Dialog>
    <footer className="playback-bar"><div className="mini-track"><img className="mini-cover" src={p.track.cover} alt="当前专辑" /><div><strong>{p.track.title}</strong><small>{p.track.artist}</small></div>{p.hasTrack && !p.track.source && <IconButton label="喜欢" onClick={toggleLike} active={favorite}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></IconButton>}</div><div className="transport"><div className="transport-buttons"><IconButton label="随机播放" active={p.mode === 'shuffle'} onClick={() => p.setMode(p.mode === 'shuffle' ? 'list' : 'shuffle')}><Shuffle size={17} /></IconButton><IconButton label="上一首" onClick={p.previous}><SkipBack size={20} fill="currentColor" /></IconButton><button className="play-button" disabled={!p.hasTrack} aria-label={p.playing ? '暂停' : '播放'} onClick={p.toggle}>{p.playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><IconButton label="下一首" onClick={p.next}><SkipForward size={20} fill="currentColor" /></IconButton><IconButton label={({ list: '列表循环', repeat: '单曲循环', shuffle: '列表循环', 'stop-track': '播完单曲停止', 'stop-list': '播完列表停止' })[p.mode]} active={p.mode !== 'list' && p.mode !== 'shuffle'} onClick={() => { const modes = ['list', 'repeat', 'stop-track', 'stop-list'] as const; p.setMode(modes[(modes.indexOf(p.mode as typeof modes[number]) + 1) % modes.length]); }}>{p.mode === 'repeat' ? <Repeat1 size={18} /> : p.mode === 'stop-track' ? <Square size={18} /> : p.mode === 'stop-list' ? <ListEnd size={18} /> : <Repeat size={18} />}</IconButton></div><div className="seek-row"><span>{formatTime(p.time)}</span><input aria-label="播放进度" type="range" min="0" max={Math.max(1, p.track.duration)} step="0.1" value={p.time} disabled={!p.hasTrack} onChange={e => p.seek(Number(e.target.value))} style={{ '--fill': `${p.time / Math.max(1, p.track.duration) * 100}%` } as React.CSSProperties} /><span>{formatTime(p.track.duration)}</span></div></div><div className="playback-extras">{p.track.quality && <span className="quality-badge" title={[p.track.quality.sampleRate && `${(p.track.quality.sampleRate / 1000).toFixed(1)} kHz`, p.track.quality.bitDepth && `${p.track.quality.bitDepth}-bit`, p.track.quality.bitrate && `${Math.round(p.track.quality.bitrate / 1000)} kbps`, p.track.quality.codec].filter(Boolean).join(' · ')}>{p.track.quality.lossless ? p.track.quality.sampleRate && p.track.quality.sampleRate >= 88200 ? 'Hi-Res' : '无损' : p.track.quality.bitrate ? `${Math.round(p.track.quality.bitrate / 1000)} kbps` : '音频'}</span>}<Popover><PopoverTrigger asChild><button type="button" className={`icon-button ${sleep > 0 ? 'is-active' : ''}`} aria-label="睡眠定时" title={sleep > 0 ? `睡眠定时：${formatTime(sleep)}` : '睡眠定时'}><Timer size={19} /></button></PopoverTrigger><PopoverContent align="end" className="sleep-quick-popover"><strong>睡眠定时</strong><p>{sleep > 0 ? `剩余 ${formatTime(sleep)}` : '到时间后暂停播放'}</p><div className="sleep-quick-options">{[5, 10, 15, 30, 45, 60].map(minutes => <button key={minutes} type="button" onClick={() => setSleep(minutes * 60)}>{minutes} 分钟</button>)}</div><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const minutes = Number(form.get('minutes')); if (Number.isFinite(minutes) && minutes > 0) setSleep(Math.round(minutes * 60)); }}><label>自定义分钟<input name="minutes" type="number" min="1" max="1440" step="1" defaultValue="20" /></label><button type="submit">设置</button></form>{sleep > 0 && <button type="button" className="sleep-quick-cancel" onClick={() => setSleep(0)}>关闭定时</button>}</PopoverContent></Popover><IconButton label={p.volume ? '静音' : '恢复音量'} onClick={() => p.setVolume(p.volume ? 0 : 65)}>{p.volume ? <Volume2 size={19} /> : <VolumeX size={19} />}</IconButton><input aria-label="音量" type="range" min="0" max="100" value={p.volume} onChange={e => p.setVolume(Number(e.target.value))} style={{ '--fill': `${p.volume}%` } as React.CSSProperties} /><span className="header-separator" /><IconButton label="播放队列" onClick={() => setQueueOpen(true)}><ListMusic size={20} /></IconButton></div></footer>
    {queueOpen && <section className="quick-queue-panel" aria-label="播放队列"><header><div><h2>播放队列</h2><span>{p.queue.length} 首歌曲</span></div><button type="button" aria-label="关闭播放队列" onClick={() => setQueueOpen(false)}><X size={17} /></button></header><div className="quick-queue-list">{p.queue.map((track, index) => <button type="button" key={track.id} className={'queue-track ' + (p.trackId === track.id ? 'current' : '')} aria-current={p.trackId === track.id ? 'true' : undefined} onClick={() => p.select(track.id)}><span className="track-number">{p.trackId === track.id ? <AudioLines size={14} /> : String(index + 1).padStart(2, '0')}</span><img src={track.cover} alt="" /><span className="queue-track-label"><span>{track.title}</span><small>{track.artist}</small></span><span className="track-duration">{formatTime(track.duration)}</span></button>)}{p.queue.length === 0 && <div className="queue-empty">队列为空</div>}</div></section>}
    {focus && p.hasTrack && <section className="immersive-overlay"><img src={p.track.cover} alt="" className="immersive-backdrop" /><div className="immersive-shade" /><header><span>{p.track.title} <small>沉浸模式</small></span><IconButton label="退出沉浸模式" onClick={() => setFocus(false)}><Minimize2 size={20} /></IconButton></header><div className="immersive-main"><div className="immersive-art"><img src={p.track.cover} alt={`${p.track.album}专辑封面`} /><Spectrum analyser={p.analyser} active={p.playing} /></div><div className="immersive-lyrics"><span className="eyebrow">{p.track.album} · {p.track.artist}</span><h1>{p.track.title}</h1>{hasLyrics && <div>{lines.map((line, i) => <p key={i} className={i === activeLine ? 'current' : ''}>{lyricEffect === '逐字' && i === activeLine ? wordLines[i].map((word, wi) => <span key={wi} className={wi < activeWord ? 'spoken' : wi === activeWord ? 'speaking' : ''}>{word.text}</span>) : line}</p>)}</div>}</div></div></section>}
    {detailTrack && <Dialog open onOpenChange={open => { if (!open) setDetailTrack(null); }}><DialogContent className={`music-dialog theme-${theme}`}><DialogTitle>关于这首歌</DialogTitle><DialogDescription>{detailTrack.source ? '本地文件 · 暂无歌词' : '演示曲目'}</DialogDescription><div className="detail-modal"><img src={detailTrack.cover} alt={`${detailTrack.album}封面`} /><div><span className="eyebrow">{detailTrack.source ? 'LOCAL AUDIO' : `TRACK 0${(detailTrack.id ?? 0) + 1}`}</span><h2>{detailTrack.title}</h2><p><button type="button" className="track-meta-link" onClick={() => openArtist(detailTrack.artist)}>{detailTrack.artist}</button></p><dl><dt>专辑</dt><dd><button type="button" className="track-meta-link" onClick={() => openAlbum(detailTrack)}>{detailTrack.album}</button></dd><dt>音乐风格</dt><dd>{detailTrack.genre}</dd><dt>发行年份</dt><dd>{detailTrack.year}</dd><dt>时长</dt><dd>{formatTime(detailTrack.duration)}</dd></dl></div></div><p className="demo-note">{detailTrack.source ? '本地音频暂无歌词。' : '演示曲目的音频由浏览器生成，歌曲信息与歌词为演示数据。'}</p></DialogContent></Dialog>}
  </div>;
}
