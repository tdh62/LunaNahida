import { useLayoutEffect, useRef, type RefObject } from 'react';

// Effects reconnect when an Activity becomes visible, without replacing its DOM.
export function usePageTransition(element: RefObject<HTMLElement | null>, key: string, contents = false, initial = true) {
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    const first = previous.current === null;
    const changed = previous.current !== key;
    previous.current = key;
    if (!initial && (first || !changed)) return;
    const page = element.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!page || motion.matches) return;
    // Opacity avoids moving scroll containers or changing fixed dialog positioning.
    const targets = contents ? Array.from(page.children) : [page];
    const animations = targets.filter(target => target instanceof HTMLElement && typeof target.animate === 'function')
      .map(target => {
        const animation = target.animate([{ opacity: .84 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
        animation.id = 'page-entrance';
        return animation;
      });
    const cancel = () => animations.forEach(animation => animation.cancel());
    const preferenceChanged = () => { if (motion.matches) cancel(); };
    motion.addEventListener('change', preferenceChanged);
    return () => { cancel(); motion.removeEventListener('change', preferenceChanged); };
  }, [element, key, contents, initial]);
}
