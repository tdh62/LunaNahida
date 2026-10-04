import { useCallback, useEffect, useState } from 'react';
import { Archive, History, RefreshCw, RotateCcw } from 'lucide-react';
import { backend, type AutomaticBackupState, type BackupPolicy } from '@/lib/backend';
import { useRuntime } from '@/hooks/use-runtime';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import LoadingPlaceholder from './LoadingPlaceholder';

export default function AutomaticBackupSettings({ hidden = false }: { hidden?: boolean }) {
  const runtime = useRuntime();
  const [state, setState] = useState<AutomaticBackupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [restore, setRestore] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!runtime.backend) return;
    try { const value = await backend.automaticBackups(); if (!value.policy) throw new Error('无法读取自动备份设置'); setState(value); setFailure(''); }
    catch(error) { setFailure(error instanceof Error ? error.message : '备份读取失败'); }
  }, [runtime.backend]);
  useEffect(() => {
    if (!runtime.backend) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('lunanahida-backup-imported', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('lunanahida-backup-imported', refresh); };
  }, [runtime.backend, refresh]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); await refresh(); }
    catch(error) { toast.error(error instanceof Error ? error.message : '备份操作失败'); }
    finally { setBusy(false); }
  };
  const policy = (change: Partial<BackupPolicy>) => { if(state) void run(() => backend.saveBackupPolicy({...state.policy,...change})); };
  return <section className="settings-group automatic-backups" data-settings-category="data" hidden={hidden}>
    <div className="settings-group-title backup-section-title"><Archive size={19} /><div><h2>自动备份</h2><p>程序运行时按周期备份</p></div><button type="button" disabled={!state || busy} role="switch" aria-label="自动备份" aria-checked={state?.policy.enabled ?? false} className={`settings-switch ${state?.policy.enabled ? 'on' : ''}`} onClick={() => policy({enabled:!state?.policy.enabled})}><span /></button></div>
    {!runtime.backend ? <p className="backup-empty">需要连接音乐库服务</p> : <>
    {failure && <div className="backup-error" role="alert"><span>{failure}</span><button type="button" className="backup-secondary" disabled={busy} onClick={() => void refresh()}>重试</button></div>}
    <fieldset disabled={busy || !state}>
      <div className="backup-policy-controls">
        <label><span>备份周期</span><select className="lyric-font-select" aria-label="备份周期" value={state?.policy.intervalHours ?? 24} onChange={event => policy({intervalHours:Number(event.target.value)})}><option value="24">每天</option><option value="168">每周</option></select></label>
        <label><span>保留份数</span><input className="lyric-font-select" aria-label="保留份数" type="number" min="1" max="30" key={state?.policy.keepCount} defaultValue={state?.policy.keepCount ?? 7} onBlur={event => {const value=Number(event.target.value); if(Number.isInteger(value) && value>=1 && value<=30 && value!==state?.policy.keepCount) policy({keepCount:value}); else event.target.value=String(state?.policy.keepCount ?? 7);}} /></label>
      </div>
      <div className="backup-list-heading"><h3>本地备份{Boolean(state?.files.length) && <span>{state!.files.length}</span>}</h3><div className="backup-list-actions"><button type="button" className="backup-refresh" aria-label="刷新备份列表" title="刷新备份列表" onClick={() => void refresh()}><RefreshCw size={15} /></button><button type="button" className="playlist-primary" onClick={() => void run(async () => {await backend.createAutomaticBackup(); toast.success('备份已创建');})}><Archive size={15} />{busy ? '处理中…' : '立即备份'}</button></div></div>
      <div className="backup-file-list">{state?.files.map(file => <div className="backup-file-row" key={file.name}><div title={file.name}><time>{new Date(file.createdAt).toLocaleString()}</time><small>{(file.size/1024/1024).toFixed(1)} MB</small></div><button type="button" className="backup-secondary" onClick={() => setRestore(file.name)}><RotateCcw size={14} />合并恢复</button></div>)}{state && !state.files.length && <p className="backup-empty">暂无备份</p>}{!state && !failure && <LoadingPlaceholder label="正在读取备份…" kind="list" rows={3} />}</div>
    </fieldset>
    <details className="backup-history"><summary><History size={15} />备份和恢复记录</summary><div className="backup-history-list">{state?.events.map(event => <div className="backup-history-row" key={event.id} title={event.name}><time>{new Date(event.time).toLocaleString()}</time><span>{event.action === 'backup' ? '备份' : event.action === 'restore' ? '合并恢复' : '备份任务'}</span><span className={`backup-status ${event.status === 'success' ? 'success' : 'failed'}`}>{event.status === 'success' ? '成功' : '失败'}</span>{event.detail && <p>{event.detail}</p>}</div>)}{state && !state.events.length && <p className="backup-empty">暂无记录</p>}</div></details>
    <Dialog open={Boolean(restore)} onOpenChange={open => {if(!open&&!busy)setRestore(null);}}><DialogContent className="music-dialog" showClose={!busy}><DialogTitle>合并恢复备份</DialogTitle><DialogDescription>补充缺失数据，保留当前已有内容。</DialogDescription><div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setRestore(null)}>取消</button><button type="button" disabled={busy} onClick={() => void run(async () => {await backend.restoreAutomaticBackup(restore!); setRestore(null); window.dispatchEvent(new Event('lunanahida-backup-imported')); toast.success('备份已合并恢复');})}>{busy ? '恢复中…' : '确认合并恢复'}</button></div></DialogContent></Dialog>
    </>}
  </section>;
}
