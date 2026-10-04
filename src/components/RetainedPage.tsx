import { Activity, useLayoutEffect, useRef, type ReactNode } from 'react';
import { usePageTransition } from '@/hooks/use-page-transition';

export default function RetainedPage({ route, active, children }: { route: string; active: boolean; children: ReactNode }) {
  return <Activity mode={active ? 'visible' : 'hidden'}><PagePosition route={route}>{children}</PagePosition></Activity>;
}

function PagePosition({ route, children }: { route: string; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  usePageTransition(element, route, true);
  useLayoutEffect(() => {
    const page = element.current;
    const container = window.matchMedia('(max-width: 760px)').matches
      ? document.scrollingElement : page?.closest('.workspace');
    if (!container) return;
    // Catalog pages already restore their list position through their own hook.
    if (!route.startsWith('/artists') && !route.startsWith('/albums')) container.scrollTop = scrollTop.current;
    const remember = () => { scrollTop.current = container.scrollTop; };
    const events = container === document.scrollingElement ? window : container;
    events.addEventListener('scroll', remember, { passive: true });
    return () => { events.removeEventListener('scroll', remember); };
  }, [route]);
  return <div ref={element} className="retained-page" data-page-route={route}>{children}</div>;
}
