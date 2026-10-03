import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { discoverRuntime, isDesktopEnvironment, type Runtime } from '@/lib/runtime';
import '@/runtime.css';

const RuntimeContext = createContext<Runtime | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const desktop = isDesktopEnvironment();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    // Wails injects its environment after navigation completes, which can follow React startup.
    const nativeReady = () => { if (!desktop && isDesktopEnvironment()) setAttempt(value => value + 1); };
    window.addEventListener('wails:runtime-config-ready', nativeReady);
    discoverRuntime(desktop, controller.signal).then(value => {
      if (active) setRuntime(value);
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : '音乐库加载失败');
    }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.removeEventListener('wails:runtime-config-ready', nativeReady); };
  }, [attempt]);
  useEffect(() => {
    if (!runtime?.backend) return;
    let active = true;
    let pending = false;
    let lastCheck = 0;
    const controller = new AbortController();
    const refresh = async (event: Event) => {
      if (pending || event.type === 'focus' && Date.now() - lastCheck < 2000) return;
      pending = true;
      lastCheck = Date.now();
      try {
        const response = await fetch('/api/capabilities', { signal: controller.signal });
        if (!response.ok) return;
        const capabilities = await response.json();
        if (active && capabilities.application === 'LunaNahida') setRuntime(previous => previous ? { ...previous, conversion: capabilities.conversion === true } : previous);
      } catch { /* A temporary capability refresh failure must not interrupt playback. */ }
      finally { pending = false; }
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('lunanahida-capabilities-changed', refresh);
    return () => { active = false; controller.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('lunanahida-capabilities-changed', refresh); };
  }, [runtime?.backend]);
  if (!runtime) return <main className="runtime-status"><img src="/lunanahida-icon.png" alt="" /><h1>LunaNahida</h1><p role={error ? 'alert' : 'status'}>{error || '正在打开…'}</p>{error && <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重试</button>}</main>;
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeProvider is required');
  return runtime;
}
