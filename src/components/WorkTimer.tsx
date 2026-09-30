import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { WorkTimerControls } from '@/hooks/use-work-timer';
import { formatWorkTimerTime, type WorkTimerMode } from '@/lib/work-timer';

export default function WorkTimer({ timer }: { timer: WorkTimerControls }) {
  const [mode, setMode] = useState<WorkTimerMode>(timer.state.mode);
  const [minutes, setMinutes] = useState(Math.floor((timer.state.durationMs || 1500000) / 60000));
  const [seconds, setSeconds] = useState(Math.floor((timer.state.durationMs || 1500000) / 1000) % 60);
  useEffect(() => {
    if (timer.ready && timer.state.status === 'idle') {
      setMode(timer.state.mode);
      setMinutes(Math.floor((timer.state.durationMs || 1500000) / 60000));
      setSeconds(Math.floor((timer.state.durationMs || 1500000) / 1000) % 60);
    }
  }, [timer.ready, timer.state.status, timer.state.mode, timer.state.durationMs]);
  const chosenMode = timer.active ? timer.state.mode : mode;
  const shownMinutes = timer.active ? Math.floor(timer.state.durationMs / 60000) : minutes;
  const shownSeconds = timer.active ? Math.floor(timer.state.durationMs / 1000) % 60 : seconds;
  const durationMs = (minutes * 60 + seconds) * 1000;
  const valid = Number.isInteger(minutes) && Number.isInteger(seconds) && minutes >= 0 && seconds >= 0 && seconds < 60 && durationMs >= 1000 && durationMs <= 604800000;
  const blocked = !timer.ready || timer.busy || timer.state.status === 'running' && timer.view.status === 'completed';
  const status = { idle: '准备开始', running: '计时中', paused: '已暂停', completed: '倒计时结束' }[timer.view.status];
  const shown = timer.active ? timer.view.displayMs : chosenMode === 'countdown' && valid ? durationMs : 0;
  return <section className="work-timer" aria-label="计时器窗口">
    <div className="work-timer-modes" role="group" aria-label="计时模式">{([{ id: 'stopwatch', label: '正计时' }, { id: 'countdown', label: '倒计时' }] as const).map(item => <button type="button" key={item.id} aria-pressed={chosenMode === item.id} disabled={blocked || timer.active} onClick={() => setMode(item.id)}>{item.label}</button>)}</div>
    <div className={`work-timer-face ${timer.view.status}`}><span>{timer.ready ? status : '正在读取本地计时器…'}</span><output aria-label="计时时间">{formatWorkTimerTime(shown, chosenMode === 'countdown')}</output>{timer.active && chosenMode === 'countdown' && <progress aria-label="倒计时进度" max="1" value={timer.view.progress} />}</div>
    {chosenMode === 'countdown' && !timer.active && <fieldset disabled={blocked || timer.active} className="work-timer-duration"><legend>倒计时时长</legend><div className="work-timer-presets">{[{ label: '专注 25 分钟', value: 25 }, { label: '短休息 5 分钟', value: 5 }, { label: '长休息 15 分钟', value: 15 }].map(preset => <button type="button" key={preset.value} aria-pressed={shownMinutes === preset.value && shownSeconds === 0} onClick={() => { setMinutes(preset.value); setSeconds(0); }}>{preset.label}</button>)}</div><div className="work-timer-custom"><label>分钟<input aria-label="倒计时分钟" type="number" min="0" max="10080" step="1" value={Number.isFinite(shownMinutes) ? shownMinutes : ''} onChange={event => setMinutes(event.target.value === '' ? NaN : Number(event.target.value))} /></label><label>秒<input aria-label="倒计时秒" type="number" min="0" max="59" step="1" value={Number.isFinite(shownSeconds) ? shownSeconds : ''} onChange={event => setSeconds(event.target.value === '' ? NaN : Number(event.target.value))} /></label></div>{!valid && <p>请输入 1 秒至 7 天的倒计时时长。</p>}</fieldset>}
    {timer.error && <p className="work-timer-error" role="alert">{timer.error} <button type="button" onClick={timer.retry}>重新同步</button></p>}
    <div className="work-timer-actions">{timer.view.status === 'running' ? <button type="button" disabled={blocked} onClick={() => void timer.pause()}><Pause size={16} />暂停计时</button> : timer.view.status === 'paused' ? <button type="button" disabled={blocked} onClick={() => void timer.resume()}><Play size={16} />继续计时</button> : <button type="button" disabled={blocked || chosenMode === 'countdown' && !(timer.active ? timer.state.durationMs > 0 : valid)} onClick={() => void timer.start(chosenMode, timer.active ? timer.state.durationMs : durationMs)}><Play size={16} />{timer.view.status === 'completed' ? '重新开始' : '开始计时'}</button>}{timer.active && <button type="button" disabled={blocked} onClick={() => void timer.reset()}><RotateCcw size={16} />{timer.view.status === 'completed' ? '清除计时' : '结束并重置'}</button>}</div>
    <p className="work-timer-hint">关闭窗口或退出应用不停止计时。</p>
  </section>;
}
