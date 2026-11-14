import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyPatch, diff } from '../../src/core/diff';
import { findNonJson, jsonEqual, type Json } from '../../src/core/json';
import { chacha20Block, createRandom, normalizeSeed, WordStream } from '../../src/core/random';
import { bytesToHex, sha256 } from '../../src/core/sha256';
import { PROTOCOL_VERSION } from '../../src/index';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('sha256', () => {
  it('matches FIPS 180-4 test vectors', () => {
    expect(bytesToHex(sha256(utf8('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(bytesToHex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      bytesToHex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('chacha20Block', () => {
  it('matches the RFC 8439 section 2.3.2 test vector', () => {
    const key = new Uint32Array(8);
    for (let i = 0; i < 8; i++) {
      key[i] = (4 * i) | ((4 * i + 1) << 8) | ((4 * i + 2) << 16) | ((4 * i + 3) << 24);
    }
    const nonce = new Uint32Array([0x09000000, 0x4a000000, 0x00000000]);
    const out = Array.from(chacha20Block(key, 1, nonce), (w) => w.toString(16).padStart(8, '0'));
    expect(out).toEqual([
      'e4e7f110',
      '15593bd1',
      '1fdd0f50',
      'c47120a3',
      'c7f4d1c7',
      '0368c033',
      '9aaa2204',
      '4e6cd4c3',
      '466482d2',
      '09aa9f07',
      '05d7c214',
      'a2028bd9',
      'd19c12b5',
      'b94e16de',
      'e883d0cb',
      '4e3c50a2',
    ]);
  });
});

function randomFrom(seed: string) {
  const stream = new WordStream(normalizeSeed(seed));
  let cursor = 0;
  const draws: number[] = [];
  const random = createRandom({
    stream,
    cursor: () => cursor,
    advance: () => {
      cursor += 1;
    },
    record: (w) => draws.push(w),
  });
  return { random, draws, cursor: () => cursor };
}

describe('Random', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = randomFrom('fixed').random.shuffle([...Array(52).keys()]);
    const b = randomFrom('fixed').random.shuffle([...Array(52).keys()]);
    const c = randomFrom('other').random.shuffle([...Array(52).keys()]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect([...a].sort((x, y) => x - y)).toEqual([...Array(52).keys()]);
  });

  it('records every word it draws', () => {
    const { random, draws, cursor } = randomFrom('fixed');
    random.int(6);
    random.float();
    expect(draws.length).toBe(cursor());
    expect(cursor()).toBeGreaterThanOrEqual(3);
  });

  it('int() stays in range and is roughly uniform', () => {
    const { random } = randomFrom('dist');
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const n = random.int(6);
      counts[n] = (counts[n] ?? 0) + 1;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });

  it('float() is in [0, 1)', () => {
    const { random } = randomFrom('float');
    for (let i = 0; i < 1000; i++) {
      const f = random.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('rejects bad arguments', () => {
    const { random } = randomFrom('x');
    expect(() => random.int(0)).toThrow(RangeError);
    expect(() => random.int(1.5)).toThrow(RangeError);
    expect(() => random.pick([])).toThrow(RangeError);
  });
});

describe('diff and applyPatch', () => {
  it('round-trips arbitrary JSON (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        const ops = diff(a as Json, b as Json);
        expect(jsonEqual(applyPatch(a as Json, ops), b)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips small edits to a shared base (property)', () => {
    const base = fc.dictionary(fc.string({ maxLength: 3 }), fc.jsonValue({ maxDepth: 3 }));
    fc.assert(
      fc.property(
        base,
        fc.string({ maxLength: 3 }),
        fc.jsonValue({ maxDepth: 2 }),
        (a, key, value) => {
          const b = { ...a, [key]: value };
          expect(jsonEqual(applyPatch(a as Json, diff(a as Json, b as Json)), b)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('emits nothing for identical references and minimal ops for a change', () => {
    const shared = { deep: { list: [1, 2, 3] } };
    expect(diff({ a: shared, n: 1 }, { a: shared, n: 1 })).toEqual([]);
    expect(diff({ a: shared, n: 1 }, { a: shared, n: 2 })).toEqual([
      { op: 'replace', path: '/n', value: 2 },
    ]);
    expect(diff({ 'a/b~c': 1 }, {})).toEqual([{ op: 'remove', path: '/a~1b~0c' }]);
  });

  it('treats "__proto__" as an ordinary key (regression, found by the property test)', () => {
    const to = JSON.parse('{"__proto__":false,"a":{"__proto__":{"x":1}}}') as Json;
    const patched = applyPatch({ a: {} }, diff({ a: {} }, to));
    expect(jsonEqual(patched, to)).toBe(true);
    expect(Object.getPrototypeOf(patched)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const doc = { a: [1, 2] } as Json;
    applyPatch(doc, [{ op: 'add', path: '/a/-', value: 3 }]);
    expect(doc).toEqual({ a: [1, 2] });
  });
});

describe('findNonJson', () => {
  it('names the offending path', () => {
    expect(findNonJson({ a: [1, { b: new Map() }] })).toEqual({
      path: '/a/1/b',
      reason: 'instance of Map (only plain objects are allowed)',
    });
    expect(findNonJson({ n: NaN })?.path).toBe('/n');
    expect(findNonJson([1, undefined])?.path).toBe('/1');
    expect(findNonJson({ ok: [1, 'x', null, { y: true }] })).toBeNull();
  });
});

describe('PROTOCOL_VERSION', () => {
  it('is protocol v1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
