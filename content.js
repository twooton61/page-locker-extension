// Idempotent content script for page-locker.
// It owns exactly one navigation lock for this loaded document.

(() => {
  "use strict";

  const GLOBAL_KEY = "__pageLocker";
  const TITLE_PREFIX = "🔒 ";
  const CONFIRM_MESSAGE = "This page is locked. Leave it?";

  if (globalThis[GLOBAL_KEY]) return;

  let enabled = false;
  let lockedHref = "";
  let titleObserver = null;
  let applyingTitle = false;
  let prefixedTitle = null;
  let pageTitle = "";
  let customTitle = "";
  let allowNavigationUntil = 0;

  function beforeUnload(event) {
    if (!enabled || canNavigate()) return undefined;

    event.preventDefault();
    event.returnValue = true;
    return true;
  }

  function getState() {
    return {
      enabled,
      href: location.href,
      lockedHref,
      customTitle,
    };
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

    if (document.title !== prefixedTitle) {
      pageTitle = document.title;
    }

    const title = customTitle || pageTitle;
    const nextTitle = title.startsWith(TITLE_PREFIX)
      ? title
      : `${TITLE_PREFIX}${title}`;
    prefixedTitle = nextTitle;
    if (document.title !== nextTitle) setDocumentTitle(nextTitle);
  }

  function clearLockedTitle() {
    if (prefixedTitle !== null && document.title === prefixedTitle) {
      setDocumentTitle(pageTitle);
    }

    prefixedTitle = null;
    customTitle = "";
  }

  function onClick(event) {
    if (!enabled || event.defaultPrevented || canNavigate()) return;
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const link = closestLink(event.target);
    if (!link || opensOutsideCurrentTab(link) || link.hasAttribute("download")) {
      return;
    }
    if (!isLeavingLockedUrl(link.href)) return;

    if (confirmNavigation()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onTurboBeforeVisit(event) {
    if (!enabled || canNavigate()) return;

    const nextUrl = event.detail && event.detail.url;
    if (!nextUrl || !isLeavingLockedUrl(nextUrl)) return;

    if (confirmNavigation()) return;

    event.preventDefault();
  }

  function confirmNavigation() {
    if (!window.confirm(CONFIRM_MESSAGE)) return false;

    allowNavigationUntil = Date.now() + 3000;
    watchForUrlChange();
    return true;
  }

  function canNavigate() {
    return Date.now() < allowNavigationUntil;
  }

  function isLeavingLockedUrl(nextHref) {
    try {
      const current = comparableUrl(location.href);
      const locked = comparableUrl(lockedHref || location.href);
      const next = comparableUrl(nextHref);

      return next !== current && next !== locked;
    } catch (_) {
      return false;
    }
  }

  function comparableUrl(href) {
    const url = new URL(href, location.href);
    url.hash = "";
    return url.href;
  }

  function closestLink(target) {
    return target && typeof target.closest === "function"
      ? target.closest("a[href]")
      : null;
  }

  function opensOutsideCurrentTab(link) {
    const target = link.getAttribute("target");
    return Boolean(
      target && !["_self", "_top"].includes(target.toLowerCase())
    );
  }

  function watchForUrlChange() {
    const startHref = location.href;
    const deadline = Date.now() + 3000;

    const check = () => {
      if (!enabled) return;

      if (location.href !== startHref) {
        notifyUrlChanged();
        return;
      }

      if (Date.now() < deadline) {
        window.setTimeout(check, 100);
      }
    };

    window.setTimeout(check, 100);
  }

  function notifyUrlChanged() {
    try {
      const sent = chrome.runtime.sendMessage({
        source: "page-locker",
        type: "url-changed",
        href: location.href,
      });

      if (sent && typeof sent.catch === "function") {
        sent.catch(() => {});
      }
    } catch (_) {
      // Ignore: the background page may be unavailable during extension reloads.
    }
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

  function setLocked(nextEnabled, href, title) {
    enabled = Boolean(nextEnabled);
    lockedHref = enabled ? href || location.href : "";
    customTitle = enabled && typeof title === "string" ? title : "";

    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("turbo:before-visit", onTurboBeforeVisit, true);

    if (enabled) {
      window.addEventListener("beforeunload", beforeUnload);
      document.addEventListener("click", onClick, true);
      document.addEventListener("turbo:before-visit", onTurboBeforeVisit, true);
      startTitleObserver();
      applyLockedTitle();
    } else {
      allowNavigationUntil = 0;
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
      sendResponse(setLocked(message.enabled, message.href, message.title));
      return false;
    }

    if (message.type === "prompt-title") {
      if (!enabled) {
        window.alert("Lock this page with the toolbar icon before renaming it.");
        sendResponse({ title: null });
        return false;
      }

      const title = window.prompt(
        "Rename locked page. Leave blank to restore the site's title:",
        customTitle || pageTitle
      );
      sendResponse({ title: title === null ? null : title.trim() });
      return false;
    }

    return false;
  });

  globalThis[GLOBAL_KEY] = {
    getState,
    setLocked,
  };
})();
