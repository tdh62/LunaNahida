export type WorkTimerMode = 'stopwatch' | 'countdown';
export type WorkTimerState = { mode: WorkTimerMode; status: 'idle' | 'running' | 'paused' | 'completed'; durationMs: number; elapsedMs: number; startedAt: number; anchorAt: number; completedAt: number; revision: number };
export type WorkTimerResponse = { timer: WorkTimerState; serverNow: number };
export type WorkTimerCommand = { action: 'start' | 'pause' | 'resume' | 'reset'; revision: number; mode?: WorkTimerMode; durationMs?: number };
export const defaultWorkTimer: WorkTimerState = { mode: 'countdown', status: 'idle', durationMs: 25 * 60 * 1000, elapsedMs: 0, startedAt: 0, anchorAt: 0, completedAt: 0, revision: 0 };

export function isWorkTimerResponse(value: WorkTimerResponse) {
  const state = value?.timer;
  return state && ['stopwatch', 'countdown'].includes(state.mode) && ['idle', 'running', 'paused', 'completed'].includes(state.status)
    && ['durationMs', 'elapsedMs', 'startedAt', 'anchorAt', 'completedAt', 'revision'].every(key => Number.isSafeInteger(state[key as keyof WorkTimerState]) && Number(state[key as keyof WorkTimerState]) >= 0)
    && Number.isFinite(value.serverNow);
}

export function getWorkTimerView(state: WorkTimerState, now: number) {
  const elapsed = Math.max(0, state.elapsedMs + (state.status === 'running' ? Math.max(0, now - state.anchorAt) : 0));
  const elapsedMs = state.mode === 'countdown' ? Math.min(state.durationMs, elapsed) : elapsed;
  const remainingMs = Math.max(0, state.durationMs - elapsedMs);
  const status = state.mode === 'countdown' && state.status === 'running' && remainingMs === 0 ? 'completed' : state.status;
  return { elapsedMs, remainingMs, status, displayMs: state.mode === 'countdown' ? remainingMs : elapsedMs, progress: state.mode === 'countdown' && state.durationMs > 0 ? elapsedMs / state.durationMs : 0 };
}

export function formatWorkTimerTime(milliseconds: number, roundUp = false) {
  const seconds = Math.max(0, roundUp ? Math.ceil(milliseconds / 1000) : Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function applySessionTimerCommand(state: WorkTimerState, command: WorkTimerCommand, now: number): WorkTimerState {
  if (command.revision !== state.revision) throw new Error('计时状态已更新，请重试');
  const view = getWorkTimerView(state, now);
  const next = { ...state, revision: state.revision + 1 };
  switch (command.action) {
    case 'start': {
      if (!['countdown', 'stopwatch'].includes(command.mode)) throw new Error('请选择计时模式');
      const durationMs = command.durationMs ?? state.durationMs;
      if (command.mode === 'countdown' && (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 604800000)) throw new Error('请输入 1 秒至 7 天的倒计时时长');
      return { ...next, mode: command.mode, status: 'running', durationMs: command.mode === 'countdown' ? durationMs : state.durationMs, elapsedMs: 0, startedAt: now, anchorAt: now, completedAt: 0 };
    }
    case 'pause':
      if (state.status !== 'running' || view.status === 'completed') throw new Error('计时器当前无法暂停');
      return { ...next, status: 'paused', elapsedMs: view.elapsedMs, anchorAt: 0 };
    case 'resume':
      if (state.status !== 'paused') throw new Error('计时器当前无法继续');
      return { ...next, status: 'running', anchorAt: now };
    case 'reset':
      return { ...next, status: 'idle', elapsedMs: 0, startedAt: 0, anchorAt: 0, completedAt: 0 };
    default:
      throw new Error('未知计时操作');
  }
}

export function completeSessionTimer(state: WorkTimerState, now: number): WorkTimerState {
  if (state.status !== 'running' || getWorkTimerView(state, now).status !== 'completed') return state;
  return { ...state, status: 'completed', elapsedMs: state.durationMs, completedAt: state.anchorAt + Math.max(0, state.durationMs - state.elapsedMs), anchorAt: 0, revision: state.revision + 1 };
}
