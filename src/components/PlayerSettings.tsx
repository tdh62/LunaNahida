import { Check, FolderOpen, HardDrive, Headphones, Leaf, Moon, Palette, Pencil, Plus, RefreshCw, SlidersHorizontal, Sparkles, Sun, Timer, Trash2, Users, Waves } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { normalizeName, type ArtistMapping } from '@/lib/catalog';
import { formatTime } from '@/lib/music';
import { backend, type CacheStats, type LibraryState, type StoredSettings } from '@/lib/backend';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

export const themes = [
  { id: 'dusk', name: '山间暮色', desc: '柔和的暮蓝', icon: Moon },
  { id: 'anime', name: '星野放映室', desc: '轻盈的粉色', icon: Sparkles },
  { id: 'forest', name: '森林呼吸', desc: '安静的绿意', icon: Leaf },
];

const eqNames = ['低音', '低中', '中音', '高中', '高音'];
const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1);
  return `${(value / 1024 ** (index + 1)).toFixed(1)} ${units[index]}`;
};

type SettingsProps = {
  theme: string;
  setTheme: (value: string) => void;
  appearance: 'dark' | 'light';
  setAppearance: (value: 'dark' | 'light') => void;
  visual: string;
  setVisual: (value: string) => void;
  lyricEffect: string;
  setLyricEffect: (value: string) => void;
  lyricScroll: string;
  setLyricScroll: (value: string) => void;
  showTranslation: boolean;
  setShowTranslation: (value: boolean) => void;
  sleep: number;
  setSleep: (value: number) => void;
  effect: string;
  setEffect: (value: string) => void;
  equalizer: number[];
  setBand: (index: number, value: number) => void;
  resetEqualizer: () => void;
  mappings: ArtistMapping[];
  setMappings: (mappings: ArtistMapping[]) => void;
  lyricAppearance: { font: string; size: number; lineHeight: number; spacing: number };
  setLyricAppearance: (value: { font: string; size: number; lineHeight: number; spacing: number }) => void;
  artistNames: string[];
};

