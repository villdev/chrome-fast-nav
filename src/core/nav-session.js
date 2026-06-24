export function getNextSelectionIndex(selectedIndex, direction, itemCount) {
  if (itemCount < 2) return selectedIndex;

  const delta = direction < 0 ? -1 : 1;
  return (selectedIndex + delta + itemCount) % itemCount;
}

export function didModifierReleaseRace(modifierState, commandStartedAt, pressId, graceMs) {
  return (
    modifierState.lastUpPressId === pressId &&
    modifierState.lastUpAt >= commandStartedAt - graceMs &&
    modifierState.lastUpAt >= modifierState.lastDownAt
  );
}

export function getSessionTabRemovalUpdate(session, removedTabId) {
  const orderedTabIds = session.orderedTabIds.filter((id) => id !== removedTabId);
  const selectedIndex = Math.min(session.selectedIndex, Math.max(orderedTabIds.length - 1, 0));

  if (orderedTabIds.length <= 1) {
    return {
      action: 'commit',
      orderedTabIds,
      selectedIndex,
    };
  }

  if (session.overlayTabId === removedTabId) {
    return {
      action: 'cancel',
      orderedTabIds,
      selectedIndex,
    };
  }

  return {
    action: 'showOverlay',
    orderedTabIds,
    selectedIndex,
  };
}
