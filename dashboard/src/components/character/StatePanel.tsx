'use client';

import type { DebugState } from '@/lib/types';
import { EmotionBars } from './EmotionBars';
import { timeAgo } from '@/lib/utils';

export function StatePanel({ state }: { state: DebugState | null }) {
  if (!state) {
    return (
      <div className="p-4 text-sm text-[var(--text-muted)]">
        Connecting to engine...
      </div>
    );
  }

  // Parse impulse from markdown
  const impulseMatch = state.impulse?.match(/value:\s*([\d.]+)/);
  const impulseVal = impulseMatch ? parseFloat(impulseMatch[1]) : null;
  const firedMatch = state.impulse?.match(/fired:\s*(true|false)/);
  const fired = firedMatch?.[1] === 'true';
  const decisionMatch = state.impulse?.match(/decision:\s*(\w+)/);
  const decision = decisionMatch?.[1];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Character Info */}
      {state.card && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Character</h3>
          <div className="text-sm font-medium">{state.card.character_name}</div>
          <div className="text-xs text-[var(--text-muted)]">
            Lang: {state.card.detected_language} | WI: {state.wi.total}
          </div>
        </section>
      )}

      {/* Emotion */}
      {state.emotion && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Emotion</h3>
          <EmotionBars current={state.emotion.current} baseline={state.emotion.baseline} />
          <div className="text-xs text-[var(--text-muted)] mt-1">
            Last: {timeAgo(state.emotion.last_interaction)}
          </div>
        </section>
      )}

      {/* Impulse */}
      {impulseVal != null && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Impulse</h3>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-3 rounded-full bg-[var(--bg)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${impulseVal * 100}%`,
                  background: fired ? 'var(--success)' : 'var(--warning)',
                }}
              />
            </div>
            <span className="text-xs font-mono w-10 text-right">{impulseVal.toFixed(2)}</span>
          </div>
          <div className="flex gap-2 mt-1">
            <span className={`text-xs px-1.5 py-0.5 rounded ${fired ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'}`}>
              {fired ? 'FIRED' : 'HELD'}
            </span>
            {decision && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                {decision}
              </span>
            )}
          </div>
        </section>
      )}

      {/* Models */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Models</h3>
        <div className="space-y-1 text-xs">
          <div>
            <span className="text-[var(--text-muted)]">S1:</span>{' '}
            <span className="font-mono">{state.models.s1.model}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">S2:</span>{' '}
            <span className="font-mono">{state.models.s2.model}</span>
          </div>
        </div>
      </section>

      {/* Preset */}
      {state.preset && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Preset</h3>
          <div className="text-xs font-mono">{state.preset.source_name}</div>
        </section>
      )}

      {/* Session */}
      {state.session && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Session</h3>
          <div className="text-xs text-[var(--text-muted)]">
            {state.session.message_count} messages | {timeAgo(state.session.last_message)}
          </div>
        </section>
      )}

      {/* Uptime */}
      <div className="text-xs text-[var(--text-dim)] pt-2 border-t border-[var(--border)]">
        Agent: {state.agent_id} | Up: {Math.floor(state.uptime_s / 60)}m
      </div>
    </div>
  );
}
