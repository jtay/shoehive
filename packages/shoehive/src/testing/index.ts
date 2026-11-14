/**
 * shoehive/testing: drive games without sockets. `createTestTable`, a fake clock and
 * exact replay checks (ADR 0006). The store conformance suite lands in Phase 2.
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
