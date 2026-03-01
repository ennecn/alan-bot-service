'use client';

import { useState } from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { StatePanel } from '@/components/character/StatePanel';
import { CardList } from '@/components/character/CardList';
import { CardDetail } from '@/components/character/CardDetail';
import { useCharacterState } from '@/hooks/useCharacterState';

export default function ChatPage() {
  const { state } = useCharacterState(3000);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      {/* Left — Card List */}
      <div className="w-[240px] border-r border-[var(--border)] overflow-y-auto bg-[var(--bg-surface)]">
        <CardList onSelectCard={setSelectedCardId} />
      </div>

      {/* Center — Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-2 border-b border-[var(--border)] text-sm font-medium bg-[var(--bg-surface)]">
          {state?.card?.character_name ?? 'Alan Chat'}
        </div>
        <ChatPanel />
      </div>

      {/* Right — State Panel */}
      <div className="w-[280px] border-l border-[var(--border)] bg-[var(--bg-surface)]">
        <StatePanel state={state} />
      </div>

      {/* Card Detail Drawer */}
      {selectedCardId && (
        <CardDetail cardId={selectedCardId} onClose={() => setSelectedCardId(null)} />
      )}
    </div>
  );
}
