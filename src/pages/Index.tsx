import { type ReactNode, useEffect, useState } from 'react';
import { AudioLines, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Disc3, Heart, Headphones, Info, Leaf, ListMusic, Maximize2, Minimize2, Moon, Music2, Pause, Play, Plus, Radio, Repeat, Repeat1, Search, Settings2, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePlayer } from '@/hooks/use-player';
import { formatTime, lyricSets, tracks } from '@/lib/music';
import '@/player.css';

const themes = [{ id: 'dusk', name: '山间暮色', desc: '让心慢下来', icon: Moon, image: '/covers/mountain.svg' }, { id: 'anime', name: '星野放映室', desc: '奔赴一场漫游', icon: Sparkles, image: tracks[1].cover }, { id: 'forest', name: '森林呼吸', desc: '听见自然的频率', icon: Leaf, image: tracks[2].cover }];
function IconButton({ children, label, onClick, active = false, className = '' }: { children: ReactNode; label: string; onClick?: () => void; active?: boolean; className?: string }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`icon-button ${active ? 'is-active' : ''} ${className}`}>{children}</button>;
}
export default function Index() {
  const p = usePlayer();
  const [theme, setTheme] = useState('dusk');
  const [lyricEffect, setLyricEffect] = useState('流动');
  const [visual, setVisual] = useState('声波');
  const [panel, setPanel] = useState('queue');
  const [liked, setLiked] = useState<number[]>([2]);
  const [details, setDetails] = useState(false);
  const [focus, setFocus] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('正在播放');
  const [library, setLibrary] = useState(false);
  const [sleep, setSleep] = useState(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const lines = lyricSets[p.trackId];
  const lineLength = p.track.duration / (lines.length + 1);
  const activeLine = Math.min(lines.length - 1, Math.floor(p.time / lineLength));
  const favorite = liked.includes(p.trackId);
  const toggleLike = () => setLiked(prev => favorite ? prev.filter(id => id !== p.trackId) : [...prev, p.trackId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
      if (e.code === 'Space') { e.preventDefault(); p.toggle(); }
      if (e.code === 'ArrowRight') p.seek(Math.min(p.time + 5, p.track.duration));
      if (e.code === 'ArrowLeft') p.seek(Math.max(p.time - 5, 0));
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [p]);
  useEffect(() => {
    if (!sleep) return;
    const timer = window.setInterval(() => setSleep(v => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [sleep > 0]);
  useEffect(() => { if (sleep === 1 && p.playing) p.toggle(); }, [sleep]);
  const filtered = tracks.filter(t => (view !== '我喜欢的' || liked.includes(t.id)) && `${t.title}${t.artist}${t.album}`.toLowerCase().includes(search.toLowerCase()));
  return <div className={`music-app theme-${theme} ${focus ? 'focus-mode' : ''}`}>
    <aside className="sidebar flex flex-col">
      <a href="/" className="brand flex items-center gap-2.5"><span className="brand-icon"><AudioLines size={23} /></span><span>Luma<span className="font-normal">Tune</span><i /></span></a>
      <div className="nav-label">你的音乐空间</div>
      <nav className="space-y-1">
        {[{ title: '正在播放', icon: AudioLines }, { title: '我的音乐', icon: Disc3 }, { title: '我喜欢的', icon: Heart }, { title: '最近播放', icon: ListMusic }].map(({ title, icon: Icon }) => <button key={title} onClick={() => { setView(title); if (title !== '正在播放') setLibrary(true); }} className={`nav-item ${view === title ? 'selected' : ''}`}><Icon size={18} />{title}{title === '正在播放' && <span className="tiny-bars"><i /><i /><i /></span>}{title === '我喜欢的' && <small>{liked.length}</small>}</button>)}
      </nav>
      <div className="nav-label flex items-center justify-between mt-10">为此刻而听 <Headphones size={13} /></div>
      <button className="collection" onClick={() => { p.select(0); setView('正在播放'); }}><span className="collection-icon lavender"><Moon size={17} /></span><span>一个人的安静时刻<small>6 首 · 慢慢听，不着急</small></span></button>
      <button className="collection" onClick={() => { p.select(2); setTheme('forest'); }}><span className="collection-icon green"><Leaf size={17} /></span><span>逃进大自然<small>风、森林与自由</small></span></button>
      <button className="collection" onClick={() => { p.select(1); setTheme('anime'); }}><span className="collection-icon pink"><Sparkles size={17} /></span><span>动画里的夏天<small>给生活一点想象</small></span></button>
      <div className="sidebar-bottom mt-auto"><div className="listening-note"><span className="text-xl">☾</span><p>世界很吵，<br />把这里留给自己。</p><span className="note-line" /></div><div className="profile flex items-center gap-3"><div className="avatar">L</div><div className="flex-1">听风的人<small>今天也要好好听歌</small></div><Popover><PopoverTrigger asChild><button aria-label="播放器设置" className="icon-button"><Settings2 size={17} /></button></PopoverTrigger><PopoverContent className="player-popover w-64"><h3>睡眠定时</h3><p className="mb-3 text-xs opacity-70">音乐将在设定时间后暂停</p><div className="flex gap-2">{[0, 15, 30, 60].map(v => <button key={v} className="option-chip" onClick={() => setSleep(v * 60)}>{v ? `${v}分` : '关闭'}</button>)}</div>{sleep > 0 && <p className="mt-3 text-xs">剩余 {formatTime(sleep)}</p>}</PopoverContent></Popover></div></div>
    </aside>
    <main className="workspace min-w-0">
      <header className="topbar flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="breadcrumb">音乐空间</span><ChevronRight size={13} className="muted" /><span>正在播放</span></div><div className="flex items-center gap-5"><span className="local-badge"><i /> 为你保留的片刻宁静</span><IconButton label="搜索曲目" onClick={() => { setView('我的音乐'); setLibrary(true); }}><Search size={18} /></IconButton><span className="header-separator" /><IconButton label={focus ? '退出沉浸模式' : '沉浸模式'} active={focus} onClick={() => setFocus(!focus)}>{focus ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</IconButton></div></header>
      <section className="player-heading flex items-end justify-between"><div><div className="eyebrow"><span /> NOW PLAYING</div><h1>让音乐，慢一点。</h1><p>放下纷扰，听见此刻的自己。</p></div><span className="session-label"><Headphones size={14} /> YOUR LITTLE ESCAPE</span></section>
      <div className="main-columns">
        <section className="listening-stage">
          <div className="stage-top flex items-center justify-between"><span><span className="status-dot" /> {p.playing ? '正在聆听' : '准备好，进入音乐'} <span className="stage-divider">/</span> {themes.find(t => t.id === theme)?.name}</span><button className="text-action" onClick={() => setDetails(true)}>曲目详情 <ArrowUpRight size={14} /></button></div>
          <div className="listening-content">
            <div className="album-column">
              <button className={`album-art ${visual === '唱片' ? 'vinyl' : ''} ${p.playing ? 'playing' : ''}`} onClick={() => setDetails(true)} aria-label="查看专辑封面与详情"><img src={p.track.cover} alt={`${p.track.album}专辑封面`} /><span className="album-print">{p.track.english}<small>{p.track.artist.split(' · ')[1] || 'LUMATUNE SESSIONS'}</small></span><span className="cover-corner">VOL. 0{p.trackId + 1}</span></button>
              <div className="album-title flex items-center justify-between"><h2>{p.track.title}</h2><IconButton label={favorite ? '取消喜欢' : '喜欢这首歌'} active={favorite} onClick={toggleLike}><Heart size={21} fill={favorite ? 'currentColor' : 'none'} /></IconButton></div>
              <p className="artist-name">{p.track.artist}<span> · </span>{p.track.album}</p>
              <div className="track-tags"><span>原创试听</span><span>{p.track.genre.split(' / ')[0]}</span><span>{p.track.year}</span></div>
              <div className={`visualizer ${p.playing ? 'animated' : ''} ${visual === '呼吸' ? 'breathing' : ''}`} aria-label="音乐氛围动效">{Array.from({ length: 48 }, (_, i) => <i key={i} style={{ height: `${8 + Math.sin(i * .65) ** 2 * 23 + Math.sin(i * .2) ** 2 * 13}px`, animationDelay: `${i * -.13}s`, animationDuration: `${.65 + i % 5 * .2}s` }} />)}</div>
              <div className="audio-caption"><span className="status-dot" /> LOCAL SESSION <span>给耳朵一段温柔的旅行</span></div>
            </div>
            <div className={`lyrics-column lyric-${lyricEffect}`}><div className="lyrics-header"><span>歌词 <small>LYRICS</small></span><button title="切换歌词显示" onClick={() => setShowTranslation(!showTranslation)} className={showTranslation ? 'is-active' : ''}>文</button></div>
              <div className="lyrics-window"><div className="lyrics-track" style={{ transform: `translateY(${112 - activeLine * 66}px)` }}>{lines.map((line, i) => <button key={line} className={`lyric-line ${i === activeLine ? 'current' : ''} ${Math.abs(i - activeLine) > 2 ? 'distant' : ''}`} onClick={() => p.seek(i * lineLength)}><span>{line}</span>{i === activeLine && showTranslation && <small>{i === 0 ? 'The wind carries our thoughts away.' : 'Take a breath. Let the world slow down.'}</small>}</button>)}</div></div>
              <div className="lyric-footer"><span className="lyric-dots">•••</span><span>点击歌词，跳转到那一刻</span><div className="lyric-effects">{['流动', '聚焦', '逐字'].map(v => <button key={v} className={lyricEffect === v ? 'active' : ''} onClick={() => setLyricEffect(v)}>{v}</button>)}</div></div>
            </div>
          </div>
          <div className="stage-toolbar flex items-center justify-between"><Popover><PopoverTrigger asChild><button className="toolbar-button"><SlidersHorizontal size={14} /> 音效 <span>{p.effect}</span><ChevronDown size={12} /></button></PopoverTrigger><PopoverContent className="player-popover w-56"><h3>声音的另一种可能</h3>{['原声', '低音增强', '空间回响', '温暖 Lo-fi'].map(e => <button className="popover-item" key={e} onClick={() => p.setEffect(e)}>{e}{p.effect === e && <Check size={14} />}</button>)}</PopoverContent></Popover><div className="flex items-center gap-3"><span className="muted text-xs">播放氛围</span>{['声波', '唱片', '呼吸'].map(v => <button key={v} className={`small-tab ${visual === v ? 'active' : ''}`} onClick={() => setVisual(v)}>{v}</button>)}</div></div>
        </section>
        <aside className="queue-panel"><div className="queue-tabs"><button className={panel === 'queue' ? 'active' : ''} onClick={() => setPanel('queue')}>播放队列 <span>06</span></button><button className={panel === 'details' ? 'active' : ''} onClick={() => setPanel('details')}>曲目信息</button><ListMusic size={16} /></div>{panel === 'queue' ? <><div className="queue-description"><span>一个人的安静时刻</span><small>{p.mode === 'shuffle' ? '随机播放' : p.mode === 'repeat' ? '单曲循环' : '顺序播放'} · 6 首歌曲</small></div><div className="queue-list">{tracks.map((t, i) => <button className={`queue-track ${p.trackId === t.id ? 'current' : ''}`} onClick={() => p.select(t.id)} key={t.id}><span className="track-number">{p.trackId === t.id ? <AudioLines size={14} /> : String(i + 1).padStart(2, '0')}</span><img src={t.cover} alt="" /><span className="queue-track-label">{t.title}<small>{t.artist.split(' · ')[0]}</small></span><span className="track-duration">{formatTime(t.duration)}</span></button>)}</div><button className="queue-add" onClick={() => { setView('我的音乐'); setLibrary(true); }}><Plus size={14} /> 浏览音乐库</button><div className="queue-note"><Radio size={17} /><span>好音乐，不必急着听完。<small>下一首，也许就是你的心情。</small></span></div></> : <div className="inline-details"><img src={p.track.cover} alt="专辑封面" /><h3>{p.track.title}</h3><p>{p.track.artist}</p><dl>{[['专辑', p.track.album], ['风格', p.track.genre], ['发行', p.track.year], ['时长', formatTime(p.track.duration)], ['音频', '本地合成 · Mock 演示']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="demo-note">原创演示曲目与模拟歌词，用于体验播放器功能。</p></div>}</aside>
      </div>
      <section className="themes-section"><div className="theme-heading"><h2><Sparkles size={16} /> 换一种心情</h2><span>让音乐有自己的颜色</span><span className="ml-auto">THE SOUND OF YOUR MOOD</span></div><div className="theme-grid">{themes.map(t => <button key={t.id} onClick={() => setTheme(t.id)} className={`theme-card ${theme === t.id ? 'selected' : ''}`}><img src={t.image} alt="" /><div><span><t.icon size={14} />{t.name}</span><small>{t.desc}</small></div><span className="theme-check">{theme === t.id ? <Check size={13} /> : <ChevronRight size={15} />}</span></button>)}</div></section>
      <div className="workspace-footer"><span>LUMATUNE · 为每一种心情，找到声音</span><span><span className="status-dot" /> MOCK SESSION <span className="mx-2">/</span> 空格键播放或暂停</span></div>
    </main>
    <footer className="playback-bar"><div className="mini-track"><button onClick={() => setDetails(true)}><img src={p.track.cover} alt="当前专辑" /></button><div><strong>{p.track.title}</strong><small>{p.track.artist}</small></div><IconButton label="喜欢" onClick={toggleLike} active={favorite}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></IconButton></div><div className="transport"><div className="transport-buttons"><IconButton label="随机播放" active={p.mode === 'shuffle'} onClick={() => p.setMode(p.mode === 'shuffle' ? 'list' : 'shuffle')}><Shuffle size={17} /></IconButton><IconButton label="上一首" onClick={p.previous}><SkipBack size={20} fill="currentColor" /></IconButton><button className="play-button" aria-label={p.playing ? '暂停' : '播放'} onClick={p.toggle}>{p.playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><IconButton label="下一首" onClick={p.next}><SkipForward size={20} fill="currentColor" /></IconButton><IconButton label="单曲循环" active={p.mode === 'repeat'} onClick={() => p.setMode(p.mode === 'repeat' ? 'list' : 'repeat')}>{p.mode === 'repeat' ? <Repeat1 size={18} /> : <Repeat size={18} />}</IconButton></div><div className="seek-row"><span>{formatTime(p.time)}</span><input aria-label="播放进度" type="range" min="0" max={p.track.duration} step="0.1" value={p.time} onChange={e => p.seek(Number(e.target.value))} style={{ '--fill': `${p.time / p.track.duration * 100}%` } as React.CSSProperties} /><span>{formatTime(p.track.duration)}</span></div></div><div className="playback-extras"><span className="quality-badge">HQ</span><IconButton label={p.volume ? '静音' : '恢复音量'} onClick={() => p.setVolume(p.volume ? 0 : 65)}>{p.volume ? <Volume2 size={19} /> : <VolumeX size={19} />}</IconButton><input aria-label="音量" type="range" min="0" max="100" value={p.volume} onChange={e => p.setVolume(Number(e.target.value))} /><span className="header-separator" /><IconButton label="播放队列" onClick={() => { setPanel('queue'); setFocus(false); }}><ListMusic size={20} /></IconButton></div></footer>
    <Dialog open={details} onOpenChange={setDetails}><DialogContent className={`music-dialog theme-${theme}`}><DialogTitle>关于这首歌</DialogTitle><DialogDescription>每一首歌，都是一处可以停留的风景。</DialogDescription><div className="detail-modal"><img src={p.track.cover} alt={`${p.track.album}封面`} /><div><span className="eyebrow">TRACK 0{p.trackId + 1}</span><h2>{p.track.title}</h2><p>{p.track.artist}</p><dl><dt>专辑</dt><dd>{p.track.album}</dd><dt>音乐风格</dt><dd>{p.track.genre}</dd><dt>发行年份</dt><dd>{p.track.year}</dd><dt>时长</dt><dd>{formatTime(p.track.duration)}</dd></dl></div></div><p className="demo-note">本项目采用 Mock 数据。音频为浏览器本地合成的氛围器乐，曲目、歌手与歌词为虚构演示内容。</p></DialogContent></Dialog>
    <Dialog open={library} onOpenChange={v => { setLibrary(v); if (!v) setView('正在播放'); }}><DialogContent className="music-dialog library-dialog"><DialogTitle>{view}</DialogTitle><DialogDescription>在你的音乐空间，找到此刻想听的声音。</DialogDescription><div className="library-search"><Search size={17} /><input placeholder="搜索歌曲、歌手或专辑" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="library-list">{filtered.map(t => <button key={t.id} className="queue-track" onClick={() => { p.select(t.id); setLibrary(false); setView('正在播放'); }}><img src={t.cover} alt="" /><span className="queue-track-label">{t.title}<small>{t.artist} · {t.album}</small></span><Play size={16} /></button>)}{!filtered.length && <p className="py-10 text-center muted">{view === '我喜欢的' ? '还没有喜欢的歌曲，点击歌曲旁的爱心来收藏。' : '没有找到匹配的曲目。'}</p>}</div></DialogContent></Dialog>
  </div>;
}