export default function PlayerSettings({ theme, setTheme, appearance, setAppearance, visual, setVisual, lyricEffect, setLyricEffect, lyricScroll, setLyricScroll, showTranslation, setShowTranslation, sleep, setSleep, effect, setEffect, equalizer, setBand, resetEqualizer, mappings, setMappings, lyricAppearance, setLyricAppearance, artistNames }: SettingsProps) {
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [cacheError, setCacheError] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => { void backend.state().then(setLibrary).catch(error => toast.error(error.message)); }, []);
  useEffect(() => { void backend.cacheStats().then(setCache).catch(error => { setCacheError(true); toast.error(error.message); }); }, []);
  const saveLibrarySettings = (change: Partial<StoredSettings>) => {
    if (!library) return;
    const settings = { ...library.settings, ...change };
    setLibrary({ ...library, settings });
    window.dispatchEvent(new CustomEvent('luma-settings-updated', { detail: settings }));
    void backend.settings(settings).catch(error => toast.error(error.message));
  };
  const refreshLibrary = () => { void backend.state().then(setLibrary).catch(error => toast.error(error.message)); };
  const addFolder = async (path: string) => { if (!path.trim()) return; try { await backend.addFolder(path.trim()); setNewFolder(''); refreshLibrary(); toast.success('已添加监听文件夹'); } catch (error) { toast.error(error instanceof Error ? error.message : '添加失败'); } };
  const scan = async () => { setScanning(true); try { const result = await backend.scan(); refreshLibrary(); window.dispatchEvent(new Event('luma-library-changed')); toast.success(`扫描完成：新增 ${result.added} 首，缺失 ${result.missing} 首`); if (result.errors.length) toast.warning(`${result.errors.length} 个路径暂不可访问`); } catch (error) { toast.error(error instanceof Error ? error.message : '扫描失败'); } finally { setScanning(false); } };
  const clearCache = async () => {
    setClearing(true);
    try {
      const stats = await backend.clearCache();
      setCache(stats);
      setCacheError(false);
      setClearConfirmOpen(false);
      window.dispatchEvent(new Event('luma-cache-cleared'));
      window.dispatchEvent(new Event('luma-library-changed'));
      toast.success('缓存已清理，WebView 缓存将在下次启动时清理');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理缓存失败');
      void backend.cacheStats().then(stats => { setCache(stats); setCacheError(false); }).catch(() => setCacheError(true));
      refreshLibrary();
      window.dispatchEvent(new Event('luma-cache-cleared'));
      window.dispatchEvent(new Event('luma-library-changed'));
    } finally {
      setClearing(false);
    }
  };
  const [root, setRoot] = useState('');
  const [aliases, setAliases] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');
  const saveMapping = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = root.trim();
    const names = [...new Map(aliases.split(/[,，、\n]+/).map(value => value.trim()).filter(Boolean).map(value => [normalizeName(value), value])).values()].filter(value => normalizeName(value) !== normalizeName(name));
    if (!name || !names.length) { setError('请填写根名称和至少一个不同的名称'); return; }
    const keys = [name, ...names].map(normalizeName);
    if (mappings.some((item, index) => index !== editing && [item.root, ...item.aliases].some(value => keys.includes(normalizeName(value))))) { setError('名称已属于其他映射组'); return; }
    const updated = { root: name, aliases: names };
    setMappings(editing === null ? [...mappings, updated] : mappings.map((item, index) => index === editing ? updated : item));
    setRoot(''); setAliases(''); setEditing(null); setError('');
  };
  return <div className="settings-page">
    <header className="settings-heading"><h1>设置</h1></header>
    <section className="settings-group"><div className="settings-group-title"><FolderOpen size={19} /><div><h2>本地音乐库</h2></div></div>
      <div className="settings-row"><div><strong>拖入文件</strong></div><select className="lyric-font-select" aria-label="拖入文件处理方式" value={library?.settings.dropAction ?? 'ask'} onChange={event => saveLibrarySettings({ dropAction: event.target.value as StoredSettings['dropAction'] })}><option value="ask">每次询问</option><option value="temporary">仅本次播放</option><option value="library">加入音乐库</option><option value="watch">监听所在文件夹</option></select></div>
      <div className="settings-row"><div><strong>启动时扫描</strong></div><button type="button" role="switch" aria-checked={library?.settings.scanOnStart ?? true} aria-label="启动时扫描" className={`settings-switch ${library?.settings.scanOnStart ? 'on' : ''}`} onClick={() => saveLibrarySettings({ scanOnStart: !library?.settings.scanOnStart })}><span /></button></div>
      <div className="settings-row"><div><strong>定时扫描</strong></div><select className="lyric-font-select" aria-label="定时扫描间隔" value={library?.settings.scanIntervalMinutes ?? 0} onChange={event => saveLibrarySettings({ scanIntervalMinutes: Number(event.target.value) })}><option value={0}>关闭</option><option value={15}>每 15 分钟</option><option value={30}>每 30 分钟</option><option value={60}>每小时</option><option value={360}>每 6 小时</option><option value={1440}>每天</option></select></div>
      <div className="settings-row"><div><strong>监听文件夹</strong><small>{library?.folders.length ?? 0} 个路径</small></div><button type="button" className="playlist-primary" onClick={() => void backend.chooseFolder().then(result => addFolder(result.paths[0])).catch(error => toast.error(error.message))}><Plus size={15} />添加文件夹</button></div>
      <form className="artist-mapping-form" onSubmit={event => { event.preventDefault(); void addFolder(newFolder); }}><label>路径<input value={newFolder} onChange={event => setNewFolder(event.target.value)} placeholder="本地文件夹绝对路径" /></label><button type="submit" className="playlist-primary" disabled={!newFolder.trim()}><Plus size={15} />添加路径</button></form>
      <div className="artist-mapping-list">{library?.folders.map(path => <div className="artist-mapping-item" key={path}><div><strong>{path}</strong></div><button type="button" title="移除监听" aria-label={`移除 ${path}`} onClick={() => void backend.removeFolder(path).then(refreshLibrary).catch(error => toast.error(error.message))}><Trash2 size={15} /></button></div>)}</div>
      <div className="settings-row"><div><strong>扫描音乐库</strong></div><button type="button" className="playlist-primary" disabled={scanning} onClick={() => void scan()}><RefreshCw size={15} />{scanning ? '扫描中' : '立即扫描'}</button></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><HardDrive size={19} /><div><h2>缓存空间</h2></div></div>
      <div className="settings-row"><div><strong>{cache ? formatBytes(cache.totalBytes) : cacheError ? '统计失败' : '正在统计'}</strong>{cache && <small>图片 {formatBytes(cache.coverBytes)} · WebView {formatBytes(cache.webviewBytes)} · 在线资料 {formatBytes(cache.metadataBytes)}</small>}{cache?.webviewClearPending && <small>WebView 缓存将在下次启动时清理</small>}</div><button type="button" className="playlist-primary" disabled={clearing || (!cache && !cacheError)} onClick={() => { if (cache) setClearConfirmOpen(true); else void backend.cacheStats().then(stats => { setCache(stats); setCacheError(false); }).catch(error => toast.error(error.message)); }}>{cache ? <Trash2 size={15} /> : <RefreshCw size={15} />}{cache ? '清理缓存' : '重试统计'}</button></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Sun size={19} /><div><h2>外观</h2><p>明暗外观与下方色调可自由组合。</p></div></div>
      <div className="settings-options appearance-options" role="group" aria-label="外观模式">{([{ id: 'dark', label: '深色', icon: Moon }, { id: 'light', label: '浅色', icon: Sun }] as const).map(option => <button key={option.id} type="button" aria-pressed={appearance === option.id} className={appearance === option.id ? 'active' : ''} onClick={() => setAppearance(option.id)}><option.icon size={15} />{option.label}</button>)}</div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Palette size={19} /><div><h2>界面主题</h2><p>颜色只影响界面，不会改变正在播放的音乐。</p></div></div>
      <div className="settings-themes">{themes.map(t => <button type="button" key={t.id} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)} className={`settings-theme ${theme === t.id ? 'selected' : ''}`}><span className={`settings-theme-preview preview-${t.id}`}><t.icon size={24} /></span><span className="settings-theme-label"><strong><t.icon size={15} /> {t.name}</strong><small>{t.desc}</small></span><span className="settings-theme-check">{theme === t.id && <Check size={15} />}</span></button>)}</div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Headphones size={19} /><div><h2>播放器样式</h2><p>选择封面动画和歌词呈现方式。</p></div></div>
      <div className="settings-row"><div><strong>播放氛围</strong><small>切换封面与频谱显示</small></div><div className="settings-options">{['频谱', '唱片', '呼吸'].map(v => <button key={v} aria-pressed={visual === v} className={visual === v ? 'active' : ''} onClick={() => setVisual(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>歌词效果</strong><small>调整正在播放的歌词样式</small></div><div className="settings-options">{['流动', '聚焦', '逐字'].map(v => <button key={v} aria-pressed={lyricEffect === v} className={lyricEffect === v ? 'active' : ''} onClick={() => setLyricEffect(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>歌词滚动</strong><small>切换歌词跟随播放的过渡方式</small></div><div className="settings-options">{['平滑', '即时'].map(v => <button key={v} aria-pressed={lyricScroll === v} className={lyricScroll === v ? 'active' : ''} onClick={() => setLyricScroll(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>显示翻译</strong><small>在当前歌词下显示译文</small></div><button type="button" role="switch" aria-checked={showTranslation} aria-label="显示翻译" onClick={() => setShowTranslation(!showTranslation)} className={`settings-switch ${showTranslation ? 'on' : ''}`}><span /></button></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><SlidersHorizontal size={19} /><div><h2>歌词排版</h2><p>调整歌词字体与阅读间距。</p></div></div>
      <div className="settings-row"><div><strong>字体</strong></div><select className="lyric-font-select" aria-label="歌词字体" value={lyricAppearance.font} onChange={event => setLyricAppearance({ ...lyricAppearance, font: event.target.value })}><option value="default">默认黑体</option><option value="sans">清晰无衬线</option><option value="serif">衬线字体</option></select></div>
      <div className="lyric-setting-control"><label htmlFor="lyric-size">字号 <strong>{lyricAppearance.size}px</strong></label><input id="lyric-size" type="range" min="12" max="28" value={lyricAppearance.size} onChange={event => setLyricAppearance({ ...lyricAppearance, size: Number(event.target.value) })} /></div>
      <div className="lyric-setting-control"><label htmlFor="lyric-line-height">行高 <strong>{lyricAppearance.lineHeight}px</strong></label><input id="lyric-line-height" type="range" min="40" max="100" value={lyricAppearance.lineHeight} onChange={event => setLyricAppearance({ ...lyricAppearance, lineHeight: Number(event.target.value) })} /></div>
      <div className="lyric-setting-control"><label htmlFor="lyric-spacing">行间距 <strong>{lyricAppearance.spacing}px</strong></label><input id="lyric-spacing" type="range" min="0" max="24" value={lyricAppearance.spacing} onChange={event => setLyricAppearance({ ...lyricAppearance, spacing: Number(event.target.value) })} /></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><SlidersHorizontal size={19} /><div><h2>声音</h2></div></div>
      <div className="settings-row"><div><strong>音效</strong></div><div className="settings-options settings-wrap">{['原声', '低音增强', '空间回响', '温暖 Lo-fi'].map(v => <button key={v} aria-pressed={effect === v} className={effect === v ? 'active' : ''} onClick={() => setEffect(v)}>{v}</button>)}</div></div>
      <div className="settings-eq"><div className="settings-eq-heading"><span><Waves size={16} /> 五段均衡器</span><button onClick={resetEqualizer}>重置</button></div><div className="settings-eq-grid">{eqNames.map((name, i) => <label key={name}><span>{name}</span><input type="range" min="-12" max="12" value={equalizer[i]} onChange={e => setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{equalizer[i] > 0 ? '+' : ''}{equalizer[i]} dB</small></label>)}</div></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Users size={19} /><div><h2>歌手名称映射</h2><p>繁简体名称自动合并；手动指定根名称后，歌手页将显示根名称。</p></div></div>
      {mappings.length > 0 && <div className="artist-mapping-list">{mappings.map((item, index) => <div className="artist-mapping-item" key={index}><div><strong>{item.root}</strong><small>{item.aliases.join(' · ')}</small></div><button type="button" aria-label={`编辑 ${item.root}`} title="编辑映射" onClick={() => { setRoot(item.root); setAliases(item.aliases.join('，')); setEditing(index); setError(''); }}><Pencil size={15} /></button><button type="button" aria-label={`删除 ${item.root}`} title="删除映射" onClick={() => { setMappings(mappings.filter((_, i) => i !== index)); if (editing === index) { setEditing(null); setRoot(''); setAliases(''); setError(''); } else if (editing !== null && editing > index) setEditing(editing - 1); }}><Trash2 size={15} /></button></div>)}</div>}
      <form className="artist-mapping-form" onSubmit={saveMapping}><label>展示名称（映射根）<input value={root} onChange={event => setRoot(event.target.value)} placeholder="例如：青木" list="artist-name-options" maxLength={80} /></label><label>其他名称（用逗号分隔）<input value={aliases} onChange={event => setAliases(event.target.value)} placeholder="例如：青木 · Aoki，青木 Aoki" maxLength={500} /></label><datalist id="artist-name-options">{artistNames.map(name => <option key={name} value={name} />)}</datalist>{error && <p role="alert">{error}</p>}<div><button type="submit" className="playlist-primary"><Plus size={15} />{editing === null ? '添加映射' : '保存映射'}</button>{editing !== null && <button type="button" className="artist-mapping-cancel" onClick={() => { setEditing(null); setRoot(''); setAliases(''); setError(''); }}>取消</button>}</div></form>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Timer size={19} /><div><h2>睡眠定时</h2><p>到时间后自动暂停音乐。</p></div></div><div className="settings-row"><div><strong>暂停时间</strong><small>{sleep > 0 ? `剩余 ${formatTime(sleep)}` : '未设置定时'}</small></div><div className="settings-options">{[0, 15, 30, 60].map(v => <button key={v} aria-pressed={v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v} className={(v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v) ? 'active' : ''} onClick={() => setSleep(v * 60)}>{v ? `${v} 分钟` : '关闭'}</button>)}</div></div><div className="settings-row"><div><strong>精细设定</strong><small>以分钟为单位，最多 24 小时</small></div><form className="sleep-settings-form" onSubmit={event => { event.preventDefault(); const minutes = Number(new FormData(event.currentTarget).get('minutes')); if (Number.isFinite(minutes) && minutes > 0) setSleep(Math.round(minutes * 60)); }}><input name="minutes" type="number" min="1" max="1440" step="1" aria-label="睡眠定时分钟数" defaultValue={sleep > 0 ? Math.ceil(sleep / 60) : 20} /><span>分钟</span><button type="submit">设置</button></form></div></section>
    <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>清理缓存？</DialogTitle><DialogDescription>在线图片和资料缓存将被清除；音乐库、收藏、内嵌封面及自定义歌单封面会保留。WebView 缓存在下次启动时清理。</DialogDescription><div className="playlist-dialog-actions"><button type="button" disabled={clearing} onClick={() => setClearConfirmOpen(false)}>取消</button><button type="button" className="playlist-danger" disabled={clearing} onClick={() => void clearCache()}>{clearing ? '清理中' : '清理缓存'}</button></div></DialogContent></Dialog>
  </div>;
}
