import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'outline' | 'secondary';
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        variant === 'default' && 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100',
        variant === 'outline' && 'border border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300',
        variant === 'secondary' && 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
        className
      )}
    >
      {children}
    </span>
  );
}
