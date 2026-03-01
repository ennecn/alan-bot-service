'use client';

import { useState, useEffect } from 'react';
import { getCards, activateCard } from '@/lib/api';
import type { CardManifestEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  onSelectCard?: (id: string) => void;
}

export function CardList({ onSelectCard }: Props) {
  const [cards, setCards] = useState<CardManifestEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getCards();
      setCards(data.cards);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleActivate = async (id: string) => {
    try {
      await activateCard(id);
      await load();
    } catch (err) {
      console.error('Activate failed:', err);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-[var(--text-muted)]">Loading cards...</div>;
  }

  if (cards.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--text-muted)]">
        No cards imported yet. Go to Import to add one.
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider px-2 mb-2">
        Cards
      </h3>
      {cards.map((card) => (
        <div
          key={card.id}
          className={cn(
            'rounded-lg px-3 py-2 cursor-pointer transition-colors text-sm',
            card.active
              ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--text)]'
              : 'hover:bg-[var(--bg-elevated)] text-[var(--text-muted)]',
          )}
        >
          <div
            className="font-medium truncate"
            onClick={() => onSelectCard?.(card.id)}
          >
            {card.name}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px]">{card.detected_language} | WI:{card.wi_count}</span>
            {!card.active && (
              <button
                onClick={(e) => { e.stopPropagation(); handleActivate(card.id); }}
                className="text-[10px] text-[var(--accent)] hover:underline ml-auto"
              >
                Activate
              </button>
            )}
            {card.active && (
              <span className="text-[10px] text-[var(--success)] ml-auto">Active</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
