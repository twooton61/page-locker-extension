// Idempotent content script for page-locker.
// It owns exactly one beforeunload listener for this loaded document.

(() => {
  "use strict";

  const GLOBAL_KEY = "__pageLocker";

  if (globalThis[GLOBAL_KEY]) return;

  let enabled = false;
  let lockedHref = "";

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

  function setLocked(nextEnabled, href) {
    enabled = Boolean(nextEnabled);
    lockedHref = enabled ? href || location.href : "";

    window.removeEventListener("beforeunload", beforeUnload);
    if (enabled) {
      window.addEventListener("beforeunload", beforeUnload);
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
