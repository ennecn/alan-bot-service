'use client';

import { useState, useRef, useCallback } from 'react';
import { Send } from 'lucide-react';

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 150)}px`;
  };

  return (
    <div className="border-t border-[var(--border)] p-3">
      <div className="flex items-end gap-2 bg-[var(--bg-elevated)] rounded-xl px-3 py-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent resize-none outline-none text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] max-h-[150px]"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="p-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-30 hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
