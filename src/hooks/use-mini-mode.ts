import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createMiniModeController } from '@/lib/mini-mode';

export function useMiniMode(desktop: boolean) {
  const controller = useRef<ReturnType<typeof createMiniModeController> | null>(null);
  const pending = useRef(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('desktop-mini-mode', active);
    return () => document.documentElement.classList.remove('desktop-mini-mode');
  }, [active]);
  const change = async (next: boolean) => {
    if (!desktop || pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      if (!controller.current) {
        const { Window } = await import('@wailsio/runtime');
        controller.current = createMiniModeController(Window);
      }
      if (next) await controller.current.enter();
      else await controller.current.exit();
      setActive(next);
      if (!next) setPinned(false);
      return true;
    } catch (error) {
      toast.error('窗口切换失败', { description: error instanceof Error ? error.message : String(error) });
      return false;
    } finally { pending.current = false; setBusy(false); }
  };
  const pin = async () => {
    if (!desktop || !active || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const { Window } = await import('@wailsio/runtime');
      await Window.SetAlwaysOnTop(!pinned);
      setPinned(!pinned);
    } catch (error) { toast.error(error instanceof Error ? error.message : '置顶失败'); }
    finally { pending.current = false; setBusy(false); }
  };
  const windowAction = async (action: 'Minimise' | 'Close') => {
    if (!desktop || pending.current) return;
    try { const { Window } = await import('@wailsio/runtime'); await Window[action](); }
    catch (error) { toast.error(error instanceof Error ? error.message : '窗口操作失败'); }
  };
  return { active, busy, pinned, change, pin, minimise: () => void windowAction('Minimise'), close: () => void windowAction('Close') };
}
