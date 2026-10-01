import { useEffect, useState } from 'react';
import { Copy, Minus, PictureInPicture2, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { isDesktopEnvironment } from '@/lib/runtime';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import '@/desktop-window.css';

export default function DesktopWindowBar() {
  const [desktop, setDesktop] = useState(isDesktopEnvironment);
  const [maximised, setMaximised] = useState(false);
  useEffect(() => {
    const ready = () => setDesktop(isDesktopEnvironment());
    window.addEventListener('wails:runtime-config-ready', ready);
    ready();
    return () => window.removeEventListener('wails:runtime-config-ready', ready);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    document.documentElement.classList.add('desktop-frameless');
    let disposed = false;
    let cleanup: (() => void)[] = [];
    void import('@wailsio/runtime').then(({ Window, Events }) => {
      if (disposed) return;
      const sync = () => { void Window.IsMaximised().then(value => { if (!disposed) setMaximised(value); }).catch(() => {}); };
      sync();
      cleanup = [Events.Types.Common.WindowMaximise, Events.Types.Common.WindowUnMaximise, Events.Types.Common.WindowRestore]
        .map(name => Events.On(name, sync));
    });
    return () => { disposed = true; cleanup.forEach(off => off()); document.documentElement.classList.remove('desktop-frameless'); };
  }, [desktop]);
  const act = async (action: 'Minimise' | 'ToggleMaximise' | 'Close') => {
    try {
      const { Window } = await import('@wailsio/runtime');
      await Window[action]();
      if (action === 'ToggleMaximise') setMaximised(await Window.IsMaximised());
    } catch { toast.error('窗口操作失败，请重试'); }
  };
  if (!desktop) return null;
  const actions = [
    { label: '最小化窗口', action: 'Minimise', icon: Minus },
    { label: maximised ? '还原窗口' : '最大化窗口', action: 'ToggleMaximise', icon: maximised ? Copy : Square },
    { label: '关闭窗口', action: 'Close', icon: X },
  ] as const;
  return <header className="desktop-window-bar" aria-label="窗口控制" onDoubleClick={event => {
    if (!(event.target as HTMLElement).closest('button')) void act('ToggleMaximise');
  }}>
    <div className="desktop-window-drag-zone" aria-hidden="true" />
    <div className="desktop-window-actions"><Tooltip><TooltipTrigger asChild><button type="button" aria-label="切换到迷你模式" onClick={() => window.dispatchEvent(new Event('lunanahida:enter-mini-mode'))}><PictureInPicture2 size={15} /></button></TooltipTrigger><TooltipContent side="bottom">迷你模式</TooltipContent></Tooltip>{actions.map(({ label, action, icon: Icon }) =>
      <Tooltip key={action}><TooltipTrigger asChild><button type="button" aria-label={label} className={action === 'Close' ? 'desktop-window-close' : ''} onClick={() => void act(action)}><Icon size={14} /></button></TooltipTrigger><TooltipContent side="bottom">{label}</TooltipContent></Tooltip>
    )}</div>
  </header>;
}
