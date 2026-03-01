'use client';

import { cn } from '@/lib/utils';

interface Props {
  role: string;
  content: string;
  timestamp?: string;
}

export function MessageBubble({ role, content, timestamp }: Props) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex gap-2 px-4 py-2', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[70%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words',
          isUser
            ? 'bg-[var(--accent)] text-white rounded-br-sm'
            : 'bg-[var(--bg-elevated)] text-[var(--text)] rounded-bl-sm',
        )}
      >
        {content}
        {timestamp && (
          <div className={cn('text-[10px] mt-1', isUser ? 'text-blue-200' : 'text-[var(--text-dim)]')}>
            {new Date(timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
