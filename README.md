# page-locker

A tiny Chrome (Manifest V3) extension that locks the current tab so Chrome asks
for confirmation before you navigate away, reload, or close it - useful when a
page has unsaved work, long-running state, or anything else you do not want to
lose by accident.

![page-locker locked page icon](icons/page-locked-128.png)

Click the toolbar icon on a normal web page to toggle the lock for that loaded
document. When locked, page-locker applies two cues:

- **Navigation confirmation** - a standard `beforeunload` handler asks Chrome to
  show its built-in leave-page dialog before the document unloads.
- **Locked toolbar state** - the extension icon changes to the locked page icon,
  and the toolbar tooltip switches to the unlock action.

The lock is scoped to the current loaded document. If you confirm navigation and
a new page loads, the extension clears the tab state automatically.

## Zero dependencies

This extension is, and is intended to stay, **zero-dependency**: no npm packages,
no build step, no bundler, no runtime CDN fetches - just plain vanilla JavaScript
and the standard Chrome extension APIs. The folder you clone is the folder you
load.

## Install (unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select this folder.

## Usage notes

Modern browsers control the exact confirmation dialog text, and Chrome may only
show the dialog after the page has received user interaction. Restricted pages
such as `chrome://` pages cannot be locked because extensions cannot inject
content scripts there.

Locks are tracked per tab in `chrome.storage.session` when available, with an
in-memory fallback for browsers that do not expose session storage.

## How it works

- `manifest.json` - Manifest V3 metadata, toolbar action, icons, and minimal
  permissions: `activeTab`, `scripting`, and `storage`.
- `background.js` - service worker that toggles the active tab lock, updates the
  toolbar icon/title, and clears stale tab state after navigation or tab close.
- `content.js` - idempotent page script that owns exactly one `beforeunload`
  listener for the loaded document.
- `icons/` - unlocked and locked page icons used for the toolbar state.
