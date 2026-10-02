import type { TrackConditions } from '@/lib/track-query';

export default function TrackFilterControls({ value, onChange }: { value: TrackConditions; onChange: (value: TrackConditions) => void }) {
  const change = (field: keyof TrackConditions, next: unknown) => onChange({ ...value, [field]: next });
  return <div className="track-filter-controls">
    <label>歌手包含<input value={value.artist ?? ''} onChange={event => change('artist', event.target.value)} /></label>
    <label>专辑包含<input value={value.album ?? ''} onChange={event => change('album', event.target.value)} /></label>
    <label>标签（用逗号分隔）<input value={(value.tags ?? []).join(',')} onChange={event => change('tags', event.target.value.split(/[,，]/))} /></label>
    <label>标签匹配<select aria-label="标签匹配" value={value.tagMode ?? 'all'} onChange={event => change('tagMode', event.target.value)}><option value="all">包含全部标签</option><option value="any">包含任一标签</option></select></label>
    <label>歌曲来源<select aria-label="歌曲来源" value={value.source ?? 'all'} onChange={event => change('source', event.target.value)}><option value="all">全部来源</option><option value="local">本地歌曲</option><option value="network">网络歌曲</option></select></label>
    <label>播放状态<select aria-label="播放状态" value={value.availability ?? 'all'} onChange={event => change('availability', event.target.value)}><option value="all">全部状态</option><option value="playable">可播放</option><option value="missing">缺失或无法播放</option></select></label>
    <label>收藏状态<select aria-label="收藏状态" value={value.favorite ?? 'all'} onChange={event => change('favorite', event.target.value)}><option value="all">全部歌曲</option><option value="liked">已喜欢</option><option value="unliked">未喜欢</option></select></label>
    <label>文件格式<select aria-label="文件格式" value={value.format ?? ''} onChange={event => change('format', event.target.value)}><option value="">全部格式</option>{['flac','wav','mp3','m4a','ogg','opus','aiff','wma','ape'].map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>
    {([['minDuration', '最短时长（秒）'], ['maxDuration','最长时长（秒）'], ['minYear','起始年份'], ['maxYear','结束年份']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" min="0" step="1" value={value[field] ?? ''} onChange={event => change(field, event.target.value === '' ? undefined : Math.max(0, Number(event.target.value)))} /></label>)}
  </div>;
}
