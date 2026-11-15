import { runStoreConformance } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { mapStore, newShelf } from '../src/map-store';

// #region conformance
runStoreConformance(
  () => {
    const shelf = newShelf(); // fresh, empty storage for each test
    return {
      open: () => mapStore(shelf), // called again after close(): must see the old data
      destroy: () => {
        // drop the test's data here (a temp file, a schema, a key prefix)
      },
    };
  },
  { describe, it, expect },
);
// #endregion conformance
