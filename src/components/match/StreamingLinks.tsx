import type { StreamingServiceId } from '@/types/match';
import { SERVICES_BY_ID } from '@/lib/constants/services';
import { cn } from '@/lib/utils';

interface StreamingLinksProps {
  services: StreamingServiceId[];
  subscribedServices: StreamingServiceId[];
  compact?: boolean;
}

export function StreamingLinks({ services, subscribedServices, compact = false }: StreamingLinksProps) {
  if (services.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', compact ? 'items-center' : '')}>
      {services.map((id) => {
        const service = SERVICES_BY_ID[id];
        if (!service) return null;
        const subscribed = subscribedServices.includes(id);

        return (
          <span
            key={id}
            style={subscribed ? { backgroundColor: service.color + '22', borderColor: service.color + '44', color: service.color } : undefined}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
              !subscribed && 'border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'
            )}
          >
            {service.label}
          </span>
        );
      })}
    </div>
  );
}
