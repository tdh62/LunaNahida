import { useState } from 'react';
import { ListEnd, Repeat, Repeat1, Shuffle, Square } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { StoredSettings } from '@/lib/backend';
import '@/playback-mode.css';

const modes = [
  { id: 'list', label: '列表循环', icon: Repeat },
  { id: 'shuffle', label: '随机播放', icon: Shuffle },
  { id: 'repeat', label: '单曲循环', icon: Repeat1 },
  { id: 'stop-track', label: '单曲后停止', icon: Square },
  { id: 'stop-list', label: '列表后停止', icon: ListEnd },
] as const;

export default function PlaybackModeControl({ mode, onChange, disabled = false }: { mode: StoredSettings['mode']; onChange: (mode: StoredSettings['mode']) => void; disabled?: boolean }) {
  const current = modes.find(item => item.id === mode) ?? modes[0];
  const Icon = current.icon;
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  return <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}><Tooltip open={tooltipOpen && !menuOpen} onOpenChange={setTooltipOpen}><DropdownMenuTrigger asChild><TooltipTrigger asChild>
    <button type="button" className="playback-mode-control" data-mode={mode} disabled={disabled} aria-label={`播放模式：${current.label}`}><Icon size={18} /></button>
  </TooltipTrigger></DropdownMenuTrigger><TooltipContent side="top">{current.label}</TooltipContent></Tooltip>
    <DropdownMenuContent side="top" align="end" sideOffset={10} collisionPadding={12} className="playback-mode-menu" aria-label="播放模式">
      <DropdownMenuRadioGroup value={mode} onValueChange={value => onChange(value as StoredSettings['mode'])}>{modes.map(item => <DropdownMenuRadioItem key={item.id} value={item.id} className="playback-mode-option"><item.icon size={16} /><span>{item.label}</span></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
