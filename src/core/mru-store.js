export const MAX_MRU_SIZE = 200;

export function pushTabIdToMru(stack, tabId, maxSize = MAX_MRU_SIZE) {
  if (typeof tabId !== 'number') return stack.slice(0, maxSize);
  return [tabId, ...stack.filter((id) => id !== tabId)].slice(0, maxSize);
}

export function removeTabIdFromMru(stack, tabId, maxSize = MAX_MRU_SIZE) {
  return stack.filter((id) => id !== tabId).slice(0, maxSize);
}

export function insertTabIdAfter(stack, tabId, anchorTabId, maxSize = MAX_MRU_SIZE) {
  if (typeof tabId !== 'number' || maxSize <= 0) return stack.slice(0, maxSize);
  const nextStack = stack.filter((id) => id !== tabId);
  const anchorIndex = nextStack.indexOf(anchorTabId);

  if (anchorIndex < 0 || anchorIndex + 1 >= maxSize) {
    return pushTabIdToMru(nextStack, tabId, maxSize);
  }

  const insertionIndex = anchorIndex + 1;
  nextStack.splice(insertionIndex, 0, tabId);
  return nextStack.slice(0, maxSize);
}

export function seedMruStack(currentStack, tabs, maxSize = MAX_MRU_SIZE) {
  const merged = currentStack.slice(0, maxSize);
  const seen = new Set(merged);

  for (let i = tabs.length - 1; i >= 0; i -= 1) {
    const tabId = tabs[i].id;
    if (typeof tabId !== 'number' || seen.has(tabId)) continue;

    merged.push(tabId);
    seen.add(tabId);

    if (merged.length >= maxSize) break;
  }

  return merged;
}
