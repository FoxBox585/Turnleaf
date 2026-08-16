// Unit tests for Turnleaf's pure logic. The app script is a browser IIFE, so
// it is executed here with browser globals supplied by jsdom; the guarded
// `module.exports` at its end exposes the pure functions under test.
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let api;

beforeAll(() => {
  const html = readFileSync(join(root, 'frontend', 'index.html'), 'utf8');
  const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1]
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(body, { url: 'http://localhost/', pretendToBeVisual: false });
  const { window } = dom;
  // jsdom stubs matchMedia with a throwing function; the app guards with a
  // truthiness check and falls back itself, so remove the stub entirely
  window.matchMedia = undefined;
  const appJs = readFileSync(join(root, 'frontend', 'app.js'), 'utf8');
  const moduleShim = { exports: {} };
  const globals = {
    window: window,
    document: window.document,
    location: window.location,
    localStorage: window.localStorage,
    navigator: window.navigator,
    URL: window.URL,
    Blob: window.Blob,
    confirm: function () { return true; },
    alert: function () {},
    Audio: function () {},
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    module: moduleShim
  };
  const names = Object.keys(globals);
  // the script body is the IIFE call itself; the gate inside fills moduleShim
  // eslint-disable-next-line no-new-func
  const runner = new Function(names.join(','), appJs);
  runner.apply(null, names.map(function (n) { return globals[n]; }));
  api = moduleShim.exports;
  expect(api, 'app.js must expose its API under Node').toBeTruthy();
});

describe('moveHabit', function () {
  const mk = function () {
    return [].slice.call(arguments).map(function (id) {
      return { id: id, name: 'habit ' + id };
    });
  };
  it('moves a habit to the front', function () {
    const list = mk('a', 'b', 'c');
    expect(api.moveHabit(list, 'c', 'a', false)).toBe(true);
    expect(list.map(function (h) { return h.id; })).toEqual(['c', 'a', 'b']);
  });
  it('moves a habit after another', function () {
    const list = mk('a', 'b', 'c');
    expect(api.moveHabit(list, 'a', 'b', true)).toBe(true);
    expect(list.map(function (h) { return h.id; })).toEqual(['b', 'a', 'c']);
  });
  it('appends to the end when beforeId is null', function () {
    const list = mk('a', 'b', 'c');
    expect(api.moveHabit(list, 'a', null, false)).toBe(true);
    expect(list.map(function (h) { return h.id; })).toEqual(['b', 'c', 'a']);
  });
  it('refuses a move before/after itself and leaves the list intact', function () {
    const list = mk('a', 'b');
    expect(api.moveHabit(list, 'a', 'a', false)).toBe(false);
    expect(api.moveHabit(list, 'a', 'a', true)).toBe(false);
    expect(list.map(function (h) { return h.id; })).toEqual(['a', 'b']);
  });
  it('refuses unknown ids and leaves the list intact', function () {
    const list = mk('a', 'b');
    expect(api.moveHabit(list, 'zz', 'a', false)).toBe(false);
    expect(api.moveHabit(list, 'a', 'zz', false)).toBe(false);
    expect(list.map(function (h) { return h.id; })).toEqual(['a', 'b']);
  });
});

describe('moveTask (regression)', function () {
  const mk = function () {
    return [].slice.call(arguments).map(function (id) {
      return { id: id, text: 'task ' + id, subs: [] };
    });
  };
  it('moves a task to the front', function () {
    const list = mk('a', 'b', 'c');
    expect(api.moveTask(list, 'c', 'a', false)).toBe(true);
    expect(list.map(function (t) { return t.id; })).toEqual(['c', 'a', 'b']);
  });
  it('moves a task after another', function () {
    const list = mk('a', 'b', 'c');
    expect(api.moveTask(list, 'a', 'b', true)).toBe(true);
    expect(list.map(function (t) { return t.id; })).toEqual(['b', 'a', 'c']);
  });
  it('refuses a move before/after itself and unknown ids', function () {
    const list = mk('a', 'b');
    expect(api.moveTask(list, 'a', 'a', true)).toBe(false);
    expect(api.moveTask(list, 'b', 'zz', false)).toBe(false);
    expect(list.map(function (t) { return t.id; })).toEqual(['a', 'b']);
  });
});

describe('parseWhen', function () {
  it('parses weekday names and prefixes', function () {
    expect(api.parseWhen('Mon')).toEqual({ weekday: 1 });
    expect(api.parseWhen('monday')).toEqual({ weekday: 1 });
    expect(api.parseWhen('Sunday')).toEqual({ weekday: 0 });
    expect(api.parseWhen('tue')).toEqual({ weekday: 2 });
  });
  it('parses a bare day number for one-off lessons', function () {
    expect(api.parseWhen('19')).toEqual({ day: 19 });
    expect(api.parseWhen('1')).toEqual({ day: 1 });
  });
  it('rejects short, out-of-range or garbage input', function () {
    expect(api.parseWhen('m')).toBeNull();
    expect(api.parseWhen('')).toBeNull();
    expect(api.parseWhen('xyz')).toBeNull();
    expect(api.parseWhen('0')).toBeNull();
    expect(api.parseWhen('32')).toBeNull();
  });
});

