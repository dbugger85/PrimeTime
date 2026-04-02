export function MatchCardSkeleton() {
  return (
    <div className="rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden animate-pulse">
      <div className="px-4 pt-3 pb-1 flex justify-between">
        <div className="h-3.5 w-32 bg-zinc-100 dark:bg-zinc-800 rounded" />
        <div className="h-3.5 w-16 bg-zinc-100 dark:bg-zinc-800 rounded" />
      </div>
      <div className="px-4 py-2 flex justify-between gap-4">
        <div className="h-5 w-28 bg-zinc-100 dark:bg-zinc-800 rounded" />
        <div className="h-5 w-28 bg-zinc-100 dark:bg-zinc-800 rounded" />
      </div>
      <div className="px-4 pb-3 flex gap-2">
        <div className="h-6 w-24 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
        <div className="h-6 w-32 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
      </div>
      <div className="px-4 pb-3 flex gap-2">
        <div className="h-5 w-16 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
      </div>
    </div>
  );
}
