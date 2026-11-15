/**
 * shoehive/testing: drive games without sockets. `createTestTable`, a fake clock and
 * exact replay checks (ADR 0006), and the store conformance suite (ADR 0009).
 *
 * @packageDocumentation
 */
export {
  createTestTable,
  TestTable,
  TEST_SEED,
  type RecordedEvent,
  type TestTableOptions,
} from './test-table';
export { FakeClock, FAKE_EPOCH } from './fake-clock';
export { runStoreConformance, type ConformanceRunner } from './store-conformance';
export { runWalletConformance, type WalletFunds } from './wallet-conformance';
