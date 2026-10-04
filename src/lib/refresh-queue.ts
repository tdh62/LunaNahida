// Coalesce bursts without losing a change that arrives during a pending read.
export function createRefreshQueue<T>(load: () => Promise<T>, apply: (value: T) => void) {
  let pending: Promise<void> | null = null;
  let dirty = false;
  return () => {
    dirty = true;
    if (!pending) {
      pending = (async () => {
        // Requests made in the same turn need only one snapshot.
        await Promise.resolve();
        do {
          dirty = false;
          const value = await load();
          if (!dirty) apply(value);
        } while (dirty);
      })().finally(() => { pending = null; });
    }
    return pending;
  };
}