describe('parseDate', function () {
  it('parses a bare day of the open month', function () {
    expect(api.parseDate('24', 2026, 8)).toBe('2026-08-24');
  });
  it('parses month/day in the open year', function () {
    expect(api.parseDate('9/24', 2026, 8)).toBe('2026-09-24');
  });
  it('parses an absolute ISO date', function () {
    expect(api.parseDate('2027-01-04', 2026, 8)).toBe('2027-01-04');
  });
  it('clears the date on an empty string', function () {
    expect(api.parseDate('', 2026, 8)).toBe('');
  });
  it('rejects invalid and out-of-range dates', function () {
    expect(api.parseDate('0', 2026, 8)).toBeNull();
    expect(api.parseDate('32', 2026, 8)).toBeNull();   // August has 31 days
    expect(api.parseDate('2/30', 2026, 8)).toBeNull(); // Feb 30 never exists
    expect(api.parseDate('garbage', 2026, 8)).toBeNull();
  });
});

describe('parseTime', function () {
  it('parses 24-hour forms', function () {
    expect(api.parseTime('16:00')).toBe('16:00');
    expect(api.parseTime('16.00')).toBe('16:00');
    expect(api.parseTime('1600')).toBe('16:00');
    expect(api.parseTime('9')).toBe('09:00');
  });
  it('parses am/pm forms', function () {
    expect(api.parseTime('4pm')).toBe('16:00');
    expect(api.parseTime('4:30 pm')).toBe('16:30');
    expect(api.parseTime('12am')).toBe('00:00');
    expect(api.parseTime('12pm')).toBe('12:00');
  });
  it('rejects malformed and out-of-range times', function () {
    expect(api.parseTime('25:00')).toBeNull();
    expect(api.parseTime('16:60')).toBeNull();
    expect(api.parseTime('13pm')).toBeNull();
    expect(api.parseTime('')).toBeNull();
    expect(api.parseTime('garbage')).toBeNull();
  });
});

describe('cleanDay', function () {
  it('keeps valid ISO dates', function () {
    expect(api.cleanDay('2026-08-24')).toBe('2026-08-24');
  });
  it('rejects impossible and malformed dates', function () {
    expect(api.cleanDay('2026-02-30')).toBeNull();
    expect(api.cleanDay('2026-13-01')).toBeNull();
    expect(api.cleanDay('2026-08-32')).toBeNull();
    expect(api.cleanDay('not a date')).toBeNull();
    expect(api.cleanDay('')).toBeNull();
  });
});

describe('daysInMonth', function () {
  it('knows month lengths and leap years', function () {
    expect(api.daysInMonth(2026, 2)).toBe(28);
    expect(api.daysInMonth(2024, 2)).toBe(29);
    expect(api.daysInMonth(2026, 4)).toBe(30);
    expect(api.daysInMonth(2026, 8)).toBe(31);
  });
});

describe('sanitize', function () {
  it('rejects unusable input', function () {
    expect(api.sanitize(null)).toBeNull();
    expect(api.sanitize({})).toBeNull();
    expect(api.sanitize({ version: 5 })).toBeNull();
  });
  it('lifts legacy data to the current shape with all sections on', function () {
    const out = api.sanitize({ version: 1, birthdays: [] });
    expect(out.version).toBe(4);
    expect(out.settings.sections.habits).toBe(true);
    expect(out.projects).toEqual([]);
    expect(out.months).toEqual({});
  });
  it('keeps valid habits, their order, and their ids', function () {
    const out = api.sanitize({
      version: 4,
      habits: [
        { id: 'h1', name: 'Meditate' },
        { id: 'h2', name: 'Gym' },
        { id: 'h3', name: '' },
        { name: 'Nameless' }
      ]
    });
    expect(out.habits.map(function (h) { return h.id; })).toEqual(['h1', 'h2', expect.any(String)]);
    expect(out.habits.map(function (h) { return h.name; })).toEqual(['Meditate', 'Gym', 'Nameless']);
  });
  it('honours explicit section off switches only', function () {
    const out = api.sanitize({
      version: 4,
      settings: { sections: { habits: false, goals: false } }
    });
    expect(out.settings.sections.habits).toBe(false);
    expect(out.settings.sections.goals).toBe(false);
    expect(out.settings.sections.important).toBe(true);
  });
  it('clamps pomodoro lengths', function () {
    const out = api.sanitize({
      version: 4,
      settings: { pomodoro: { work: 999, rest: 0, chime: false } }
    });
    expect(out.settings.pomodoro.work).toBe(25); // out of range → default
    expect(out.settings.pomodoro.rest).toBe(5);
    expect(out.settings.pomodoro.chime).toBe(false);
  });
});
