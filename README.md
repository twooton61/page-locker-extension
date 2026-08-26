# page-locker

A tiny Manifest V3 browser extension that locks the current page until you
confirm navigation away from it.

Click the extension action to toggle the lock for the active page. When locked,
the content script installs a standard `beforeunload` handler on that page. If a
navigation, reload, or tab close would unload the document, the browser shows
its built-in confirmation dialog. Modern browsers control the exact dialog text
and may require that the page has received user interaction before showing it.

The lock is scoped to the current loaded document. Once navigation is confirmed
and a new page loads, the extension clears the tab badge state.

## Install unpacked

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this directory.

## Files

- `manifest.json` - Manifest V3 extension metadata and minimal permissions.
- `background.js` - action-click toggle, tab badge/title state, and cleanup.
- `content.js` - idempotent page script that owns the `beforeunload` handler.
- `icons/` - PNG page icons and locked page icons for the toolbar state.

This extension has no dependencies and no build step.
