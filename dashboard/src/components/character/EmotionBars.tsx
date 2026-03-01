'use client';

import type { EmotionState } from '@/lib/types';

const DIMENSIONS: { key: keyof EmotionState; label: string; color: string }[] = [
  { key: 'joy', label: 'Joy', color: '#22c55e' },
  { key: 'sadness', label: 'Sadness', color: '#3b82f6' },
  { key: 'anger', label: 'Anger', color: '#ef4444' },
  { key: 'anxiety', label: 'Anxiety', color: '#eab308' },
  { key: 'longing', label: 'Longing', color: '#a855f7' },
  { key: 'trust', label: 'Trust', color: '#06b6d4' },
];

export function EmotionBars({ current, baseline }: { current: EmotionState; baseline?: EmotionState }) {
  return (
    <div className="space-y-2">
      {DIMENSIONS.map(({ key, label, color }) => {
        const val = current[key];
        const base = baseline?.[key];
        return (
          <div key={key}>
            <div className="flex justify-between text-xs mb-0.5">
              <span style={{ color }}>{label}</span>
              <span className="text-[var(--text-muted)]">{val.toFixed(2)}</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--bg)] relative overflow-hidden">
              {base != null && (
                <div
                  className="absolute top-0 h-full opacity-30 rounded-full"
                  style={{ width: `${base * 100}%`, background: color }}
                />
              )}
              <div
                className="absolute top-0 h-full rounded-full transition-all duration-500"
                style={{ width: `${val * 100}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
