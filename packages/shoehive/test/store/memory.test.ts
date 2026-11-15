import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../src/store/memory';
import { runStoreConformance } from '../../src/testing/index';
import { describeRecovery } from './recovery';

runStoreConformance(() => memoryStore(), { describe, it, expect });

// The memory store survives close() (it is a no-op), so "reopening" returns the same
// object: enough to run the recovery suite in-process.
describeRecovery('memory', () => {
  const store = memoryStore();
  return Promise.resolve({ open: () => store });
});
