import { useCallback, useEffect, useState } from 'react';
import { backend, type ConversionJob } from '@/lib/backend';
import { useRuntime } from '@/hooks/use-runtime';
import type { Track } from '@/lib/music';
import { toast } from 'sonner';

export default function ConversionRecovery({ onChanged, onBusyChange }: { onChanged: (tracks: Track[]) => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const runtime = useRuntime();
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [folder, setFolder] = useState('');
  const [confirmation, setConfirmation] = useState<{ job: ConversionJob; action: 'restore' | 'import' } | null>(null);
  const refresh = useCallback(async (folders: string[] = []) => {
    setLoading(true); setError(''); onBusyChange(true);
    try { setJobs(await backend.conversionJobs(folders)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '无法检查任务'); }
    finally { setLoading(false); onBusyChange(false); }
  }, [onBusyChange]);
  useEffect(() => { void refresh(); }, [refresh]);
  const choose = async () => {
    try { const result = await backend.chooseFolder(); if (result.paths[0]) { setFolder(result.paths[0]); await refresh([result.paths[0]]); } }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : '无法选择文件夹'); }
  };
  const recover = async () => {
    if (!confirmation) return;
    setLoading(true); onBusyChange(true);
    try {
      const result = await backend.recoverConversion(confirmation.job.path, confirmation.action);
      if (result.track) await onChanged([result.track]);
      toast.success(result.status === 'restored' ? '已找回源文件' : '已重新加入曲库', { description: result.output });
      setConfirmation(null);
      setJobs(await backend.conversionJobs(folder ? [folder] : []));
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : '恢复失败'); }
    finally { setLoading(false); onBusyChange(false); }
  };
  return <div className="conversion-recovery">
    <p>检查未完成的还原任务。恢复时会核对文件；原文件副本和已有结果都会保留。</p>
    <div className="toolbox-controls"><button disabled={loading} onClick={() => void refresh(folder ? [folder] : [])}>刷新记录</button>{runtime.nativeFolders && <button disabled={loading} onClick={() => void choose()}>检查其他文件夹</button>}</div>
    {!runtime.nativeFolders && <form className="organizer-path-entry" onSubmit={event => { event.preventDefault(); void refresh([folder]); }}><input aria-label="恢复任务文件夹" value={folder} onChange={event => setFolder(event.target.value)} placeholder="音乐库服务所在电脑的文件夹完整路径" /><button disabled={loading || !folder.trim()}>检查文件夹</button></form>}
    {loading && <p role="status">正在检查或恢复…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && jobs.length === 0 && <p>没有发现未完成任务。已检查本机任务记录和监听文件夹，也可选择其他音乐文件夹。</p>}
    <div className="recovery-jobs">{jobs.map(job => <article key={job.path}>
      <strong>{job.source.split(/[\\/]/).at(-1) || '无法读取的任务'}</strong>
      <p>{job.error || (job.stage === 'decoding' ? '还原被中断，尚未处理源文件；可重新添加源文件进行还原。' : '任务未完成，请选择恢复方式。')}</p>
      <dl><dt>源文件</dt><dd>{job.source || '未知'} · {job.sourceExists ? '存在' : '未找到'}</dd><dt>还原结果</dt><dd>{job.output || '尚未生成'}{job.output && ` · ${job.outputExists ? '存在' : '未找到'}`}</dd>{job.retired && <><dt>源文件副本</dt><dd>{job.retired}</dd></>}</dl>
      <div className="recovery-actions"><button disabled={loading || !job.canRestore} onClick={() => setConfirmation({ job, action: 'restore' })}>恢复源文件</button><button disabled={loading || !job.canImport} onClick={() => setConfirmation({ job, action: 'import' })}>重新入库</button>{runtime.nativeFolders && <button disabled={loading} onClick={() => void backend.openConversionFolder(job.path).catch(failure => toast.error(failure.message))}>打开文件夹</button>}</div>
    </article>)}</div>
    {confirmation && <div className="recovery-confirmation" role="alert">
      <strong>{confirmation.action === 'restore' ? '确认恢复源文件？' : '确认将还原结果加入曲库？'}</strong>
      <p>{confirmation.action === 'restore' ? '源路径已有文件时，会另存为 .recovered-encrypted；同名恢复副本存在时停止，不覆盖任何文件。' : '核对结果后更新曲库；原歌曲仍关联此任务时保留收藏和歌单关系。文件副本继续保留。'}</p>
      <div className="recovery-actions"><button disabled={loading} onClick={() => setConfirmation(null)}>返回</button><button disabled={loading} onClick={() => void recover()}>确认{confirmation.action === 'restore' ? '恢复源文件' : '重新入库'}</button></div>
    </div>}
  </div>;
}
