import { useCallback, useEffect, useRef, useState, type DragEvent, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, ArrowUpRight, AudioLines, Check, Clock3, FileAudio, FolderOpen, Hammer, Library, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { backend, type ConversionResult, type OrganizerResult } from '@/lib/backend';
import MusicOrganizer from '@/components/MusicOrganizer';
import NoiseGenerator from '@/components/NoiseGenerator';
import WorkTimer from '@/components/WorkTimer';
import ConversionRecovery from '@/components/ConversionRecovery';
import type { WorkTimerControls } from '@/hooks/use-work-timer';
import type { NoiseControls } from '@/hooks/use-noise-generator';
import type { Track } from '@/lib/music';
import { toast } from 'sonner';
import { useRuntime } from '@/hooks/use-runtime';
import '@/toolbox.css';
import '@/work-timer.css';

type Props = {
  open: boolean;
  theme: string;
  autoClose: boolean;
  onOpenChange: (open: boolean) => void;
  paths: string[];
  setPaths: Dispatch<SetStateAction<string[]>>;
  addToLibrary: boolean;
  onAddToLibraryChange: (value: boolean) => void;
  onChanged: (tracks: Track[]) => Promise<void>;
  onOrganized: (result: OrganizerResult) => Promise<void>;
  noise: NoiseControls;
  timer: WorkTimerControls;
  launchRequest: { tool: 'conversion' | 'timer' | null; revision: number };
};

const tools = [
  { id: 'conversion', title: '格式还原', icon: FileAudio },
  { id: 'recovery', title: '文件恢复', icon: FolderOpen },
  { id: 'organizer', title: '曲库整理', icon: Library },
  { id: 'noise', title: '噪音发生器', icon: AudioLines },
  { id: 'timer', title: '计时器', icon: Clock3 },
] as const;

export default function Toolbox({ open, theme, autoClose, onOpenChange, paths, setPaths, addToLibrary, onAddToLibraryChange, onChanged, onOrganized, noise, timer, launchRequest }: Props) {
  const runtime = useRuntime();
  const noiseAvailable = typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined' && (runtime.mode === 'desktop' || window.isSecureContext);
  const [incomingPath, setIncomingPath] = useState('');
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [progress, setProgress] = useState({ completed: 0, total: 0, cancelled: false });
  const runRef = useRef<{ cancelled: boolean; id: string; controller: AbortController } | null>(null);
  useEffect(() => () => { const run = runRef.current; if (run) { run.cancelled = true; if (run.id) void backend.cancelConversion(run.id).catch(() => {}); run.controller.abort(); } }, []);
  const [results, setResults] = useState<Record<string, ConversionResult>>({});
  const [tool, setTool] = useState<typeof tools[number]['id'] | null>(null);
  const [organizerPaths, setOrganizerPaths] = useState<string[]>([]);
  const [organizerBusy, setOrganizerBusy] = useState(false);
  const workingRef = useRef(false);
  workingRef.current = busy || organizerBusy;
  useEffect(() => {
    if (open && !workingRef.current) { window.dispatchEvent(new Event('lunanahida-capabilities-changed')); setTool(launchRequest.tool === 'conversion' && !runtime.conversion ? null : launchRequest.tool); }
  }, [open, launchRequest, runtime.conversion]);
  useEffect(() => { if (!runtime.conversion && !busy) { setTool(previous => previous === 'conversion' ? null : previous); setPaths([]); setResults({}); } }, [runtime.conversion, busy, setPaths]);
  const selectedTool = tools.find(value => value.id === tool);
  const ToolIcon = selectedTool?.icon ?? Hammer;
  const modal = tool === 'conversion' || tool === 'organizer' || tool === 'recovery';
  const pendingConversions = paths.filter(path => results[path]?.status !== 'converted').length;

  const addPaths = useCallback(async (incoming: string[]) => {
    if (!incoming.length || !runtime.conversion) return;
    try {
      const inspected = await backend.inspectConversion(incoming);
      if (inspected.available === false) { window.dispatchEvent(new Event('lunanahida-capabilities-changed')); toast.info('未安装或无法使用加密音乐还原模块'); return; }
      const found = inspected.paths;
      setPaths(previous => [...new Set([...previous, ...found])]);
      if (!found.length) toast.info('没有找到可转换的加密音频');
    } catch (error) { toast.error(error instanceof Error ? error.message : '无法读取文件'); }
  }, [setPaths, runtime.conversion]);
  useEffect(() => {
    if (!open) return;
    const receive = (event: Event) => {
      if (busy || organizerBusy || tool === 'noise' || tool === 'timer' || tool === 'recovery') return;
      const incoming = (event as CustomEvent<string[]>).detail;
      if (tool === 'organizer') setOrganizerPaths(previous => [...new Set([...previous, ...incoming])]);
      else if (runtime.conversion) { setTool('conversion'); void addPaths(incoming); }
    };
    window.addEventListener('lunanahida-toolbox-drop', receive);
    return () => window.removeEventListener('lunanahida-toolbox-drop', receive);
  }, [open, tool, busy, organizerBusy, addPaths, runtime.conversion]);
  const choose = () => { if (runtime.nativeFiles) void backend.chooseFiles().then(result => addPaths(result.paths)).catch(error => toast.error(error.message)); };
  const drop = (event: DragEvent) => {
    if (runtime.mode !== 'desktop') return;
    event.preventDefault();
    const dropped = [...event.dataTransfer.files].map(file => (file as File & { path?: string }).path).filter((value): value is string => Boolean(value));
    if (busy || organizerBusy || tool === 'noise' || tool === 'timer' || tool === 'recovery') return;
    if (tool === 'organizer') setOrganizerPaths(previous => [...new Set([...previous, ...dropped])]);
    else if (runtime.conversion) { setTool('conversion'); void addPaths(dropped); }
  };
  const convert = async (failedOnly = false) => {
    if (!paths.length || runRef.current || busy || !runtime.conversion) return;
    const pending = paths.filter(path => failedOnly ? results[path]?.status === 'failed' : results[path]?.status !== 'converted');
    if (!pending.length) return;
    const run = { cancelled: false, id: '', controller: new AbortController() };
    runRef.current = run;
    setProgress({ completed: 0, total: pending.length, cancelled: false });
    setBusy(true);
    let converted = 0;
    let failed = paths.some(path => results[path]?.status === 'converted' && Boolean(results[path]?.error));
    const addedTracks: Track[] = [];
    for (const path of pending) {
      if (run.cancelled) break;
      setCurrent(path);
      run.id = crypto.randomUUID();
      try {
        const result = await backend.convert(path, addToLibrary, run.id, run.controller.signal);
        setResults(previous => ({ ...previous, [path]: result }));
        if (result.status === 'converted') { converted++; if (result.track) addedTracks.push(result.track); if (result.error) { failed = true; toast.warning(result.error); } }
        else if (result.status === 'cancelled') { run.cancelled = true; break; }
        else failed = true;
      } catch (error) {
        failed = true;
        setResults(previous => ({ ...previous, [path]: { source: path, status: 'failed', error: error instanceof Error ? error.message : '转换失败' } }));
        if ((error as { code?: string }).code === 'CONVERTER_UNAVAILABLE') break;
      }
      run.id = '';
      setProgress(previous => ({ ...previous, completed: previous.completed + 1 }));
    }
    run.id = '';
    setCurrent('');
    if (converted) {
      try { await onChanged(addedTracks); }
      catch (error) { failed = true; toast.error(error instanceof Error ? error.message : '曲库刷新失败'); }
      toast.success(`已转换 ${converted} 首`);
    }
    setBusy(false);
    runRef.current = null;
    setProgress(previous => ({ ...previous, cancelled: run.cancelled }));
    if (run.cancelled) toast.info('已取消，完成的结果已保留');
    if (autoClose && converted && !failed && !run.cancelled && pathsRef.current.every(path => paths.includes(path)) && paths.every(path => pending.includes(path) || results[path]?.status === 'converted')) {
      setPaths([]);
      setResults({});
      onOpenChange(false);
    }
  };
  const cancel = async () => {
    const run = runRef.current;
    if (!run) return;
    run.cancelled = true;
    setProgress(previous => ({ ...previous, cancelled: true }));
    if (run.id) {
      try { await backend.cancelConversion(run.id); }
      catch (error) { toast.error(error instanceof Error ? error.message : '取消请求失败，请重试'); setProgress(previous => ({ ...previous, cancelled: false })); run.cancelled = false; }
    }
  };

  return <Dialog open={open} modal={modal} onOpenChange={value => { if (!busy && !organizerBusy) onOpenChange(value); }}>
    <DialogContent aria-describedby={undefined} data-file-drop-target showOverlay={modal} className={`music-dialog toolbox-dialog ${tool === null ? 'toolbox-menu-dialog' : tool === 'organizer' ? 'organizer-dialog' : tool === 'noise' ? 'noise-dialog' : tool === 'timer' ? 'timer-dialog' : ''} theme-${theme}`} onInteractOutside={event => { if (tool === 'noise' || tool === 'timer' || busy || organizerBusy || (event.target instanceof Element && event.target.closest('.toolbox-trigger, .work-timer-trigger'))) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy || organizerBusy) event.preventDefault(); }} onDragOver={event => event.preventDefault()} onDrop={drop}>
      {selectedTool && <div className="toolbox-app-nav"><button type="button" disabled={busy || organizerBusy} onClick={() => setTool(null)}><ArrowLeft size={14} />返回工具箱</button></div>}
      <DialogTitle><ToolIcon size={19} /> {selectedTool?.title ?? '工具箱'}</DialogTitle>
      {tool === null ? <>
        <div className="toolbox-apps" role="group" aria-label="工具箱应用">{tools.filter(application => (application.id !== 'conversion' || runtime.conversion) && (application.id !== 'recovery' || runtime.backend)).map(application => {
          const Icon = application.icon;
          const status = application.id === 'noise' && noise.active ? `${noise.name} · ${noise.playing ? '播放中' : '已暂停'}` : application.id === 'timer' && timer.active ? `${timer.state.mode === 'stopwatch' ? '正计时' : '倒计时'} · ${{ running: '计时中', paused: '已暂停', completed: '已结束', idle: '准备开始' }[timer.view.status]}` : application.id === 'conversion' && pendingConversions ? `${pendingConversions} 个文件待处理` : '';
          const unavailable = application.id === 'noise' ? !noiseAvailable : (application.id === 'conversion' || application.id === 'organizer') && !runtime.backend;
          return <button type="button" className="toolbox-app-card" key={application.id} disabled={unavailable} title={unavailable ? application.id === 'noise' ? '当前浏览器不支持噪音播放' : '需要连接音乐库服务' : application.title} aria-label={application.title} onClick={() => setTool(application.id)}>
            <span className="toolbox-app-icon"><Icon size={23} /></span>
            <span className="toolbox-app-label"><strong>{application.title}</strong>{status && <small>{status}</small>}</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>;
        })}</div>
      </> : tool === 'timer' ? <WorkTimer timer={timer} /> : tool === 'noise' ? <NoiseGenerator noise={noise} /> : tool === 'recovery' ? <ConversionRecovery onChanged={onChanged} onBusyChange={setOrganizerBusy} /> : tool === 'organizer' ? <MusicOrganizer paths={organizerPaths} setPaths={setOrganizerPaths} onBusyChange={setOrganizerBusy} onChanged={onOrganized} /> : <>
      {runtime.nativeFiles && <div className="toolbox-drop" onClick={choose} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') choose(); }}>
        <FolderOpen size={25} /><strong>拖入或选择加密音频</strong><small>输出至原文件夹</small>
      </div>}
      {!runtime.nativeFiles && <form className="organizer-path-entry" onSubmit={event => { event.preventDefault(); void addPaths([incomingPath.trim()]); setIncomingPath(''); }}><input aria-label="加密音频绝对路径" placeholder="音乐库服务所在电脑的音频完整路径" value={incomingPath} disabled={busy} onChange={event => setIncomingPath(event.target.value)} /><button type="submit" disabled={busy || !incomingPath.trim()} aria-label="添加音频路径"><Plus size={15} /></button></form>}
      <div className="toolbox-controls"><label><input type="checkbox" disabled={busy} checked={addToLibrary} onChange={event => onAddToLibraryChange(event.target.checked)} /> 加入音乐库</label><button type="button" onClick={choose} disabled={busy || !runtime.nativeFiles}><Plus size={15} />添加文件</button></div>
      {progress.total > 0 && <div className="conversion-progress" role="status"><span>{progress.cancelled ? busy ? '正在取消…' : '已取消' : busy ? '正在还原' : '本批已结束'} · 已处理 {progress.completed} / {progress.total}</span><progress aria-label="批量还原进度" value={progress.completed} max={progress.total} /></div>}
      {paths.length > 0 && <div className="toolbox-list" aria-live="polite">{paths.map(path => <div key={path} className="toolbox-item"><div><strong title={path}>{path.split(/[\\/]/).at(-1)}</strong><small title={results[path]?.error || results[path]?.output || path}>{results[path]?.status === 'converted' ? results[path].error || `已转换 · ${results[path].output?.split(/[\\/]/).at(-1)}` : current === path ? '转换中…' : results[path]?.error || path}</small></div>{results[path]?.status === 'converted' ? <Check size={17} className="toolbox-success" /> : <button type="button" title="移除" aria-label={`移除 ${path}`} disabled={busy} onClick={() => setPaths(previous => previous.filter(value => value !== path))}><X size={16} /></button>}</div>)}</div>}
      <div className="toolbox-actions"><button type="button" onClick={() => { setPaths([]); setResults({}); setProgress({ completed: 0, total: 0, cancelled: false }); }} disabled={busy || !paths.length}>清空</button>{!busy && paths.some(path => results[path]?.status === 'failed') && <button onClick={() => void convert(true)}>仅重试失败项</button>}{busy ? <button type="button" onClick={() => void cancel()} disabled={progress.cancelled}>取消还原</button> : <button type="button" className="toolbox-convert" onClick={() => void convert()} disabled={!paths.length || paths.every(path => results[path]?.status === 'converted')}>{progress.cancelled ? '继续剩余任务' : '开始转换'}</button>}</div>
      </>}
    </DialogContent>
  </Dialog>;
}
