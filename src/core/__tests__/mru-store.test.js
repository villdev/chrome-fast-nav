import { describe, expect, it } from 'vitest';

import { MAX_MRU_SIZE, pushTabIdToMru, removeTabIdFromMru, seedMruStack } from '../mru-store.js';

describe('pushTabIdToMru', () => {
  it('adds a new tab id to the front', () => {
    expect(pushTabIdToMru([3, 2, 1], 4)).toEqual([4, 3, 2, 1]);
  });

  it('moves an existing tab id to the front without duplicates', () => {
    expect(pushTabIdToMru([3, 2, 1], 2)).toEqual([2, 3, 1]);
  });

  it('caps the stack at the requested size', () => {
    expect(pushTabIdToMru([3, 2, 1], 4, 3)).toEqual([4, 3, 2]);
  });

  it('leaves non-number tab ids out of the update path', () => {
    expect(pushTabIdToMru([3, 2, 1], '4', 2)).toEqual([3, 2]);
  });
});

describe('removeTabIdFromMru', () => {
  it('removes matching tab ids and preserves the rest', () => {
    expect(removeTabIdFromMru([5, 3, 5, 2], 5)).toEqual([3, 2]);
  });

  it('caps the remaining stack', () => {
    expect(removeTabIdFromMru([5, 4, 3, 2, 1], 9, 3)).toEqual([5, 4, 3]);
  });
});

describe('seedMruStack', () => {
  it('preserves existing MRU ids and appends missing tabs from the back of the tab strip', () => {
    const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

    expect(seedMruStack([2], tabs)).toEqual([2, 4, 3, 1]);
  });

  it('skips duplicate, missing, and non-number tab ids while seeding', () => {
    const tabs = [{ id: 1 }, {}, { id: 2 }, { id: 1 }, { id: '3' }];

    expect(seedMruStack([2], tabs)).toEqual([2, 1]);
  });

  it('does not grow beyond the maximum MRU size', () => {
    const tabs = Array.from({ length: MAX_MRU_SIZE + 10 }, (_, index) => ({ id: index + 1 }));

    expect(seedMruStack([], tabs)).toHaveLength(MAX_MRU_SIZE);
  });
});
