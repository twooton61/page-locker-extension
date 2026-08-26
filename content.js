// Idempotent content script for page-locker.
// It owns exactly one beforeunload listener for this loaded document.

(() => {
  "use strict";

  const GLOBAL_KEY = "__pageLocker";
  const TITLE_PREFIX = "🔒 ";

  if (globalThis[GLOBAL_KEY]) return;

  let enabled = false;
  let lockedHref = "";
  let titleObserver = null;
  let applyingTitle = false;

  function beforeUnload(event) {
    if (!enabled) return undefined;

    event.preventDefault();
    event.returnValue = true;
    return true;
  }

  function getState() {
    return {
      enabled,
      href: location.href,
      lockedHref,
    };
  }

  function stripTitlePrefix(title) {
    return title.startsWith(TITLE_PREFIX)
      ? title.slice(TITLE_PREFIX.length)
      : title;
  }

  function setDocumentTitle(title) {
    applyingTitle = true;
    try {
      document.title = title;
    } finally {
      applyingTitle = false;
    }
  }

  function applyLockedTitle() {
    if (!enabled || applyingTitle) return;

    const nextTitle = `${TITLE_PREFIX}${stripTitlePrefix(document.title)}`;
    if (document.title === nextTitle) return;

    setDocumentTitle(nextTitle);
  }

  function clearLockedTitle() {
    const nextTitle = stripTitlePrefix(document.title);
    if (document.title === nextTitle) return;

    setDocumentTitle(nextTitle);
  }

  function startTitleObserver() {
    const root = document.head || document.documentElement;
    if (titleObserver || !root) return;

    titleObserver = new MutationObserver(() => {
      applyLockedTitle();
    });
    titleObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function stopTitleObserver() {
    if (!titleObserver) return;

    titleObserver.disconnect();
    titleObserver = null;
  }

  function setLocked(nextEnabled, href) {
    enabled = Boolean(nextEnabled);
    lockedHref = enabled ? href || location.href : "";

    window.removeEventListener("beforeunload", beforeUnload);
    if (enabled) {
      window.addEventListener("beforeunload", beforeUnload);
      startTitleObserver();
      applyLockedTitle();
    } else {
      stopTitleObserver();
      clearLockedTitle();
    }

    return getState();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== "page-locker") return false;

    if (message.type === "get-state") {
      sendResponse(getState());
      return false;
    }

    if (message.type === "set-locked") {
      sendResponse(setLocked(message.enabled, message.href));
      return false;
    }

    return false;
  });

  globalThis[GLOBAL_KEY] = {
    getState,
    setLocked,
  };
})();
