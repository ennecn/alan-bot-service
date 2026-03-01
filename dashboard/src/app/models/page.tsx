'use client';

import { useState, useEffect, useCallback } from 'react';
import { ModelList } from '@/components/models/ModelList';
import { ModelForm } from '@/components/models/ModelForm';
import { getModels, addModel, setActiveModel, deleteModel } from '@/lib/api';
import type { ModelEntry, ModelRegistry } from '@/lib/types';

export default function ModelsPage() {
  const [registry, setRegistry] = useState<ModelRegistry>({ models: [], active: {} });
  const [showForm, setShowForm] = useState<'s1' | 's2' | null>(null);

  const load = useCallback(async () => {
    try {
      setRegistry(await getModels());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (data: Parameters<typeof addModel>[0]) => {
    await addModel(data);
    await load();
  };

  const handleSetActive = async (role: 's1' | 's2', id: string) => {
    await setActiveModel(role, id);
    await load();
  };

  const handleDelete = async (id: string) => {
    await deleteModel(id);
    await load();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-xl font-semibold mb-6">Model Management</h1>

        {/* Current active display */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-4 mb-6">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
            Currently Active
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--text-muted)]">S1:</span>{' '}
              {registry.active.s1 ? (
                <span className="font-mono">
                  {registry.models.find(m => m.id === registry.active.s1)?.label ?? registry.active.s1}
                </span>
              ) : (
                <span className="text-[var(--text-dim)]">Using env default</span>
              )}
            </div>
            <div>
              <span className="text-[var(--text-muted)]">S2:</span>{' '}
              {registry.active.s2 ? (
                <span className="font-mono">
                  {registry.models.find(m => m.id === registry.active.s2)?.label ?? registry.active.s2}
                </span>
              ) : (
                <span className="text-[var(--text-dim)]">Using env default</span>
              )}
            </div>
          </div>
        </div>

        {/* Dual-column model lists */}
        <div className="flex gap-6">
          <ModelList
            role="s1"
            models={registry.models}
            activeId={registry.active.s1}
            onSetActive={(id) => handleSetActive('s1', id)}
            onDelete={handleDelete}
            onAdd={() => setShowForm('s1')}
          />
          <ModelList
            role="s2"
            models={registry.models}
            activeId={registry.active.s2}
            onSetActive={(id) => handleSetActive('s2', id)}
            onDelete={handleDelete}
            onAdd={() => setShowForm('s2')}
          />
        </div>

        {/* Add Model Dialog */}
        {showForm && (
          <ModelForm
            role={showForm}
            onSubmit={handleAdd}
            onClose={() => setShowForm(null)}
          />
        )}
      </div>
    </div>
  );
}
