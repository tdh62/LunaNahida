import type { Track } from './music';
import type { Playlist } from './playlists';
import type { ArtistMapping } from './catalog';
import type { SavedEffect } from './audio-filter';
import { readOrganizerPreview } from './organizer-progress';
import type { WorkTimerCommand, WorkTimerResponse } from './work-timer';
import type { TimerReminders } from './timer-reminders';

export type OrganizerOptions = { paths: string[]; target: string; mode: 'rename' | 'artist' | 'deduplicate' | 'consolidate'; template: string; matchMode?: 'content' | 'quick' };
export type OrganizerProgress = { phase: 'discover' | 'scan' | 'group' | 'ready'; processed: number; total: number; current: string; bytes: number; totalBytes: number; quick: boolean };
export type OrganizerFile = { path: string; title: string; artist: string; album: string; quality: string; size: number; companions: string[] };
export type OrganizerPlan = { id: string; mode: OrganizerOptions['mode']; matchMode?: 'content' | 'quick'; scanned: number; warnings: string[]; moves: { source: string; destination: string; companions: string[] }[]; groups: { id: string; match: 'exact' | 'metadata' | 'filename'; files: OrganizerFile[]; suggestedKeep: string }[] };
export type OrganizerResult = { moved: number; quarantined: number; companions: number; recoveryPaths: string[]; manifest: string; remappedIds: Record<string, number>; temporaryTracks: Track[]; warnings: string[] };

export type ScopeSettings = { mode: 'spectrum' | 'waveform'; fftSize: 2048 | 4096 | 8192 | 16384; minFrequency: number; maxFrequency: number; smoothing: number };
export const defaultScopeSettings: ScopeSettings = { mode: 'spectrum', fftSize: 8192, minFrequency: 20, maxFrequency: 20000, smoothing: 0.72 };

export type StoredSettings = {
  resumePlayback?: boolean;
  professionalAudio?: boolean;
  trayEnabled?: boolean;
  hideLocalMusicActions?: boolean;
  hideNetworkMusicActions?: boolean;
  dropAction: 'ask' | 'temporary' | 'library' | 'watch';
  networkCacheCount: number;
  scanOnStart: boolean;
  scanIntervalMinutes: number;
  autoConvert: boolean;
  backupOriginal: boolean;
  theme: string;
  appearance: 'dark' | 'light';
  visual: string;
  scope: ScopeSettings;
  lyricEffect: string;
  lyricScroll: string;
  showTranslation: boolean;
  lyricAppearance: { font: string; size: number; lineHeight: number; spacing: number };
  artistMappings: ArtistMapping[];
  volume: number;
  mode: 'list' | 'repeat' | 'shuffle' | 'stop-track' | 'stop-list';
  effect: string;
  customEffects: SavedEffect[];
  equalizer: number[];
};

