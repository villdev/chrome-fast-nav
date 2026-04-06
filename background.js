const MRU_KEY = 'mruStack';
const MAX_MRU_SIZE = 200;
const NAV_COMMIT_DELAY_MS = 900;
const SHOW_OVERLAY_RETRY_MS = 80;
const SHOW_OVERLAY_MAX_ATTEMPTS = 6;

let suppressMruUpdate = false;
let navSession = null;
const modifierState = {
  alt: false,
  pressId: 0,
};

async function getMru() {
  const data = await chrome.storage.session.get(MRU_KEY);
  return Array.isArray(data[MRU_KEY]) ? data[MRU_KEY] : [];
}

async function setMru(stack) {
  await chrome.storage.session.set({ [MRU_KEY]: stack.slice(0, MAX_MRU_SIZE) });
}

async function pushMru(tabId) {
  if (suppressMruUpdate || typeof tabId !== 'number') return;

  const stack = await getMru();
  await setMru([tabId, ...stack.filter((id) => id !== tabId)]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeSendMessage(tabId, message) {
  if (typeof tabId !== 'number') return;

  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (_) {
    // Some pages cannot host content scripts (chrome://, extension pages, etc).
    return false;
  }
}

async function ensureOverlayInjected(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css'],
    });
  } catch (_) {
    // Ignore; CSS may already be present or page may be restricted.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function sendMessageWithRetry(tabId, message, attempts = SHOW_OVERLAY_MAX_ATTEMPTS) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const delivered = await safeSendMessage(tabId, message);
    if (delivered) return true;
    if (attempt === 0) {
      await ensureOverlayInjected(tabId);
    }
    if (attempt < attempts - 1) {
      await sleep(SHOW_OVERLAY_RETRY_MS);
    }
  }

  return false;
}

function clearCommitTimer() {
  if (!navSession?.commitTimer) return;
  clearTimeout(navSession.commitTimer);
  navSession.commitTimer = null;
}

function scheduleCommitTimer() {
  clearCommitTimer();
  if (!navSession) return;
  navSession.commitTimer = setTimeout(() => {
    commitNav().catch(() => {});
  }, NAV_COMMIT_DELAY_MS);
}

async function getWindowState(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const activeTab = tabs.find((tab) => tab.active);

  if (!activeTab?.id) {
    return { tabs, activeTab: null, orderedTabIds: [] };
  }

  const mru = await getMru();
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

  for (const tab of tabs) {
    if (!seen.has(tab.id)) {
      orderedTabIds.push(tab.id);
      seen.add(tab.id);
    }
  }

  return { tabs, activeTab, orderedTabIds };
}

function buildOverlayTabs(orderedTabIds, tabMap) {
  return orderedTabIds
    .map((tabId) => tabMap.get(tabId))
    .filter(Boolean)
    .map((tab) => ({
      id: tab.id,
      title: tab.title || tab.url || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
    }));
}

async function showOverlay() {
  if (!navSession) return;

  const { orderedTabIds, selectedIndex, overlayTabId } = navSession;
  const tabs = await chrome.tabs.query({ windowId: navSession.windowId });
  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const overlayTabs = buildOverlayTabs(orderedTabIds, tabMap);

  await sendMessageWithRetry(overlayTabId, {
    action: 'showSwitcher',
    tabs: overlayTabs,
    selectedIndex,
  });
}

async function closeOverlay() {
  if (!navSession?.overlayTabId) return;
  await safeSendMessage(navSession.overlayTabId, { action: 'closeSwitcher' });
}

async function activateSelectedTab() {
  if (!navSession) return null;

  scheduleCommitTimer();
  await showOverlay();

  return navSession.orderedTabIds[navSession.selectedIndex] ?? null;
}

async function startNavSession(direction) {
  const currentWindow = await chrome.windows.getCurrent();
  const { activeTab, orderedTabIds } = await getWindowState(currentWindow.id);

  if (!activeTab?.id || orderedTabIds.length < 2) return;

  navSession = {
    windowId: currentWindow.id,
    originTabId: activeTab.id,
    orderedTabIds,
    selectedIndex: 0,
    overlayTabId: activeTab.id,
    commitTimer: null,
    pressId: modifierState.pressId,
  };

  suppressMruUpdate = true;
  moveSelection(direction);
  await activateSelectedTab();
}

