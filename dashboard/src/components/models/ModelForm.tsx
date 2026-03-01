'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  role: 's1' | 's2';
  onSubmit: (data: { label: string; base_url: string; api_key?: string; model_id: string; role: 's1' | 's2' }) => Promise<void>;
  onClose: () => void;
}

export function ModelForm({ role, onSubmit, onClose }: Props) {
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8080');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !baseUrl || !modelId) {
      setError('Label, Base URL, and Model ID are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ label, base_url: baseUrl, api_key: apiKey || undefined, model_id: modelId, role });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add model');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] w-[420px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Add {role.toUpperCase()} Model</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-elevated)] rounded">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Kimi Pro"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Model ID</label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="e.g. claude-opus-4-6"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">API Key (optional)</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Leave empty if proxy handles auth"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>

          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Model'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
