import { type ChangeEvent, type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PlayerSettings from '@/components/PlayerSettings';
import QueuePanel from '@/components/QueuePanel';
import { droppedAudioFiles } from '@/lib/local-files';
import { isAudioFile } from '@/hooks/use-player';
import { toast } from 'sonner';
import '@/settings.css';
import { AudioLines, ArrowUpRight, Check, ChevronDown, ChevronRight, Disc3, FolderOpen, Heart, ListMusic, Maximize2, Minimize2, Pause, Play, Plus, Repeat, Repeat1, Search, Settings2, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Volume2, VolumeX, Waves } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePlayer } from '@/hooks/use-player';
import { formatTime, lyricSets, tracks, wordLyricSets } from '@/lib/music';
import '@/player.css';
import '@/player-import.css';

const eqNames = ['低音', '低中', '中音', '高中', '高音'];
function IconButton({ children, label, onClick, active = false, className = '' }: { children: ReactNode; label: string; onClick?: () => void; active?: boolean; className?: string }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`icon-button ${active ? 'is-active' : ''} ${className}`}>{children}</button>;
}
function Spectrum({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const context = element.getContext('2d'); if (!context) return;
    let frame = 0;
    const draw = () => {
      const width = element.width = element.clientWidth * 2, height = element.height = element.clientHeight * 2;
      context.clearRect(0, 0, width, height);
      const data = new Uint8Array(analyser?.frequencyBinCount ?? 64);
      if (analyser && active) analyser.getByteFrequencyData(data);
      const bars = 34, gap = 5, barWidth = Math.max(2, (width - gap * bars) / bars);
      for (let i = 0; i < bars; i++) { const value = active ? data[Math.floor(i * data.length / bars)] / 255 : .1; const barHeight = Math.max(3, value * height * .9); context.fillStyle = getComputedStyle(element).color; context.globalAlpha = .38 + value * .62; context.fillRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight); }
      frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [analyser, active]);
  return <canvas ref={canvas} className="spectrum-canvas" aria-label="实时频谱" />;
}
export default function Index() {
  const p = usePlayer();
  const navigate = useNavigate();
  const isSettings = useLocation().pathname === '/settings';
  const [theme, setTheme] = useState(() => localStorage.getItem('luma-theme') || 'dusk'), [lyricEffect, setLyricEffect] = useState('流动'), [visual, setVisual] = useState('频谱');
  const [liked, setLiked] = useState<number[]>([2]);
  const [details, setDetails] = useState(false), [focus, setFocus] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState(''), [view, setView] = useState('正在播放'), [library, setLibrary] = useState(false);
  const [sleep, setSleep] = useState(0), [showTranslation, setShowTranslation] = useState(true);
  const appRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const [pendingFolder, setPendingFolder] = useState<File[]>([]), [folderOpen, setFolderOpen] = useState(false), [dropActive, setDropActive] = useState(false);
  useEffect(() => { localStorage.setItem('luma-theme', theme); }, [theme]);
  useEffect(() => { folderInput.current?.setAttribute('webkitdirectory', ''); }, []);
  const importFiles = async (files: File[], replace = false) => {
    const count = await p.addFiles(files, replace);
    if (count) toast.success(`已添加 ${count} 首歌曲`);
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
    if (folder) { setPendingFolder(audioFiles); setFolderOpen(true); }
    else void importFiles(audioFiles);
  };
  const confirmFolder = (replace: boolean) => { void importFiles(pendingFolder, replace); setFolderOpen(false); setPendingFolder([]); };
  const lines = p.track.source ? ['本地歌曲', '歌词数据暂未提供', p.track.title, '本地音频播放中'] : lyricSets[p.trackId ?? 0];
  const wordLines = p.track.source ? lines.map((line, index) => [...line].map((text, i) => ({ text, start: index * p.track.duration / (lines.length + 1) + i * .25, end: index * p.track.duration / (lines.length + 1) + (i + 1) * .25 }))) : wordLyricSets[p.trackId ?? 0];
  const lineLength = p.track.duration / (lines.length + 1) || 1, activeLine = Math.min(lines.length - 1, Math.floor(p.time / lineLength));
  const activeWord = wordLines[activeLine].findIndex((word, i) => p.time >= word.start && (p.time < word.end || i === wordLines[activeLine].length - 1));
  const favorite = liked.includes(p.trackId);
  const toggleLike = () => setLiked(prev => favorite ? prev.filter(id => id !== p.trackId) : [...prev, p.trackId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return; if (e.code === 'Space') { e.preventDefault(); p.toggle(); } if (e.code === 'ArrowRight') p.seek(Math.min(p.time + 5, p.track.duration)); if (e.code === 'ArrowLeft') p.seek(Math.max(p.time - 5, 0)); if (e.key === 'Escape') setFocus(false); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [p]);
  useEffect(() => { const sync = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', sync); return () => document.removeEventListener('fullscreenchange', sync); }, []);
  useEffect(() => { if (!sleep) return; const timer = window.setInterval(() => setSleep(v => Math.max(0, v - 1)), 1000); return () => window.clearInterval(timer); }, [sleep > 0]);
  useEffect(() => { if (sleep === 1 && p.playing) p.toggle(); }, [sleep]);
  const toggleFullscreen = async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await appRef.current?.requestFullscreen(); };
  const filtered = [...tracks, ...p.queue.filter(t => t.source)].filter(t => (view !== '我喜欢的' || liked.includes(t.id)) && `${t.title}${t.artist}${t.album}`.toLowerCase().includes(search.toLowerCase()));
  return <div ref={appRef} className={`music-app theme-${theme} ${focus ? 'focus-mode' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDropActive(true); } }} onDragLeave={event => { if (event.dataTransfer.types.includes('Files') && --dragDepth.current <= 0) { dragDepth.current = 0; setDropActive(false); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { void dropFiles(event); }}>
    <aside className="sidebar flex flex-col">
      <Link to="/" className="brand flex items-center gap-2.5"><span className="brand-icon"><AudioLines size={23} /></span><span>Luma<span className="font-normal">Tune</span><i /></span></Link>
      <div className="nav-label">音乐库</div><nav className="space-y-1">{[{ title: '正在播放', icon: AudioLines }, { title: '我的音乐', icon: Disc3 }, { title: '我喜欢的', icon: Heart }, { title: '最近播放', icon: ListMusic }].map(({ title, icon: Icon }) => <button key={title} onClick={() => { navigate('/'); setView(title); if (title !== '正在播放') setLibrary(true); }} className={`nav-item ${!isSettings && view === title ? 'selected' : ''}`}><Icon size={18} />{title}{title === '正在播放' && <span className="tiny-bars"><i /><i /><i /></span>}{title === '我喜欢的' && <small>{liked.length}</small>}</button>)}</nav>
      <Link to="/settings" className={`nav-item settings-nav ${isSettings ? 'selected' : ''}`}><Settings2 size={18} />播放器设置</Link>
      <div className="nav-label mt-10">本地音乐</div><div className="import-actions"><button className="nav-item" onClick={() => fileInput.current?.click()}><Plus size={18} />打开歌曲</button><button className="nav-item" onClick={() => folderInput.current?.click()}><FolderOpen size={18} />打开文件夹</button></div>
    </aside>
    <main className={`workspace min-w-0 ${isSettings ? 'settings-workspace' : ''}`}>
      <header className="topbar flex items-center justify-between gap-4"><div className="flex items-center gap-3"><Link to="/" className="breadcrumb">音乐空间</Link><ChevronRight size={13} className="muted" /><span>{isSettings ? '设置' : '正在播放'}</span></div><div className="flex items-center gap-5"><IconButton label="搜索曲目" onClick={() => { setView('我的音乐'); setLibrary(true); }}><Search size={18} /></IconButton><span className="header-separator" /><IconButton label={fullscreen ? '退出全屏' : '进入全屏沉浸模式'} active={fullscreen} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</IconButton></div></header>
      {isSettings ? <PlayerSettings theme={theme} setTheme={setTheme} visual={visual} setVisual={setVisual} lyricEffect={lyricEffect} setLyricEffect={setLyricEffect} showTranslation={showTranslation} setShowTranslation={setShowTranslation} sleep={sleep} setSleep={setSleep} effect={p.effect} setEffect={p.setEffect} equalizer={p.equalizer} setBand={p.setBand} resetEqualizer={p.resetEqualizer} /> : <>
      <div className="main-columns"><section className="listening-stage"><div className="stage-top flex items-center justify-between"><span>{p.playing ? '正在播放' : p.hasTrack ? '已暂停' : '队列为空'}</span>{p.hasTrack && <button className="text-action" onClick={() => setDetails(true)}>曲目详情 <ArrowUpRight size={14} /></button>}</div>
        {p.hasTrack ? <div className="listening-content"><div className="album-column"><button className={`album-art ${visual === '唱片' ? 'vinyl' : ''}`} onClick={() => setDetails(true)} aria-label="查看专辑封面与详情"><img src={p.track.cover} alt={`${p.track.album}专辑封面`} />{!p.track.source && <><span className="album-print">{p.track.english}</span><span className="cover-corner">VOL. 0{(p.trackId ?? 0) + 1}</span></>}</button><div className="album-title flex items-center justify-between"><h2>{p.track.title}</h2><IconButton label={favorite ? '取消喜欢' : '喜欢这首歌'} active={favorite} onClick={toggleLike}><Heart size={21} fill={favorite ? 'currentColor' : 'none'} /></IconButton></div><p className="artist-name">{p.track.artist}<span> · </span>{p.track.album}</p><div className="track-tags"><span>{p.track.source ? '本地文件' : '演示曲目'}</span><span>{p.track.genre.split(' / ')[0]}</span></div><div className={`visualizer ${p.playing ? 'animated' : ''} ${visual === '呼吸' ? 'breathing' : ''}`} aria-label="音乐频谱"><Spectrum analyser={p.analyser} active={p.playing && visual === '频谱'} />{visual !== '频谱' && Array.from({ length: 48 }, (_, i) => <i key={i} style={{ height: `${8 + Math.sin(i * .65) ** 2 * 23 + Math.sin(i * .2) ** 2 * 13}px`, animationDelay: `${i * -.13}s`, animationDuration: `${.65 + i % 5 * .2}s` }} />)}</div></div>
          <div className={`lyrics-column lyric-${lyricEffect}`}><div className="lyrics-header"><span>歌词 <small>LYRICS</small></span>{!p.track.source && <button title="切换歌词显示" onClick={() => setShowTranslation(!showTranslation)} className={showTranslation ? 'is-active' : ''}>文</button>}</div><div className="lyrics-window"><div className="lyrics-track" style={{ transform: `translateY(${112 - activeLine * 66}px)` }}>{lines.map((line, i) => <button key={`${p.trackId}-${i}`} className={`lyric-line ${i === activeLine ? 'current' : ''} ${Math.abs(i - activeLine) > 2 ? 'distant' : ''}`} onClick={() => p.seek(i * lineLength)}><span>{lyricEffect === '逐字' && i === activeLine ? wordLines[i].map((word, wi) => <span key={wi} className={`lyric-word ${wi < activeWord ? 'spoken' : ''} ${wi === activeWord ? 'speaking' : ''}`} style={{ animationDuration: `${Math.max(.1, word.end - word.start)}s` }}>{word.text}</span>) : line}</span>{i === activeLine && showTranslation && !p.track.source && <small>{i === 0 ? 'The wind carries our thoughts away.' : 'Take a breath. Let the world slow down.'}</small>}</button>)}</div></div><div className="lyric-footer"><div className="lyric-effects">{['流动', '聚焦', '逐字'].map(v => <button key={v} className={lyricEffect === v ? 'active' : ''} onClick={() => setLyricEffect(v)}>{v}</button>)}</div></div></div>
        </div> : <div className="listening-empty"><img src="/covers/local.svg" alt="" /><h2>播放队列为空</h2></div>}
        <div className="stage-toolbar flex items-center justify-between"><Popover><PopoverTrigger asChild><button className="toolbar-button"><SlidersHorizontal size={14} /> 音效 <span>{p.effect}</span><ChevronDown size={12} /></button></PopoverTrigger><PopoverContent className="player-popover w-56"><h3>声音的另一种可能</h3>{['原声', '低音增强', '空间回响', '温暖 Lo-fi'].map(e => <button className="popover-item" key={e} onClick={() => p.setEffect(e)}>{e}{p.effect === e && <Check size={14} />}</button>)}</PopoverContent></Popover><Link to="/settings" className="toolbar-button"><Settings2 size={14} /> 播放器样式</Link><Popover><PopoverTrigger asChild><button className="toolbar-button eq-trigger"><Waves size={15} /> 均衡器</button></PopoverTrigger><PopoverContent className="player-popover eq-popover"><div className="eq-heading"><h3>五段均衡器</h3><button onClick={p.resetEqualizer}>重置</button></div><div className="eq-sliders">{eqNames.map((name, i) => <label key={name}><span>{p.equalizer[i] > 0 ? '+' : ''}{p.equalizer[i]}</span><input type="range" min="-12" max="12" value={p.equalizer[i]} onChange={e => p.setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{name}</small></label>)}</div></PopoverContent></Popover></div>
      </section><QueuePanel player={p} /></div>
      </>}
    </main>
    <input ref={fileInput} className="sr-only" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm" multiple onChange={chooseFiles} />
    <input ref={folderInput} className="sr-only" type="file" multiple onChange={chooseFolder} />
    {dropActive && <div className="file-drop-overlay"><Plus size={32} /><strong>添加到播放队列</strong></div>}
    <Dialog open={folderOpen} onOpenChange={open => { setFolderOpen(open); if (!open) setPendingFolder([]); }}><DialogContent className="music-dialog folder-dialog"><DialogTitle>导入文件夹</DialogTitle><DialogDescription>找到 {pendingFolder.length} 个音频文件。如何处理现有播放队列？</DialogDescription><div className="folder-dialog-actions"><button onClick={() => confirmFolder(false)}>追加到队列</button><button onClick={() => confirmFolder(true)}>替换队列</button></div></DialogContent></Dialog>
    <footer className="playback-bar"><div className="mini-track"><button onClick={() => p.hasTrack && setDetails(true)} disabled={!p.hasTrack}><img src={p.track.cover} alt="当前专辑" /></button><div><strong>{p.track.title}</strong><small>{p.track.artist}</small></div>{p.hasTrack && <IconButton label="喜欢" onClick={toggleLike} active={favorite}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></IconButton>}</div><div className="transport"><div className="transport-buttons"><IconButton label="随机播放" active={p.mode === 'shuffle'} onClick={() => p.setMode(p.mode === 'shuffle' ? 'list' : 'shuffle')}><Shuffle size={17} /></IconButton><IconButton label="上一首" onClick={p.previous}><SkipBack size={20} fill="currentColor" /></IconButton><button className="play-button" disabled={!p.hasTrack} aria-label={p.playing ? '暂停' : '播放'} onClick={p.toggle}>{p.playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><IconButton label="下一首" onClick={p.next}><SkipForward size={20} fill="currentColor" /></IconButton><IconButton label="单曲循环" active={p.mode === 'repeat'} onClick={() => p.setMode(p.mode === 'repeat' ? 'list' : 'repeat')}>{p.mode === 'repeat' ? <Repeat1 size={18} /> : <Repeat size={18} />}</IconButton></div><div className="seek-row"><span>{formatTime(p.time)}</span><input aria-label="播放进度" type="range" min="0" max={Math.max(1, p.track.duration)} step="0.1" value={p.time} disabled={!p.hasTrack} onChange={e => p.seek(Number(e.target.value))} style={{ '--fill': `${p.time / Math.max(1, p.track.duration) * 100}%` } as React.CSSProperties} /><span>{formatTime(p.track.duration)}</span></div></div><div className="playback-extras"><IconButton label={p.volume ? '静音' : '恢复音量'} onClick={() => p.setVolume(p.volume ? 0 : 65)}>{p.volume ? <Volume2 size={19} /> : <VolumeX size={19} />}</IconButton><input aria-label="音量" type="range" min="0" max="100" value={p.volume} onChange={e => p.setVolume(Number(e.target.value))} /><span className="header-separator" /><IconButton label="播放队列" onClick={() => { navigate('/'); setFocus(false); }}><ListMusic size={20} /></IconButton></div></footer>
    {focus && p.hasTrack && <section className="immersive-overlay"><img src={p.track.cover} alt="" className="immersive-backdrop" /><div className="immersive-shade" /><header><span className="brand-icon"><AudioLines size={21} /></span><span>LumaTune <small>NOW PLAYING</small></span><div><IconButton label={fullscreen ? '退出全屏' : '进入全屏'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</IconButton><IconButton label="退出沉浸模式" onClick={() => setFocus(false)}><Minimize2 size={20} /></IconButton></div></header><div className="immersive-main"><div className="immersive-art"><img src={p.track.cover} alt={`${p.track.album}专辑封面`} /><Spectrum analyser={p.analyser} active={p.playing} /></div><div className="immersive-lyrics"><span className="eyebrow">{p.track.album} · {p.track.artist}</span><h1>{p.track.title}</h1><div>{lines.map((line, i) => <p key={i} className={i === activeLine ? 'current' : ''}>{lyricEffect === '逐字' && i === activeLine ? wordLines[i].map((word, wi) => <span key={wi} className={wi < activeWord ? 'spoken' : wi === activeWord ? 'speaking' : ''}>{word.text}</span>) : line}</p>)}</div></div></div><footer className="immersive-controls"><div className="immersive-meta"><img src={p.track.cover} alt="" /><span>{p.track.title}<small>{p.track.artist}</small></span><IconButton label={favorite ? '取消喜欢' : '喜欢'} active={favorite} onClick={toggleLike}><Heart size={19} fill={favorite ? 'currentColor' : 'none'} /></IconButton></div><div className="immersive-transport"><div><IconButton label="上一首" onClick={p.previous}><SkipBack size={21} /></IconButton><button className="play-button" disabled={!p.hasTrack} aria-label={p.playing ? '暂停' : '播放'} onClick={p.toggle}>{p.playing ? <Pause size={22} /> : <Play size={22} />}</button><IconButton label="下一首" onClick={p.next}><SkipForward size={21} /></IconButton></div><label><span>{formatTime(p.time)}</span><input aria-label="播放进度" type="range" min="0" max={p.track.duration} value={p.time} onChange={e => p.seek(Number(e.target.value))} style={{ '--fill': `${p.time / Math.max(1, p.track.duration) * 100}%` } as React.CSSProperties} /><span>{formatTime(p.track.duration)}</span></label></div><div className="immersive-extra"><IconButton label="关闭全屏沉浸" onClick={() => setFocus(false)}><Minimize2 size={19} /></IconButton></div></footer></section>}
    <Dialog open={details} onOpenChange={setDetails}><DialogContent className={`music-dialog theme-${theme}`}><DialogTitle>关于这首歌</DialogTitle><DialogDescription>{p.track.source ? '本地文件 · 封面与歌词为 Mock 数据' : '演示曲目'}</DialogDescription><div className="detail-modal"><img src={p.track.cover} alt={`${p.track.album}封面`} /><div><span className="eyebrow">{p.track.source ? 'LOCAL AUDIO' : `TRACK 0${(p.trackId ?? 0) + 1}`}</span><h2>{p.track.title}</h2><p>{p.track.artist}</p><dl><dt>专辑</dt><dd>{p.track.album}</dd><dt>音乐风格</dt><dd>{p.track.genre}</dd><dt>发行年份</dt><dd>{p.track.year}</dd><dt>时长</dt><dd>{formatTime(p.track.duration)}</dd></dl></div></div><p className="demo-note">{p.track.source ? '正在播放本地音频；封面和歌词为 Mock 数据。' : '演示曲目的音频由浏览器生成，歌曲信息与歌词为演示数据。'}</p></DialogContent></Dialog>
    <Dialog open={library} onOpenChange={v => { setLibrary(v); if (!v) setView('正在播放'); }}><DialogContent className="music-dialog library-dialog"><DialogTitle>{view}</DialogTitle><DialogDescription>选择歌曲播放，未在队列中的演示曲将加入队列。</DialogDescription><div className="library-search"><Search size={17} /><input placeholder="搜索歌曲、歌手或专辑" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="library-list">{filtered.map(t => <button key={t.id} className="queue-track" onClick={() => { p.select(t.id); setLibrary(false); setView('正在播放'); }}><img src={t.cover} alt="" /><span className="queue-track-label">{t.title}<small>{t.artist} · {t.album}</small></span><Play size={16} /></button>)}{!filtered.length && <p className="py-10 text-center muted">{view === '我喜欢的' ? '还没有喜欢的歌曲，点击歌曲旁的爱心来收藏。' : '没有找到匹配的曲目。'}</p>}</div></DialogContent></Dialog>
  </div>;
}
