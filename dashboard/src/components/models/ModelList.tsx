'use client';

import type { ModelEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Trash2, Zap } from 'lucide-react';

interface Props {
  role: 's1' | 's2';
  models: ModelEntry[];
  activeId?: string;
  onSetActive: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function ModelList({ role, models, activeId, onSetActive, onDelete, onAdd }: Props) {
  const filtered = models.filter(m => m.role === role);

  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {role === 's1' ? 'System 1 (Fast)' : 'System 2 (Reply)'}
        </h2>
        <button
          onClick={onAdd}
          className="text-xs px-3 py-1 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
        >
          + Add
        </button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-sm text-[var(--text-dim)] py-4">
            No {role.toUpperCase()} models configured.
          </div>
        )}
        {filtered.map((model) => {
          const isActive = model.id === activeId;
          return (
            <div
              key={model.id}
              className={cn(
                'p-3 rounded-lg border transition-colors',
                isActive
                  ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
                  : 'border-[var(--border)] bg-[var(--bg-surface)]',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isActive && <Zap size={14} className="text-[var(--accent)]" />}
                  <span className="text-sm font-medium">{model.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  {!isActive && (
                    <button
                      onClick={() => onSetActive(model.id)}
                      className="text-xs px-2 py-1 rounded text-[var(--accent)] hover:bg-[var(--accent)]/10"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(model.id)}
                    className="p-1 rounded text-[var(--text-dim)] hover:text-[var(--danger)] hover:bg-red-900/20"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1 font-mono">
                {model.model_id}
              </div>
              <div className="text-xs text-[var(--text-dim)] truncate">
                {model.base_url}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
