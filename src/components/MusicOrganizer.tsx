import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { backend, type OrganizerOptions, type OrganizerPlan, type OrganizerProgress, type OrganizerResult } from '@/lib/backend';
import { organizerProgressPercent } from '@/lib/organizer-progress';
import { toast } from 'sonner';
import { useRuntime } from '@/hooks/use-runtime';

type Props = {
  paths: string[];
  setPaths: Dispatch<SetStateAction<string[]>>;
  onBusyChange: (value: boolean) => void;
  onChanged: (result: OrganizerResult) => Promise<void>;
};

const modes: { id: OrganizerOptions['mode']; title: string }[] = [
  { id: 'rename', title: '按格式命名' },
  { id: 'artist', title: '按歌手归档' },
  { id: 'deduplicate', title: '清理重复音乐' },
  { id: 'consolidate', title: '合并多个路径' },
];
const message = (error: unknown) => error instanceof Error ? error.message : '整理失败';

export default function MusicOrganizer({ paths, setPaths, onBusyChange, onChanged }: Props) {
  const runtime = useRuntime();
  const [mode, setMode] = useState<OrganizerOptions['mode']>('rename');
  const [target, setTarget] = useState('');
  const [template, setTemplate] = useState('{artist} - {title}');
  const [incoming, setIncoming] = useState('');
  const [busy, setBusy] = useState<'preview' | 'execute' | 'choose' | null>(null);
  const [snapshot, setSnapshot] = useState<{ plan: OrganizerPlan; signature: string } | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<OrganizerResult | null>(null);
  const [matchMode, setMatchMode] = useState<'content' | 'quick'>('content');
  const [progress, setProgress] = useState<OrganizerProgress | null>(null);
  const scanController = useRef<AbortController | null>(null);
  useEffect(() => () => scanController.current?.abort(), []);
  const signature = JSON.stringify({ paths, mode, target, template, matchMode });
  const plan = snapshot?.signature === signature ? snapshot.plan : null;
  const working = (value: typeof busy) => { setBusy(value); onBusyChange(Boolean(value)); };
  const invalidate = () => { setSnapshot(null); setConfirmed(false); setResult(null); };
  const add = (values: string[]) => { if (!values.length) return; invalidate(); setPaths(previous => [...new Set([...previous, ...values.map(value => value.trim()).filter(Boolean)])]); };
  const choose = async (destination = false) => {
    working('choose');
    try { const selection = await backend.chooseFolder(); if (destination && selection.paths[0]) { invalidate(); setTarget(selection.paths[0]); } else if (!destination) add(selection.paths); }
    catch (error) { toast.error(message(error)); }
    finally { working(null); }
  };
  const preview = async () => {
    if (busy) return;
    const controller = new AbortController();
    scanController.current = controller;
    setProgress({ phase: 'discover', processed: 0, total: 0, current: '', bytes: 0, totalBytes: 0, quick: mode === 'deduplicate' && matchMode === 'quick' });
    working('preview'); invalidate();
    try {
      const next = await backend.previewOrganizer({ paths, mode, target: target.trim(), template, matchMode: mode === 'deduplicate' ? matchMode : 'content' }, setProgress, controller.signal);
      setSnapshot({ plan: next, signature });
      setKeep(Object.fromEntries(next.groups.filter(group => group.suggestedKeep).map(group => [group.id, group.suggestedKeep])));
      if (!next.scanned) toast.info('没有找到支持的音乐文件');
    } catch (error) { if (controller.signal.aborted) toast.info('扫描已取消，文件未修改'); else toast.error(message(error)); }
    finally { scanController.current = null; setProgress(null); working(null); }
  };
  const execute = async () => {
    if (!plan || !confirmed || busy) return;
    working('execute');
    try {
      const completed = await backend.executeOrganizer(plan.id, keep);
      setResult(completed); setSnapshot(null); setConfirmed(false);
      toast.success(`已整理 ${completed.moved} 首，移入恢复区 ${completed.quarantined} 首`);
      try { await onChanged(completed); } catch (error) { toast.warning(`整理已完成，曲库刷新失败：${message(error)}`); }
    } catch (error) { setSnapshot(null); setConfirmed(false); toast.error(message(error)); }
    finally { working(null); }
  };
  const pending = plan?.groups.filter(group => !keep[group.id]).length ?? 0;
  const removed = plan?.groups.reduce((total, group) => total + (keep[group.id] && keep[group.id] !== '*' ? group.files.length - 1 : 0), 0) ?? 0;
  const actionable = Boolean(plan && (plan.moves.length || removed));
  const percentage = progress ? organizerProgressPercent(progress) : null;

  return <div className="organizer">
    <div className="organizer-modes" role="group" aria-label="整理操作">{modes.map(item => <button type="button" key={item.id} className={mode === item.id ? 'active' : ''} aria-pressed={mode === item.id} disabled={Boolean(busy)} onClick={() => { invalidate(); setMode(item.id); }}>{item.title}</button>)}</div>
    <fieldset disabled={Boolean(busy)} className="organizer-inputs">
      {mode === 'deduplicate' && <div className="organizer-match-options" role="group" aria-label="去重匹配方式">
        <label><input type="radio" name="organizer-match" checked={matchMode === 'content'} onChange={() => { invalidate(); setMatchMode('content'); }} />完整校验</label>
        <label><input type="radio" name="organizer-match" checked={matchMode === 'quick'} onChange={() => { invalidate(); setMatchMode('quick'); }} />快速匹配</label>
        {matchMode === 'quick' && <p className="organizer-hint">不读取音频，仅匹配已有标签或同名与大小；结果须人工确认。</p>}
      </div>}
      <label htmlFor="organizer-source">来源路径 <span>包含子文件夹</span></label>
      <form className="organizer-path-entry" onSubmit={event => { event.preventDefault(); add([incoming]); setIncoming(''); }}>
        <input id="organizer-source" value={incoming} onChange={event => setIncoming(event.target.value)} placeholder="音乐库服务所在电脑的文件夹或音乐文件完整路径" />
        <button type="submit" disabled={!incoming.trim()} aria-label="添加来源路径"><Plus size={15} /></button>
        <button type="button" disabled={!runtime.nativeFolders} title={runtime.nativeFolders ? '选择文件夹' : '请填写音乐库服务所在电脑的完整路径'} onClick={() => void choose()}><FolderOpen size={15} />选择文件夹</button>
      </form>
      <div className="organizer-sources">{paths.map(path => <div key={path}><span title={path}>{path}</span><button type="button" aria-label={`移除来源 ${path}`} onClick={() => { invalidate(); setPaths(previous => previous.filter(value => value !== path)); }}><X size={14} /></button></div>)}</div>
      {mode !== 'deduplicate' && <><label htmlFor="organizer-target">目标路径 {mode === 'rename' && <span>留空则在原位置命名</span>}</label><div className="organizer-path-entry"><input id="organizer-target" value={target} onChange={event => { invalidate(); setTarget(event.target.value); }} placeholder="音乐库服务所在电脑的目标文件夹完整路径" /><button type="button" disabled={!runtime.nativeFolders} title={runtime.nativeFolders ? '选择文件夹' : '请填写音乐库服务所在电脑的完整路径'} onClick={() => void choose(true)}><FolderOpen size={15} />选择</button></div></>}
      {mode === 'rename' && <><label htmlFor="organizer-template">命名格式</label><input id="organizer-template" value={template} onChange={event => { invalidate(); setTemplate(event.target.value); }} /><div className="organizer-presets">{['{artist} - {title}', '{title} - {artist}', '{artist} - {album} - {title}', '{title}'].map(value => <button type="button" key={value} onClick={() => { invalidate(); setTemplate(value); }}>{value}</button>)}</div><p className="organizer-hint">{'{title}'} 歌名 · {'{artist}'} 歌手 · {'{album}'} 专辑 · {'{filename}'} 原文件名</p></>}
    </fieldset>
    {busy === 'preview' && progress && <section className="organizer-progress" aria-label="扫描进度">
      <div><strong>{progress.phase === 'discover' ? `正在发现音乐 · 已找到 ${progress.total} 首` : progress.phase === 'group' ? '正在生成整理预览…' : progress.phase === 'ready' ? '扫描完成' : progress.quick ? '正在快速匹配…' : '正在读取与校验…'}</strong><span>{percentage === null ? '' : `${percentage}%`}</span></div>
      <progress aria-label="扫描完成比例" max="100" value={percentage ?? undefined} />
      {progress.phase !== 'discover' && <p>已处理 {progress.processed} / {progress.total} 首{!progress.quick && progress.totalBytes > 0 && ` · ${(progress.bytes / 1048576).toFixed(1)} / ${(progress.totalBytes / 1048576).toFixed(1)} MB`}</p>}
      <small title={progress.current}>{progress.current || '正在检查来源路径…'}</small>
      <button type="button" onClick={() => scanController.current?.abort()}>取消扫描</button>
    </section>}
    {actionable && <p className="organizer-safety">歌词、图片随行；整理需额外磁盘空间。</p>}
    {plan && <section className="organizer-preview" aria-label="整理预览" aria-live="polite">
      <strong>找到 {plan.scanned} 首 · {mode === 'deduplicate' ? `${plan.groups.length} 组重复或疑似重复` : `${plan.moves.length} 首待整理`}</strong>
      {plan.warnings.length > 0 && <details><summary>{plan.warnings.length} 条提示</summary><ul>{plan.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul></details>}
      {plan.groups.length > 0 && <p className="organizer-hint">选择保留版本，其余音乐及附属文件移入恢复区，不永久删除。</p>}
      <div className="organizer-preview-list">
        {plan.moves.slice(0, 200).map(move => <div key={move.source} className="organizer-move"><span>{move.source}</span><strong>→ {move.destination}</strong>{move.companions.length > 0 && <small>附属文件：{move.companions.map(path => path.split(/[\\/]/).at(-1)).join('、')}</small>}</div>)}
        {plan.moves.length > 200 && <p className="organizer-hint">显示前 200 首，共 {plan.moves.length} 首。</p>}
        {plan.groups.map(group => <fieldset key={group.id} className="organizer-duplicate" disabled={Boolean(busy)}><legend>{group.files[0].title} · {group.match === 'exact' ? '内容完全相同' : group.match === 'metadata' ? '标签相同，版本待确认' : '仅同名，需核对'}</legend>{group.files.map(file => <label key={file.path}><input type="radio" name={group.id} checked={keep[group.id] === file.path} onChange={() => { setKeep(previous => ({ ...previous, [group.id]: file.path })); setConfirmed(false); }} /><span><strong>{file.quality} · {(file.size / 1048576).toFixed(2)} MB</strong><small>{file.artist} · {file.album} · 附属文件 {file.companions.length} 个</small><small>{file.path}</small></span></label>)}<label><input type="radio" name={group.id} checked={keep[group.id] === '*'} onChange={() => { setKeep(previous => ({ ...previous, [group.id]: '*' })); setConfirmed(false); }} />全部保留</label></fieldset>)}
      </div>
      {pending > 0 && <p className="organizer-warning">还有 {pending} 组待选择。</p>}
      {actionable && <label className="organizer-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} />我已核对预览，确认{mode === 'deduplicate' ? `将 ${removed} 首移入恢复区` : `整理 ${plan.moves.length} 首音乐及附属文件`}</label>}
      {!plan.moves.length && !plan.groups.length && <p className="organizer-hint">无需整理。</p>}
      {plan.groups.length > 0 && !pending && !actionable && <p className="organizer-hint">全部保留，不修改文件。</p>}
    </section>}
    {result && <section className="organizer-result" aria-live="polite"><strong>整理完成</strong><p>移动 {result.moved} 首 · 恢复区 {result.quarantined} 首 · 随行附属文件 {result.companions} 个</p>{result.recoveryPaths.map(path => <p key={path}>恢复区：<span>{path}</span></p>)}{result.manifest && <p>操作记录：<span>{result.manifest}</span></p>}{result.warnings.map(warning => <p key={warning} className="organizer-warning">{warning}</p>)}</section>}
    <div className="toolbox-actions"><button type="button" onClick={() => void preview()} disabled={Boolean(busy) || !paths.length || (mode !== 'rename' && mode !== 'deduplicate' && !target.trim())}>{busy === 'preview' ? '扫描与校验中…' : '预览整理'}</button><button type="button" className="toolbox-convert" onClick={() => void execute()} disabled={Boolean(busy) || !actionable || !confirmed || pending > 0}>{busy === 'execute' ? '整理中，请勿关闭…' : '确认并执行'}</button></div>
  </div>;
}
