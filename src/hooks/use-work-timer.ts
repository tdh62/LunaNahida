import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { backend } from '@/lib/backend';
import { applySessionTimerCommand, completeSessionTimer, defaultWorkTimer, getWorkTimerView, isWorkTimerResponse, type WorkTimerCommand, type WorkTimerMode, type WorkTimerResponse } from '@/lib/work-timer';
import { useRuntime } from '@/hooks/use-runtime';

export function useWorkTimer() {
  const runtime = useRuntime();
  const [state, setState] = useState(defaultWorkTimer);
  const stateRef = useRef(state);
  const [clock, setClock] = useState(Date.now);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const offset = useRef(0);
  const mounted = useRef(false);
  const working = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const finishing = useRef(-1);
  const notified = useRef(0);
  const accept = useCallback((response: WorkTimerResponse) => {
    if (!isWorkTimerResponse(response)) throw new Error('计时器记录无法读取，请重试');
    if (!mounted.current || response.timer.revision < stateRef.current.revision) return;
    const receivedAt = Date.now();
    offset.current = response.serverNow - receivedAt;
    stateRef.current = response.timer;
    setState(response.timer); setClock(receivedAt); setReady(true); setError('');
  }, []);
  const refresh = useCallback(async () => {
    try {
      if (runtime.backend) accept(await backend.workTimer());
      else { const now = Date.now(); accept({ timer: completeSessionTimer(stateRef.current, now), serverNow: now }); }
    }
    catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '无法读取本地计时器');
      throw failure;
    }
  }, [accept, runtime.backend]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => {});
    const tick = window.setInterval(() => { if (stateRef.current.status === 'running' && !document.hidden) setClock(Date.now()); }, 1000);
    const sync = runtime.backend ? window.setInterval(() => void refresh().catch(() => {}), 15000) : undefined;
    const wake = () => { if (!document.hidden) { setClock(Date.now()); void refresh().catch(() => {}); } };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    if (runtime.backend && typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('luma-work-timer');
      channel.current.onmessage = () => void refresh().catch(() => {});
    }
    return () => {
      mounted.current = false;
      window.clearInterval(tick); window.clearInterval(sync);
      window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake);
      channel.current?.close(); channel.current = null;
    };
  }, [refresh, runtime.backend]);
  const view = getWorkTimerView(state, clock + offset.current);
  useEffect(() => {
    if (state.status === 'running' && view.status === 'completed' && finishing.current !== state.revision) {
      finishing.current = state.revision;
      void refresh().catch(() => {});
    }
    if (state.status === 'completed' && state.startedAt !== notified.current) {
      notified.current = state.startedAt;
      toast.success('倒计时结束', { description: runtime.backend ? '计时结果已保存，可以休息一下了。' : '可以休息一下了。', duration: 8000 });
    }
  }, [state.status, state.revision, state.startedAt, view.status, refresh, runtime.backend]);
  const command = useCallback(async (change: Omit<WorkTimerCommand, 'revision'>) => {
    if (working.current) return false;
    working.current = true; setBusy(true);
    try {
      const command = { ...change, revision: stateRef.current.revision };
      if (runtime.backend) accept(await backend.updateWorkTimer(command));
      else { const now = Date.now(); accept({ timer: applySessionTimerCommand(stateRef.current, command, now), serverNow: now }); }
      channel.current?.postMessage('changed');
      return true;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '计时器保存失败';
      if (mounted.current) { setError(message); toast.error(message); }
      await refresh().catch(() => {});
      return false;
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  }, [accept, refresh, runtime.backend]);
  return { state, view, ready, busy, error, active: ready && state.status !== 'idle', retry: () => void refresh().catch(() => {}), start: (mode: WorkTimerMode, durationMs: number) => command({ action: 'start', mode, durationMs }), pause: () => command({ action: 'pause' }), resume: () => command({ action: 'resume' }), reset: () => command({ action: 'reset' }) };
}

export type WorkTimerControls = ReturnType<typeof useWorkTimer>;
