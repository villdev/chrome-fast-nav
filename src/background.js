import {
  insertTabIdAfter,
  MAX_MRU_SIZE,
  pushTabIdToMru,
  removeTabIdFromMru,
  seedMruStack,
} from './core/mru-store.js';
import {
  didModifierReleaseRace as didModifierReleaseRaceForState,
  getNextSelectionIndex,
  getSessionTabRemovalUpdate,
} from './core/nav-session.js';
import { buildOrderedTabIds, buildOverlayTabs, getActiveTab } from './core/tab-ordering.js';

const MRU_KEY = 'mruStack';
const NAV_COMMIT_DELAY_MS = 900;
const MODIFIER_RELEASE_GRACE_MS = 750;
const SHOW_OVERLAY_RETRY_MS = 80;
const SHOW_OVERLAY_MAX_ATTEMPTS = 6;

let suppressMruUpdate = false;
let navSession = null;
let nextSessionId = 1;
let historyMutationQueue = Promise.resolve();
let mruCache = null;
let mruLoadPromise = null;
const createdTabBatches = new Map();
const modifierState = {
  pressId: 0,
  lastDownAt: 0,
  lastUpAt: 0,
  lastUpPressId: null,
};

function enqueueHistoryMutation(mutation) {
  const result = historyMutationQueue.then(mutation);
  historyMutationQueue = result.catch(() => {});
  return result;
}

async function getMru() {
  if (mruCache) return mruCache;

  if (!mruLoadPromise) {
    mruLoadPromise = chrome.storage.session
      .get(MRU_KEY)
      .then((data) => {
        mruCache = Array.isArray(data[MRU_KEY]) ? data[MRU_KEY].slice(0, MAX_MRU_SIZE) : [];
        return mruCache;
      })
      .finally(() => {
        mruLoadPromise = null;
      });
  }

  return mruLoadPromise;
}

async function setMru(stack) {
  const nextStack = stack.slice(0, MAX_MRU_SIZE);
  await chrome.storage.session.set({ [MRU_KEY]: nextStack });
  mruCache = nextStack;
}

async function mutateMru(mutation) {
  await enqueueHistoryMutation(async () => {
    const stack = await getMru();
    await setMru(await mutation(stack));
  });
}

async function pushMru(tabId) {
  if (suppressMruUpdate || typeof tabId !== 'number') return;

  await mutateMru((stack) => pushTabIdToMru(stack, tabId));
}

function removeTabFromCreationBatches(tabId) {
  for (const [windowId, batch] of createdTabBatches) {
    if (batch.openerTabId === tabId) {
      createdTabBatches.delete(windowId);
      continue;
    }

    batch.tabIds = batch.tabIds.filter((id) => id !== tabId);
    if (batch.tabIds.length === 0) {
      createdTabBatches.delete(windowId);
    }
  }
}

async function insertCreatedTab(tab) {
  if (typeof tab.id !== 'number') return;

  if (tab.active) {
    createdTabBatches.delete(tab.windowId);
    await pushMru(tab.id);
    return;
  }

  await mutateMru(async (stack) => {
    let openerTabId = tab.openerTabId;

    if (typeof openerTabId !== 'number' && typeof tab.windowId === 'number') {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        windowId: tab.windowId,
      });
      openerTabId = activeTab?.id;
    }

    if (typeof openerTabId !== 'number') {
      return pushTabIdToMru(stack, tab.id);
    }

    let batch = createdTabBatches.get(tab.windowId);
    if (!batch || batch.openerTabId !== openerTabId) {
      batch = { openerTabId, tabIds: [] };
    }

    const anchorTabId = batch.tabIds.at(-1) ?? openerTabId;
    batch.tabIds.push(tab.id);
    batch.tabIds = batch.tabIds.slice(-MAX_MRU_SIZE);
    createdTabBatches.set(tab.windowId, batch);

    return insertTabIdAfter(stack, tab.id, anchorTabId);
  });
}

async function removeTabFromHistory(tabId) {
  removeTabFromCreationBatches(tabId);
  await mutateMru((stack) => removeTabIdFromMru(stack, tabId));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeSendMessage(tabId, message) {
  if (typeof tabId !== 'number') return;

  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // Some pages cannot host content scripts (chrome://, extension pages, etc).
    return false;
  }
}

async function ensureOverlayInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content.js'],
    });
    return true;
  } catch {
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
  await historyMutationQueue;
  const [tabs, mru] = await Promise.all([chrome.tabs.query({ windowId }), getMru()]);
  const activeTab = getActiveTab(tabs);

  if (!activeTab) {
    return { activeTab: null, orderedTabIds: [], overlayTabs: [] };
  }

  const orderedTabIds = buildOrderedTabIds(tabs, mru);
  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  const overlayTabs = buildOverlayTabs(orderedTabIds, tabMap);

  return { activeTab, orderedTabIds, overlayTabs };
}

