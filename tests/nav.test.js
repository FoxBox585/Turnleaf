// Navigation regression test: the reported bug stranded the user on Settings
// (Month → Projects → Settings → Back → Back bounced between Projects and
// Settings forever). These tests drive the real goPage/goBack/goHome with
// fake timers to let each 750 ms page-flip settle, exactly as the app runs.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let api;
let win;

beforeAll(function () {
  const html = readFileSync(join(root, 'frontend', 'index.html'), 'utf8');
  const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1]
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(body, { url: 'http://localhost/', pretendToBeVisual: false });
  win = dom.window;
  win.matchMedia = undefined;
  const appJs = readFileSync(join(root, 'frontend', 'app.js'), 'utf8');
  const moduleShim = { exports: {} };
  const globals = {
    window: win,
    document: win.document,
    location: win.location,
    localStorage: win.localStorage,
    navigator: win.navigator,
    URL: win.URL,
    Blob: win.Blob,
    confirm: function () { return true; },
    alert: function () {},
    Audio: function () {},
    // delegate at call time so vi.useFakeTimers() can take over after boot
    setTimeout: function () { return globalThis.setTimeout.apply(null, arguments); },
    clearTimeout: function () { return globalThis.clearTimeout.apply(null, arguments); },
    setInterval: function () { return globalThis.setInterval.apply(null, arguments); },
    clearInterval: function () { return globalThis.clearInterval.apply(null, arguments); },
    module: moduleShim
  };
  const names = Object.keys(globals);
  // eslint-disable-next-line no-new-func
  const runner = new Function(names.join(','), appJs);
  runner.apply(null, names.map(function (n) { return globals[n]; }));
  api = moduleShim.exports;
});

beforeEach(function () {
  vi.useFakeTimers();
});

afterEach(function () {
  vi.useRealTimers();
});

// each navigation plays a page-flip that settles after its 750 ms fallback
const settle = function () { vi.advanceTimersByTime(800); };
const page = function () { return api.getView().page; };
const homeHidden = function () { return win.document.getElementById('btn-home').hidden; };

describe('navigation back-trail', function () {
  it('retraces Month → Projects → Settings → Back → Back to Month (the reported bug)', function () {
    expect(page()).toBe('month');
    api.goPage('projects'); settle();
    expect(page()).toBe('projects');
    api.goPage('settings'); settle();
    expect(page()).toBe('settings');
    api.goBack(); settle();
    expect(page()).toBe('projects');   // back walks the real trail...
    api.goBack(); settle();
    expect(page()).toBe('month');      // ...all the way home
  });

  it('back from a bar hop returns to where the hop started', function () {
    api.goPage('settings'); settle();
    expect(page()).toBe('settings');
    api.goPage('projects'); settle();  // Projects from Settings pushes settings
    expect(page()).toBe('projects');
    api.goBack(); settle();
    expect(page()).toBe('settings');
    api.goBack(); settle();
    expect(page()).toBe('month');
  });

  it('goHome jumps straight to Month and starts a fresh trail', function () {
    api.goPage('projects'); settle();
    api.goPage('settings'); settle();
    api.goHome(); settle();
    expect(page()).toBe('month');
    // the trail was cleared: a back from a later page falls to Month once
    api.goPage('settings'); settle();
    api.goBack(); settle();
    expect(page()).toBe('month');
  });

  it('goBack with no trail lands on Month (after an import reset)', function () {
    api.goPage('projects'); settle();
    api.showPageNow('month');          // what Import does
    expect(page()).toBe('month');
    api.goPage('projects'); settle();
    api.goBack(); settle();
    expect(page()).toBe('month');
  });

  it('keeps the Month button hidden only while already home', function () {
    expect(homeHidden()).toBe(true);
    api.goPage('projects'); settle();
    expect(homeHidden()).toBe(false);
    api.goHome(); settle();
    expect(homeHidden()).toBe(true);
  });

  it('ignores navigation to the page already showing', function () {
    api.goPage('projects'); settle();
    api.goPage('projects'); settle();
    api.goBack(); settle();
    expect(page()).toBe('month');      // the no-op hop pushed nothing extra
  });
});
