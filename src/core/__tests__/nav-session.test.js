import { describe, expect, it } from 'vitest';

import {
  didModifierReleaseRace,
  getNextSelectionIndex,
  getSessionTabRemovalUpdate,
} from '../nav-session.js';

describe('getNextSelectionIndex', () => {
  it('cycles forward and wraps to the first item', () => {
    expect(getNextSelectionIndex(0, 1, 3)).toBe(1);
    expect(getNextSelectionIndex(2, 1, 3)).toBe(0);
  });

  it('cycles backward and wraps to the last item', () => {
    expect(getNextSelectionIndex(2, -1, 3)).toBe(1);
    expect(getNextSelectionIndex(0, -1, 3)).toBe(2);
  });

  it('treats zero direction as forward movement, matching command handling', () => {
    expect(getNextSelectionIndex(0, 0, 3)).toBe(1);
  });

  it('does not move when fewer than two tabs are available', () => {
    expect(getNextSelectionIndex(3, 1, 1)).toBe(3);
  });
});

describe('didModifierReleaseRace', () => {
  const graceMs = 750;

  it('detects a matching release that landed inside the race grace window', () => {
    const modifierState = {
      lastDownAt: 1_000,
      lastUpAt: 1_200,
      lastUpPressId: 7,
    };

    expect(didModifierReleaseRace(modifierState, 1_800, 7, graceMs)).toBe(true);
  });

  it('ignores releases from older presses', () => {
    const modifierState = {
      lastDownAt: 1_000,
      lastUpAt: 1_200,
      lastUpPressId: 6,
    };

    expect(didModifierReleaseRace(modifierState, 1_800, 7, graceMs)).toBe(false);
  });

  it('ignores releases outside the grace window', () => {
    const modifierState = {
      lastDownAt: 1_000,
      lastUpAt: 1_000,
      lastUpPressId: 7,
    };

    expect(didModifierReleaseRace(modifierState, 2_000, 7, graceMs)).toBe(false);
  });

  it('ignores releases that happened before the latest modifier down event', () => {
    const modifierState = {
      lastDownAt: 1_500,
      lastUpAt: 1_200,
      lastUpPressId: 7,
    };

    expect(didModifierReleaseRace(modifierState, 1_800, 7, graceMs)).toBe(false);
  });
});

describe('getSessionTabRemovalUpdate', () => {
  const baseSession = {
    originTabId: 10,
    overlayTabId: 10,
    orderedTabIds: [10, 20, 30],
    selectedIndex: 2,
  };

  it('prunes removed tabs, clamps selection, and keeps the session visible', () => {
    expect(getSessionTabRemovalUpdate(baseSession, 20)).toEqual({
      action: 'showOverlay',
      orderedTabIds: [10, 30],
      selectedIndex: 1,
      originTabId: 10,
    });
  });

  it('updates the origin tab when the origin is removed', () => {
    const session = {
      ...baseSession,
      overlayTabId: 30,
      selectedIndex: 1,
    };

    expect(getSessionTabRemovalUpdate(session, 10)).toEqual({
      action: 'showOverlay',
      orderedTabIds: [20, 30],
      selectedIndex: 1,
      originTabId: 20,
    });
  });

  it('requests cancellation when the overlay tab disappears and enough tabs remain', () => {
    const session = {
      ...baseSession,
      overlayTabId: 20,
      orderedTabIds: [10, 20, 30, 40],
      selectedIndex: 2,
    };

    expect(getSessionTabRemovalUpdate(session, 20)).toEqual({
      action: 'cancel',
      orderedTabIds: [10, 30, 40],
      selectedIndex: 2,
      originTabId: 10,
    });
  });

  it('requests commit when only one tab remains', () => {
    const session = {
      ...baseSession,
      orderedTabIds: [10, 20],
      selectedIndex: 1,
    };

    expect(getSessionTabRemovalUpdate(session, 20)).toEqual({
      action: 'commit',
      orderedTabIds: [10],
      selectedIndex: 0,
      originTabId: 10,
    });
  });
});
