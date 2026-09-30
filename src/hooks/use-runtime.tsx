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
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    discoverRuntime(isDesktopEnvironment(), controller.signal).then(value => {
      if (active) setRuntime(value);
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : '音乐库加载失败');
    }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt]);
  if (!runtime) return <main className="runtime-status"><img src="/lunanahida-icon.png" alt="" /><h1>LunaNahida</h1><p role={error ? 'alert' : 'status'}>{error || '正在打开…'}</p>{error && <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重试</button>}</main>;
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeProvider is required');
  return runtime;
}
