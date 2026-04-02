import { MatchList } from '@/components/MatchList';

export default function Home() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          What to watch
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Spoiler-free watchability scores — find out which replays are worth your time
        </p>
      </div>
      <MatchList />
    </div>
  );
}
