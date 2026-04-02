import { cn } from '@/lib/utils';
import type { WatchabilityLabel } from '@/types/scoring';

interface WatchabilityBadgeProps {
  score: number;
  label: WatchabilityLabel;
  size?: 'sm' | 'lg';
}

const LABEL_STYLES: Record<WatchabilityLabel, string> = {
  'Must Watch': 'bg-emerald-500 text-white',
  'Worth It': 'bg-green-400 text-white',
  'Selective': 'bg-amber-400 text-white',
  'Highlights': 'bg-orange-400 text-white',
  'Skip': 'bg-zinc-400 text-white',
};

export function WatchabilityBadge({ score, label, size = 'sm' }: WatchabilityBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-bold',
        LABEL_STYLES[label],
        size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm'
      )}
    >
      <span className="tabular-nums">{score.toFixed(1)}</span>
      <span className="opacity-90">{label}</span>
    </div>
  );
}
