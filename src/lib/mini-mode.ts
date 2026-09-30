import type { Window } from '@wailsio/runtime';

type WindowAPI = Pick<typeof Window, 'IsMaximised' | 'IsFullscreen' | 'UnMaximise' | 'UnFullscreen' | 'Maximise' | 'Fullscreen' | 'Size' | 'Position' | 'Resizable' | 'SetSize' | 'SetPosition' | 'SetMinSize' | 'SetFrameless' | 'SetResizable' | 'SetAlwaysOnTop'>;
type WindowSnapshot = { width: number; height: number; x: number; y: number; maximised: boolean; fullscreen: boolean; resizable: boolean };

export const miniWindowSize = { width: 400, height: 168 };

export function createMiniModeController(native: WindowAPI) {
  let snapshot: WindowSnapshot | null = null;
  const restore = async (saved: WindowSnapshot) => {
    await native.SetAlwaysOnTop(false);
    await native.SetFrameless(false);
    await native.SetResizable(saved.resizable);
    await native.SetMinSize(900, 600);
    await native.SetSize(saved.width, saved.height);
    await native.SetPosition(saved.x, saved.y);
    if (saved.maximised) await native.Maximise();
    if (saved.fullscreen) await native.Fullscreen();
  };
  return {
    async enter() {
      if (snapshot) return;
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
      } catch (error) {
        await restore(saved);
        snapshot = null;
        throw error;
      }
    },
    async exit() {
      if (!snapshot) return;
      await restore(snapshot);
      snapshot = null;
    },
  };
}
