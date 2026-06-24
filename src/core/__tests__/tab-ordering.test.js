import { describe, expect, it } from 'vitest';

import { buildOrderedTabIds, buildOverlayTabs, getActiveTab } from '../tab-ordering.js';

describe('getActiveTab', () => {
  it('returns the active tab when it has a numeric id', () => {
    const activeTab = { id: 2, active: true };

    expect(getActiveTab([{ id: 1 }, activeTab])).toBe(activeTab);
  });

  it('returns null when there is no active tab with a numeric id', () => {
    expect(getActiveTab([{ id: 1 }, { active: true }])).toBeNull();
  });
});

describe('buildOrderedTabIds', () => {
  it('orders tabs as active first, MRU-known tabs next, then untracked tabs from the back', () => {
    const tabs = [{ id: 1 }, { id: 2, active: true }, { id: 3 }, { id: 4 }, { id: 5 }];
    const mru = [3, 2, 99, 3, 1];

    expect(buildOrderedTabIds(tabs, mru)).toEqual([2, 3, 1, 5, 4]);
  });

  it('ignores missing MRU ids and duplicate MRU ids', () => {
    const tabs = [{ id: 1, active: true }, { id: 2 }, { id: 3 }];

    expect(buildOrderedTabIds(tabs, [9, 2, 2, 9])).toEqual([1, 2, 3]);
  });

  it('returns an empty ordering when there is no usable active tab', () => {
    expect(buildOrderedTabIds([{ id: 1 }, { id: 2 }], [2])).toEqual([]);
  });
});

describe('buildOverlayTabs', () => {
  it('builds overlay-safe tab summaries in the requested order', () => {
    const tabMap = new Map([
      [
        1,
        {
          id: 1,
          title: '',
          url: 'https://example.com/page',
          favIconUrl: 'http://example.com/icon.png',
        },
      ],
      [
        2,
        {
          id: 2,
          title: 'Docs',
          url: '',
          favIconUrl: 'https://example.com/icon.png',
        },
      ],
    ]);

    expect(buildOverlayTabs([2, 9, 1], tabMap)).toEqual([
      {
        id: 2,
        title: 'Docs',
        url: '',
        favIconUrl: 'https://example.com/icon.png',
      },
      {
        id: 1,
        title: 'https://example.com/page',
        url: 'https://example.com/page',
        favIconUrl: '',
      },
    ]);
  });

  it('falls back to Untitled when both title and URL are empty', () => {
    const tabMap = new Map([[1, { id: 1, title: '', url: '', favIconUrl: '' }]]);

    expect(buildOverlayTabs([1], tabMap)).toEqual([
      {
        id: 1,
        title: 'Untitled',
        url: '',
        favIconUrl: '',
      },
    ]);
  });
});