async function showOverlay(session = navSession, forceFullRender = false) {
  if (!session || navSession !== session) return;

  const { overlayTabId } = session;
  const selectedIndex = Math.min(
    session.selectedIndex,
    Math.max(session.overlayTabs.length - 1, 0),
  );

  if (session.overlayInitialized && !forceFullRender) {
    const selectionUpdated = await safeSendMessage(overlayTabId, {
      action: 'updateSwitcherSelection',
      sessionId: session.id,
      selectedIndex,
    });

    if (selectionUpdated) return true;
    session.overlayInitialized = false;
  }

  const overlayShown = await sendMessageWithRetry(overlayTabId, {
    action: 'showSwitcher',
    sessionId: session.id,
    tabs: session.overlayTabs,
    selectedIndex,
  });

  if (navSession === session && overlayShown) {
    session.overlayInitialized = true;
  }

  return overlayShown;
}

async function closeOverlay(session = navSession) {
  if (!session?.overlayTabId) return;
  await safeSendMessage(session.overlayTabId, {
    action: 'closeSwitcher',
    sessionId: session.id,
  });
}

async function endNavSession(session = navSession) {
  if (!session) return false;

  let endedActiveSession = false;
  session.isFinalizing = true;
  clearCommitTimer(session);

  try {
    await closeOverlay(session);
  } catch {
    // Overlay teardown is best-effort; session state must still be restored.
  } finally {
    endedActiveSession = navSession === session;
    if (endedActiveSession) {
      navSession = null;
      suppressMruUpdate = false;
    }
  }

  return endedActiveSession;
}

async function refreshOverlayWithCommitFallback() {
  const session = navSession;
  if (!session) return;

  scheduleCommitTimer(session);
  const overlayShown = await showOverlay(session);

  if (navSession !== session) return;
  if (overlayShown) {
    clearCommitTimer(session);
  }
}

function didModifierReleaseRace(commandStartedAt, pressId) {
  return didModifierReleaseRaceForState(
    modifierState,
    commandStartedAt,
    pressId,
    MODIFIER_RELEASE_GRACE_MS,
  );
}

async function startNavSession(windowId, direction, commandStartedAt) {
  const { activeTab, orderedTabIds, overlayTabs } = await getWindowState(windowId);

  if (typeof activeTab?.id !== 'number' || orderedTabIds.length < 2) return;

  const pressId = modifierState.pressId;

  navSession = {
    id: nextSessionId,
    windowId,
    orderedTabIds,
    overlayTabs,
    selectedIndex: 0,
    overlayTabId: activeTab.id,
    overlayInitialized: false,
    commitTimer: null,
    isFinalizing: false,
  };
  nextSessionId += 1;

  const session = navSession;
  suppressMruUpdate = true;

  try {
    moveSelection(direction);
    await refreshOverlayWithCommitFallback();

    if (navSession === session && didModifierReleaseRace(commandStartedAt, pressId)) {
      await commitNav();
    }
  } catch (error) {
    if (navSession === session) {
      await endNavSession(session);
    }
    throw error;
  }
}

function moveSelection(direction) {
  if (!navSession) return;

  navSession.selectedIndex = getNextSelectionIndex(
    navSession.selectedIndex,
    direction,
    navSession.orderedTabIds.length,
  );
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
      await endNavSession(navSession);
    }
    await startNavSession(windowId, direction, commandStartedAt);
    return;
  }

  moveSelection(direction);
  await refreshOverlayWithCommitFallback();
}

async function commitNav() {
  const session = navSession;
  if (!session) return;

  const finalTabId = session.orderedTabIds[session.selectedIndex];
  const endedActiveSession = await endNavSession(session);
  if (!endedActiveSession) return;

  if (typeof finalTabId === 'number') {
    await chrome.tabs.update(finalTabId, { active: true }).catch(() => {});
    await pushMru(finalTabId);
  }
}

async function cancelNav() {
  const session = navSession;
  if (!session) return;

  await endNavSession(session);
}

async function handleNavbarToggle(commandTab) {
  const windowId = getCommandWindowId(commandTab) ?? (await getFocusedWindowId());
  const win = await chrome.windows.get(windowId);
  const newState = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
  await chrome.windows.update(win.id, { state: newState });
}

async function seedMru() {
  await mutateMru(async (stack) => {
    const tabs = await chrome.tabs.query({});
    return seedMruStack(stack, tabs);
  });
}

async function warmContentScripts() {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs
      .map((tab) => tab.id)
      .filter((tabId) => typeof tabId === 'number')
      .map((tabId) => ensureOverlayInjected(tabId).catch(() => false)),
  );
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  createdTabBatches.delete(windowId);
  pushMru(tabId).catch(() => {});
});

chrome.tabs.onCreated.addListener((tab) => {
  insertCreatedTab(tab).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await removeTabFromHistory(tabId);

  if (!navSession) return;

  const session = navSession;
  if (session.isFinalizing) return;

  const update = getSessionTabRemovalUpdate(session, tabId);
  session.orderedTabIds = update.orderedTabIds;
  session.overlayTabs = session.overlayTabs.filter((tab) => tab.id !== tabId);
  session.selectedIndex = update.selectedIndex;

  if (update.action === 'commit') {
    await commitNav();
    return;
  }

  if (update.action === 'cancel') {
    await cancelNav();
    return;
  }

  await showOverlay(session, true);
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
      modifierState.lastDownAt = timestamp;
    } else {
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
    refreshOverlayWithCommitFallback().catch(() => {});
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
