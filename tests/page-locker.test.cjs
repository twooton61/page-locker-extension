const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const contentSource = readFileSync(`${__dirname}/../content.js`, "utf8");
const backgroundSource = readFileSync(`${__dirname}/../background.js`, "utf8");
const LOCKS_KEY = "pageLockerUrlLocks";
const HREF = "https://example.com/work";

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    async emit(...args) {
      await Promise.all(listeners.map((listener) => listener(...args)));
    },
  };
}

function createPage(href, initialTitle) {
  let title = initialTitle;
  let pendingMutation = false;
  const observers = new Set();
  const listeners = new Map();
  const messages = [];
  const page = { nextTitle: null, alerts: [], promptCount: 0 };
  const document = {
    head: {},
    get title() { return title; },
    set title(value) { title = value; pendingMutation = true; },
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    document,
    location: { href },
    URL,
    Date,
    window: {
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name) { listeners.delete(name); },
      prompt(_message, defaultTitle) {
        page.promptCount++;
        page.promptDefault = defaultTitle;
        return page.nextTitle;
      },
      alert(message) { page.alerts.push(message); },
    },
    chrome: { runtime: { onMessage: {
      addListener(listener) { messages.push(listener); },
    } } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
  });
  return Object.assign(page, {
    context,
    document,
    listeners,
    inject() { vm.runInContext(contentSource, context); },
    message(message) {
      let response;
      for (const listener of messages) {
        listener(message, {}, (value) => { response = value; });
      }
      return response;
    },
    flushTitles() {
      let count = 0;
      while (pendingMutation) {
        assert.ok(count++ < 10, "title observer must settle");
        pendingMutation = false;
        for (const observer of observers) observer.callback();
      }
    },
    setSiteTitle(value) {
      document.title = value;
      this.flushTitles();
    },
  });
}

function createExtension(savedLocks = {}) {
  const storage = { [LOCKS_KEY]: structuredClone(savedLocks) };
  const tabs = new Map();
  const menus = [];
  const chrome = {
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
    action: {
      onClicked: event(),
      async setIcon() {}, async setBadgeText() {}, async setTitle() {},
    },
    contextMenus: {
      create(menu) { menus.push(menu); },
      onClicked: event(),
    },
    tabs: {
      onActivated: event(), onUpdated: event(),
      async get(id) { return { id, url: tabs.get(id).context.location.href }; },
      async query(query) {
        const result = await Promise.all([...tabs.keys()].map(this.get));
        return query.active ? result.slice(0, 1) : result;
      },
      async sendMessage(id, message) { return tabs.get(id).message(message); },
    },
    scripting: {
      async executeScript({ target }) { tabs.get(target.tabId).inject(); },
    },
    storage: { local: {
      async get(key) { return structuredClone({ [key]: storage[key] }); },
      async set(values) { Object.assign(storage, structuredClone(values)); },
    } },
  };
  vm.runInNewContext(backgroundSource, { chrome, console });
  return {
    chrome, storage, menus,
    page(id = 1, title = "Work", href = HREF) {
      const page = createPage(href, title);
      tabs.set(id, page);
      return page;
    },
    async toggle(id = 1) { await chrome.action.onClicked.emit(await chrome.tabs.get(id)); },
    async rename(title, id = 1) {
      tabs.get(id).nextTitle = title;
      await chrome.contextMenus.onClicked.emit(
        { menuItemId: "page-locker-rename" }, await chrome.tabs.get(id)
      );
      for (const page of tabs.values()) page.flushTitles();
    },
  };
}

test("locking prompts for a title and saves it for matching tabs", async () => {
  const extension = createExtension();
  const page = extension.page();
  const duplicate = extension.page(2, "Another copy");
  page.nextTitle = "  Project dashboard  ";
  await extension.toggle();
  assert.equal(page.promptCount, 1);
  assert.equal(page.promptDefault, "Work");
  assert.equal(page.document.title, "🔒 Project dashboard");
  assert.equal(duplicate.document.title, "🔒 Project dashboard");
  assert.equal(extension.storage[LOCKS_KEY][HREF].title, "Project dashboard");
  assert.equal(page.listeners.has("beforeunload"), true);

  await extension.toggle();
  assert.equal(page.promptCount, 1, "unlocking must not prompt");
});

