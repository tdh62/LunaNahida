import { useRef, useState, type DragEvent, type Dispatch, type SetStateAction } from 'react';
import { Check, FolderOpen, Hammer, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { backend, type ConversionResult } from '@/lib/backend';
import type { Track } from '@/lib/music';
import { toast } from 'sonner';
import '@/toolbox.css';

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
};

export default function Toolbox({ open, theme, autoClose, onOpenChange, paths, setPaths, addToLibrary, onAddToLibraryChange, onChanged }: Props) {
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [results, setResults] = useState<Record<string, ConversionResult>>({});

  const addPaths = async (incoming: string[]) => {
    if (!incoming.length) return;
    try {
      const found = (await backend.inspectConversion(incoming)).paths;
      setPaths(previous => [...new Set([...previous, ...found])]);
      if (!found.length) toast.info('没有找到可转换的加密音频');
    } catch (error) { toast.error(error instanceof Error ? error.message : '无法读取文件'); }
  };
  const choose = () => void backend.chooseFiles().then(result => addPaths(result.paths)).catch(error => toast.error(error.message));
  const drop = (event: DragEvent) => {
    event.preventDefault();
    const dropped = [...event.dataTransfer.files].map(file => (file as File & { path?: string }).path).filter((value): value is string => Boolean(value));
    void addPaths(dropped);
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

  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent data-file-drop-target className={`music-dialog toolbox-dialog theme-${theme}`} onDragOver={event => event.preventDefault()} onDrop={drop}>
      <DialogTitle><Hammer size={19} /> 音频工具箱</DialogTitle>
      <DialogDescription>格式还原</DialogDescription>
      <div className="toolbox-drop" onClick={choose} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') choose(); }}>
        <FolderOpen size={25} /><strong>拖入加密音频，或选择文件</strong><small>输出保存在源文件所在文件夹</small>
      </div>
      <div className="toolbox-controls"><label><input type="checkbox" checked={addToLibrary} onChange={event => onAddToLibraryChange(event.target.checked)} /> 加入音乐库</label><button type="button" onClick={choose} disabled={busy}><Plus size={15} />添加文件</button></div>
      {paths.length > 0 && <div className="toolbox-list" aria-live="polite">{paths.map(path => <div key={path} className="toolbox-item"><div><strong title={path}>{path.split(/[\\/]/).at(-1)}</strong><small title={results[path]?.error || results[path]?.output || path}>{results[path]?.status === 'converted' ? results[path].error || `已转换 · ${results[path].output?.split(/[\\/]/).at(-1)}` : current === path ? '转换中…' : results[path]?.error || path}</small></div>{results[path]?.status === 'converted' ? <Check size={17} className="toolbox-success" /> : <button type="button" title="移除" aria-label={`移除 ${path}`} disabled={busy} onClick={() => setPaths(previous => previous.filter(value => value !== path))}><X size={16} /></button>}</div>)}</div>}
      <div className="toolbox-actions"><button type="button" onClick={() => { setPaths([]); setResults({}); }} disabled={busy || !paths.length}>清空</button><button type="button" className="toolbox-convert" onClick={() => void convert()} disabled={busy || !paths.length || paths.every(path => results[path]?.status === 'converted')}>{busy ? '转换中' : '开始转换'}</button></div>
    </DialogContent>
  </Dialog>;
}
