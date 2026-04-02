'use client';

import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import type { TimelineSegment } from '@/types/scoring';

interface ActionTimelineProps {
  segments: TimelineSegment[];
  sport?: string;
  peakMinute?: number;
}

function intensityColor(intensity: number): string {
  if (intensity >= 0.75) return '#ef4444'; // red
  if (intensity >= 0.45) return '#f97316'; // orange
  if (intensity >= 0.2)  return '#3b82f6'; // blue
  return '#94a3b8';                         // slate
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const seg: TimelineSegment = payload[0]?.payload;
  if (!seg) return null;

  const intensityLabel =
    seg.intensity >= 0.75 ? 'High intensity' :
    seg.intensity >= 0.45 ? 'Moderate activity' :
    seg.intensity >= 0.15 ? 'Some activity' : 'Quiet';

  return (
    <div className="bg-zinc-900 dark:bg-zinc-700 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg">
      <p className="font-medium">{intensityLabel}</p>
      <p className="text-zinc-300">
        {seg.startMinute}–{seg.endMinute}&apos;
        {seg.eventCount > 0 ? ` · ${seg.eventCount} event${seg.eventCount > 1 ? 's' : ''}` : ''}
      </p>
    </div>
  );
}

export function ActionTimeline({ segments, sport = 'football', peakMinute }: ActionTimelineProps) {
  const isFootball = sport === 'football';
  const xLabel = isFootball ? "'" : ' L';
  const halftimeMinute = 45;

  const chartData = segments.map((s) => ({
    ...s,
    fill: intensityColor(s.intensity),
  }));

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Action intensity</span>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-slate-400" /> Quiet</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> Active</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-orange-400" /> Hot</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Peak</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={90}>
        <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="grad-quiet"  x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="grad-active" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="grad-hot"    x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f97316" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="grad-peak"   x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.65} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="startMinute"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}${xLabel}`}
            interval="preserveStartEnd"
          />
          <YAxis hide domain={[0, 1]} />

          {isFootball && (
            <ReferenceLine
              x={halftimeMinute}
              stroke="#d1d5db"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{ value: 'HT', position: 'insideTopRight', fontSize: 9, fill: '#9ca3af', dy: -2 }}
            />
          )}

          {peakMinute !== undefined && (
            <ReferenceLine
              x={peakMinute}
              stroke="#ef4444"
              strokeDasharray="2 2"
              strokeWidth={1}
              label={{ value: `Peak ${peakMinute}${xLabel}`, position: 'insideTopLeft', fontSize: 9, fill: '#ef4444', dy: -2 }}
            />
          )}

          <Tooltip content={<CustomTooltip />} />

          <Area
            type="monotone"
            dataKey="intensity"
            stroke="#3b82f6"
            strokeWidth={1.5}
            fill="url(#grad-active)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
