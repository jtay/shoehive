import { describe, expect, it } from 'vitest';
import { MemoryWallet } from '../../src/core/wallet';
import { runWalletConformance } from '../../src/testing/index';

runWalletConformance((balances) => new MemoryWallet({ balances }), { describe, it, expect });