export type NetworkSource = { id: number; kind: 'webdav' | 'ftp' | 'ftps' | 'playlist'; url: string; username: string };
export type PlaybackState = { trackId: number; position: number };
export type LibraryState = { playback?: PlaybackState; tracks: Track[]; tags: string[]; playlists: Playlist[]; liked: number[]; recent: number[]; queue: number[]; folders: string[]; networkSources: NetworkSource[]; settings: StoredSettings };
export type ScanResult = { added: number; updated: number; missing: number; removed: number; folders: number; converted: number; errors: string[] };
export type ConversionResult = { source: string; output?: string; backup?: string; status: 'converted' | 'failed'; error?: string; track?: Track };
export type CacheStats = { coverBytes: number; webviewBytes: number; metadataBytes: number; networkAudioBytes: number; totalBytes: number; webviewClearPending: boolean };
export type BackupImportResult = { tracks: number; playlists: number; tags: number; covers: number };

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const backend = {
  lyricOffset: (id: number, offsetMs: number) => request<{ok: boolean}>(`/api/tracks/${id}/lyric-offset`, 'PUT', {offsetMs}),
  savePlayback: (value: PlaybackState) => request<{ ok: boolean }>('/api/playback', 'PUT', value),
  timerReminders: () => request<TimerReminders>('/api/timer/reminders'),
  saveTimerReminders: (value: TimerReminders) => request<TimerReminders>('/api/timer/reminders', 'PUT', value),
  authorizeTimerNotification: () => request<{ granted: boolean }>('/api/timer/notification/authorize', 'POST'),
  claimTimerAlert: (startedAt: number, desktopNotification: boolean) => request<{ claimed: boolean; notificationError: string }>('/api/timer/alert', 'POST', { startedAt, desktopNotification }),
  workTimer: () => request<WorkTimerResponse>('/api/timer'),
  updateWorkTimer: (command: WorkTimerCommand) => request<WorkTimerResponse>('/api/timer', 'POST', command),
  previewOrganizer: async (options: OrganizerOptions, onProgress?: (progress: OrganizerProgress) => void, signal?: AbortSignal) => readOrganizerPreview(await fetch('/api/organizer/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(options), signal }), onProgress),
  executeOrganizer: (id: string, keep: Record<string, string>) => request<OrganizerResult>('/api/organizer/execute', 'POST', { id, keep }),
  state: () => request<LibraryState>('/api/state'),
  deleteTracks: (ids: number[]) => request<{ ok: boolean }>('/api/tracks', 'DELETE', { ids }),
  createTag: (name: string) => request<{ ok: boolean }>('/api/tags', 'POST', { name }),
  renameTag: (oldName: string, newName: string) => request<{ ok: boolean }>('/api/tags/rename', 'PUT', { oldName, newName }),
  deleteTag: (name: string) => request<{ ok: boolean }>('/api/tags', 'DELETE', { name }),
  changeTrackTag: (ids: number[], name: string, add: boolean) => request<{ ok: boolean }>('/api/tracks/tags', 'PATCH', { ids, name, add }),
  settings: (value: StoredSettings) => request<StoredSettings>('/api/settings', 'PUT', value),
  playlists: (value: Playlist[]) => request<{ ok: boolean }>('/api/playlists', 'PUT', value),
  liked: (value: number[]) => request<{ ok: boolean }>('/api/liked', 'PUT', value),
  queue: (value: number[]) => request<{ ok: boolean }>('/api/queue', 'PUT', value),
  history: (id: number) => request<{ ok: boolean }>('/api/history', 'POST', { id }),
  duration: (id: number, duration: number) => request<{ ok: boolean }>(`/api/tracks/${id}/duration`, 'PUT', { duration }),
  updateTrackMetadata: (id: number, title: string, artist: string, album: string) => request<Track>(`/api/tracks/${id}/metadata`, 'PUT', { title, artist, album }),
  enrichment: (id: number, cover: string, lyric: string, translation: string, fallbackOnly = false) => request<{ ok: boolean }>(`/api/tracks/${id}/enrichment${fallbackOnly ? '?fallback=1' : ''}`, 'PUT', { cover, lyric, translation }),
  saveLyrics: (track: Track) => request<Track>(`/api/tracks/${track.id}/lyrics`, 'POST', { lyrics: track.lyrics }),
  import: (paths: string[], mode: 'temporary' | 'library' | 'watch', skipConversion = false) => request<Track[]>('/api/import', 'POST', { paths, mode, skipConversion }),
  importNetwork: (url: string) => request<Track>('/api/import/network', 'POST', { url }),
  addNetworkSource: (kind: NetworkSource['kind'], url: string, username: string, password: string) => request<{ source: NetworkSource; scan: ScanResult }>('/api/network/sources', 'POST', { kind, url, username, password }),
  removeNetworkSource: (id: number) => request<{ ok: boolean }>(`/api/network/sources/${id}`, 'DELETE'),
  inspectConversion: (paths: string[]) => request<{ paths: string[] }>('/api/conversion/inspect', 'POST', { paths }),
  convert: (path: string, addToLibrary: boolean) => request<ConversionResult>('/api/conversion', 'POST', { path, addToLibrary }),
  playbackStatus: (id: number, status: 'unknown' | 'playable' | 'unplayable') => request<{ ok: boolean }>(`/api/tracks/${id}/playback`, 'PUT', { status }),
  scan: (backupOriginal: boolean) => request<ScanResult>('/api/scan', 'POST', { backupOriginal }),
  cacheStats: () => request<CacheStats>('/api/cache'),
  saveBackupNative: () => request<{ available: boolean; saved: boolean }>('/api/backup/save', 'POST'),
  exportBackup: async () => {
    const response = await fetch('/api/backup');
    if (!response.ok) throw new Error('导出备份失败');
    return response.blob();
  },
  importBackup: async (file: File) => {
    const form = new FormData();
    form.append('archive', file);
    const response = await fetch('/api/backup/import', { method: 'POST', body: form });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || '导入备份失败');
    }
    return response.json() as Promise<BackupImportResult>;
  },
  clearCache: () => request<CacheStats>('/api/cache/clear', 'POST'),
  clearNetworkCache: () => request<CacheStats>('/api/cache/network/clear', 'POST'),
  addFolder: (path: string) => request<{ ok: boolean }>('/api/folders', 'POST', { path }),
  removeFolder: (path: string) => request<{ ok: boolean }>('/api/folders', 'DELETE', { path }),
  chooseFiles: () => request<{ paths: string[] }>('/api/dialog/files'),
  chooseFolder: () => request<{ paths: string[] }>('/api/dialog/folder'),
  chooseCover: () => request<{ cover: string }>('/api/dialog/cover'),
  uploadCover: async (file: File) => {
    const form = new FormData(); form.append('image', file);
    const response = await fetch('/api/media/cover', { method: 'POST', body: form });
    if (!response.ok) throw new Error('封面保存失败');
    return (await response.json() as { cover: string }).cover;
  },
};
