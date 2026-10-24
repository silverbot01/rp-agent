export type VectorRow = {
  id: string;
  text: string;
  vector: Float32Array;
};

export function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function rankVectors(query: Float32Array, rows: VectorRow[], limit: number): VectorRow[] {
  return rows
    .map((row) => ({ row, score: cosine(query, row.vector) }))
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, Math.max(0, limit))
    .map((item) => item.row);
}

/** Deterministic stand-in used by the offline mock embedder. */
export function mockVector(text: string, dims = 32): Float32Array {
  const vector = new Float32Array(dims);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const source = tokens.length ? tokens : ["empty"];
  for (const token of source) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dims] += 1;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) vector[i] = (vector[i] ?? 0) / norm;
  return vector;
}

export function vectorToBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

export function bytesToVector(bytes: Uint8Array): Float32Array {
  const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.slice()
    : bytes.slice();
  const aligned = new Uint8Array(copy.byteLength);
  aligned.set(copy);
  return new Float32Array(aligned.buffer);
}
