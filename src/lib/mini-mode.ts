import type { Window } from '@wailsio/runtime';

type WindowAPI = Pick<typeof Window, 'IsMaximised' | 'IsFullscreen' | 'UnMaximise' | 'UnFullscreen' | 'Maximise' | 'Fullscreen' | 'Size' | 'Position' | 'Resizable' | 'SetSize' | 'SetPosition' | 'SetMinSize' | 'SetFrameless' | 'SetResizable' | 'SetAlwaysOnTop' | 'Center'>;
type WindowSnapshot = { width: number; height: number; x: number; y: number; maximised: boolean; fullscreen: boolean; resizable: boolean };
type MiniPreferences = { x: number; y: number; pinned: boolean };
type WorkArea = { X: number; Y: number; Width: number; Height: number };
type MiniModeOptions = { storage?: Pick<Storage, 'getItem' | 'setItem'>; getWorkAreas?: () => Promise<WorkArea[]> };

export const miniWindowSize = { width: 400, height: 168 };
export const miniWindowStorageKey = 'mini-window-preferences';

export function createMiniModeController(native: WindowAPI, options: MiniModeOptions = {}) {
  let snapshot: WindowSnapshot | null = null;
  let preferences: MiniPreferences | null = null;
  let pinned = false;
  let exiting = false;
  try {
    const saved = JSON.parse(options.storage?.getItem(miniWindowStorageKey) || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && typeof saved.pinned === 'boolean') preferences = saved;
  } catch { /* Unavailable storage uses the default window position. */ }
  const remember = async () => {
    if (!snapshot || exiting) return;
    preferences = { ...await native.Position(), pinned };
    try { options.storage?.setItem(miniWindowStorageKey, JSON.stringify(preferences)); }
    catch { /* Keep preferences in memory when storage is unavailable. */ }
  };
  const restore = async (saved: WindowSnapshot) => {
    await native.SetAlwaysOnTop(false);
    await native.SetFrameless(true);
    await native.SetResizable(saved.resizable);
    await native.SetMinSize(900, 600);
    await native.SetSize(saved.width, saved.height);
    await native.SetPosition(saved.x, saved.y);
    if (saved.maximised) await native.Maximise();
    if (saved.fullscreen) await native.Fullscreen();
  };
  return {
    async enter() {
      if (snapshot) return pinned;
      const maximised = await native.IsMaximised();
      const fullscreen = await native.IsFullscreen();
      const resizable = await native.Resizable();
      if (fullscreen) await native.UnFullscreen();
      if (maximised) await native.UnMaximise();
      // Read the restored bounds so leaving mini mode preserves the normal window too.
      const size = await native.Size();
      const position = await native.Position();
      const saved = { ...size, ...position, maximised, fullscreen, resizable };
      snapshot = saved;
      try {
        await native.SetMinSize(miniWindowSize.width, miniWindowSize.height);
        await native.SetFrameless(true);
        await native.SetResizable(false);
        await native.SetSize(miniWindowSize.width, miniWindowSize.height);
        let areas: WorkArea[] = [];
        try { areas = await options.getWorkAreas?.() ?? []; }
        catch { /* Fall back to native centering if screen information is unavailable. */ }
        const position = preferences;
        if (position && areas.some(area => position.x >= area.X && position.y >= area.Y && position.x + miniWindowSize.width <= area.X + area.Width && position.y + miniWindowSize.height <= area.Y + area.Height)) {
          await native.SetPosition(position.x, position.y);
        } else {
          await native.Center();
        }
        pinned = preferences?.pinned ?? false;
        await native.SetAlwaysOnTop(pinned);
        exiting = false;
        return pinned;
      } catch (error) {
        await restore(saved);
        snapshot = null;
        throw error;
      }
    },
    async exit() {
      if (!snapshot) return;
      await remember();
      exiting = true;
      await restore(snapshot);
      snapshot = null;
    },
    async setPinned(next: boolean) {
      await native.SetAlwaysOnTop(next);
      pinned = next;
    },
    remember,
  };
}
