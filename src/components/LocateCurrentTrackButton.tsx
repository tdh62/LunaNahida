import { LocateFixed } from 'lucide-react';

type Props = { available: boolean; onLocate: () => void; iconOnly?: boolean };

export default function LocateCurrentTrackButton({ available, onLocate, iconOnly = false }: Props) {
  return <button type="button" className={`locate-current-track ${iconOnly ? 'icon-only' : ''}`} aria-label="定位当前播放" title={available ? '定位当前播放的歌曲' : '当前播放的歌曲不在此列表中'} disabled={!available} onClick={onLocate}><LocateFixed size={17} />{!iconOnly && <span>定位当前播放</span>}</button>;
}
