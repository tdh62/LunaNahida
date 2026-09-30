export function scrollToCurrentLyric(container: HTMLElement, line: HTMLElement | undefined, behavior: ScrollBehavior) {
  if (!line) return false;
  const containerBounds = container.getBoundingClientRect();
  const lineBounds = line.getBoundingClientRect();
  container.scrollTo({
    top: Math.max(0, container.scrollTop + lineBounds.top - containerBounds.top - container.clientTop + lineBounds.height / 2 - container.clientHeight / 2),
    behavior,
  });
  return true;
}
