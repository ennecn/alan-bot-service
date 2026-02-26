import type { WIStore } from '../storage/wi-store.js';
import { batchEmbed } from './client.js';
import type { EmbeddingConfig } from './client.js';

const BATCH_SIZE = 32;

/**
 * Backfill embeddings for WI entries that have embedding_status = 'pending'.
 * Processes in batches of 32.
 */
export async function backfillEmbeddings(
  wiStore: WIStore,
  config: EmbeddingConfig,
): Promise<{ processed: number; failed: number }> {
  const pending = wiStore.getPendingEmbeddings();
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const texts = batch.map(e => `${e.keys.join(', ')}: ${e.content}`);
    const embeddings = await batchEmbed(texts, config);

    for (let j = 0; j < batch.length; j++) {
      const embedding = embeddings[j];
      if (embedding) {
        wiStore.updateEmbedding(batch[j].id, embedding);
        processed++;
      } else {
        failed++;
      }
    }
  }

  return { processed, failed };
}
