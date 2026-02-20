import type { MetroidConfig } from '../../config.js';

/**
 * Embedding service for vector-based memory retrieval.
 * Uses SiliconFlow's embedding API (BAAI/bge-m3) for Chinese+English.
 * Falls back gracefully if embedding API is unavailable.
 */
export class EmbeddingService {
  private model = 'BAAI/bge-m3';
  private dimensions = 1024;

  constructor(private config: MetroidConfig) {}

  /** Generate embedding vector for text. Returns null on failure. */
  async embed(text: string): Promise<Float32Array | null> {
    const baseUrl = this.config.llm.openaiBaseUrl;
    const apiKey = this.config.llm.openaiApiKey || this.config.llm.apiKey;
    if (!baseUrl || !apiKey) return null;

    try {
      const endpoint = baseUrl.replace(/\/+$/, '') + '/embeddings';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text.slice(0, 2000), // bge-m3 supports 8192 tokens
          encoding_format: 'float',
        }),
      });

      if (!resp.ok) return null;
      const result = await resp.json() as any;
      const vec = result.data?.[0]?.embedding;
      if (!Array.isArray(vec)) return null;
      return new Float32Array(vec);
    } catch {
      return null;
    }
  }

  /** Batch embed multiple texts. Returns array aligned with input. */
  async embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) {
      const v = await this.embed(texts[0]);
      return [v];
    }

    const baseUrl = this.config.llm.openaiBaseUrl;
    const apiKey = this.config.llm.openaiApiKey || this.config.llm.apiKey;
    if (!baseUrl || !apiKey) return texts.map(() => null);

    try {
      const endpoint = baseUrl.replace(/\/+$/, '') + '/embeddings';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts.map(t => t.slice(0, 2000)),
          encoding_format: 'float',
        }),
      });

      if (!resp.ok) return texts.map(() => null);
      const result = await resp.json() as any;
      const data = result.data as any[];
      return data.map((d: any) =>
        Array.isArray(d?.embedding) ? new Float32Array(d.embedding) : null
      );
    } catch {
      return texts.map(() => null);
    }
  }

  /** Cosine similarity between two vectors */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Serialize Float32Array to Buffer for SQLite BLOB storage */
  static toBuffer(vec: Float32Array): Buffer {
    return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
  }

  /** Deserialize Buffer from SQLite BLOB to Float32Array */
  static fromBuffer(buf: Buffer): Float32Array {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Float32Array(ab);
  }
}
