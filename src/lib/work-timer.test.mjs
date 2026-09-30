import assert from 'node:assert/strict';
import test from 'node:test';
import { applySessionTimerCommand, completeSessionTimer, defaultWorkTimer, formatWorkTimerTime, getWorkTimerView, isWorkTimerResponse } from './work-timer.ts';

test('countdown restores from absolute start time across app downtime', () => {
  const state = { ...defaultWorkTimer, status: 'running', durationMs: 60000, startedAt: 100000, anchorAt: 100000 };
  assert.equal(getWorkTimerView(state, 145000).remainingMs, 15000);
  assert.equal(getWorkTimerView(state, 160000).status, 'completed');
  assert.equal(getWorkTimerView(state, 999999).displayMs, 0);
  assert.equal(getWorkTimerView(state, 999999).progress, 1);
});

test('stopwatch, pause and resume do not accumulate paused or backwards time', () => {
  const state = { ...defaultWorkTimer, mode: 'stopwatch', status: 'running', elapsedMs: 15500, startedAt: 100000, anchorAt: 300000 };
  assert.equal(getWorkTimerView(state, 305000).elapsedMs, 20500);
  assert.equal(getWorkTimerView(state, 299000).elapsedMs, 15500);
  assert.equal(getWorkTimerView({ ...state, status: 'paused' }, 999999).displayMs, 15500);
  assert.equal(getWorkTimerView({ ...state, status: 'paused' }, 999999).status, 'paused');
});

test('display rounds remaining time up and stopwatch time down', () => {
  assert.equal(formatWorkTimerTime(1, true), '00:00:01');
  assert.equal(formatWorkTimerTime(999), '00:00:00');
  assert.equal(formatWorkTimerTime(3601000), '01:00:01');
  assert.equal(formatWorkTimerTime(360000000), '100:00:00');
  assert.equal(formatWorkTimerTime(-1000), '00:00:00');
});

test('idle and expired states stay stable without ticking mutations', () => {
  const state = structuredClone(defaultWorkTimer);
  assert.equal(getWorkTimerView(state, 999999).remainingMs, 1500000);
  getWorkTimerView(state, 99999999);
  assert.deepEqual(state, defaultWorkTimer);
  assert.equal(getWorkTimerView({ ...state, status: 'completed', elapsedMs: state.durationMs }, 10000000).displayMs, 0);
});

test('timer response rejects missing and invalid database snapshots', () => {
  assert.ok(isWorkTimerResponse({ timer: defaultWorkTimer, serverNow: 100000 }));
  assert.ok(!isWorkTimerResponse({ ok: true }));
  assert.ok(!isWorkTimerResponse(null));
  assert.ok(!isWorkTimerResponse({ timer: { ...defaultWorkTimer, revision: -1 }, serverNow: 1 }));
  assert.ok(!isWorkTimerResponse({ timer: { ...defaultWorkTimer, startedAt: '1000' }, serverNow: 1 }));
  assert.ok(!isWorkTimerResponse({ timer: { ...defaultWorkTimer, status: 'invalid' }, serverNow: 1 }));
});

test('session countdown survives pause and completes once using absolute time', () => {
  let state = applySessionTimerCommand(defaultWorkTimer, { action: 'start', revision: 0, mode: 'countdown', durationMs: 10000 }, 1000);
  state = applySessionTimerCommand(state, { action: 'pause', revision: state.revision }, 4000);
  assert.equal(state.elapsedMs, 3000);
  state = applySessionTimerCommand(state, { action: 'resume', revision: state.revision }, 20000);
  assert.equal(getWorkTimerView(state, 25000).remainingMs, 2000);
  state = completeSessionTimer(state, 99999);
  assert.equal(state.status, 'completed');
  assert.equal(state.completedAt, 27000);
  assert.equal(completeSessionTimer(state, 100000), state);
  state = applySessionTimerCommand(state, { action: 'reset', revision: state.revision }, 100000);
  assert.equal(state.status, 'idle');
  assert.equal(state.startedAt, 0);
});

test('session stopwatch resumes without counting paused time and rejects invalid commands', () => {
  let state = applySessionTimerCommand(defaultWorkTimer, { action: 'start', revision: 0, mode: 'stopwatch' }, 1000);
  assert.equal(completeSessionTimer(state, 100000), state);
  state = applySessionTimerCommand(state, { action: 'pause', revision: state.revision }, 2000);
  state = applySessionTimerCommand(state, { action: 'resume', revision: state.revision }, 9000);
  assert.equal(getWorkTimerView(state, 10000).elapsedMs, 2000);
  assert.throws(() => applySessionTimerCommand(state, { action: 'reset', revision: 0 }, 10000));
  assert.throws(() => applySessionTimerCommand(defaultWorkTimer, { action: 'start', revision: 0, mode: 'countdown', durationMs: 0 }, 1));
  assert.throws(() => applySessionTimerCommand(defaultWorkTimer, { action: 'resume', revision: 0 }, 1));
});
