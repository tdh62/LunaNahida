import TrackFilterControls from './TrackFilterControls';
import { queryTracks, type TrackSort } from '@/lib/track-query';
import type { PlaylistRules } from '@/lib/playlists';
import type { Track } from '@/lib/music';

export default function PlaylistRuleEditor({ value, onChange, tracks, liked }: { value: PlaylistRules; onChange: (value: PlaylistRules) => void; tracks: Track[]; liked: number[] }) {
  const count = queryTracks(tracks, value.conditions, liked).length;
  return <fieldset className="playlist-rule-editor"><legend>自动收录条件</legend><p>匹配全部条件，留空表示不限。</p>
    <label className="playlist-field">条件关键词<input value={value.conditions.keyword ?? ''} onChange={event => onChange({...value, conditions:{...value.conditions,keyword:event.target.value}})} /></label>
    <TrackFilterControls value={value.conditions} onChange={conditions => onChange({...value,conditions})} />
    <div className="library-query-bar"><label>歌单排序<select aria-label="条件歌单排序" value={value.sort} onChange={event => onChange({...value,sort:event.target.value as TrackSort})}>{[['original','加入顺序'],['title','歌曲名称'],['artist','歌手'],['album','专辑'],['duration','时长'],['year','年份'],['added','加入时间']].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" disabled={value.sort==='original'} aria-pressed={value.descending} onClick={() => onChange({...value,descending:!value.descending})}>{value.descending ? '降序' : '升序'}</button></div>
    <output aria-live="polite">当前匹配 {count} 首歌曲</output>
  </fieldset>;
}
