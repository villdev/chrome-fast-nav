import { getSafeFaviconUrl } from './url-safety.js';

export function getActiveTab(tabs) {
  return tabs.find((tab) => tab.active && typeof tab.id === 'number') ?? null;
}

export function buildOrderedTabIds(tabs, mru) {
  const activeTab = getActiveTab(tabs);
  if (!activeTab) return [];

  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const orderedTabIds = [];
  const seen = new Set();

  orderedTabIds.push(activeTab.id);
  seen.add(activeTab.id);

  for (const tabId of mru) {
    if (!tabMap.has(tabId) || seen.has(tabId)) continue;
    orderedTabIds.push(tabId);
    seen.add(tabId);
  }

  for (let i = tabs.length - 1; i >= 0; i -= 1) {
    const tab = tabs[i];
    if (typeof tab.id !== 'number' || seen.has(tab.id)) continue;
    orderedTabIds.push(tab.id);
    seen.add(tab.id);
  }

  return orderedTabIds;
}

export function buildOverlayTabs(orderedTabIds, tabMap) {
  return orderedTabIds
    .map((tabId) => tabMap.get(tabId))
    .filter(Boolean)
    .map((tab) => ({
      id: tab.id,
      title: tab.title || tab.url || 'Untitled',
      url: tab.url || '',
      favIconUrl: getSafeFaviconUrl(tab.favIconUrl),
    }));
}
