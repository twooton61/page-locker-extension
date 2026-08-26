// Background service worker for page-locker.
// Click the extension action to persistently toggle a beforeunload lock for the
// active URL.

const LOCKS_KEY = "pageLockerUrlLocks";
const TITLE_UNLOCK = "Page Locker: locked URL - click to unlock";
const TITLE_LOCK = "Page Locker: click to lock this URL";
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
  await syncActiveTab();
});

chrome.runtime.onStartup.addListener(async () => {
  await renderDefaultAction();
  await syncActiveTab();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !Number.isInteger(tab.id)) return;

  try {
    await ensureContentScript(tab.id);

    const state = await getPageState(tab.id);
    const href = state.href || tab.url || "";
    if (!href) throw new Error("missing tab URL");

    const storedLock = await readLock(href);
    const nextEnabled = !(state.enabled || storedLock);
    const nextState = await setPageLocked(tab.id, nextEnabled, href);

    if (nextState.enabled) {
      await rememberLock(nextState.lockedHref || href);
    } else {
      await forgetLock(href);
      await forgetLock(state.lockedHref);
      await forgetLock(nextState.lockedHref);
    }

    await renderAction(tab.id, nextState.enabled);
  } catch (error) {
    console.warn("page-locker: unable to toggle lock", error);
    await renderUnavailable(tab.id);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    message &&
    message.source === "page-locker" &&
    message.type === "url-changed"
  ) {
    if (sender.tab && Number.isInteger(sender.tab.id)) {
      void reconcileTab(sender.tab.id);
    }
  }

  return false;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await reconcileTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (
    changeInfo.status === "complete" ||
    (changeInfo.url && !changeInfo.status)
  ) {
    await reconcileTab(tabId);
  } else if (changeInfo.url) {
    await syncActionFromUrl(tabId, changeInfo.url);
  }
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
  const tabHref = await getTabHref(tabId);
  if (tabHref && !canInjectContentScript(tabHref)) {
    await renderUnavailable(tabId);
    return;
  }

  try {
    await ensureContentScript(tabId);
    const state = await getPageState(tabId);
    const href = state.href || "";
    const shouldLock = Boolean(href && (await readLock(href)));
    const lockedHref = shouldLock ? href : "";

    if (state.enabled !== shouldLock || state.lockedHref !== lockedHref) {
      await setPageLocked(tabId, shouldLock, href);
    }

    await renderAction(tabId, shouldLock);
  } catch (error) {
    console.warn("page-locker: unable to reconcile tab", error);
    await renderUnavailable(tabId);
  }
}

async function syncActionFromUrl(tabId, href) {
  if (href && !canInjectContentScript(href)) {
    await renderUnavailable(tabId);
    return;
  }

  const lock = href ? await readLock(href) : null;
  await renderAction(tabId, Boolean(lock));
}

async function syncActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab && Number.isInteger(tab.id)) {
      await reconcileTab(tab.id);
    }
  } catch (error) {
    console.warn("page-locker: unable to sync active tab", error);
  }
}

async function getTabHref(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || "";
  } catch (_) {
    return "";
  }
}

function canInjectContentScript(href) {
  return /^(https?|file):/.test(href);
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

async function readLock(href) {
  if (!href) return null;

  const locks = await readLocks();
  return locks[href] || null;
}

async function rememberLock(href) {
  if (!href) return;

  const locks = await readLocks();
  locks[href] = {
    href,
    lockedAt: new Date().toISOString(),
  };
  await writeLocks(locks);
}

async function forgetLock(href) {
  if (!href) return;

  const locks = await readLocks();
  delete locks[href];
  await writeLocks(locks);
}

async function readLocks() {
  if (chrome.storage && chrome.storage.local) {
    const got = await chrome.storage.local.get(LOCKS_KEY);
    return normalizeLocks(got[LOCKS_KEY]);
  }

  return { ...memoryLocks };
}

async function writeLocks(locks) {
  if (chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [LOCKS_KEY]: locks });
    return;
  }

  memoryLocks = { ...locks };
}

function normalizeLocks(locks) {
  if (!locks || typeof locks !== "object" || Array.isArray(locks)) {
    return {};
  }

  return locks;
}
