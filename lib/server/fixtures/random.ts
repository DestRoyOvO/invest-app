import "server-only";

// Deterministic randomness for the fixture market data (MARKET_DATA_SOURCE=fixtures). Every number comes from a key
// string: the same key gives the same number on every machine, every run and every day, so a test can rely on it.

/** 32-bit FNV-1a hash of a string, unsigned. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** MurmurHash3's finalizer: spreads FNV's weak low bits, so keys that differ in one character get unrelated seeds. */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A 32-bit seed from key parts, e.g. seedOf("AAPL", "2026-11-06"). */
export function seedOf(...parts: ReadonlyArray<string | number>): number {
  return mix32(hash32(parts.join("|")));
}

/** Mulberry32: a small, fast PRNG with a 32-bit state; returns numbers in [0, 1). */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniform number in [0, 1) for a key. */
export function unit(...parts: ReadonlyArray<string | number>): number {
  return prng(seedOf(...parts))();
}

/** A uniform number in [min, max) for a key. */
export function between(min: number, max: number, ...parts: ReadonlyArray<string | number>): number {
  return min + (max - min) * unit(...parts);
}

/** An integer in [0, n) for a key. */
export function pick(n: number, ...parts: ReadonlyArray<string | number>): number {
  return Math.min(n - 1, Math.floor(unit(...parts) * n));
}

/** Box-Muller from two uniforms, clamped to ±4.5 so a single draw never produces an absurd move. */
export function normalFrom(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  const v = next();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-4.5, Math.min(4.5, z));
}

/** A standard normal number for a key. */
export function gaussian(...parts: ReadonlyArray<string | number>): number {
  return normalFrom(prng(seedOf(...parts)));
}

/** Rounds to `digits` decimals (prices to cents, ratios to four places). */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
