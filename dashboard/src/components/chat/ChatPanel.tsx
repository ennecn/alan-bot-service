'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { streamChat, getChatHistory } from '@/lib/api';
import type { ChatMessage } from '@/lib/types';

interface LocalMessage {
  role: string;
  content: string;
  timestamp?: string;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load recent history on mount
  useEffect(() => {
    getChatHistory(undefined, 30).then(({ messages: history }) => {
      // Reverse because API returns DESC order
      setMessages(
        history.reverse().map((m: ChatMessage) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
      );
    }).catch(() => {});
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async (text: string) => {
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }]);
    setStreaming(true);

    // Stream response
    let accumulated = '';
    const assistantIdx = messages.length + 1; // Position of assistant message

    setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }]);

    try {
      for await (const chunk of streamChat(text)) {
        accumulated += chunk;
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: accumulated };
          }
          return updated;
        });
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: accumulated || `Error: ${err instanceof Error ? err.message : 'Stream failed'}`,
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
            Send a message to start chatting
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} timestamp={msg.timestamp} />
        ))}
        {streaming && (
          <div className="px-4 py-1">
            <span className="text-xs text-[var(--text-muted)] animate-pulse">Generating...</span>
          </div>
        )}
      </div>
      <ChatInput onSend={handleSend} disabled={streaming} />
    </div>
  );
}
