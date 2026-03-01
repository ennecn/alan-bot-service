'use client';

import { useState, useEffect } from 'react';
import { getCardDetail } from '@/lib/api';
import type { CardDetail as CardDetailType } from '@/lib/types';
import { X } from 'lucide-react';

const TABS = ['Overview', 'IDENTITY', 'SOUL', 'MEMORY'] as const;

interface Props {
  cardId: string;
  onClose: () => void;
}

export function CardDetail({ cardId, onClose }: Props) {
  const [card, setCard] = useState<CardDetailType | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('Overview');

  useEffect(() => {
    getCardDetail(cardId).then(setCard).catch(() => {});
  }, [cardId]);

  if (!card) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-[var(--bg-surface)] rounded-xl p-8 text-sm">Loading...</div>
      </div>
    );
  }

  const renderContent = () => {
    switch (tab) {
      case 'Overview':
        return (
          <div className="space-y-3 text-sm">
            <div><span className="text-[var(--text-muted)]">Name:</span> {card.name}</div>
            <div><span className="text-[var(--text-muted)]">Language:</span> {card.detected_language}</div>
            <div><span className="text-[var(--text-muted)]">WI Entries:</span> {card.wi_count}</div>
            <div><span className="text-[var(--text-muted)]">Imported:</span> {new Date(card.imported_at).toLocaleString()}</div>
            {card.card_data?.system_prompt && (
              <div>
                <div className="text-[var(--text-muted)] mb-1">System Prompt:</div>
                <pre className="text-xs bg-[var(--bg)] rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                  {card.card_data.system_prompt}
                </pre>
              </div>
            )}
          </div>
        );
      case 'IDENTITY':
        return <pre className="text-xs whitespace-pre-wrap">{card.identity ?? 'Not available'}</pre>;
      case 'SOUL':
        return <pre className="text-xs whitespace-pre-wrap">{card.soul ?? 'Not available'}</pre>;
      case 'MEMORY':
        return <pre className="text-xs whitespace-pre-wrap">{card.memory ?? 'Not available'}</pre>;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
      <div className="w-[500px] bg-[var(--bg-surface)] h-full overflow-y-auto border-l border-[var(--border)]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">{card.name}</h2>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-elevated)] rounded">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                tab === t
                  ? 'border-[var(--accent)] text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4">{renderContent()}</div>
      </div>
    </div>
  );
}
