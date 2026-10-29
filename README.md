# page-locker

A tiny Chrome (Manifest V3) extension that locks selected URLs so Chrome asks for
confirmation before you navigate away, reload, or close them - useful when a page
has unsaved work, long-running state, or anything else you do not want to lose by
accident.

![page-locker locked page icon](icons/page-locked-128.png)

Click the toolbar icon on a normal web page to toggle the lock for that exact
URL. When locked, page-locker applies three cues:

- **Navigation confirmation** - a standard `beforeunload` handler asks Chrome to
  show its built-in leave-page dialog before the document unloads, and an
  in-page guard catches app-level link navigation in single-page apps.
- **Title prefix** - a lock emoji is added to the page title so the tab is easy
  to spot in the tab strip.
- **Locked toolbar state** - the extension icon changes to the locked page icon,
  and the toolbar tooltip switches to the unlock action.

Locks are saved by exact URL. If you return to a locked URL later, page-locker
reapplies the navigation confirmation and lock title automatically. Click the
toolbar icon again on that URL to remove the saved lock.

When you first lock a page, a prompt lets you rename its tab. Cancel or leave the
name blank to keep the site's title. To rename it later, right-click the toolbar
icon and choose **Rename locked page…**. The custom title is saved with the URL's
lock and survives reloads and browser restarts. Leave the name blank to restore
the site's title. Unlocking the URL also restores the site's title and removes
the saved name.

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

Locks are stored in `chrome.storage.local`, so they survive navigation and
browser restarts. The extension requests host access for normal web pages so it
can reapply a saved lock when a matching URL loads again. On browser startup,
page-locker checks open tabs and re-arms any restored tab whose exact URL is
locked.

## How it works

- `manifest.json` - Manifest V3 metadata, toolbar action, icons, storage and
  scripting permissions, and host access for normal web pages.
- `background.js` - service worker that toggles saved URL locks, updates the
  toolbar icon/title, and reapplies locks after navigation.
- `content.js` - idempotent page script that owns the `beforeunload` listener,
  in-page navigation guard, and title prefix for the loaded document.
- `icons/` - unlocked and locked page icons used for the toolbar state.
