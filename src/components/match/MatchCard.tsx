'use client';

import { useState } from 'react';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';
import type { Match, StreamingServiceId } from '@/types/match';
import { useMatchScore } from '@/hooks/useMatchScore';
import { WatchabilityBadge } from './WatchabilityBadge';
import { WatchRecommendation } from './WatchRecommendation';
import { ActionTimeline } from './ActionTimeline';
import { StreamingLinks } from './StreamingLinks';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Eye, EyeOff, RefreshCw, Zap } from 'lucide-react';

interface MatchCardProps {
  match: Match;
  subscribedServices: StreamingServiceId[];
  spoilerMode: 'hide' | 'show';
}

export function MatchCard({ match, subscribedServices, spoilerMode }: MatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [localSpoilerMode, setLocalSpoilerMode] = useState(spoilerMode);
  const [scoreRequested, setScoreRequested] = useState(false);
  const isFinished = match.status === 'FINISHED';

  const { data: score, isLoading, isError, refetch, isFetching } = useMatchScore(
    match.sport,
    match.id,
    isFinished && scoreRequested
  );

  const matchDate = new Date(match.utcDate);
  const timeAgo = formatDistanceToNow(matchDate, { addSuffix: true });

  // Norway time — no extra library needed, Intl is built-in
  const norwayTime = new Intl.DateTimeFormat('no-NO', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(matchDate);

  const dateLabel = isToday(matchDate)
    ? `Today ${norwayTime}`
    : isYesterday(matchDate)
    ? `Yesterday ${norwayTime}`
    : `${format(matchDate, 'd MMM')} ${norwayTime}`;

  const sportEmoji: Record<string, string> = {
    football: '⚽',
    f1: '🏎️',
    basketball: '🏀',
    tennis: '🎾',
  };

  const hasData = score?.hasData ?? false;

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white dark:bg-zinc-900 dark:border-zinc-800 transition-shadow hover:shadow-md overflow-hidden',
        !isFinished && 'opacity-75'
      )}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">{sportEmoji[match.sport]}</span>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {match.competition}
            {match.matchday ? ` · ${match.matchday}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isFinished ? (
            <span className="text-xs text-zinc-400">{dateLabel}</span>
          ) : (
            <span className="text-xs text-zinc-400" title={timeAgo}>{dateLabel}</span>
          )}
        </div>
      </div>

      {/* Teams */}
      <div className="px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base text-zinc-900 dark:text-zinc-100 truncate">
              {match.homeTeam}
            </p>
          </div>
          <span className="text-zinc-300 dark:text-zinc-600 text-sm font-light">vs</span>
          <div className="flex-1 min-w-0 text-right">
            <p className="font-semibold text-base text-zinc-900 dark:text-zinc-100 truncate">
              {match.awayTeam}
            </p>
          </div>
        </div>
      </div>

      {/* Score / Watchability row */}
      {isFinished && (
        <div className="px-4 pb-3">
          {!scoreRequested ? (
            <button
              onClick={() => setScoreRequested(true)}
              className="flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 hover:text-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-200 transition-colors"
            >
              <Zap className="h-3 w-3" /> Get watchability score
            </button>
          ) : isLoading || isFetching ? (
            <div className="h-7 w-32 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ) : isError ? (
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Failed to load — retry
            </button>
          ) : score && !hasData ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 italic">No event data available</span>
              <button
                onClick={() => refetch()}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          ) : score && hasData ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <WatchabilityBadge score={score.score} label={score.label} />
              <WatchRecommendation recommendation={score.recommendation} compact />
            </div>
          ) : null}
        </div>
      )}

      {/* Streaming */}
      <div className="px-4 pb-3">
        <StreamingLinks
          services={match.streamingServices}
          subscribedServices={subscribedServices}
          compact
        />
      </div>

      {/* Expandable detail — only when we have real data */}
      {isFinished && score && hasData && (
        <>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 border-t border-zinc-100 dark:border-zinc-800 transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="h-3.5 w-3.5" /> Less detail</>
            ) : (
              <><ChevronDown className="h-3.5 w-3.5" /> More detail</>
            )}
          </button>

          {expanded && (
            <div className="px-4 pb-4 space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-300 italic">
                {score.spoilerFreeDescription}
              </p>

              {score.contextBullets.length > 0 && (
                <ul className="space-y-1">
                  {score.contextBullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="mt-0.5 shrink-0 text-zinc-300 dark:text-zinc-600">—</span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}

              <ActionTimeline
                segments={score.timelineSegments}
                sport={match.sport}
                peakMinute={score.peakMinute}
              />

              <WatchRecommendation recommendation={score.recommendation} />

              <button
                onClick={() => setLocalSpoilerMode((m) => (m === 'hide' ? 'show' : 'hide'))}
                className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                {localSpoilerMode === 'hide' ? (
                  <><Eye className="h-3.5 w-3.5" /> Reveal event details</>
                ) : (
                  <><EyeOff className="h-3.5 w-3.5" /> Hide event details</>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
