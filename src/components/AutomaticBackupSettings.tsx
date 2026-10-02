import { useCallback, useEffect, useState } from 'react';
import { backend, type AutomaticBackupState, type BackupPolicy } from '@/lib/backend';
import { useRuntime } from '@/hooks/use-runtime';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

export default function AutomaticBackupSettings() {
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
  if (!runtime.backend) return <p className="processor-note">自动备份需要连接音乐库服务。</p>;
  return <div className="automatic-backups">
    {failure && <p role="alert">{failure}<button type="button" onClick={() => void refresh()}>重试</button></p>}
    <fieldset disabled={busy || !state}>
      <div className="settings-row"><div><strong>自动备份</strong><small>程序运行时执行，不包含音频文件。</small></div><button type="button" role="switch" aria-label="自动备份" aria-checked={state?.policy.enabled ?? false} className={`settings-switch ${state?.policy.enabled ? 'on' : ''}`} onClick={() => policy({enabled:!state?.policy.enabled})}><span /></button></div>
      <div className="backup-policy-controls"><label>备份周期<select value={state?.policy.intervalHours ?? 24} onChange={event => policy({intervalHours:Number(event.target.value)})}><option value="24">每天</option><option value="168">每周</option></select></label><label>保留份数<input type="number" min="1" max="30" key={state?.policy.keepCount} defaultValue={state?.policy.keepCount ?? 7} onBlur={event => {const value=Number(event.target.value); if(Number.isInteger(value) && value>=1 && value<=30 && value!==state?.policy.keepCount) policy({keepCount:value}); else event.target.value=String(state?.policy.keepCount ?? 7);}} /></label><button type="button" onClick={() => void run(async () => {await backend.createAutomaticBackup(); toast.success('备份已创建');})}>{busy ? '处理中…' : '立即备份'}</button><button type="button" onClick={() => void refresh()}>刷新备份列表</button></div>
      <div className="backup-file-list">{state?.files.map(file => <div key={file.name}><span>{new Date(file.createdAt).toLocaleString()} · {(file.size/1024/1024).toFixed(1)} MB</span><button type="button" onClick={() => setRestore(file.name)}>合并恢复</button></div>)}{state && !state.files.length && <p>还没有自动备份</p>}</div>
    </fieldset>
    <details className="backup-history"><summary>备份和恢复记录</summary>{state?.events.map(event => <p key={event.id} title={event.name}><time>{new Date(event.time).toLocaleString()}</time> · {event.action === 'backup' ? '备份' : event.action === 'restore' ? '合并恢复' : '备份任务'} · {event.status === 'success' ? '成功' : '失败'} {event.detail}</p>)}{state && !state.events.length && <p>暂无记录</p>}</details>
    <Dialog open={Boolean(restore)} onOpenChange={open => {if(!open&&!busy)setRestore(null);}}><DialogContent className="music-dialog" showClose={!busy}><DialogTitle>合并恢复备份</DialogTitle><DialogDescription>补充缺失数据，保留当前已有内容。</DialogDescription><div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setRestore(null)}>取消</button><button type="button" disabled={busy} onClick={() => void run(async () => {await backend.restoreAutomaticBackup(restore!); setRestore(null); window.dispatchEvent(new Event('lunanahida-backup-imported')); toast.success('备份已合并恢复');})}>{busy ? '恢复中…' : '确认合并恢复'}</button></div></DialogContent></Dialog>
  </div>;
}
