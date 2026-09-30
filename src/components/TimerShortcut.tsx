import { Clock3 } from 'lucide-react';
import { Portal } from '@radix-ui/react-hover-card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { WorkTimerControls } from '@/hooks/use-work-timer';
import { formatWorkTimerTime } from '@/lib/work-timer';

export default function TimerShortcut({ timer, onOpen }: { timer: WorkTimerControls; onOpen: () => void }) {
  if (!timer.active) return null;
  const title = timer.state.mode === 'stopwatch' ? '正计时' : '倒计时';
  const status = { idle: '准备开始', running: '计时中', paused: '已暂停', completed: '已结束' }[timer.view.status];
  return <HoverCard openDelay={200} closeDelay={100}><HoverCardTrigger asChild><button type="button" className={`icon-button work-timer-trigger ${timer.view.status}`} aria-label="打开计时器" onClick={onOpen}><Clock3 size={19} /><i aria-hidden="true" /></button></HoverCardTrigger><Portal><HoverCardContent side="top" align="end" sideOffset={12} collisionPadding={12} className="work-timer-preview" aria-label="计时器预览"><div><strong>{title}</strong><span>{status}</span></div><output>{formatWorkTimerTime(timer.view.displayMs, timer.state.mode === 'countdown')}</output>{timer.state.mode === 'countdown' && <progress max="1" value={timer.view.progress} aria-label="倒计时预览进度" />}</HoverCardContent></Portal></HoverCard>;
}
