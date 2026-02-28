import { LRUCache } from './cache.js';

const SILICONFLOW_URL = 'https://api.siliconflow.cn/v1/embeddings';
const MODEL = 'Qwen/Qwen3-Embedding-4B';
const MAX_CONCURRENT = 10;
const BATCH_CHUNK_SIZE = 20;
const CACHE_MAX = 10_000;

const cache = new LRUCache<number[]>(CACHE_MAX);

// Simple semaphore for concurrency limiting
let inflight = 0;
const waitQueue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inflight < MAX_CONCURRENT) {
    inflight++;
    return;
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      inflight++;
      resolve();
    });
  });
}

function release(): void {
  inflight--;
  const next = waitQueue.shift();
  if (next) next();
}

function getApiKey(): string {
  const key = process.env.SILICONFLOW_API_KEY;
  if (!key) throw new Error('SILICONFLOW_API_KEY not set');
  return key;
}

interface SiliconFlowResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

async function callSiliconFlow(texts: string[]): Promise<number[][]> {
  await acquire();
  try {
    const res = await fetch(SILICONFLOW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({ model: MODEL, input: texts }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SiliconFlow ${res.status}: ${body}`);
    }
    const json = (await res.json()) as SiliconFlowResponse;
    // Sort by index to match input order
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  } finally {
    release();
  }
}

export async function embedSingle(text: string): Promise<number[]> {
  const cached = cache.get(text);
  if (cached) return cached;

  const [embedding] = await callSiliconFlow([text]);
  cache.set(text, embedding);
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // Check cache first, collect misses
  const results: (number[] | null)[] = texts.map((t) => cache.get(t) ?? null);
  const misses: Array<{ index: number; text: string }> = [];
  for (let i = 0; i < texts.length; i++) {
    if (results[i] === null) {
      misses.push({ index: i, text: texts[i] });
    }
  }

  if (misses.length === 0) return results as number[][];

  // Split misses into chunks of BATCH_CHUNK_SIZE
  for (let i = 0; i < misses.length; i += BATCH_CHUNK_SIZE) {
    const chunk = misses.slice(i, i + BATCH_CHUNK_SIZE);
    const embeddings = await callSiliconFlow(chunk.map((m) => m.text));
    for (let j = 0; j < chunk.length; j++) {
      results[chunk[j].index] = embeddings[j];
      cache.set(chunk[j].text, embeddings[j]);
    }
  }

  return results as number[][];
}

export function cacheSize(): number {
  return cache.size;
}