function moveSelection(direction) {
  if (!navSession) return;

  const len = navSession.orderedTabIds.length;
  if (len < 2) return;

  const delta = direction < 0 ? -1 : 1;
  let nextIndex = navSession.selectedIndex + delta;

  if (nextIndex <= 0) {
    nextIndex = len - 1;
  } else if (nextIndex >= len) {
    nextIndex = 1;
  }

  navSession.selectedIndex = nextIndex;
}

async function handleMruNav(direction) {
  const currentWindow = await chrome.windows.getCurrent();
  const shouldContinueSession =
    navSession &&
    navSession.windowId === currentWindow.id &&
    modifierState.alt &&
    navSession.pressId === modifierState.pressId;

  if (!shouldContinueSession) {
    if (navSession) {
      clearCommitTimer();
      await closeOverlay();
      navSession = null;
      suppressMruUpdate = false;
    }
    await startNavSession(direction);
    return;
  }

  moveSelection(direction);
  await activateSelectedTab();
}

async function commitNav() {
  if (!navSession) return;

  const finalTabId = navSession.orderedTabIds[navSession.selectedIndex];
  clearCommitTimer();
  await closeOverlay();

  navSession = null;
  suppressMruUpdate = false;

  if (typeof finalTabId === 'number') {
    await chrome.tabs.update(finalTabId, { active: true }).catch(() => {});
    await pushMru(finalTabId);
  }
}

async function cancelNav() {
  if (!navSession) return;

  clearCommitTimer();
  await closeOverlay();

  navSession = null;
  suppressMruUpdate = false;
}

async function handleNavbarToggle() {
  const win = await chrome.windows.getCurrent();
  const newState = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
  await chrome.windows.update(win.id, { state: newState });
}

async function seedMru() {
  const tabs = await chrome.tabs.query({});
  const current = await getMru();
  const merged = [...current];
  const seen = new Set(current);

  for (const tab of tabs) {
    if (!seen.has(tab.id)) {
      merged.push(tab.id);
      seen.add(tab.id);
    }
  }

  await setMru(merged);
}

async function warmContentScripts() {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs
      .map((tab) => tab.id)
      .filter((tabId) => typeof tabId === 'number')
      .map((tabId) => ensureOverlayInjected(tabId).catch(() => false))
  );
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  pushMru(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stack = await getMru();
  await setMru(stack.filter((id) => id !== tabId));

  if (!navSession) return;

  navSession.orderedTabIds = navSession.orderedTabIds.filter((id) => id !== tabId);

  if (!navSession.orderedTabIds.length || navSession.orderedTabIds.length === 1) {
    await commitNav();
    return;
  }

  if (navSession.originTabId === tabId) {
    navSession.originTabId = navSession.orderedTabIds[0];
  }

  const nextIndex = Math.min(navSession.selectedIndex, navSession.orderedTabIds.length - 1);
  navSession.selectedIndex = Math.max(1, nextIndex);

  if (navSession.overlayTabId === tabId) {
    await cancelNav();
    return;
  }

  await showOverlay();
});

chrome.runtime.onInstalled.addListener(() => {
  seedMru().catch(() => {});
  warmContentScripts().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  seedMru().catch(() => {});
  warmContentScripts().catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'mru-next') {
    handleMruNav(1).catch(() => {});
    return;
  }

  if (command === 'mru-prev') {
    handleMruNav(-1).catch(() => {});
    return;
  }

  if (command === 'toggle-navbar') {
    handleNavbarToggle().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'commitNav') {
    commitNav().catch(() => {});
  } else if (msg.action === 'cancelNav') {
    cancelNav().catch(() => {});
  } else if (msg.action === 'modifierChange' && msg.key === 'Alt') {
    if (msg.isDown) {
      modifierState.pressId += 1;
      modifierState.alt = true;
    } else {
      modifierState.alt = false;
      if (navSession) {
        commitNav().catch(() => {});
      }
    }
  } else if (msg.action === 'switchToTab' && typeof msg.tabId === 'number') {
    if (navSession) {
      const index = navSession.orderedTabIds.indexOf(msg.tabId);
      if (index > 0) {
        navSession.selectedIndex = index;
      }
    }
    commitNav().catch(() => {});
  }

  return false;
});
