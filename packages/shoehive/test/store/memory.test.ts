import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../src/store/memory';
import { runStoreConformance } from '../../src/testing/index';

runStoreConformance(() => memoryStore(), { describe, it, expect });
