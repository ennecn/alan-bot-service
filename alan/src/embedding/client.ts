export interface EmbeddingConfig {
  baseUrl: string;
  model?: string;
}

/**
 * Get embedding for a single text query.
 * Returns null if the embedding proxy is unavailable.
 */
export async function getEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[] | null> {
  try {
    const url = `${config.baseUrl.replace(/\/$/, '')}/v1/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        model: config.model ?? 'BAAI/bge-m3',
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
    };

    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Batch embed multiple texts.
 * Returns array of embeddings (null for failures).
 */
export async function batchEmbed(
  texts: string[],
  config: EmbeddingConfig,
): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];

  try {
    const url = `${config.baseUrl.replace(/\/$/, '')}/v1/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: texts,
        model: config.model ?? 'BAAI/bge-m3',
      }),
    });

    if (!response.ok) return texts.map(() => null);

    const data = await response.json() as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };

    if (!data.data) return texts.map(() => null);

    const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map(d => d.embedding ?? null);
  } catch {
    return texts.map(() => null);
  }
}
