'use client';

import { Check } from 'lucide-react';

interface Props {
  result: Record<string, unknown>;
}

export function ImportResult({ result }: Props) {
  return (
    <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-4 mt-4">
      <div className="flex items-center gap-2 text-green-400 text-sm mb-2">
        <Check size={16} />
        Import Successful
      </div>
      <div className="text-xs space-y-1 text-[var(--text-muted)]">
        {Object.entries(result).map(([key, value]) => (
          <div key={key}>
            <span className="text-[var(--text-dim)]">{key}:</span>{' '}
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </div>
        ))}
      </div>
    </div>
  );
}
