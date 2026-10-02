import type { LibraryState } from './backend';

export type Runtime = {
  mode: 'desktop' | 'browser-backend' | 'web';
  backend: boolean;
  nativeFiles: boolean;
  nativeFolders: boolean;
  nativeCover: boolean;
  nativeBackup: boolean;
  nativeFonts: boolean;
  initialState: LibraryState;
};

export function isDesktopEnvironment(host: unknown = window): boolean {
  const value = host as { _wails?: { environment?: { OS?: string } } };
  return ['windows', 'linux', 'darwin'].includes(value?._wails?.environment?.OS ?? '');
}

export function emptyLibrary(): LibraryState {
  return {
    tracks: [], tags: [], playlists: [], liked: [], recent: [], queue: [], folders: [], networkSources: [],
    settings: {
      dropAction: 'temporary', networkCacheCount: 0, scanOnStart: false, scanIntervalMinutes: 0,
      autoConvert: false, backupOriginal: true, theme: 'forest', themeColor: '#2b7651', appearance: 'light', uiTextSize: 100, visual: '频谱',
      scope: { mode: 'spectrum', fftSize: 8192, minFrequency: 20, maxFrequency: 20000, smoothing: .72 },
      lyricEffect: '流动', lyricScroll: '平滑', showTranslation: true,
      lyricAppearance: { font: 'default', size: 16, lineHeight: 57, spacing: 0 }, artistMappings: [],
      volume: 65, mode: 'list', effect: '原声', customEffects: [], equalizer: [0, 0, 0, 0, 0],
    },
  };
}

function validState(value: LibraryState): boolean {
  return value && ['tracks', 'tags', 'playlists', 'liked', 'recent', 'queue', 'folders', 'networkSources']
    .every(key => Array.isArray(value[key])) && Boolean(value.settings && Array.isArray(value.settings.equalizer));
}

export async function discoverRuntime(desktop: boolean, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Runtime> {
  const web: Runtime = { mode: 'web', backend: false, nativeFiles: false, nativeFolders: false, nativeCover: false, nativeBackup: false, nativeFonts: false, initialState: emptyLibrary() };
  let response: Response;
  try { response = await fetcher('/api/capabilities', { signal }); }
  catch (error) { if (desktop) throw error; return web; }
  if (response.status === 404 || response.ok && !response.headers.get('content-type')?.includes('application/json')) {
    if (desktop) throw new Error('无法连接本地音乐库');
    return web;
  }
  if (!response.ok) throw new Error('音乐库服务暂时不可用，请重试');
  const capabilities = await response.json();
  if (capabilities.application !== 'LunaNahida') throw new Error('音乐库服务无法识别');
  const stateResponse = await fetcher('/api/state', { signal });
  if (!stateResponse.ok) throw new Error('音乐库加载失败，请重试');
  const initialState = await stateResponse.json() as LibraryState;
  if (!validState(initialState)) throw new Error('音乐库数据无法读取');
  return {
    mode: desktop ? 'desktop' : 'browser-backend', backend: true, initialState,
    nativeFiles: desktop && capabilities.nativeFiles === true,
    nativeFolders: desktop && capabilities.nativeFolders === true,
    nativeCover: desktop && capabilities.nativeCover === true,
    nativeBackup: desktop && capabilities.nativeBackup === true,
    nativeFonts: desktop && capabilities.nativeFonts === true,
  };
}
