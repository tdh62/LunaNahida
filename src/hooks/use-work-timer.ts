import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { backend } from '@/lib/backend';
import { applySessionTimerCommand, completeSessionTimer, defaultWorkTimer, getWorkTimerView, isWorkTimerResponse, type WorkTimerCommand, type WorkTimerMode, type WorkTimerResponse } from '@/lib/work-timer';
import { useRuntime } from '@/hooks/use-runtime';
import { browserNotificationsAvailable, defaultTimerReminders, playTimerSound, prepareTimerSound, sendBrowserTimerNotification, type TimerReminders } from '@/lib/timer-reminders';

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
  const alerted = useRef(0);
  const [reminders, setReminders] = useState(defaultTimerReminders);
  const remindersRef = useRef(reminders);
  const [remindersReady, setRemindersReady] = useState(!runtime.backend);
  const [remindersBusy, setRemindersBusy] = useState(false);
  const savingReminders = useRef(false);
  const [remindersError, setRemindersError] = useState('');
  const loadReminders = useCallback(async () => {
    try {
      const value = runtime.backend ? await backend.timerReminders() : remindersRef.current;
      remindersRef.current = value; setReminders(value); setRemindersReady(true); setRemindersError('');
    } catch (failure) { setRemindersError(failure instanceof Error ? failure.message : '提醒设置读取失败'); }
  }, [runtime.backend]);
  useEffect(() => { void loadReminders(); }, [loadReminders]);
  const updateReminders = async (change: Partial<TimerReminders>) => {
    if (savingReminders.current || !remindersReady) return;
    savingReminders.current = true; setRemindersBusy(true);
    try {
      if (change.notificationEnabled) {
        const granted = runtime.mode === 'desktop' ? (await backend.authorizeTimerNotification()).granted
          : browserNotificationsAvailable() && await Notification.requestPermission() === 'granted';
        if (!granted) throw new Error('桌面通知未获授权，请检查系统或浏览器通知权限');
      }
      if (change.soundEnabled) await prepareTimerSound();
      const next = { ...remindersRef.current, ...change };
      const saved = runtime.backend ? await backend.saveTimerReminders(next) : next;
      remindersRef.current = saved; setReminders(saved); setRemindersError('');
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : '提醒设置保存失败'); }
    finally { savingReminders.current = false; setRemindersBusy(false); }
  };
  const alert = useCallback(async (startedAt: number) => {
    const settings = remindersRef.current;
    try {
      if (runtime.backend) {
        const result = await backend.claimTimerAlert(startedAt, runtime.mode === 'desktop');
        if (!result.claimed) return;
        if (result.notificationError) toast.error('桌面通知发送失败', { description: result.notificationError });
      }
      const outcomes = await Promise.allSettled([
        settings.soundEnabled ? playTimerSound(settings) : Promise.resolve(),
        settings.notificationEnabled && runtime.mode !== 'desktop' ? Promise.resolve().then(() => sendBrowserTimerNotification(startedAt)) : Promise.resolve(),
      ]);
      for (const result of outcomes) if (result.status === 'rejected') toast.error(result.reason instanceof Error ? result.reason.message : '计时提醒失败');
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : '计时提醒失败'); }
  }, [runtime.backend, runtime.mode]);
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
    const tick = window.setInterval(() => { if (stateRef.current.status === 'running') setClock(Date.now()); }, 1000);
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
    if (state.status === 'completed' && remindersReady && state.startedAt !== alerted.current) {
      alerted.current = state.startedAt;
      void alert(state.startedAt);
    }
  }, [state.status, state.revision, state.startedAt, view.status, refresh, runtime.backend, remindersReady, alert]);
  const command = useCallback(async (change: Omit<WorkTimerCommand, 'revision'>) => {
    if (working.current) return false;
    working.current = true; setBusy(true);
    try {
      if ((change.action === 'start' || change.action === 'resume') && remindersRef.current.soundEnabled) {
        await prepareTimerSound().catch(failure => toast.error(failure instanceof Error ? failure.message : '提醒音效无法播放'));
      }
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
  return { state, view, ready, busy, error, reminders, remindersReady, remindersBusy, remindersError, updateReminders, retryReminders: () => void loadReminders(), notificationAvailable: runtime.mode === 'desktop' || browserNotificationsAvailable(), previewSound: () => void playTimerSound(remindersRef.current).catch(failure => toast.error(failure instanceof Error ? failure.message : '提醒音效无法播放')), active: ready && state.status !== 'idle', retry: () => void refresh().catch(() => {}), start: (mode: WorkTimerMode, durationMs: number) => command({ action: 'start', mode, durationMs }), pause: () => command({ action: 'pause' }), resume: () => command({ action: 'resume' }), reset: () => command({ action: 'reset' }) };
}

export type WorkTimerControls = ReturnType<typeof useWorkTimer>;
