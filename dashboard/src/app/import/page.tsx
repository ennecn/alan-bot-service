'use client';

import { useState, useEffect, useCallback } from 'react';
import { DropZone } from '@/components/import/DropZone';
import { ImportResult } from '@/components/import/ImportResult';
import {
  uploadCard, getCards, activateCard,
  uploadPreset, getPresets, activatePreset,
} from '@/lib/api';
import type { CardManifestEntry, PresetManifestEntry } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

type Tab = 'cards' | 'presets';

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>('cards');
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);
  const [cards, setCards] = useState<CardManifestEntry[]>([]);
  const [presets, setPresets] = useState<PresetManifestEntry[]>([]);

  const loadCards = useCallback(async () => {
    try {
      const data = await getCards();
      setCards(data.cards);
    } catch { /* ignore */ }
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      const data = await getPresets();
      setPresets(data.presets);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadCards();
    loadPresets();
  }, [loadCards, loadPresets]);

  const handleCardUpload = async (file: File) => {
    const result = await uploadCard(file);
    setLastResult(result as Record<string, unknown>);
    await loadCards();
  };

  const handlePresetUpload = async (file: File) => {
    const result = await uploadPreset(file);
    setLastResult(result as Record<string, unknown>);
    await loadPresets();
  };

  const handleActivateCard = async (id: string) => {
    await activateCard(id);
    await loadCards();
  };

  const handleActivatePreset = async (id: string) => {
    await activatePreset(id);
    await loadPresets();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-8">
        <h1 className="text-xl font-semibold mb-6">Import</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[var(--bg-surface)] rounded-lg p-1 w-fit">
          {(['cards', 'presets'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setLastResult(null); }}
              className={cn(
                'px-4 py-1.5 rounded-md text-sm transition-colors capitalize',
                tab === t
                  ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Upload Zone */}
        {tab === 'cards' && (
          <DropZone
            accept=".png,.json"
            label="Drop a character card (.png or .json)"
            onUpload={handleCardUpload}
          />
        )}
        {tab === 'presets' && (
          <DropZone
            accept=".json"
            label="Drop a SillyTavern preset (.json)"
            onUpload={handlePresetUpload}
          />
        )}

        {/* Last import result */}
        {lastResult && <ImportResult result={lastResult} />}

        {/* Lists */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Imported {tab}
          </h2>

          {tab === 'cards' && (
            <div className="space-y-2">
              {cards.length === 0 && (
                <div className="text-sm text-[var(--text-dim)]">No cards imported yet.</div>
              )}
              {cards.map((card) => (
                <div
                  key={card.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border',
                    card.active
                      ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
                      : 'border-[var(--border)] bg-[var(--bg-surface)]',
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">{card.name}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {card.detected_language} | WI: {card.wi_count} | {timeAgo(card.imported_at)}
                    </div>
                  </div>
                  {card.active ? (
                    <span className="text-xs text-[var(--success)]">Active</span>
                  ) : (
                    <button
                      onClick={() => handleActivateCard(card.id)}
                      className="text-xs px-3 py-1 rounded bg-[var(--bg-elevated)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                    >
                      Activate
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'presets' && (
            <div className="space-y-2">
              {presets.length === 0 && (
                <div className="text-sm text-[var(--text-dim)]">No presets imported yet.</div>
              )}
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border',
                    preset.active
                      ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
                      : 'border-[var(--border)] bg-[var(--bg-surface)]',
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">{preset.source_name}</div>
                    <div className="text-xs text-[var(--text-muted)]">{timeAgo(preset.imported_at)}</div>
                  </div>
                  {preset.active ? (
                    <span className="text-xs text-[var(--success)]">Active</span>
                  ) : (
                    <button
                      onClick={() => handleActivatePreset(preset.id)}
                      className="text-xs px-3 py-1 rounded bg-[var(--bg-elevated)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                    >
                      Activate
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
