// Background service worker for page-locker.
// Click the extension action to toggle a beforeunload lock on the active page.

const LOCKS_KEY = "pageLockerLocks";
const TITLE_UNLOCK = "Page Locker: locked - click to unlock";
const TITLE_LOCK = "Page Locker: click to lock this page";
const TITLE_UNAVAILABLE = "Page Locker: cannot lock this page";
const PAGE_ICONS = {
  16: "icons/page-16.png",
  32: "icons/page-32.png",
  48: "icons/page-48.png",
  128: "icons/page-128.png",
};
const LOCKED_ICONS = {
  16: "icons/page-locked-16.png",
  32: "icons/page-locked-32.png",
  48: "icons/page-locked-48.png",
  128: "icons/page-locked-128.png",
};

let memoryLocks = {};

chrome.runtime.onInstalled.addListener(async () => {
  await renderDefaultAction();
});

chrome.runtime.onStartup.addListener(async () => {
  await renderDefaultAction();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !Number.isInteger(tab.id)) return;

  try {
    await ensureContentScript(tab.id);

    const state = await getPageState(tab.id);
    const nextEnabled = !state.enabled;
    const nextHref = state.href || "";
    const nextState = await setPageLocked(tab.id, nextEnabled, nextHref);

    if (nextState.enabled) {
      await rememberLock(tab.id, nextState.lockedHref || nextHref);
    } else {
      await forgetLock(tab.id);
    }

    await renderAction(tab.id, nextState.enabled);
  } catch (error) {
    console.warn("page-locker: unable to toggle lock", error);
    await forgetLock(tab.id);
    await renderUnavailable(tab.id);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await syncActionFromStoredLock(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    await reconcileTab(tabId);
  } else {
    await syncActionFromStoredLock(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await forgetLock(tabId);
});

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function getPageState(tabId) {
  return await chrome.tabs.sendMessage(tabId, {
    source: "page-locker",
    type: "get-state",
  });
}

async function setPageLocked(tabId, enabled, href) {
  return await chrome.tabs.sendMessage(tabId, {
    source: "page-locker",
    type: "set-locked",
    enabled,
    href,
  });
}

async function reconcileTab(tabId) {
  const lock = await readLock(tabId);
  if (!lock) {
    await renderAction(tabId, false);
    return;
  }

  try {
    const state = await getPageState(tabId);
    if (state.enabled) {
      await renderAction(tabId, true);
      return;
    }

    await setPageLocked(tabId, false, "");
  } catch (_) {
    // The original document unloaded or the content script is not present.
  }

  await forgetLock(tabId);
  await renderAction(tabId, false);
}

async function syncActionFromStoredLock(tabId) {
  const lock = await readLock(tabId);
  await renderAction(tabId, Boolean(lock));
}

async function renderAction(tabId, enabled) {
  await chrome.action.setIcon({
    tabId,
    path: enabled ? LOCKED_ICONS : PAGE_ICONS,
  });
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({
    tabId,
    title: enabled ? TITLE_UNLOCK : TITLE_LOCK,
  });
}

async function renderUnavailable(tabId) {
  await chrome.action.setIcon({ tabId, path: PAGE_ICONS });
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: TITLE_UNAVAILABLE });
}

async function renderDefaultAction() {
  await chrome.action.setIcon({ path: PAGE_ICONS });
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: TITLE_LOCK });
}

async function readLock(tabId) {
  const locks = await readLocks();
  return locks[String(tabId)] || null;
}

async function rememberLock(tabId, href) {
  const locks = await readLocks();
  locks[String(tabId)] = { href };
  await writeLocks(locks);
}

async function forgetLock(tabId) {
  const locks = await readLocks();
  delete locks[String(tabId)];
  await writeLocks(locks);
}

async function readLocks() {
  if (chrome.storage && chrome.storage.session) {
    const got = await chrome.storage.session.get(LOCKS_KEY);
    return got[LOCKS_KEY] || {};
  }

  return { ...memoryLocks };
}

async function writeLocks(locks) {
  if (chrome.storage && chrome.storage.session) {
    await chrome.storage.session.set({ [LOCKS_KEY]: locks });
    return;
  }

  memoryLocks = { ...locks };
}
