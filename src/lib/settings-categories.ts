export const settingsCategories = [
  { id: 'general', label: '常规' },
  { id: 'library', label: '音乐库' },
  { id: 'playback', label: '播放与歌词' },
  { id: 'appearance', label: '外观' },
  { id: 'data', label: '数据与备份' },
] as const;

export type SettingsCategory = typeof settingsCategories[number]['id'];
