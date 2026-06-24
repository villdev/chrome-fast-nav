const MRU_KEY = 'mruStack';
const MAX_MRU_SIZE = 200;
const NAV_COMMIT_DELAY_MS = 900;
const MODIFIER_RELEASE_GRACE_MS = 750;
const SHOW_OVERLAY_RETRY_MS = 80;
const SHOW_OVERLAY_MAX_ATTEMPTS = 6;

let suppressMruUpdate = false;
let navSession = null;
let nextSessionId = 1;
const modifierState = {
  alt: false,
  pressId: 0,
  lastDownAt: 0,
  lastUpAt: 0,
  lastUpPressId: null,
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

function clearCommitTimer(session = navSession) {
  if (!session?.commitTimer) return;
  clearTimeout(session.commitTimer);
  session.commitTimer = null;
}

function scheduleCommitTimer(session = navSession) {
  clearCommitTimer(session);
  if (!session || navSession !== session) return;

  session.commitTimer = setTimeout(() => {
    if (navSession === session) {
      commitNav().catch(() => {});
    }
  }, NAV_COMMIT_DELAY_MS);
}

function getCommandWindowId(commandTab) {
  if (typeof commandTab?.windowId === 'number') {
    return commandTab.windowId;
  }

  return null;
}

async function getFocusedWindowId() {
  const focusedWindow = await chrome.windows.getLastFocused();
  return focusedWindow.id;
}

async function getWindowState(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const activeTab = tabs.find((tab) => tab.active);

  if (typeof activeTab?.id !== 'number') {
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

function parseIPv4Address(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;

  const bytes = parts.map((part) => {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });

  return bytes.every((byte) => byte !== null) ? bytes : null;
}

function isPrivateIPv4(bytes) {
  const [a, b] = bytes;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isLocalOrPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  const ipv4 = parseIPv4Address(host);
  if (ipv4) {
    return isPrivateIPv4(ipv4);
  }

  if (host.includes(':')) {
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;

    const firstHextet = Number.parseInt(host.split(':')[0], 16);
    if (Number.isFinite(firstHextet)) {
      return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
    }
  }

  return !host.includes('.');
}

function getSafeFaviconUrl(favIconUrl) {
  if (typeof favIconUrl !== 'string' || !favIconUrl) return '';

  try {
    const url = new URL(favIconUrl);

    if (url.protocol === 'data:') {
      return url.href.toLowerCase().startsWith('data:image/') ? favIconUrl : '';
    }

    if (url.protocol !== 'https:') {
      return '';
    }

    return isLocalOrPrivateHostname(url.hostname) ? '' : favIconUrl;
  } catch (_) {
    return '';
  }
}

function buildOverlayTabs(orderedTabIds, tabMap) {
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

async function showOverlay(session = navSession) {
  if (!session || navSession !== session) return;

  const { orderedTabIds, overlayTabId } = session;
  const tabs = await chrome.tabs.query({ windowId: session.windowId });
  if (navSession !== session) return;

  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const overlayTabs = buildOverlayTabs(orderedTabIds, tabMap);
  const selectedIndex = Math.min(session.selectedIndex, Math.max(overlayTabs.length - 1, 0));

  return sendMessageWithRetry(overlayTabId, {
    action: 'showSwitcher',
    sessionId: session.id,
    tabs: overlayTabs,
    selectedIndex,
  });
}

async function closeOverlay(session = navSession) {
  if (!session?.overlayTabId) return;
  await safeSendMessage(session.overlayTabId, {
    action: 'closeSwitcher',
    sessionId: session.id,
  });
}

async function activateSelectedTab() {
  const session = navSession;
  if (!session) return null;

  scheduleCommitTimer(session);
  const overlayShown = await showOverlay(session);

  if (navSession !== session) return null;
  if (overlayShown) {
    clearCommitTimer(session);
  }

  return session.orderedTabIds[session.selectedIndex] ?? null;
}

function didModifierReleaseRace(commandStartedAt, pressId) {
  return (
    modifierState.lastUpPressId === pressId &&
    modifierState.lastUpAt >= commandStartedAt - MODIFIER_RELEASE_GRACE_MS &&
    modifierState.lastUpAt >= modifierState.lastDownAt
  );
}

async function startNavSession(windowId, direction, commandStartedAt) {
  const { activeTab, orderedTabIds } = await getWindowState(windowId);

  if (typeof activeTab?.id !== 'number' || orderedTabIds.length < 2) return;

  const pressId = modifierState.pressId;

  navSession = {
    id: nextSessionId,
    windowId,
    originTabId: activeTab.id,
    orderedTabIds,
    selectedIndex: 0,
    overlayTabId: activeTab.id,
    commitTimer: null,
    pressId,
    isFinalizing: false,
  };
  nextSessionId += 1;

  const session = navSession;
  suppressMruUpdate = true;
  moveSelection(direction);
  await activateSelectedTab();

  if (navSession === session && didModifierReleaseRace(commandStartedAt, pressId)) {
    await commitNav();
  }
}

function moveSelection(direction) {
  if (!navSession) return;

  const len = navSession.orderedTabIds.length;
  if (len < 2) return;

  const delta = direction < 0 ? -1 : 1;
  navSession.selectedIndex = (navSession.selectedIndex + delta + len) % len;
}

async function handleMruNav(direction, commandTab) {
  const commandStartedAt = Date.now();
  let windowId = getCommandWindowId(commandTab);

  if (windowId === null && navSession && !navSession.isFinalizing) {
    windowId = navSession.windowId;
  }

  if (windowId === null) {
    windowId = await getFocusedWindowId();
  }

  if (navSession?.isFinalizing) return;

  const shouldContinueSession = navSession && navSession.windowId === windowId;

  if (!shouldContinueSession) {
    if (navSession) {
      const previousSession = navSession;
      clearCommitTimer(previousSession);
      await closeOverlay(previousSession);
      if (navSession === previousSession) {
        navSession = null;
        suppressMruUpdate = false;
      }
    }
    await startNavSession(windowId, direction, commandStartedAt);
    return;
  }

  moveSelection(direction);
  await activateSelectedTab();
}

async function commitNav() {
  const session = navSession;
  if (!session) return;

  const finalTabId = session.orderedTabIds[session.selectedIndex];
  session.isFinalizing = true;
  clearCommitTimer(session);
  await closeOverlay(session);

  if (navSession !== session) return;
  navSession = null;
  suppressMruUpdate = false;

  if (typeof finalTabId === 'number') {
    await chrome.tabs.update(finalTabId, { active: true }).catch(() => {});
    await pushMru(finalTabId);
  }
}

async function cancelNav() {
  const session = navSession;
  if (!session) return;

  session.isFinalizing = true;
  clearCommitTimer(session);
  await closeOverlay(session);

  if (navSession !== session) return;
  navSession = null;
  suppressMruUpdate = false;
}

async function handleNavbarToggle(commandTab) {
  const windowId = getCommandWindowId(commandTab) ?? (await getFocusedWindowId());
  const win = await chrome.windows.get(windowId);
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

  const session = navSession;
  if (session.isFinalizing) return;

  session.orderedTabIds = session.orderedTabIds.filter((id) => id !== tabId);

  if (!session.orderedTabIds.length || session.orderedTabIds.length === 1) {
    await commitNav();
    return;
  }

  if (session.originTabId === tabId) {
    session.originTabId = session.orderedTabIds[0];
  }

  session.selectedIndex = Math.min(session.selectedIndex, session.orderedTabIds.length - 1);

  if (session.overlayTabId === tabId) {
    await cancelNav();
    return;
  }

  await showOverlay(session);
});

chrome.runtime.onInstalled.addListener(() => {
  seedMru().catch(() => {});
  warmContentScripts().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  seedMru().catch(() => {});
  warmContentScripts().catch(() => {});
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'mru-next') {
    handleMruNav(1, tab).catch(() => {});
    return;
  }

  if (command === 'mru-prev') {
    handleMruNav(-1, tab).catch(() => {});
    return;
  }

  if (command === 'toggle-navbar') {
    handleNavbarToggle(tab).catch(() => {});
  }
});

function isSessionMessage(msg) {
  return Number.isInteger(msg.sessionId);
}

function doesMessageMatchSession(msg) {
  return !isSessionMessage(msg) || (navSession && msg.sessionId === navSession.id);
}

function isModifierEventForSession(sender) {
  return !navSession || sender?.tab?.windowId === navSession.windowId;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'commitNav') {
    if (doesMessageMatchSession(msg)) {
      commitNav().catch(() => {});
    }
  } else if (msg.action === 'cancelNav') {
    if (doesMessageMatchSession(msg)) {
      cancelNav().catch(() => {});
    }
  } else if (msg.action === 'modifierChange' && msg.key === 'Alt') {
    const timestamp = Date.now();
    if (msg.isDown) {
      modifierState.pressId += 1;
      modifierState.alt = true;
      modifierState.lastDownAt = timestamp;
    } else {
      modifierState.alt = false;
      modifierState.lastUpAt = timestamp;
      modifierState.lastUpPressId = modifierState.pressId;

      if (navSession && isModifierEventForSession(sender)) {
        commitNav().catch(() => {});
      }
    }
  } else if (msg.action === 'moveSelection' && Number.isFinite(msg.direction)) {
    if (!doesMessageMatchSession(msg) || !navSession || navSession.isFinalizing) {
      return false;
    }

    moveSelection(msg.direction);
    activateSelectedTab().catch(() => {});
  } else if (msg.action === 'switchToTab' && typeof msg.tabId === 'number') {
    if (!doesMessageMatchSession(msg)) {
      return false;
    }

    if (navSession) {
      const index = navSession.orderedTabIds.indexOf(msg.tabId);
      if (index >= 0) {
        navSession.selectedIndex = index;
      }
    }
    commitNav().catch(() => {});
  }

  return false;
});
