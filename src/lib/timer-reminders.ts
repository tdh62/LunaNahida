export type TimerReminders = { soundEnabled: boolean; sound: 'chime' | 'bell' | 'beep'; volume: number; notificationEnabled: boolean };
export const defaultTimerReminders: TimerReminders = { soundEnabled: false, sound: 'chime', volume: 60, notificationEnabled: false };
export const timerSounds = [{ id: 'chime', name: '轻柔提示' }, { id: 'bell', name: '清脆铃声' }, { id: 'beep', name: '电子提示' }] as const;

let context: AudioContext | null = null;
export async function prepareTimerSound() {
  context ??= new AudioContext();
  if (context.state === 'suspended') await context.resume();
  if (context.state !== 'running') throw new Error('提醒音效无法播放，请先试听音效');
  return context;
}

export async function playTimerSound(settings: TimerReminders) {
  const audio = await prepareTimerSound();
  const notes = settings.sound === 'bell' ? [880, 1320, 1760] : settings.sound === 'beep' ? [740, 740, 740] : [523.25, 659.25, 783.99];
  const duration = settings.sound === 'beep' ? .16 : .7;
  notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + index * .24;
    oscillator.type = settings.sound === 'beep' ? 'triangle' : 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(settings.volume / 100 * .22, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start); oscillator.stop(start + duration);
  });
}

export function browserNotificationsAvailable() {
  return typeof Notification !== 'undefined' && window.isSecureContext;
}

export function sendBrowserTimerNotification(startedAt: number) {
  if (!browserNotificationsAvailable() || Notification.permission !== 'granted') throw new Error('桌面通知未获授权，请检查浏览器通知权限');
  const notification = new Notification('LunaNahida · 倒计时结束', { body: '可以休息一下了。', tag: `work-timer-${startedAt}`, silent: true, icon: '/lunanahida-icon.png' });
  notification.onclick = () => { window.focus(); notification.close(); };
}