for (const title of [null, "   "]) {
  test(`locking keeps the original title when the prompt returns ${JSON.stringify(title)}`, async () => {
    const extension = createExtension();
    const page = extension.page();
    page.nextTitle = title;
    await extension.toggle();
    assert.equal(page.promptCount, 1);
    assert.equal(page.document.title, "🔒 Work");
    assert.ok(extension.storage[LOCKS_KEY][HREF]);
    assert.equal(page.listeners.has("beforeunload"), true);
  });
}

test("the toolbar menu renames a locked URL and updates matching tabs", async () => {
  const extension = createExtension();
  const page = extension.page();
  const duplicate = extension.page(2, "Another copy");
  const differentUrl = extension.page(3, "Other page", `${HREF}#other`);
  await extension.chrome.runtime.onInstalled.emit();
  assert.equal(extension.menus[0].contexts[0], "action");
  await extension.toggle();
  const lockedAt = extension.storage[LOCKS_KEY][HREF].lockedAt;
  await extension.rename("  Project dashboard  ");

  assert.equal(page.document.title, "🔒 Project dashboard");
  assert.equal(duplicate.document.title, "🔒 Project dashboard");
  assert.equal(differentUrl.document.title, "Other page");
  assert.equal(extension.storage[LOCKS_KEY][HREF].title, "Project dashboard");
  assert.equal(extension.storage[LOCKS_KEY][HREF].lockedAt, lockedAt);
  const unload = { preventDefault() { this.prevented = true; } };
  page.listeners.get("beforeunload")(unload);
  assert.equal(unload.prevented, true);
});

test("saved names survive a page reload and service worker restart", async () => {
  const extension = createExtension();
  extension.page();
  await extension.toggle();
  await extension.rename("My work");
  const reloaded = extension.page(1, "Reloaded site title");
  await extension.chrome.tabs.onUpdated.emit(1, { status: "complete" });
  reloaded.flushTitles();
  assert.equal(reloaded.document.title, "🔒 My work");
  assert.equal(reloaded.promptCount, 0);

  const restarted = createExtension(extension.storage[LOCKS_KEY]);
  const restored = restarted.page(1, "Fresh site title");
  await restarted.chrome.runtime.onStartup.emit();
  restored.flushTitles();
  assert.equal(restored.document.title, "🔒 My work");
  assert.equal(restored.promptCount, 0);
});

test("clearing a name restores the latest site title and keeps the lock", async () => {
  const extension = createExtension();
  const page = extension.page();
  await extension.toggle();
  await extension.rename("My work");
  page.setSiteTitle("New notification (1)");
  assert.equal(page.document.title, "🔒 My work");
  await extension.rename("   ");
  assert.equal(page.document.title, "🔒 New notification (1)");
  assert.equal(extension.storage[LOCKS_KEY][HREF].title, "");
  page.setSiteTitle("New notification (2)");
  assert.equal(page.document.title, "🔒 New notification (2)");
});

test("unlocking restores the site title and forgets the custom name", async () => {
  const extension = createExtension();
  const page = extension.page();
  await extension.toggle();
  await extension.rename("My work");
  page.setSiteTitle("Latest site title");
  await extension.toggle();
  page.flushTitles();
  assert.equal(page.document.title, "Latest site title");
  assert.equal(page.listeners.has("beforeunload"), false);
  assert.equal(extension.storage[LOCKS_KEY][HREF], undefined);
  page.nextTitle = null;
  await extension.toggle();
  page.flushTitles();
  assert.equal(page.document.title, "🔒 Latest site title");
});

test("cancelling a rename leaves the saved name intact", async () => {
  const extension = createExtension();
  const page = extension.page();
  await extension.toggle();
  await extension.rename("My work");
  await extension.rename(null);
  assert.equal(page.promptDefault, "My work");
  assert.equal(page.document.title, "🔒 My work");
  assert.equal(extension.storage[LOCKS_KEY][HREF].title, "My work");
});

test("locks saved before custom titles still work, including a site's lock prefix", async () => {
  const extension = createExtension({ [HREF]: { href: HREF, lockedAt: "earlier" } });
  const page = extension.page(1, "🔒 Private work");
  await extension.chrome.runtime.onStartup.emit();
  page.flushTitles();
  assert.equal(page.document.title, "🔒 Private work");
  await extension.rename("Custom");
  await extension.toggle();
  page.flushTitles();
  assert.equal(page.document.title, "🔒 Private work");
});

test("renaming an unlocked page explains how to lock it first", async () => {
  const extension = createExtension();
  const page = extension.page();
  await extension.rename("Custom");
  assert.equal(page.alerts.length, 1);
  assert.equal(page.document.title, "Work");
  assert.deepEqual(extension.storage[LOCKS_KEY], {});
});
