import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index';

describe('PROTOCOL_VERSION', () => {
  it('is protocol v1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
