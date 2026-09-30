import { useCallback, useEffect, useRef, useState, type DragEvent, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, ArrowUpRight, AudioLines, Check, Clock3, FileAudio, FolderOpen, Hammer, Library, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { backend, type ConversionResult, type OrganizerResult } from '@/lib/backend';
import MusicOrganizer from '@/components/MusicOrganizer';
import NoiseGenerator from '@/components/NoiseGenerator';
import WorkTimer from '@/components/WorkTimer';
import type { WorkTimerControls } from '@/hooks/use-work-timer';
import type { NoiseControls } from '@/hooks/use-noise-generator';
import type { Track } from '@/lib/music';
import { toast } from 'sonner';
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
  { id: 'organizer', title: '曲库整理', icon: Library },
  { id: 'noise', title: '噪音发生器', icon: AudioLines },
  { id: 'timer', title: '计时器', icon: Clock3 },
] as const;

export default function Toolbox({ open, theme, autoClose, onOpenChange, paths, setPaths, addToLibrary, onAddToLibraryChange, onChanged, onOrganized, noise, timer, launchRequest }: Props) {
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [results, setResults] = useState<Record<string, ConversionResult>>({});
  const [tool, setTool] = useState<typeof tools[number]['id'] | null>(null);
  const [organizerPaths, setOrganizerPaths] = useState<string[]>([]);
  const [organizerBusy, setOrganizerBusy] = useState(false);
  const workingRef = useRef(false);
  workingRef.current = busy || organizerBusy;
  useEffect(() => {
    if (open && !workingRef.current) setTool(launchRequest.tool);
  }, [open, launchRequest]);
  const selectedTool = tools.find(value => value.id === tool);
  const ToolIcon = selectedTool?.icon ?? Hammer;
  const modal = tool === 'conversion' || tool === 'organizer';
  const pendingConversions = paths.filter(path => results[path]?.status !== 'converted').length;

  const addPaths = useCallback(async (incoming: string[]) => {
    if (!incoming.length) return;
    try {
      const found = (await backend.inspectConversion(incoming)).paths;
      setPaths(previous => [...new Set([...previous, ...found])]);
      if (!found.length) toast.info('没有找到可转换的加密音频');
    } catch (error) { toast.error(error instanceof Error ? error.message : '无法读取文件'); }
  }, [setPaths]);
  useEffect(() => {
    if (!open) return;
    const receive = (event: Event) => {
      if (busy || organizerBusy || tool === 'noise' || tool === 'timer') return;
      const incoming = (event as CustomEvent<string[]>).detail;
      if (tool === 'organizer') setOrganizerPaths(previous => [...new Set([...previous, ...incoming])]);
      else { setTool('conversion'); void addPaths(incoming); }
    };
    window.addEventListener('lunanahida-toolbox-drop', receive);
    return () => window.removeEventListener('lunanahida-toolbox-drop', receive);
  }, [open, tool, busy, organizerBusy, addPaths]);
  const choose = () => void backend.chooseFiles().then(result => addPaths(result.paths)).catch(error => toast.error(error.message));
  const drop = (event: DragEvent) => {
    event.preventDefault();
    const dropped = [...event.dataTransfer.files].map(file => (file as File & { path?: string }).path).filter((value): value is string => Boolean(value));
    if (busy || organizerBusy || tool === 'noise' || tool === 'timer') return;
    if (tool === 'organizer') setOrganizerPaths(previous => [...new Set([...previous, ...dropped])]);
    else { setTool('conversion'); void addPaths(dropped); }
  };
  const convert = async () => {
    if (!paths.length || busy) return;
    setBusy(true);
    let converted = 0;
    let failed = paths.some(path => results[path]?.status === 'converted' && Boolean(results[path]?.error));
    const addedTracks: Track[] = [];
    for (const path of paths) {
      if (results[path]?.status === 'converted') continue;
      setCurrent(path);
      try {
        const result = await backend.convert(path, addToLibrary);
        setResults(previous => ({ ...previous, [path]: result }));
        if (result.status === 'converted') { converted++; if (result.track) addedTracks.push(result.track); if (result.error) { failed = true; toast.warning(result.error); } }
        else failed = true;
      } catch (error) {
        failed = true;
        setResults(previous => ({ ...previous, [path]: { source: path, status: 'failed', error: error instanceof Error ? error.message : '转换失败' } }));
      }
    }
    setCurrent('');
    if (converted) {
      try { await onChanged(addedTracks); }
      catch (error) { failed = true; toast.error(error instanceof Error ? error.message : '曲库刷新失败'); }
      toast.success(`已转换 ${converted} 首`);
    }
    setBusy(false);
    if (autoClose && converted && !failed && pathsRef.current.every(path => paths.includes(path))) {
      setPaths([]);
      setResults({});
      onOpenChange(false);
    }
  };

  return <Dialog open={open} modal={modal} onOpenChange={value => { if (!busy && !organizerBusy) onOpenChange(value); }}>
    <DialogContent aria-describedby={undefined} data-file-drop-target showOverlay={modal} className={`music-dialog toolbox-dialog ${tool === null ? 'toolbox-menu-dialog' : tool === 'organizer' ? 'organizer-dialog' : tool === 'noise' ? 'noise-dialog' : tool === 'timer' ? 'timer-dialog' : ''} theme-${theme}`} onInteractOutside={event => { if (tool === 'noise' || tool === 'timer' || busy || organizerBusy || (event.target instanceof Element && event.target.closest('.toolbox-trigger, .work-timer-trigger'))) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy || organizerBusy) event.preventDefault(); }} onDragOver={event => event.preventDefault()} onDrop={drop}>
      {selectedTool && <div className="toolbox-app-nav"><button type="button" disabled={busy || organizerBusy} onClick={() => setTool(null)}><ArrowLeft size={14} />返回工具箱</button></div>}
      <DialogTitle><ToolIcon size={19} /> {selectedTool?.title ?? '工具箱'}</DialogTitle>
      {tool === null ? <>
        <div className="toolbox-apps" role="group" aria-label="工具箱应用">{tools.map(application => {
          const Icon = application.icon;
          const status = application.id === 'noise' && noise.active ? `${noise.name} · ${noise.playing ? '播放中' : '已暂停'}` : application.id === 'timer' && timer.active ? `${timer.state.mode === 'stopwatch' ? '正计时' : '倒计时'} · ${{ running: '计时中', paused: '已暂停', completed: '已结束', idle: '准备开始' }[timer.view.status]}` : application.id === 'conversion' && pendingConversions ? `${pendingConversions} 个文件待处理` : '';
          return <button type="button" className="toolbox-app-card" key={application.id} aria-label={application.title} onClick={() => setTool(application.id)}>
            <span className="toolbox-app-icon"><Icon size={23} /></span>
            <span className="toolbox-app-label"><strong>{application.title}</strong>{status && <small>{status}</small>}</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>;
        })}</div>
      </> : tool === 'timer' ? <WorkTimer timer={timer} /> : tool === 'noise' ? <NoiseGenerator noise={noise} /> : tool === 'organizer' ? <MusicOrganizer paths={organizerPaths} setPaths={setOrganizerPaths} onBusyChange={setOrganizerBusy} onChanged={onOrganized} /> : <>
      <div className="toolbox-drop" onClick={choose} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') choose(); }}>
        <FolderOpen size={25} /><strong>拖入或选择加密音频</strong><small>输出至原文件夹</small>
      </div>
      <div className="toolbox-controls"><label><input type="checkbox" checked={addToLibrary} onChange={event => onAddToLibraryChange(event.target.checked)} /> 加入音乐库</label><button type="button" onClick={choose} disabled={busy}><Plus size={15} />添加文件</button></div>
      {paths.length > 0 && <div className="toolbox-list" aria-live="polite">{paths.map(path => <div key={path} className="toolbox-item"><div><strong title={path}>{path.split(/[\\/]/).at(-1)}</strong><small title={results[path]?.error || results[path]?.output || path}>{results[path]?.status === 'converted' ? results[path].error || `已转换 · ${results[path].output?.split(/[\\/]/).at(-1)}` : current === path ? '转换中…' : results[path]?.error || path}</small></div>{results[path]?.status === 'converted' ? <Check size={17} className="toolbox-success" /> : <button type="button" title="移除" aria-label={`移除 ${path}`} disabled={busy} onClick={() => setPaths(previous => previous.filter(value => value !== path))}><X size={16} /></button>}</div>)}</div>}
      <div className="toolbox-actions"><button type="button" onClick={() => { setPaths([]); setResults({}); }} disabled={busy || !paths.length}>清空</button><button type="button" className="toolbox-convert" onClick={() => void convert()} disabled={busy || !paths.length || paths.every(path => results[path]?.status === 'converted')}>{busy ? '转换中' : '开始转换'}</button></div>
      </>}
    </DialogContent>
  </Dialog>;
}
