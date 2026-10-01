import { Check, Download, FolderOpen, HardDrive, Headphones, Leaf, ListMusic, Moon, Palette, Pencil, Plus, RefreshCw, SlidersHorizontal, Sparkles, Sun, Timer, Trash2, Upload, Users, Waves, Globe2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { normalizeName, type ArtistMapping } from '@/lib/catalog';
import { formatTime } from '@/lib/music';
import { backend, type CacheStats, type LibraryState, type NetworkSource, type StoredSettings } from '@/lib/backend';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useRuntime } from '@/hooks/use-runtime';

export const themes = [
  { id: 'dusk', name: '山间暮色', icon: Moon },
  { id: 'anime', name: '星野放映室', icon: Sparkles },
  { id: 'forest', name: '纳西妲之森', icon: Leaf },
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
  effectName: string;
  onEditEffects: () => void;
  equalizer: number[];
  setBand: (index: number, value: number) => void;
  resetEqualizer: () => void;
  mappings: ArtistMapping[];
  setMappings: (mappings: ArtistMapping[]) => void;
  lyricAppearance: { font: string; size: number; lineHeight: number; spacing: number };
  setLyricAppearance: (value: { font: string; size: number; lineHeight: number; spacing: number }) => void;
  artistNames: string[];
};

export default function PlayerSettings({ theme, setTheme, appearance, setAppearance, visual, setVisual, lyricEffect, setLyricEffect, lyricScroll, setLyricScroll, showTranslation, setShowTranslation, sleep, setSleep, effectName, onEditEffects, equalizer, setBand, resetEqualizer, mappings, setMappings, lyricAppearance, setLyricAppearance, artistNames }: SettingsProps) {
  const runtime = useRuntime();
  const { hash } = useLocation();
  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const targetId = ({ '#player-style': 'player-style', '#lyrics-layout': 'lyrics-layout' } as Record<string, string>)[hash];
    const target = targetId ? pageRef.current?.querySelector<HTMLElement>(`#${targetId}`) : null;
    if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [hash]);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [sourceKind, setSourceKind] = useState<NetworkSource['kind']>('webdav');
  const [sourceURL, setSourceURL] = useState('');
  const [sourceUsername, setSourceUsername] = useState('');
  const [sourcePassword, setSourcePassword] = useState('');
  const [addingSource, setAddingSource] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanBackupOverride, setScanBackupOverride] = useState<boolean | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [cacheError, setCacheError] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearingNetwork, setClearingNetwork] = useState(false);
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!runtime.backend) return; void backend.state().then(setLibrary).catch(error => toast.error(error.message)); }, [runtime.backend]);
  useEffect(() => { if (!runtime.backend) return; void backend.cacheStats().then(setCache).catch(error => { setCacheError(true); toast.error(error.message); }); }, [runtime.backend]);
  const saveLibrarySettings = (change: Partial<StoredSettings>) => {
    if (!library) return;
    const settings = { ...library.settings, ...change };
    setLibrary({ ...library, settings });
    window.dispatchEvent(new CustomEvent('lunanahida-settings-updated', { detail: settings }));
    void backend.settings(settings).catch(error => toast.error(error.message));
  };
  const refreshLibrary = () => { void backend.state().then(setLibrary).catch(error => toast.error(error.message)); };
  const addFolder = async (path: string) => { if (!path.trim()) return; try { await backend.addFolder(path.trim()); setNewFolder(''); refreshLibrary(); toast.success('已添加监听文件夹'); } catch (error) { toast.error(error instanceof Error ? error.message : '添加失败'); } };
  const scan = async () => { setScanning(true); try { const result = await backend.scan(scanBackupOverride ?? library?.settings.backupOriginal ?? true); refreshLibrary(); window.dispatchEvent(new Event('lunanahida-library-changed')); toast.success(`扫描完成：新增 ${result.added} 首，转换 ${result.converted} 首，清理 ${result.removed} 首${result.missing > result.removed ? `，缺失 ${result.missing - result.removed} 首` : ''}`); if (result.errors.length) toast.warning(`${result.errors.length} 个文件或路径处理失败`); } catch (error) { toast.error(error instanceof Error ? error.message : '扫描失败'); } finally { setScanning(false); setScanBackupOverride(null); } };
  const addNetworkSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceURL.trim()) return;
    setAddingSource(true);
    try {
      const result = await backend.addNetworkSource(sourceKind, sourceURL.trim(), sourceUsername.trim(), sourcePassword);
      setSourceURL(''); setSourceUsername(''); setSourcePassword('');
      refreshLibrary();
      window.dispatchEvent(new Event('lunanahida-library-changed'));
      toast.success(`已添加网络来源，找到 ${result.scan.added} 首歌曲`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '添加网络来源失败'); }
    finally { setAddingSource(false); }
  };
  const removeNetworkSource = async (id: number) => {
    try { await backend.removeNetworkSource(id); refreshLibrary(); window.dispatchEvent(new Event('lunanahida-library-changed')); toast.success('已移除网络来源'); }
    catch (error) { toast.error(error instanceof Error ? error.message : '移除网络来源失败'); }
  };
  const clearCache = async () => {
    setClearing(true);
    try {
      const stats = await backend.clearCache();
      setCache(stats);
      setCacheError(false);
      setClearConfirmOpen(false);
      window.dispatchEvent(new Event('lunanahida-cache-cleared'));
      window.dispatchEvent(new Event('lunanahida-library-changed'));
      toast.success(runtime.mode === 'desktop' ? '缓存已清理，界面缓存将在下次启动时清理' : '音乐库服务缓存已清理');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理缓存失败');
      void backend.cacheStats().then(stats => { setCache(stats); setCacheError(false); }).catch(() => setCacheError(true));
      refreshLibrary();
      window.dispatchEvent(new Event('lunanahida-cache-cleared'));
      window.dispatchEvent(new Event('lunanahida-library-changed'));
    } finally {
      setClearing(false);
    }
  };
  const clearNetworkCache = async () => {
    setClearingNetwork(true);
    try {
      setCache(await backend.clearNetworkCache());
      toast.success('网络歌曲缓存已清理');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理网络歌曲缓存失败');
    } finally {
      setClearingNetwork(false);
    }
  };
  const exportBackup = async () => {
    setBackupBusy('export');
    try {
      const native = runtime.nativeBackup ? await backend.saveBackupNative() : { available: false, saved: false };
      if (native.available) {
        if (native.saved) toast.success('备份已导出');
        return;
      }
      const blob = await backend.exportBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `LunaNahida-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('备份已导出');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出备份失败');
    } finally {
      setBackupBusy(null);
    }
  };
  const importBackup = async (file: File) => {
    setBackupBusy('import');
    try {
      const result = await backend.importBackup(file);
      refreshLibrary();
      void backend.cacheStats().then(setCache).catch(() => {});
      window.dispatchEvent(new Event('lunanahida-backup-imported'));
      toast.success(`已合并 ${result.tracks} 首歌曲、${result.playlists} 个歌单、${result.tags} 个标签、${result.covers} 张封面`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入备份失败');
    } finally {
      setBackupBusy(null);
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
  return <div ref={pageRef} className="settings-page">
    <header className="settings-heading"><h1>设置</h1>{!runtime.backend && <span className="runtime-mode">仅本次有效</span>}</header>
    <section className="settings-group"><div className="settings-group-title"><ListMusic size={19} /><div><h2>左侧菜单</h2></div></div><fieldset disabled={!library}>
      <div className="settings-row"><div><strong>显示本地音乐入口</strong></div><button type="button" role="switch" aria-checked={!library?.settings.hideLocalMusicActions} aria-label="显示本地音乐入口" className={`settings-switch ${!library?.settings.hideLocalMusicActions ? 'on' : ''}`} onClick={() => saveLibrarySettings({ hideLocalMusicActions: !library?.settings.hideLocalMusicActions })}><span /></button></div>
      <div className="settings-row"><div><strong>显示网络音乐入口</strong></div><button type="button" role="switch" aria-checked={!library?.settings.hideNetworkMusicActions} aria-label="显示网络音乐入口" className={`settings-switch ${!library?.settings.hideNetworkMusicActions ? 'on' : ''}`} onClick={() => saveLibrarySettings({ hideNetworkMusicActions: !library?.settings.hideNetworkMusicActions })}><span /></button></div>
    </fieldset></section>
    <section className="settings-group"><div className="settings-group-title"><FolderOpen size={19} /><div><h2>本地音乐库</h2></div></div><fieldset disabled={!runtime.backend}>
        <div className="settings-row"><div><strong>打开文件或文件夹</strong></div><select className="lyric-font-select" aria-label="打开文件或文件夹处理方式" disabled={!runtime.nativeFiles} title={runtime.nativeFiles ? undefined : '浏览器文件仅本次播放'} value={runtime.nativeFiles ? library?.settings.dropAction ?? 'ask' : 'temporary'} onChange={event => saveLibrarySettings({ dropAction: event.target.value as StoredSettings['dropAction'] })}><option value="ask">每次询问</option><option value="temporary">仅本次播放</option><option value="library">加入音乐库</option><option value="watch">监听所在文件夹</option></select></div>
      <div className="settings-row"><div><strong>启动时扫描</strong></div><button type="button" role="switch" aria-checked={library?.settings.scanOnStart ?? false} aria-label="启动时扫描" className={`settings-switch ${library?.settings.scanOnStart ? 'on' : ''}`} onClick={() => saveLibrarySettings({ scanOnStart: !library?.settings.scanOnStart })}><span /></button></div>
      <div className="settings-row"><div><strong>自动转换加密音频</strong><small>打开文件/文件夹及自动扫描时处理</small></div><button type="button" role="switch" aria-checked={library?.settings.autoConvert ?? false} aria-label="自动转换加密音频" className={`settings-switch ${library?.settings.autoConvert ? 'on' : ''}`} onClick={() => saveLibrarySettings({ autoConvert: !library?.settings.autoConvert })}><span /></button></div>
      <div className="settings-row"><div><strong>备份加密源文件</strong><small>保存在源文件同目录的备份文件夹</small></div><button type="button" role="switch" aria-checked={library?.settings.backupOriginal ?? true} aria-label="备份加密源文件" className={`settings-switch ${library?.settings.backupOriginal ? 'on' : ''}`} onClick={() => saveLibrarySettings({ backupOriginal: !library?.settings.backupOriginal })}><span /></button></div>
      <div className="settings-row"><div><strong>定时扫描</strong></div><select className="lyric-font-select" aria-label="定时扫描间隔" value={library?.settings.scanIntervalMinutes ?? 0} onChange={event => saveLibrarySettings({ scanIntervalMinutes: Number(event.target.value) })}><option value={0}>关闭</option><option value={15}>每 15 分钟</option><option value={30}>每 30 分钟</option><option value={60}>每小时</option><option value={360}>每 6 小时</option><option value={1440}>每天</option></select></div>
      <div className="settings-row"><div><strong>监听文件夹</strong><small>{library?.folders.length ?? 0} 个路径</small></div><button type="button" className="playlist-primary" disabled={!runtime.nativeFolders} title={runtime.nativeFolders ? '添加文件夹' : '请填写音乐库服务所在电脑的完整路径'} onClick={() => void backend.chooseFolder().then(result => addFolder(result.paths[0])).catch(error => toast.error(error.message))}><Plus size={15} />添加文件夹</button></div>
      <form className="artist-mapping-form" onSubmit={event => { event.preventDefault(); void addFolder(newFolder); }}><label>路径<input value={newFolder} onChange={event => setNewFolder(event.target.value)} placeholder="音乐库服务所在电脑的文件夹完整路径" /></label><button type="submit" className="playlist-primary" disabled={!newFolder.trim()}><Plus size={15} />添加路径</button></form>
      <div className="artist-mapping-list">{library?.folders.map(path => <div className="artist-mapping-item" key={path}><div><strong>{path}</strong></div><button type="button" title="移除监听" aria-label={`移除 ${path}`} onClick={() => void backend.removeFolder(path).then(refreshLibrary).catch(error => toast.error(error.message))}><Trash2 size={15} /></button></div>)}</div>
      <div className="settings-row settings-scan-row"><div><strong>扫描音乐库</strong><small>手动扫描时转换支持的加密歌曲</small></div><div className="settings-scan-actions"><label className="settings-scan-backup"><input type="checkbox" checked={scanBackupOverride ?? library?.settings.backupOriginal ?? true} disabled={scanning || !library} onChange={event => setScanBackupOverride(event.target.checked)} />本次保留源文件备份</label><button type="button" className="playlist-primary" disabled={scanning || !library} onClick={() => void scan()}><RefreshCw size={15} />{scanning ? '扫描中' : '立即扫描'}</button></div></div>
    </fieldset></section>
    <section className="settings-group"><div className="settings-group-title"><Globe2 size={19} /><div><h2>网络音乐库</h2></div></div><fieldset disabled={!runtime.backend}>
      <form className="artist-mapping-form network-source-form" onSubmit={event => void addNetworkSource(event)}>
        <label>来源类型<select className="lyric-font-select" value={sourceKind} onChange={event => setSourceKind(event.target.value as NetworkSource['kind'])}><option value="webdav">WebDAV 文件夹</option><option value="ftp">FTP 文件夹</option><option value="ftps">FTPS 文件夹</option><option value="playlist">HTTP M3U 清单</option></select></label>
        <label>地址<input type="url" required value={sourceURL} onChange={event => setSourceURL(event.target.value)} placeholder={sourceKind === 'playlist' ? 'https://example.com/music.m3u' : sourceKind === 'webdav' ? 'https://example.com/dav/music/' : `${sourceKind}://example.com/music/`} /></label>
        {sourceKind !== 'playlist' && <div className="network-source-credentials"><label>用户名<input autoComplete="username" value={sourceUsername} onChange={event => setSourceUsername(event.target.value)} /></label><label>密码<input type="password" autoComplete="new-password" value={sourcePassword} onChange={event => setSourcePassword(event.target.value)} /></label></div>}
        <div><button type="submit" className="playlist-primary" disabled={addingSource || !sourceURL.trim()}><Plus size={15} />{addingSource ? '连接中' : '添加来源'}</button></div>
      </form>
      <div className="artist-mapping-list">{library?.networkSources.map(source => <div className="artist-mapping-item" key={source.id}><div><strong>{source.kind === 'playlist' ? 'HTTP 清单' : source.kind.toUpperCase()} · {source.url}</strong>{source.username && <small>{source.username}</small>}</div><button type="button" title="移除来源" aria-label={`移除 ${source.url}`} onClick={() => void removeNetworkSource(source.id)}><Trash2 size={15} /></button></div>)}</div>
    </fieldset></section>
    <section className="settings-group"><div className="settings-group-title"><HardDrive size={19} /><div><h2>缓存空间</h2></div></div><fieldset disabled={!runtime.backend}>
      <div className="settings-row"><div><strong>最近播放的网络歌曲</strong><small>完整缓存最近播放的歌曲，单曲上限 512 MB</small></div><select className="lyric-font-select" aria-label="网络歌曲缓存数量" value={library?.settings.networkCacheCount ?? 10} onChange={event => saveLibrarySettings({ networkCacheCount: Number(event.target.value) })}>{[0, 5, 10, 20, 30, 50].map(count => <option key={count} value={count}>{count ? `${count} 首` : '关闭'}</option>)}</select></div>
      <div className="settings-row"><div><strong>网络歌曲缓存</strong><small>{cache ? formatBytes(cache.networkAudioBytes) : runtime.backend ? '正在统计' : '未连接音乐库服务'}</small></div><button type="button" className="playlist-primary" disabled={clearingNetwork || !cache?.networkAudioBytes} onClick={() => void clearNetworkCache()}><Trash2 size={15} />{clearingNetwork ? '清理中' : '清理网络缓存'}</button></div>
      <div className="settings-row"><div><strong>{cache ? formatBytes(cache.totalBytes) : !runtime.backend ? '未连接音乐库服务' : cacheError ? '统计失败' : '正在统计'}</strong>{cache && <small>图片 {formatBytes(cache.coverBytes)}{runtime.mode === 'desktop' && <> · 界面缓存 {formatBytes(cache.webviewBytes)}</>} · 在线资料 {formatBytes(cache.metadataBytes)} · 网络歌曲 {formatBytes(cache.networkAudioBytes)}</small>}{runtime.mode === 'desktop' && cache?.webviewClearPending && <small>界面缓存将在下次启动时清理</small>}</div><button type="button" className="playlist-primary" disabled={clearing || (!cache && !cacheError)} onClick={() => { if (cache) setClearConfirmOpen(true); else void backend.cacheStats().then(stats => { setCache(stats); setCacheError(false); }).catch(error => toast.error(error.message)); }}>{cache ? <Trash2 size={15} /> : <RefreshCw size={15} />}{cache ? '清理缓存' : '重试统计'}</button></div>
    </fieldset></section>
    <section className="settings-group"><div className="settings-group-title"><HardDrive size={19} /><div><h2>数据备份</h2></div></div><fieldset disabled={!runtime.backend}>
      <div className="settings-row backup-row"><div><strong>导出压缩包</strong><small>音乐库数据库、歌词及在线资料、封面缓存；不包含音频文件</small></div><button type="button" className="playlist-primary" disabled={backupBusy !== null} onClick={() => void exportBackup()}><Download size={15} />{backupBusy === 'export' ? '导出中' : '导出备份'}</button></div>
      <div className="settings-row backup-row"><div><strong>合并备份</strong><small>添加缺失数据，保留当前已有歌曲信息、歌单和封面</small></div><button type="button" className="playlist-primary" disabled={backupBusy !== null} onClick={() => backupInput.current?.click()}><Upload size={15} />{backupBusy === 'import' ? '导入中' : '导入备份'}</button><input ref={backupInput} className="sr-only" type="file" accept=".zip,application/zip" aria-label="选择备份压缩包" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importBackup(file); }} /></div>
    </fieldset></section>
    <section className="settings-group"><div className="settings-group-title"><Sun size={19} /><div><h2>外观</h2></div></div>
      <div className="settings-options appearance-options" role="group" aria-label="外观模式">{([{ id: 'dark', label: '深色', icon: Moon }, { id: 'light', label: '浅色', icon: Sun }] as const).map(option => <button key={option.id} type="button" aria-pressed={appearance === option.id} className={appearance === option.id ? 'active' : ''} onClick={() => setAppearance(option.id)}><option.icon size={15} />{option.label}</button>)}</div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Palette size={19} /><div><h2>界面主题</h2></div></div>
      <div className="settings-themes">{themes.map(t => <button type="button" key={t.id} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)} className={`settings-theme ${theme === t.id ? 'selected' : ''}`}><span className={`settings-theme-preview preview-${t.id}`}><t.icon size={24} /></span><span className="settings-theme-label"><strong><t.icon size={15} /> {t.name}</strong></span><span className="settings-theme-check">{theme === t.id && <Check size={15} />}</span></button>)}</div>
    </section>
    <section id="player-style" className="settings-group"><div className="settings-group-title"><Headphones size={19} /><div><h2>播放器样式</h2></div></div>
      <div className="settings-row"><div><strong>播放氛围</strong></div><div className="settings-options">{['频谱', '唱片', '呼吸'].map(v => <button key={v} aria-pressed={visual === v} className={visual === v ? 'active' : ''} onClick={() => setVisual(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>歌词效果</strong></div><div className="settings-options">{['流动', '聚焦', '逐字'].map(v => <button key={v} aria-pressed={lyricEffect === v} className={lyricEffect === v ? 'active' : ''} onClick={() => setLyricEffect(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>歌词滚动</strong></div><div className="settings-options">{['平滑', '即时'].map(v => <button key={v} aria-pressed={lyricScroll === v} className={lyricScroll === v ? 'active' : ''} onClick={() => setLyricScroll(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>显示翻译</strong></div><button type="button" role="switch" aria-checked={showTranslation} aria-label="显示翻译" onClick={() => setShowTranslation(!showTranslation)} className={`settings-switch ${showTranslation ? 'on' : ''}`}><span /></button></div>
    </section>
    <section id="lyrics-layout" className="settings-group"><div className="settings-group-title"><SlidersHorizontal size={19} /><div><h2>歌词排版</h2></div></div>
      <div className="settings-row"><div><strong>字体</strong></div><select className="lyric-font-select" aria-label="歌词字体" value={lyricAppearance.font} onChange={event => setLyricAppearance({ ...lyricAppearance, font: event.target.value })}><option value="default">默认黑体</option><option value="sans">清晰无衬线</option><option value="serif">衬线字体</option></select></div>
      <div className="lyric-setting-control"><label htmlFor="lyric-size">字号 <strong>{lyricAppearance.size}px</strong></label><input id="lyric-size" type="range" min="12" max="28" value={lyricAppearance.size} onChange={event => setLyricAppearance({ ...lyricAppearance, size: Number(event.target.value) })} /></div>
      <div className="lyric-setting-control"><label htmlFor="lyric-line-height">行高 <strong>{lyricAppearance.lineHeight}px</strong></label><input id="lyric-line-height" type="range" min="40" max="100" value={lyricAppearance.lineHeight} onChange={event => setLyricAppearance({ ...lyricAppearance, lineHeight: Number(event.target.value) })} /></div>
      <div className="lyric-setting-control"><label htmlFor="lyric-spacing">行间距 <strong>{lyricAppearance.spacing}px</strong></label><input id="lyric-spacing" type="range" min="0" max="24" value={lyricAppearance.spacing} onChange={event => setLyricAppearance({ ...lyricAppearance, spacing: Number(event.target.value) })} /></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><SlidersHorizontal size={19} /><div><h2>声音</h2></div></div>
      <div className="settings-row"><div><strong>音效</strong><small>{effectName}</small></div><button type="button" className="playlist-primary" onClick={onEditEffects}><SlidersHorizontal size={15} />编辑音效</button></div>
      <div className="settings-eq"><div className="settings-eq-heading"><span><Waves size={16} /> 五段均衡器</span><button onClick={resetEqualizer}>重置</button></div><div className="settings-eq-grid">{eqNames.map((name, i) => <label key={name}><span>{name}</span><input type="range" min="-12" max="12" value={equalizer[i]} onChange={e => setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{equalizer[i] > 0 ? '+' : ''}{equalizer[i]} dB</small></label>)}</div></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Users size={19} /><div><h2>歌手名称映射</h2><p>繁简名称自动合并；其他别名可在此合并。</p></div></div><fieldset disabled={!runtime.backend}>
      {mappings.length > 0 && <div className="artist-mapping-list">{mappings.map((item, index) => <div className="artist-mapping-item" key={index}><div><strong>{item.root}</strong><small>{item.aliases.join(' · ')}</small></div><button type="button" aria-label={`编辑 ${item.root}`} title="编辑映射" onClick={() => { setRoot(item.root); setAliases(item.aliases.join('，')); setEditing(index); setError(''); }}><Pencil size={15} /></button><button type="button" aria-label={`删除 ${item.root}`} title="删除映射" onClick={() => { setMappings(mappings.filter((_, i) => i !== index)); if (editing === index) { setEditing(null); setRoot(''); setAliases(''); setError(''); } else if (editing !== null && editing > index) setEditing(editing - 1); }}><Trash2 size={15} /></button></div>)}</div>}
      <form className="artist-mapping-form" onSubmit={saveMapping}><label>展示名称（映射根）<input value={root} onChange={event => setRoot(event.target.value)} placeholder="例如：青木" list="artist-name-options" maxLength={80} /></label><label>其他名称（用逗号分隔）<input value={aliases} onChange={event => setAliases(event.target.value)} placeholder="例如：青木 · Aoki，青木 Aoki" maxLength={500} /></label><datalist id="artist-name-options">{artistNames.map(name => <option key={name} value={name} />)}</datalist>{error && <p role="alert">{error}</p>}<div><button type="submit" className="playlist-primary"><Plus size={15} />{editing === null ? '添加映射' : '保存映射'}</button>{editing !== null && <button type="button" className="artist-mapping-cancel" onClick={() => { setEditing(null); setRoot(''); setAliases(''); setError(''); }}>取消</button>}</div></form>
    </fieldset></section>
    <section className="settings-group"><div className="settings-group-title"><Timer size={19} /><div><h2>定时暂停</h2></div></div><div className="settings-row"><div><strong>暂停时间</strong><small>{sleep > 0 ? `剩余 ${formatTime(sleep)}` : '未设置定时'}</small></div><div className="settings-options">{[0, 15, 30, 60].map(v => <button key={v} aria-pressed={v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v} className={(v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v) ? 'active' : ''} onClick={() => setSleep(v * 60)}>{v ? `${v} 分钟` : '关闭'}</button>)}</div></div><div className="settings-row"><div><strong>精细设定</strong><small>以分钟为单位，最多 24 小时</small></div><form className="sleep-settings-form" onSubmit={event => { event.preventDefault(); const minutes = Number(new FormData(event.currentTarget).get('minutes')); if (Number.isFinite(minutes) && minutes > 0) setSleep(Math.round(minutes * 60)); }}><input name="minutes" type="number" min="1" max="1440" step="1" aria-label="睡眠定时分钟数" defaultValue={sleep > 0 ? Math.ceil(sleep / 60) : 20} /><span>分钟</span><button type="submit">设置</button></form></div></section>
    <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}><DialogContent className="music-dialog playlist-dialog"><DialogTitle>清理缓存？</DialogTitle><DialogDescription>在线图片、资料和网络歌曲缓存将被清除；音乐库、收藏、内嵌封面及自定义歌单封面会保留。{runtime.mode === 'desktop' && '界面缓存在下次启动时清理。'}</DialogDescription><div className="playlist-dialog-actions"><button type="button" disabled={clearing} onClick={() => setClearConfirmOpen(false)}>取消</button><button type="button" className="playlist-danger" disabled={clearing} onClick={() => void clearCache()}>{clearing ? '清理中' : '清理缓存'}</button></div></DialogContent></Dialog>
  </div>;
}
