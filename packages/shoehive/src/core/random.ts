// Seeded, recorded randomness for game code (ADR 0006).
//
// ctx.random is a ChaCha20 keystream (RFC 8439 block function, 20 rounds) keyed by the
// table's 256-bit seed, with a zero nonce. The stream is consumed as 32-bit words, and
// the "cursor" (number of words consumed so far) is part of the table's engine state,
// so a rolled-back entry consumes nothing.

import { bytesToHex, hexToBytes, sha256 } from './sha256';

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a]! + s[b]!) >>> 0;
  s[d] = rotl(s[d]! ^ s[a], 16) >>> 0;
  s[c] = (s[c]! + s[d]) >>> 0;
  s[b] = rotl(s[b]! ^ s[c], 12) >>> 0;
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 8) >>> 0;
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 7) >>> 0;
}

/**
 * The ChaCha20 block function (RFC 8439 section 2.3). `key` is 8 little-endian words,
 * `nonce` 3 words. Returns 16 output words.
 */
export function chacha20Block(key: Uint32Array, counter: number, nonce: Uint32Array): Uint32Array {
  const input = new Uint32Array(16);
  input.set(SIGMA, 0);
  input.set(key, 4);
  input[12] = counter >>> 0;
  input.set(nonce, 13);
  const s = new Uint32Array(input);
  for (let i = 0; i < 10; i++) {
    quarterRound(s, 0, 4, 8, 12);
    quarterRound(s, 1, 5, 9, 13);
    quarterRound(s, 2, 6, 10, 14);
    quarterRound(s, 3, 7, 11, 15);
    quarterRound(s, 0, 5, 10, 15);
    quarterRound(s, 1, 6, 11, 12);
    quarterRound(s, 2, 7, 8, 13);
    quarterRound(s, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) s[i] = (s[i]! + input[i]!) >>> 0;
  return s;
}

function keyWords(seedHex: string): Uint32Array {
  const bytes = hexToBytes(seedHex);
  const view = new DataView(bytes.buffer);
  const key = new Uint32Array(8);
  for (let i = 0; i < 8; i++) key[i] = view.getUint32(i * 4, true);
  return key;
}

const SEED_HEX = /^[0-9a-f]{64}$/;

/**
 * Normalises a seed. A 64-character lowercase hex string is used as is; anything else
 * (for example `'fixed'` in tests) is hashed with SHA-256 to 256 bits.
 */
export function normalizeSeed(seed: string): string {
  if (SEED_HEX.test(seed)) return seed;
  return bytesToHex(sha256(new TextEncoder().encode(seed)));
}

/** A fresh 256-bit seed from the platform CSPRNG (`globalThis.crypto`). */
export function randomSeed(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** A ChaCha20 word stream with random access by word index. */
export class WordStream {
  private readonly key: Uint32Array;
  private readonly nonce = new Uint32Array(3);
  private cachedBlock = -1;
  private cached: Uint32Array = new Uint32Array(16);

  constructor(seedHex: string) {
    this.key = keyWords(seedHex);
  }

  word(index: number): number {
    const block = Math.floor(index / 16);
    if (block !== this.cachedBlock) {
      this.cached = chacha20Block(this.key, block, this.nonce);
      this.cachedBlock = block;
    }
    return this.cached[index % 16]!;
  }
}

/** Randomness available to game code as `ctx.random` and in `setup`. */
export interface Random {
  /** A uniformly distributed integer in `[0, maxExclusive)`. Unbiased. */
  int(maxExclusive: number): number;
  /** A float in `[0, 1)` with 53 bits of randomness. */
  float(): number;
  /** A new array with the items in uniformly random order (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** One uniformly chosen item. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
}

/**
 * A `Random` reading words from `stream` starting at `cursor()` and advancing it via
 * `advance()`. Every word drawn is passed to `record`.
 */
export function createRandom(source: {
  stream: WordStream;
  cursor: () => number;
  advance: () => void;
  record: (word: number) => void;
}): Random {
  const next = (): number => {
    const w = source.stream.word(source.cursor());
    source.advance();
    source.record(w);
    return w;
  };
  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) {
      throw new RangeError(
        `random.int(): max must be an integer in [1, 2^32], got ${String(maxExclusive)}`,
      );
    }
    if (maxExclusive === 1) return 0;
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    for (;;) {
      const w = next();
      if (w < limit) return w % maxExclusive;
    }
  };
  return {
    int,
    float: () => ((next() >>> 5) * 0x4000000 + (next() >>> 6)) / 0x20000000000000,
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('random.pick(): empty array');
      return items[int(items.length)] as T;
    },
  };
}
