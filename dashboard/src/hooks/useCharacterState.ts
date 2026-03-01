'use client';

import { useState, useEffect, useCallback } from 'react';
import { getDebugState } from '@/lib/api';
import type { DebugState } from '@/lib/types';

export function useCharacterState(intervalMs = 3000) {
  const [state, setState] = useState<DebugState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getDebugState();
      setState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch state');
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { state, error, refresh };
}
