(function () {
  'use strict';

  /* ------------------------------ constants ---------------------------- */
  var KEY = 'bujoNotes.v1';
  var VERSION = '1.0.1';        // shown in About; the notes format is state.version
  var POM_PRESETS = [[25, 5], [30, 6], [50, 10], [10, 20]];
  // side-column sections the reader can switch off. Order is display order.
  var SECTIONS = [
    { key: 'goals', label: 'Goals' },
    { key: 'important', label: 'Important' },
    { key: 'birthdays', label: 'Birthdays' },
    { key: 'lessons', label: 'Lessons' },
    { key: 'projects', label: 'Projects' },
    { key: 'habits', label: 'Habits' }
  ];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  // longest possible day count per month (Feb 29 allowed; renders only in leap years)
  var MONTH_CAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // weekday indexes follow Date#getDay(): 0 = Sunday
  var WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WEEKDAY_WORDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var CHECK_SVG = '<svg viewBox="0 0 26 26" aria-hidden="true"><polyline points="5,15 10,20 22,4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var book = document.getElementById('book');
  var pageMonth = document.getElementById('page-month');
  var pageDay = document.getElementById('page-day');
  var pageProjects = document.getElementById('page-projects');
  var pageLessons = document.getElementById('page-lessons');
  var pageLessonPlan = document.getElementById('page-lesson-plan');
  var pageSettings = document.getElementById('page-settings');
  var btnProjects = document.getElementById('btn-projects');
  var btnLessons = document.getElementById('btn-lessons');
  var btnHome = document.getElementById('btn-home');
  var importFile = document.getElementById('import-file');
  var banner = document.getElementById('banner');
  var reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* ------------------------------ helpers ------------------------------ */
  function $(sel, el) { return (el || document).querySelector(sel); }

  // Scoped lookups for ids that can exist on more than one page's last render
  // (a lesson row lives on the month spread AND the Lessons page). Only the
  // visible page is live, so document-order lookups would land on a stale,
  // hidden copy and edit/delete the wrong record.
  function $v(sel) {
    var pageEl = book.querySelector('.page:not([hidden])');
    return pageEl ? pageEl.querySelector(sel) : null;
  }
  function rowById(id) {
    return $v('[data-id="' + id + '"]');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  // Ids from an import are put straight into [data-id="…"] selectors, so anything
  // that could close the attribute or the bracket has to go. Not an XSS hole —
  // these are attribute lookups, never innerHTML — but a stray quote throws.
  function safeId(v) {
    return String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '') || uid();
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function monthKey(y, m) { return y + '-' + pad2(m); }            // m is 1-based
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); } // m is 1-based
  function dateWeekday(y, m, d) { return WEEKDAY_ABBR[new Date(y, m - 1, d).getDay()]; }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  // a teaching week reads Monday-first, but Date#getDay() starts on Sunday
  function weekRank(wd) { return (wd + 6) % 7; }
  function byTime(a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; }

  // The lesson "when" field carries both kinds of lesson: a weekday name means
  // weekly, a bare number means a one-off on that date of the open month.
  function parseWhen(str) {
    var s = String(str == null ? '' : str).trim().toLowerCase();
    if (!s) return null;
    if (/^\d{1,2}$/.test(s)) {
      var d = +s;
      return d >= 1 && d <= 31 ? { day: d } : null;
    }
    if (s.length < 3) return null; // "m"/"tu" are ambiguous — make them type more
    for (var i = 0; i < WEEKDAY_WORDS.length; i++) {
      if (WEEKDAY_WORDS[i].indexOf(s) === 0) return { weekday: i };
    }
    return null;
  }

  // Exactly one level of nesting, enforced by shape: a subtask's own `subs` is
  // simply never read, so it cannot have children however a file was written.
  function subsOf(t) {
    var out = [];
    if (Array.isArray(t.subs)) {
      t.subs.forEach(function (s) {
        if (s && typeof s.text === 'string') {
          out.push({ id: safeId(s.id), text: s.text, done: !!s.done });
        }
      });
    }
    return out;
  }

  // A project task's optional date is stored as ISO "YYYY-MM-DD": sortable, one
  // field, and `day.slice(0, 7) === monthKey(y, m)` is the whole month test.
  function cleanDay(v) {
    var mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v == null ? '' : v));
    if (!mt) return null;
    var yy = +mt[1], mm = +mt[2], dd = +mt[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth(yy, mm)) return null;
    return mt[0];
  }

  // "" clears the date · "24" = that day of the open month · "9/24" = M/D in the
  // open month's year · "2027-01-04" absolute. null means unparseable, and the
  // caller keeps the old value — same bargain as the lesson time field.
  function parseDate(str, y, m) {
    var s = String(str == null ? '' : str).trim();
    if (!s) return '';
    var mt;
    if ((mt = /^(\d{1,2})$/.exec(s))) {
      return +mt[1] >= 1 && +mt[1] <= daysInMonth(y, m)
        ? monthKey(y, m) + '-' + pad2(+mt[1]) : null;
    }
    if ((mt = /^(\d{1,2})[\/.\-](\d{1,2})$/.exec(s))) {
      return cleanDay(y + '-' + pad2(+mt[1]) + '-' + pad2(+mt[2]));
    }
    if ((mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
      return cleanDay(mt[1] + '-' + pad2(+mt[2]) + '-' + pad2(+mt[3]));
    }
    return null;
  }

  // inside the open month a bare ordinal is enough; further out needs the month
  function fmtDate(iso, y, m) {
    var p = iso.split('-'), yy = +p[0], mm = +p[1], dd = +p[2];
    if (yy === y && mm === m) return ordinal(dd);
    return MONTH_NAMES[mm - 1].slice(0, 3) + ' ' + dd + (yy === y ? '' : ' ' + yy);
  }

  // Accepts 16:00, 16.00, 1600, 4pm, 4:30 pm, 9 — always stores 24-hour "HH:MM"
  function parseTime(str) {
    var s = String(str == null ? '' : str).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    var suffix = null, h, mi, m;
    if (/(am|pm)$/.test(s)) { suffix = s.slice(-2); s = s.slice(0, -2); }
    if ((m = s.match(/^(\d{1,2})[:.](\d{2})$/))) { h = +m[1]; mi = +m[2]; }
    else if (/^\d{3,4}$/.test(s)) { h = +s.slice(0, -2); mi = +s.slice(-2); }
    else if (/^\d{1,2}$/.test(s)) { h = +s; mi = 0; }
    else return null;
    if (suffix) {
      if (h < 1 || h > 12) return null;
      if (suffix === 'pm' && h !== 12) h += 12;
      if (suffix === 'am' && h === 12) h = 0;
    }
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
    return pad2(h) + ':' + pad2(mi);
  }

  // Asked once: does this locale write afternoons as "1:00 PM"? Used only until
  // the reader picks a format on the bar, after which state.timeFormat wins.
  var LOCALE_12 = (function () {
    try { return /am|pm/i.test(new Date(2020, 0, 1, 13).toLocaleTimeString()); }
    catch (e) { return false; }
  })();
  function use12() {
    return state.timeFormat ? state.timeFormat === '12' : LOCALE_12;
  }
  // display only — storage stays 24-hour "HH:MM" so sorting and backups don't care
  function fmtTime(t) {
    if (!use12()) return t;
    var h = +t.slice(0, 2), h12 = h % 12;
    return (h12 === 0 ? 12 : h12) + ':' + t.slice(3) + (h < 12 ? ' AM' : ' PM');
  }

  // tiny DOM builder; user text always goes through textContent/value (no HTML)
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      if (arguments[i] != null) node.append(arguments[i]);
    }
    return node;
  }

  /* ------------------------------ state -------------------------------- */
  var state = null;
  var storageOk = true;
  var saveFailed = false;
  // view.page is the only thing that decides what is on screen; view.day says
  // which day the day page shows, and view.planLesson/planDate which lesson
  // plan. All of it is memory-only — a reload lands on the current month.
  var view = { y: 0, m: 0, day: null, page: 'month', planLesson: null, planDate: null };
  // the trail of pages behind us, so Back retraces the whole journey instead
  // of bouncing between the last two pages (Settings ⇄ Projects forever)
  var backStack = [];
  // { type: 'goal'|'task'|'bday'|'lesson'|'lesson-once', id, field } — field
  // names which input to focus, so clicking a time lands in the time box
  var editing = null;
  // set when the row being edited was created blank a moment ago, so Escape
  // removes it instead of leaving an empty line behind
  var editNew = false;
  var flipping = false;
  var scrollMemo = {};                  // scroll position per page, by name

  // The book's pages, in the order they sit in the spine. `depth` is the only
  // thing that decides which way a leaf turns, so no page needs to know about
  // any other — adding one is a line here plus a <section> in the markup.
  var PAGES = {
    month: { el: pageMonth, depth: 0, render: renderMonth },
    projects: { el: pageProjects, depth: 1, render: renderProjects },
    lessons: { el: pageLessons, depth: 1, render: renderLessons },
    day: { el: pageDay, depth: 2, render: renderDay, enter: focusTaskInput },
    'lesson-plan': { el: pageLessonPlan, depth: 3, render: renderLessonPlan },
    settings: { el: pageSettings, depth: 4, render: renderSettings }
  };

  // Repaint whichever page is showing. Editing and adding only ever happen on
  // the visible page, and every page is rendered on the way in, so this is the
  // whole of the render scheduling.
  function render() { PAGES[view.page].render(); }

  // Every renderer hands its content over wrapped in a .sheet, which carries
  // the paper itself — grain, fibre, rules — as a scrolled child of the page.
  // See the note on .page in the CSS for why the scroller must not paint them.
  function setPage(pageEl, inner) {
    var sheet = el('div', { class: 'sheet' });
    sheet.append(inner);
    pageEl.replaceChildren(sheet);
  }

  // timeFormat null = follow the computer's locale until the reader picks one
  function defaultState() {
    return {
      version: 5,
      timeFormat: null,
      settings: {
        // every section starts on; switching one off hides it and its marks,
        // and never deletes anything
        sections: { goals: true, important: true, birthdays: true, lessons: true, projects: true, habits: true },
        pomodoro: { work: 25, rest: 5, chime: true }
      },
      birthdays: [], lessons: [], projects: [], habits: [], plans: {}, months: {}
    };
  }

  function secOn(key) { return state.settings.sections[key] !== false; }

  // Validate an untrusted object (import file or stored JSON) and rebuild it
  // copying only known fields with correct types. Returns null if unusable.
  // Older files still load — missing fields simply come back at their defaults,
  // and the next save rewrites them at the current version. That is why only an
  // explicit `false` switches a section off: absent means on.
  function sanitize(data) {
    if (!data || typeof data !== 'object') return null;
    if ([1, 2, 3, 4, 5].indexOf(data.version) < 0) return null;
    var out = defaultState();
    if (data.timeFormat === '12' || data.timeFormat === '24') out.timeFormat = data.timeFormat;
    var s = data.settings;
    if (s && typeof s === 'object') {
      if (s.sections && typeof s.sections === 'object') {
        SECTIONS.forEach(function (sec) {
          if (s.sections[sec.key] === false) out.settings.sections[sec.key] = false;
        });
      }
      if (s.pomodoro && typeof s.pomodoro === 'object') {
        var w = Math.round(+s.pomodoro.work), r = Math.round(+s.pomodoro.rest);
        if (w >= 1 && w <= 180) out.settings.pomodoro.work = w;
        if (r >= 1 && r <= 180) out.settings.pomodoro.rest = r;
        if (s.pomodoro.chime === false) out.settings.pomodoro.chime = false;
      }
    }
    if (Array.isArray(data.birthdays)) {
      data.birthdays.forEach(function (b) {
        if (!b || typeof b.name !== 'string' || !b.name.trim()) return;
        var month = +b.month, day = +b.day;
        if (month >= 1 && month <= 12 && day >= 1 && day <= MONTH_CAP[month - 1]) {
          out.birthdays.push({ id: safeId(b.id), name: b.name, month: month, day: day });
        }
      });
    }
    if (Array.isArray(data.lessons)) {
      data.lessons.forEach(function (l) {
        if (!l || typeof l.name !== 'string' || !l.name.trim()) return;
        var wd = +l.weekday, time = parseTime(l.time);
        if (wd >= 0 && wd <= 6 && time) {
          out.lessons.push({ id: safeId(l.id), name: l.name, weekday: wd, time: time });
        }
      });
    }
    if (Array.isArray(data.projects)) {
      data.projects.forEach(function (p) {
        if (!p || typeof p.name !== 'string' || !p.name.trim()) return;
        var proj = { id: safeId(p.id), name: p.name, tasks: [] };
        if (Array.isArray(p.tasks)) {
          p.tasks.forEach(function (t) {
            if (!t || typeof t.text !== 'string') return;
            proj.tasks.push({
              id: safeId(t.id), text: t.text,
              done: !!t.done, imp: !!t.imp, day: cleanDay(t.day), subs: subsOf(t)
            });
          });
        }
        out.projects.push(proj); // an empty project is a folder you just made
      });
    }
    // habits come before the months below: a month's tick map is only kept for
    // habit ids that actually exist
    if (Array.isArray(data.habits)) {
      data.habits.forEach(function (h) {
        if (!h || typeof h.name !== 'string' || !h.name.trim()) return;
        out.habits.push({ id: safeId(h.id), name: h.name });
      });
    }
    if (data.months && typeof data.months === 'object') {
      Object.keys(data.months).forEach(function (key) {
        var m = data.months[key];
        // month part must be 01–12 so MONTH_CAP lookups below are always in range
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key) || !m || typeof m !== 'object') return;
        var cap = MONTH_CAP[+key.slice(5) - 1];
        var mm = { goals: [], lessons: [], days: {} };
        if (Array.isArray(m.goals)) {
          m.goals.forEach(function (g) {
            if (g && typeof g.text === 'string' && g.text.trim()) {
              mm.goals.push({ id: safeId(g.id), text: g.text });
            }
          });
        }
        if (Array.isArray(m.lessons)) {
          m.lessons.forEach(function (l) {
            if (!l || typeof l.name !== 'string' || !l.name.trim()) return;
            var day = +l.day, time = parseTime(l.time);
            if (day >= 1 && day <= cap && time) {
              mm.lessons.push({ id: safeId(l.id), name: l.name, day: day, time: time });
            }
          });
        }
        if (m.days && typeof m.days === 'object') {
          Object.keys(m.days).forEach(function (dk) {
            var tasks = m.days[dk];
            if (!/^\d{2}$/.test(dk) || !Array.isArray(tasks)) return;
            var list = [];
            tasks.forEach(function (t) {
              if (t && typeof t.text === 'string') {
                list.push({
                  id: safeId(t.id), text: t.text,
                  done: !!t.done, imp: !!t.imp, subs: subsOf(t)
                });
              }
            });
            if (list.length) mm.days[dk] = list;
          });
        }
        // ticks for days 1..cap, only under habits that exist; anything else is
        // an orphan from some other file and is dropped
        if (m.habitChecks && typeof m.habitChecks === 'object') {
          var hc = {};
          out.habits.forEach(function (h) {
            var ch = m.habitChecks[h.id];
            if (!ch || typeof ch !== 'object') return;
            var days = {};
            Object.keys(ch).forEach(function (dk) {
              var d = +dk;
              if (/^\d{1,2}$/.test(dk) && d >= 1 && d <= cap && ch[dk]) days[dk] = true;
            });
            if (Object.keys(days).length) hc[h.id] = days;
          });
          if (Object.keys(hc).length) mm.habitChecks = hc;
        }
        if (mm.goals.length || mm.lessons.length || Object.keys(mm.days).length ||
            (mm.habitChecks && Object.keys(mm.habitChecks).length)) out.months[key] = mm;
      });
    }
    // lesson plans (v5): per lesson id, per date — but only for lessons that
    // actually exist above, so a file can never smuggle in orphans
    if (data.plans && typeof data.plans === 'object') {
      var known = {};
      out.lessons.forEach(function (l) { known[l.id] = true; });
      Object.keys(out.months).forEach(function (k) {
        out.months[k].lessons.forEach(function (l) { known[l.id] = true; });
      });
      Object.keys(data.plans).forEach(function (lid) {
        if (!known[lid]) return;
        var byDate = data.plans[lid];
        if (!byDate || typeof byDate !== 'object') return;
        var cleaned = {};
        Object.keys(byDate).forEach(function (iso) {
          var plan = byDate[iso];
          if (!cleanDay(iso) || !plan || typeof plan !== 'object') return;
          var entry = { tasks: [], notes: typeof plan.notes === 'string' ? plan.notes : '' };
          if (Array.isArray(plan.tasks)) {
            plan.tasks.forEach(function (t) {
              if (t && typeof t.text === 'string' && t.text.trim()) {
                entry.tasks.push({ id: safeId(t.id), text: t.text, done: !!t.done, subs: subsOf(t) });
              }
            });
          }
          if (entry.tasks.length || entry.notes) cleaned[iso] = entry;
        });
        if (Object.keys(cleaned).length) out.plans[lid] = cleaned;
      });
    }
    return out;
  }

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      storageOk = false;
      showBanner("Can't access browser storage — notes won't persist. Export often.");
      return defaultState();
    }
    if (!raw) return defaultState();
    try {
      var clean = sanitize(JSON.parse(raw));
      if (!clean) throw new Error('bad shape');
      return clean;
    } catch (e) {
      try { localStorage.setItem(KEY + '.corrupt', raw); } catch (_) {}
      showBanner('Stored notes were unreadable — started fresh. The old data is kept under "' + KEY + '.corrupt".');
      return defaultState();
    }
  }

  function save() {
    if (!storageOk) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (saveFailed) { saveFailed = false; hideBanner(); }
    } catch (e) {
      saveFailed = true;
      showBanner("Couldn't save — storage is unavailable or full. Export your notes as a backup.");
    }
  }

  /* month/day accessors: reads never create entries, writes create lazily */
  function getMonth(y, m) {
    return state.months[monthKey(y, m)] || { goals: [], lessons: [], days: {}, habitChecks: {} };
  }
  function ensureMonth(y, m) {
    var k = monthKey(y, m);
    if (!state.months[k]) state.months[k] = { goals: [], lessons: [], days: {}, habitChecks: {} };
    return state.months[k];
  }
  // Every lesson falling on one date: the weekly ones whose weekday matches,
  // plus this month's one-offs. Feeds the date rows, the day page and nothing else.
  function lessonsOn(y, m, d) {
    var wd = new Date(y, m - 1, d).getDay();
    var out = state.lessons
      .filter(function (l) { return l.weekday === wd; })
      .map(function (l) { return { id: l.id, name: l.name, time: l.time }; });
    getMonth(y, m).lessons.forEach(function (l) {
      if (l.day === d) out.push({ id: l.id, name: l.name, time: l.time });
    });
    return out.sort(byTime);
  }
  function getTasks(y, m, d) {
    return getMonth(y, m).days[pad2(d)] || [];
  }
  function ensureTasks(y, m, d) {
    var mo = ensureMonth(y, m), k = pad2(d);
    if (!mo.days[k]) mo.days[k] = [];
    return mo.days[k];
  }
  /* habits live on state.habits (global, like birthdays); which days were
     ticked is per month, under month.habitChecks — read straight off getMonth
     in the renderers. */
  /* projects: folders of tasks that outlive any one month. A task may carry an
     optional date, and when it does it also shows up on that day — but it is
     still stored once, here. These two functions are what keep that honest. */

  function getProject(id) {
    return state.projects.find(function (p) { return p.id === id; }) || null;
  }

  /* Lesson plans (v5): state.plans = { lessonId: { dateISO: { tasks, notes } } }.
     A plan is planning material, not todos — its tasks never show on day pages
     or the spread. Reads never create; empty plans are pruned away again. */
  function getPlan(id, iso) {
    var byLesson = state.plans[id];
    return (byLesson && byLesson[iso]) || { tasks: [], notes: '' };
  }
  function ensurePlan(id, iso) {
    var byLesson = state.plans[id] || (state.plans[id] = {});
    if (!byLesson[iso]) byLesson[iso] = { tasks: [], notes: '' };
    return byLesson[iso];
  }
  function planPrune(st, id, iso) {
    var byLesson = st.plans[id];
    if (!byLesson) return;
    var plan = byLesson[iso];
    if (plan && !plan.tasks.length && !plan.notes) delete byLesson[iso];
    if (!Object.keys(byLesson).length) delete st.plans[id];
  }

  // A lesson lives either in the global weekly list or in one month's one-offs.
  function findLesson(id) {
    var l = state.lessons.find(function (x) { return x.id === id; });
    if (l) return { lesson: l, kind: 'lesson' };
    var keys = Object.keys(state.months);
    for (var i = 0; i < keys.length; i++) {
      var mo = state.months[keys[i]];
      var lo = mo.lessons.find(function (x) { return x.id === id; });
      if (lo) return { lesson: lo, kind: 'lesson-once', y: +keys[i].slice(0, 4), m: +keys[i].slice(5) };
    }
    return null;
  }

  // The plan page's date for a lesson: the next occurrence of a weekly lesson
  // (today when today matches), or a one-off's own fixed date.
  function planDateFor(hit) {
    if (hit.kind === 'lesson-once') {
      return monthKey(hit.y, hit.m) + '-' + pad2(hit.lesson.day);
    }
    var d = new Date();
    d.setDate(d.getDate() + ((hit.lesson.weekday - d.getDay() + 7) % 7));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Everything due on one date, from both stores: the day's own tasks first
  // (the day owns those), then dated project tasks in project order.
  function tasksOn(y, m, d) {
    var out = getTasks(y, m, d).map(function (t) { return { task: t, project: null }; });
    if (!secOn('projects')) return out;
    var iso = monthKey(y, m) + '-' + pad2(d);
    state.projects.forEach(function (p) {
      p.tasks.forEach(function (t) {
        if (t.day === iso) out.push({ task: t, project: p });
      });
    });
    return out;
  }

  // This month's dated project tasks, keyed by day — built once per render
  // rather than walking every project once for each of 31 dates.
  function datedIndex(y, m) {
    var out = {};
    if (!secOn('projects')) return out;
    var prefix = monthKey(y, m) + '-';
    state.projects.forEach(function (p) {
      p.tasks.forEach(function (t) {
        if (typeof t.day === 'string' && t.day.indexOf(prefix) === 0) {
          var k = t.day.slice(8);
          (out[k] || (out[k] = [])).push({ task: t, project: p });
        }
      });
    });
    return out;
  }

  // Resolve a task id to wherever it actually lives. Every task mutation goes
  // through this, so one set of data-actions serves the day page, the projects
  // page, the plan pages and the Important list without duplicating any of them.
  // Searching the open month, all projects and the open plan is enough: only a
  // rendered row can be clicked, and only those are ever rendered.
  function findTask(id) {
    var lists = taskLists();
    for (var a = 0; a < lists.length; a++) {
      var i = lists[a].list.findIndex(function (t) { return t.id === id; });
      if (i > -1) {
        return { list: lists[a].list, i: i, task: lists[a].list[i], project: lists[a].project, plan: lists[a].plan };
      }
    }
    return null;
  }

  // Every task list a rendered row could belong to.
  function taskLists() {
    var out = [];
    var mo = state.months[monthKey(view.y, view.m)];
    if (mo) Object.keys(mo.days).forEach(function (dk) { out.push({ list: mo.days[dk], project: null }); });
    state.projects.forEach(function (p) { out.push({ list: p.tasks, project: p }); });
    if (view.page === 'lesson-plan' && view.planLesson && view.planDate) {
      out.push({ list: getPlan(view.planLesson, view.planDate).tasks, project: null, plan: true });
    }
    return out;
  }

  function findSub(id) {
    var lists = taskLists();
    for (var a = 0; a < lists.length; a++) {
      for (var b = 0; b < lists[a].list.length; b++) {
        var t = lists[a].list[b];
        var i = t.subs.findIndex(function (s) { return s.id === id; });
        if (i > -1) return { parent: t, sub: t.subs[i], i: i, plan: lists[a].plan };
      }
    }
    return null;
  }

  // The whole rule: a task with subtasks is done exactly when all of them are.
  // Applied after every subtask change, so the parent can never disagree with
  // its own counter.
  function rollUp(t) {
    if (t.subs.length) t.done = t.subs.every(function (s) { return s.done; });
  }

  function subCount(t) {
    return t.subs.filter(function (s) { return s.done; }).length + '/' + t.subs.length;
  }

  // drop empty day lists / months so exports stay tidy
  function prune(y, m) {
    var k = monthKey(y, m), mo = state.months[k];
    if (!mo) return;
    Object.keys(mo.days).forEach(function (dk) {
      if (!mo.days[dk].length) delete mo.days[dk];
    });
    if (mo.habitChecks && !Object.keys(mo.habitChecks).length) delete mo.habitChecks;
    if (!mo.goals.length && !mo.lessons.length && !Object.keys(mo.days).length &&
        !(mo.habitChecks && Object.keys(mo.habitChecks).length)) delete state.months[k];
  }

  /* ------------------------------ actions ------------------------------ */
  function gotoMonth(delta) {
    editing = null;
    var d = new Date(view.y, view.m - 1 + delta, 1);
    view.y = d.getFullYear();
    view.m = d.getMonth() + 1;
    renderMonth();
    pageMonth.scrollTop = 0; // a fresh spread opens at the top
    scrollMemo.month = 0;
  }

  // The one way to change pages: paint the destination, then turn the leaf over
  // it. Going deeper into the book turns forward, coming back out turns back.
  function navigate(from, to) {
    editing = null;
    view.page = to;
    paintBar();
    PAGES[to].render();
    flip(from, to, PAGES[to].depth > PAGES[from].depth ? 'forward' : 'back');
  }

  // Forward navigation records the page it leaves, so Back can retrace the
  // journey: Month → Projects → Settings → Back → Back ends on Month.
  function goPage(name) {
    if (flipping || !PAGES[name] || name === view.page) return;
    backStack.push(view.page);
    navigate(view.page, name);
  }

  // Back pops the trail — it must not push anything, or a run of Backs would
  // ping-pong between the last two pages. An empty trail means "home".
  function goBack() {
    var dest = backStack.length ? backStack.pop() : 'month';
    if (flipping || !PAGES[dest] || dest === view.page) return;
    navigate(view.page, dest);
  }

  // The bar's Month button: jump straight home and start a fresh trail.
  function goHome() {
    if (flipping || view.page === 'month') return;
    backStack = [];
    navigate(view.page, 'month');
  }

  // Swap pages with no animation at all — for import, which replaces the whole
  // book underneath us and has no "from" page worth turning.
  function showPageNow(name) {
    Object.keys(PAGES).forEach(function (k) { PAGES[k].el.hidden = k !== name; });
    view.page = name;
    backStack = [];
    paintBar();
    scrollMemo = {};
  }

  function openDay(d) {
    if (flipping || view.page !== 'month') return;
    view.day = d;
    goPage('day');
  }

  // Open a lesson's plan page. From the Lessons index it lands on the next
  // occurrence (weekly) or the lesson's own date (one-off); a day-page link
  // passes that day, and when the day is itself an occurrence, the plan opens
  // on it. The current page goes onto the trail, so Back returns to it.
  function openPlan(id, hintDay) {
    if (flipping) return;
    var hit = findLesson(id);
    if (!hit) return;
    view.planLesson = id;
    if (hit.kind === 'lesson-once') {
      view.planDate = monthKey(hit.y, hit.m) + '-' + pad2(hit.lesson.day);
    } else if (hintDay != null && new Date(view.y, view.m - 1, hintDay).getDay() === hit.lesson.weekday) {
      view.planDate = monthKey(view.y, view.m) + '-' + pad2(hintDay);
    } else {
      view.planDate = planDateFor(hit);
    }
    goPage('lesson-plan');
  }

  // weekly plans flip a week at a time; a one-off is a single date and never
  // steps anywhere
  function stepPlanDate(delta) {
    if (!view.planLesson || !view.planDate) return;
    var hit = findLesson(view.planLesson);
    if (!hit || hit.kind !== 'lesson') return;
    var p = view.planDate.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2] + delta);
    view.planDate = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    renderLessonPlan();
  }

  function commitAddGoal(text) {
    text = text.trim();
    if (!text) return;
    ensureMonth(view.y, view.m).goals.push({ id: uid(), text: text });
    save();
    renderMonth();
    var inp = $('#goal-input');
    if (inp) inp.focus();
  }

  function commitAddTask(text, day) {
    text = text.trim();
    if (!text) return;
    ensureTasks(view.y, view.m, day).push({ id: uid(), text: text, done: false, imp: false, subs: [] });
    save();
    renderDay();
    var inp = $('#task-input');
    if (inp) inp.focus();
  }

  function commitAddProject(text) {
    text = text.trim();
    if (!text) return;
    state.projects.push({ id: uid(), name: text, tasks: [] });
    save();
    renderProjects();
    var inp = $('#project-input');
    if (inp) inp.focus();
  }

  function commitAddHabit(text) {
    text = text.trim();
    if (!text) return;
    state.habits.push({ id: uid(), name: text });
    save();
    renderMonth();
    var inp = $('#habit-input');
    if (inp) inp.focus();
  }

  // a tick is a day number under the habit in this month's checks; unticking
  // removes it again. Painted in place, so a rapid run of taps feels instant.
  function toggleHabit(id, day, cellEl) {
    if (day < 1 || day > daysInMonth(view.y, view.m)) return;
    var mo = ensureMonth(view.y, view.m);
    var checks = mo.habitChecks || (mo.habitChecks = {});
    var list = checks[id] || (checks[id] = {});
    var k = String(day);
    if (list[k]) delete list[k]; else list[k] = true;
    if (!Object.keys(list).length) {
      delete checks[id];
      if (!Object.keys(checks).length) delete mo.habitChecks; // keep exports tidy
    }
    save();
    paintHabitCell(cellEl, !!list[k]);
  }

  function paintHabitCell(cellEl, on) {
    if (!cellEl) return;
    cellEl.classList.toggle('on', on);
    // on the spread the dot is the cell's child; on the day page the dot is
    // the cell itself — either way the ink lands on the dot
    var dot = cellEl.querySelector('.habit-dot');
    if (dot) dot.classList.toggle('on', on);
    cellEl.setAttribute('aria-checked', String(on));
  }

  // a habit's ticks die with it — that history loss earns a confirm, like a
  // project holding tasks
  function deleteHabit(id) {
    var h = state.habits.find(function (x) { return x.id === id; });
    if (!h) return;
    if (!confirm('Delete "' + h.name + '" and its tick history?')) return;
    state.habits = state.habits.filter(function (x) { return x.id !== id; });
    Object.keys(state.months).forEach(function (k) {
      var mo = state.months[k];
      if (mo.habitChecks) {
        delete mo.habitChecks[id];
        if (!Object.keys(mo.habitChecks).length) delete mo.habitChecks;
      }
      prune(+k.slice(0, 4), +k.slice(5));
    });
    save();
    renderMonth();
  }

  function commitAddProjectTask(pid, text) {
    text = text.trim();
    var proj = getProject(pid);
    if (!text || !proj) return;
    proj.tasks.push({ id: uid(), text: text, done: false, imp: false, day: null, subs: [] });
    save();
    renderProjects();
    // there is one add row per project, so the refocus has to be scoped to this
    // one rather than looking up a single well-known id
    var inp = book.querySelector('[data-project="' + pid + '"] [data-add="proj-task"]');
    if (inp) inp.focus();
  }

  function commitAddPlanTask(text) {
    text = text.trim();
    if (!text || !view.planLesson || !view.planDate) return;
    ensurePlan(view.planLesson, view.planDate).tasks.push({ id: uid(), text: text, done: false, subs: [] });
    save();
    renderLessonPlan();
    var inp = book.querySelector('[data-add="plan-task"]');
    if (inp) inp.focus();
  }

  function deleteProject(id) {
    var proj = getProject(id);
    if (!proj) return;
    var n = proj.tasks.length;
    if (n && !confirm('Delete "' + proj.name + '" and its ' + n + (n === 1 ? ' task' : ' tasks') + '?')) return;
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    save();
    renderProjects();
  }

  function commitAddBirthday() {
    var nameEl = $('#bday-name'), dayEl = $('#bday-day');
    if (!nameEl || !dayEl) return;
    var name = nameEl.value.trim();
    var d = parseInt(dayEl.value, 10);
    if (!name) { nameEl.focus(); return; }
    if (!(d >= 1 && d <= MONTH_CAP[view.m - 1])) { dayEl.focus(); dayEl.select(); return; }
    state.birthdays.push({ id: uid(), name: name, month: view.m, day: d });
    save();
    renderMonth();
    var inp = $v('#bday-name');
    if (inp) inp.focus();
  }

  function commitAddLesson() {
    var nameEl = $('#lesson-name'), whenEl = $('#lesson-when'), timeEl = $('#lesson-time');
    if (!nameEl || !whenEl || !timeEl) return;
    var name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    // bad field wins focus and nothing is added — same as the birthday row
    var when = parseWhen(whenEl.value);
    if (!when || (when.day && when.day > daysInMonth(view.y, view.m))) {
      whenEl.focus(); whenEl.select(); return;
    }
    var time = parseTime(timeEl.value);
    if (!time) { timeEl.focus(); timeEl.select(); return; }
    if (when.weekday != null) {
      state.lessons.push({ id: uid(), name: name, weekday: when.weekday, time: time });
    } else {
      ensureMonth(view.y, view.m).lessons.push({ id: uid(), name: name, day: when.day, time: time });
    }
    save();
    render();
    var inp = $v('#lesson-name');
    if (inp) inp.focus();
  }

  function toggleSection(key) {
    if (!state.settings.sections.hasOwnProperty(key)) return;
    state.settings.sections[key] = !secOn(key);
    save();
    paintBar();
    renderSettings();
  }

  // the only bar controls that come and go with a section
  function paintBar() {
    btnProjects.hidden = !secOn('projects');
    btnLessons.hidden = !secOn('lessons');
    btnHome.hidden = view.page === 'month';
  }

  function setClock(fmt) {
    // 'auto' goes back to null, which follows the machine's locale again
    state.timeFormat = (fmt === '12' || fmt === '24') ? fmt : null;
    save();
    renderSettings();
  }

  function deleteGoal(id) {
    var mo = ensureMonth(view.y, view.m);
    mo.goals = mo.goals.filter(function (g) { return g.id !== id; });
    prune(view.y, view.m);
    save();
    renderMonth();
  }

  // A dated project task deleted from its day page is deleted from the project
  // too — it is the same task, stored once.
  function deleteTask(id) {
    var hit = findTask(id);
    if (!hit) return;
    hit.list.splice(hit.i, 1);
    if (hit.plan) planPrune(state, view.planLesson, view.planDate);
    else if (!hit.project) prune(view.y, view.m);
    save();
    render();
  }

  function deleteBirthday(id) {
    state.birthdays = state.birthdays.filter(function (b) { return b.id !== id; });
    save();
    renderMonth();
  }

  function deleteLesson(id) {
    state.lessons = state.lessons.filter(function (l) { return l.id !== id; });
    delete state.plans[id]; // the student's plans go with the lesson
    save();
    render();
  }

  function deleteLessonOnce(id) {
    var mo = ensureMonth(view.y, view.m);
    mo.lessons = mo.lessons.filter(function (l) { return l.id !== id; });
    delete state.plans[id]; // the student's plans go with the lesson
    prune(view.y, view.m);
    save();
    render();
  }

  // toggling swaps a class in place (no re-render) so the check draw-in and
  // strikethrough animations actually play
  function toggleTask(id, itemEl) {
    var hit = findTask(id);
    if (!hit) return;
    var t = hit.task;
    t.done = !t.done;
    // ticking a parent cascades down: a done parent still showing "2/5" would
    // be incoherent
    t.subs.forEach(function (s) { s.done = t.done; });
    save();
    paintTaskRow(itemEl, t);
    subRowsOf(itemEl, id).forEach(function (li, i) { paintTaskRow(li, t.subs[i]); });
  }

  function toggleSub(id, itemEl) {
    var hit = findSub(id);
    if (!hit) return;
    hit.sub.done = !hit.sub.done;
    rollUp(hit.parent);
    save();
    paintTaskRow(itemEl, hit.sub);
    // the parent row and its counter have to follow, still without re-rendering
    var parentEl = itemEl.parentNode.querySelector('[data-id="' + hit.parent.id + '"]');
    paintTaskRow(parentEl, hit.parent);
  }

  // also in place — re-rendering here would restart the strikethrough animation
  function toggleImp(id, itemEl) {
    var hit = findTask(id);
    if (!hit) return;
    var t = hit.task;
    t.imp = !t.imp;
    save();
    paintTaskRow(itemEl, t);
  }

  function subRowsOf(itemEl, id) {
    return [].slice.call(itemEl.parentNode.querySelectorAll('[data-parent="' + id + '"]'));
  }

  // Bring an existing row into line with its record without re-rendering it.
  // That is the entire point: changing classes here lets the check draw-in and
  // the strikethrough actually run, where a re-render would restart them.
  function paintTaskRow(li, t) {
    if (!li || !t) return;
    li.classList.toggle('done', !!t.done);
    li.classList.toggle('imp', !!t.imp);
    var box = li.querySelector('.checkbox');
    if (box) box.setAttribute('aria-checked', String(!!t.done));
    var flag = li.querySelector('.flag');
    if (flag) flag.setAttribute('aria-pressed', String(!!t.imp));
    var count = li.querySelector('.sub-count');
    if (count && t.subs) count.textContent = subCount(t);
  }

  function addSub(id) {
    var hit = findTask(id);
    if (!hit) return;
    var sid = uid();
    hit.task.subs.push({ id: sid, text: '', done: false });
    rollUp(hit.task); // a new, unfinished subtask reopens a parent that was done
    editNew = true;
    save();
    startEdit('sub', sid);
  }

  function deleteSub(id) {
    var hit = findSub(id);
    if (!hit) return;
    hit.parent.subs.splice(hit.i, 1);
    rollUp(hit.parent);
    if (hit.plan) planPrune(state, view.planLesson, view.planDate);
    save();
    render();
  }

  /* ------------------------------ wipes -------------------------------- */
  /* Pure transforms over a state object (exported for the tests): each wipes
     one shelf and prunes months that end up empty. The About page's buttons
     confirm, safety-export, then apply one of these. */

  function wipeCounts(st) {
    var out = { tasks: 0, goals: 0, projects: 0, lessons: 0, birthdays: 0, habits: 0 };
    Object.keys(st.months).forEach(function (k) {
      var mo = st.months[k];
      Object.keys(mo.days).forEach(function (dk) { out.tasks += mo.days[dk].length; });
      out.goals += mo.goals.length;
      out.lessons += mo.lessons.length;
    });
    out.lessons += st.lessons.length;
    out.projects = st.projects.length;
    out.birthdays = st.birthdays.length;
    out.habits = st.habits.length;
    return out;
  }

  function wipeMonthShelf(st, fn) {
    Object.keys(st.months).forEach(function (k) {
      var mo = st.months[k];
      fn(mo);
      if (!mo.goals.length && !mo.lessons.length && !Object.keys(mo.days).length &&
          !(mo.habitChecks && Object.keys(mo.habitChecks).length)) delete st.months[k];
    });
    return st;
  }

  function wipeTasks(st) {
    return wipeMonthShelf(st, function (mo) { mo.days = {}; });
  }
  function wipeGoals(st) {
    return wipeMonthShelf(st, function (mo) { mo.goals = []; });
  }
  function wipeProjects(st) {
    st.projects = [];
    return st;
  }
  function wipeLessons(st) {
    st.lessons = [];
    st.plans = {}; // plans live and die with their lessons
    return wipeMonthShelf(st, function (mo) { mo.lessons = []; });
  }
  function wipeBirthdays(st) {
    st.birthdays = [];
    return st;
  }
  function wipeHabits(st) {
    st.habits = [];
    return wipeMonthShelf(st, function (mo) { delete mo.habitChecks; });
  }
  function wipeAll() {
    return defaultState(); // everything, including the settings themselves
  }

  function wipeData(kind) {
    var counts = wipeCounts(state);
    var labels = {
      tasks: 'day tasks', goals: 'goals', projects: 'projects',
      lessons: 'lessons', birthdays: 'birthdays', habits: 'habits'
    };
    var msg = kind === 'all'
      ? 'Wipe EVERYTHING — all notes, and settings back to defaults?'
      : 'Wipe all ' + counts[kind] + ' ' + labels[kind] + '?\n\nThis is permanent.';
    if (!confirm(msg)) return;
    exportData(); // safety copy first, exactly like Import
    editing = null;
    if (kind === 'all') state = wipeAll();
    else if (kind === 'tasks') wipeTasks(state);
    else if (kind === 'goals') wipeGoals(state);
    else if (kind === 'projects') wipeProjects(state);
    else if (kind === 'lessons') wipeLessons(state);
    else if (kind === 'birthdays') wipeBirthdays(state);
    else if (kind === 'habits') wipeHabits(state);
    save();
    paintBar(); // "everything" may have switched sections back on
    render();
  }

  /* ------------------------------ drag & drop -------------------------- */
  /* Grab a task's ≡ handle and drop it at a boundary of its own list. Only
     parents drag — the array holds one element per task and its subs live
     inside it, so moving the block is moving one array element. On the day
     page the list mixes day tasks and dated project tasks, and the pointer
     events only offer boundaries of the dragged task's own list: dropping a
     day task into a project's span is not a decision this gesture makes. */
  var drag = null; // { kind: 'task'|'habit', id, task?, list?, startY, active, row, line, drop }

  function moveTask(list, id, beforeId, after) {
    var from = list.findIndex(function (t) { return t.id === id; });
    if (from < 0) return false;
    var target = -1;
    if (beforeId != null) {
      var bi = list.findIndex(function (t) { return t.id === beforeId; });
      if (bi < 0) return false;
      target = after ? bi + 1 : bi;
    } else {
      target = list.length;
    }
    if (target === from || target === from + 1) return false; // before/after itself
    var task = list.splice(from, 1)[0];
    if (target > from) target -= 1;
    list.splice(target, 0, task);
    return true;
  }

  // Habits are one flat array whose order is the display order; the ticks live
  // per habit id, so reordering the array moves a row and its ticks together.
  function moveHabit(list, id, beforeId, after) {
    var from = list.findIndex(function (h) { return h.id === id; });
    if (from < 0) return false;
    var target = -1;
    if (beforeId != null) {
      var bi = list.findIndex(function (h) { return h.id === beforeId; });
      if (bi < 0) return false;
      target = after ? bi + 1 : bi;
    } else {
      target = list.length;
    }
    if (target === from || target === from + 1) return false; // before/after itself
    var habit = list.splice(from, 1)[0];
    if (target > from) target -= 1;
    list.splice(target, 0, habit);
    return true;
  }

  function startDrag(e) {
    if (flipping || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!e.target.closest('.drag')) return;
    var row = e.target.closest('[data-id]');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var isHabit = row.classList.contains('habit-row');
    // an open edit commits first, and its re-render replaces this row — so
    // everything below re-looks the row up by id, on the visible page only
    if (editing) commitEdit();
    row = rowById(id);
    if (!row) return;
    if (isHabit) {
      drag = {
        kind: 'habit', id: id,
        startY: e.clientY, active: false, row: row, line: null, drop: null
      };
    } else {
      var hit = findTask(id);
      if (!hit) return;
      drag = {
        kind: 'task', id: id, task: hit.task, list: hit.list,
        startY: e.clientY, active: false, row: row, line: null, drop: null
      };
    }
    // capture keeps the gesture on this row; when it can't (some synthetic or
    // touch sequences) the book-level listeners still see every event
    try { row.setPointerCapture(e.pointerId); } catch (_) {}
  }

  // the block a candidate row belongs to: a subtask maps to its parent's block
  function blockBoundsOf(listEl, row) {
    var parentId = row.getAttribute('data-parent');
    var startRow = parentId ? listEl.querySelector('[data-id="' + parentId + '"]') : row;
    if (!startRow) return null;
    var endRow = startRow;
    while (endRow.nextElementSibling &&
           endRow.nextElementSibling.getAttribute('data-parent') === startRow.getAttribute('data-id')) {
      endRow = endRow.nextElementSibling;
    }
    return { start: startRow, end: endRow, id: startRow.getAttribute('data-id') };
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < 5) return;
      drag.active = true;
      drag.row.classList.add('dragging');
      document.body.classList.add('drag-on');
      drag.line = el('div', { class: 'drop-line' });
    }
    // scroll the page when the pointer rides the top or bottom edge
    var pageEl = drag.row.closest('.page');
    var pr = pageEl.getBoundingClientRect();
    if (e.clientY < pr.top + 48) pageEl.scrollTop -= 8;
    else if (e.clientY > pr.bottom - 48) pageEl.scrollTop += 8;

    // the habit table is a plain div of flat rows — nearest row edge wins,
    // with no subtask blocks to respect; tasks keep their list + block logic
    var listEl = drag.kind === 'habit' ? drag.row.parentElement : drag.row.closest('ul');
    var best = null, bestDist = Infinity;
    if (drag.kind === 'habit') {
      [].slice.call(listEl.querySelectorAll('.habit-row[data-id]')).forEach(function (r) {
        var rid = r.getAttribute('data-id');
        if (rid === drag.id) return;
        var topY = r.getBoundingClientRect().top;
        var bottomY = r.getBoundingClientRect().bottom;
        [{ y: topY, beforeId: rid, after: false },
         { y: bottomY, beforeId: rid, after: true }].forEach(function (cand) {
          var dist = Math.abs(e.clientY - cand.y);
          if (dist < bestDist) { bestDist = dist; best = cand; }
        });
      });
    } else {
      var draggedIds = [drag.id].concat(drag.task.subs.map(function (s) { return s.id; }));
      [].slice.call(listEl.querySelectorAll('[data-id]')).forEach(function (r) {
        var rid = r.getAttribute('data-id');
        if (draggedIds.indexOf(rid) > -1) return;
        var hit = findTask(rid);
        if (!hit || hit.list !== drag.list) return; // only the dragged task's own list
        var b = blockBoundsOf(listEl, r);
        if (!b) return;
        var topY = b.start.getBoundingClientRect().top;
        var bottomY = b.end.getBoundingClientRect().bottom;
        [{ y: topY, beforeId: b.id, after: false },
         { y: bottomY, beforeId: b.id, after: true }].forEach(function (cand) {
          var dist = Math.abs(e.clientY - cand.y);
          if (dist < bestDist) { bestDist = dist; best = cand; }
        });
      });
    }
    if (best) {
      var listRect = listEl.getBoundingClientRect();
      drag.line.style.top = (best.y - listRect.top) + 'px';
      if (!drag.line.parentNode) listEl.append(drag.line);
      drag.drop = { beforeId: best.beforeId, after: best.after };
    } else {
      drag.drop = null;
      if (drag.line.parentNode) drag.line.remove();
    }
  }

  function endDrag(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    document.body.classList.remove('drag-on');
    d.row.classList.remove('dragging');
    if (d.line) d.line.remove();
    if (e.type === 'pointercancel' || !d.active || !d.drop) return;
    var moved = d.kind === 'habit'
      ? moveHabit(state.habits, d.id, d.drop.beforeId, d.drop.after)
      : moveTask(d.list, d.id, d.drop.beforeId, d.drop.after);
    if (moved) {
      save();
      render();
    }
  }

  // Escape abandons the gesture without moving anything
  function cancelDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    document.body.classList.remove('drag-on');
    d.row.classList.remove('dragging');
    if (d.line) d.line.remove();
  }

  function startEdit(type, id, field) {
    editing = { type: type, id: id, field: field || 'name' };
    render();
    var row = editRow();
    var inp = row && (row.querySelector('.edit-input[data-field="' + editing.field + '"]')
      || row.querySelector('.edit-input'));
    if (inp) {
      inp.focus();
      var L = inp.value.length;
      inp.setSelectionRange(L, L);
    }
  }

  // the row currently open for editing, whichever page it lives on — scoped to
  // the visible page, never a stale copy left on another page's last render
  function editRow() {
    return editing ? rowById(editing.id) : null;
  }

  function commitEdit() {
    if (!editing) return;
    var type = editing.type, id = editing.id;
    var row = editRow();
    if (!row) { editing = null; return; }
    // read every field of the row before the re-render throws the inputs away
    var vals = {};
    row.querySelectorAll('.edit-input').forEach(function (n) {
      vals[n.getAttribute('data-field') || 'name'] = n.value;
    });
    var text = String(vals.name == null ? '' : vals.name).trim();
    editing = null;
    editNew = false;

    if (type === 'goal') {
      var goals = ensureMonth(view.y, view.m).goals;
      var gi = goals.findIndex(function (g) { return g.id === id; });
      if (gi > -1) {
        if (text) goals[gi].text = text;
        else goals.splice(gi, 1); // committing empty deletes
      }
    } else if (type === 'task') {
      var hit = findTask(id);
      if (hit) {
        if (!text) { // committing empty deletes
          hit.list.splice(hit.i, 1);
          if (hit.plan) planPrune(state, view.planLesson, view.planDate);
        } else {
          hit.task.text = text;
          // only the projects page offers a day field; an unparseable one keeps
          // the old value, and an empty one clears the date
          if (hit.project && 'day' in vals) {
            var iso = parseDate(vals.day, view.y, view.m);
            if (iso !== null) hit.task.day = iso || null;
          }
        }
      }
    } else if (type === 'sub') {
      var sh = findSub(id);
      if (sh) {
        if (text) sh.sub.text = text;
        else sh.parent.subs.splice(sh.i, 1); // committing empty deletes
        rollUp(sh.parent);
      }
    } else if (type === 'project') {
      // an empty name restores the old one rather than deleting — a project
      // holds tasks, so losing it must go through the × and its confirm
      var proj = getProject(id);
      if (proj && text) proj.name = text;
    } else if (type === 'habit') {
      var hi = state.habits.findIndex(function (x) { return x.id === id; });
      if (hi > -1) {
        if (text) state.habits[hi].name = text;
        // a habit's ticks die with it, so emptying the name asks first instead
        // of silently deleting (the × asks too) — declining keeps the old name
        else if (confirm('Delete "' + state.habits[hi].name + '" and its tick history?')) {
          deleteHabit(id);
          return; // deleteHabit saves and re-renders already
        }
      }
    } else if (type === 'bday') {
      var bi = state.birthdays.findIndex(function (b) { return b.id === id; });
      if (bi > -1) {
        if (!text) state.birthdays.splice(bi, 1);
        else {
          var d = parseInt(vals.day, 10);
          state.birthdays[bi].name = text;
          // an unparseable day just keeps the old one — no modal, no trapped focus
          if (d >= 1 && d <= MONTH_CAP[state.birthdays[bi].month - 1]) state.birthdays[bi].day = d;
        }
      }
    } else {
      commitLessonEdit(type, id, text, vals);
    }
    prune(view.y, view.m);
    save();
    render();
  }

  function commitLessonEdit(kind, id, name, vals) {
    var mo = ensureMonth(view.y, view.m);
    var list = kind === 'lesson' ? state.lessons : mo.lessons;
    var i = list.findIndex(function (l) { return l.id === id; });
    if (i < 0) return;
    if (!name) { list.splice(i, 1); delete state.plans[id]; return; }
    var l = list[i];
    l.name = name;
    var time = parseTime(vals.time);
    if (time) l.time = time; // bad time keeps the old one
    var when = parseWhen(vals.when);
    if (!when) return;
    var wantsWeekly = when.weekday != null;
    if (wantsWeekly === (kind === 'lesson')) {
      // same kind — just move it within its own list
      if (wantsWeekly) l.weekday = when.weekday;
      else if (when.day <= daysInMonth(view.y, view.m)) l.day = when.day;
      return;
    }
    // switched kinds: hand the record to the other list
    if (!wantsWeekly && when.day > daysInMonth(view.y, view.m)) return;
    list.splice(i, 1);
    if (wantsWeekly) {
      delete l.day;
      l.weekday = when.weekday;
      state.lessons.push(l);
    } else {
      delete l.weekday;
      l.day = when.day;
      mo.lessons.push(l);
    }
  }

  function cancelEdit() {
    if (!editing) return;
    // Escape on an existing row restores its text, as it always has. On a row
    // that was created blank a moment ago there is nothing to restore, so it
    // goes — otherwise Escape would leave an empty line on the page.
    if (editNew && editing.type === 'sub') {
      var hit = findSub(editing.id);
      if (hit) {
        hit.parent.subs.splice(hit.i, 1);
        rollUp(hit.parent);
        save();
      }
    }
    editNew = false;
    editing = null;
    render();
  }

  /* ------------------------------ renderers ---------------------------- */
  function renderMonth() {
    var y = view.y, m = view.m;
    var mo = getMonth(y, m);
    var inner = el('div', { class: 'page-inner' });

    inner.append(el('div', { class: 'month-head' },
      el('button', { class: 'nav-arrow', type: 'button', 'data-action': 'prev-month', 'aria-label': 'Previous month', text: '‹' }),
      el('h1', { class: 'month-title', text: MONTH_NAMES[m - 1] + ' ' + y }),
      el('button', { class: 'nav-arrow', type: 'button', 'data-action': 'next-month', 'aria-label': 'Next month', text: '›' })
    ));

    var grid = el('div', { class: 'month-grid' });

    /* dates column */
    var datesCol = el('section', { class: 'dates-col' });
    datesCol.append(el('h2', { class: 'section-title', text: 'Dates' }));
    var dl = el('ul', { class: 'date-list' });
    var today = new Date();
    var isThisMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
    var n = daysInMonth(y, m);
    var dated = datedIndex(y, m);
    for (var d = 1; d <= n; d++) {
      // a dated project task counts here exactly like one written on the day
      var tasks = getTasks(y, m, d).concat((dated[pad2(d)] || []).map(function (e) { return e.task; }));
      var projNames = (dated[pad2(d)] || []).map(function (e) { return e.project.name; });
      var open = tasks.filter(function (t) { return !t.done; }).length;
      // a section that is switched off takes its marks in the dates column with
      // it — hiding "Birthdays" but still printing names here would be odd
      var names = !secOn('birthdays') ? [] : state.birthdays
        .filter(function (b) { return b.month === m && b.day === d; })
        .map(function (b) { return b.name; });
      var flagged = secOn('important') && tasks.some(function (t) { return t.imp; });
      var les = secOn('lessons') ? lessonsOn(y, m, d) : [];
      var row = el('li', {
        class: 'date-row' + (isThisMonth && today.getDate() === d ? ' today' : ''),
        'data-action': 'open-day',
        'data-day': d,
        role: 'button',
        tabindex: '0',
        'aria-label': MONTH_NAMES[m - 1] + ' ' + d + (flagged ? ' — has an important item' : '')
      });
      row.append(el('span', { class: 'date-wd', 'aria-hidden': 'true', text: dateWeekday(y, m, d) }));
      row.append(el('span', { class: 'date-num', text: d }));
      if (flagged) row.append(el('span', { class: 'date-imp', 'aria-hidden': 'true', text: '!' }));
      if (names.length) row.append(el('span', { class: 'date-bday', text: names.join(', ') }));
      if (les.length) {
        row.append(el('span', {
          class: 'date-lesson',
          text: les.map(function (l) { return fmtTime(l.time); }).join(', ')
        }));
      }
      if (projNames.length) {
        row.append(el('span', {
          class: 'date-proj',
          text: '▸ ' + projNames.filter(function (nm, i) { return projNames.indexOf(nm) === i; }).join(', ')
        }));
      }
      if (tasks.length) {
        row.append(el('span', {
          class: 'date-hint' + (open === 0 ? ' all-done' : ''),
          text: open === 0 ? '✓' : String(open)
        }));
      }
      dl.append(row);
    }
    datesCol.append(dl);

    /* side column: each section builds itself and can be switched off in
       Settings. An off section is simply never built — nothing is deleted. */
    var side = el('div', { class: 'side-col' });
    if (secOn('goals')) side.append(goalsSection(mo));
    if (secOn('important')) {
      var impSec = importantSection(mo, m, dated);
      if (impSec) side.append(impSec);
    }
    if (secOn('projects')) side.append(projectSection());
    if (secOn('birthdays')) side.append(birthdaySection(m));
    if (secOn('lessons')) side.append(lessonSection(y, m, mo));

    grid.append(datesCol, side);
    inner.append(grid);
    if (secOn('habits')) inner.append(habitSection(y, m, mo));
    inner.append(el('p', { class: 'foot-note', text: 'Saved in this browser — use Export now and then for a backup.' }));

    setPage(pageMonth, inner);
  }

  /* habits: a full-width table under the spread — one row per habit, one cell
     per day of the month, tap a cell to tick it. The list of habits is global;
     the ticks live in this month's habitChecks. */
  function habitSection(y, m, mo) {
    var sec = el('section', { class: 'habit-sec' });
    sec.append(el('h2', { class: 'section-title', text: 'Habits' }));
    var n = daysInMonth(y, m);
    var checks = mo.habitChecks || {};
    var today = new Date();
    if (state.habits.length) {
      var wrap = el('div', { class: 'habit-table' });
      var head = el('div', { class: 'habit-row habit-head', 'aria-hidden': 'true' });
      head.append(el('span', { class: 'habit-name' }));
      for (var d = 1; d <= n; d++) {
        head.append(el('span', {
          class: 'habit-daynum' + (today.getFullYear() === y && today.getMonth() + 1 === m &&
            today.getDate() === d ? ' today' : ''),
          text: d
        }));
      }
      wrap.append(head);
      state.habits.forEach(function (h) { wrap.append(habitRow(h, y, m, n, checks[h.id])); });
      sec.append(wrap);
    }
    sec.append(el('div', { class: 'habit-add' },
      el('input', {
        class: 'ghost-input', type: 'text', id: 'habit-input',
        placeholder: state.habits.length ? 'Add a habit…' : 'No habits yet — write one…'
      })
    ));
    sec.append(el('p', { class: 'lesson-hint', text: 'Tap a day to tick it; drag ≡ to move a habit. Habits carry across months; the ticks are per day.' }));
    return sec;
  }

  function habitRow(h, y, m, n, checks) {
    checks = checks || {};
    var li = el('div', { class: 'habit-row', 'data-id': h.id });
    if (editing && editing.type === 'habit' && editing.id === h.id) {
      li.append(el('input', { class: 'edit-input habit-name-input', type: 'text', value: h.name }));
    } else {
      li.append(el('span', { class: 'habit-name' },
        el('button', {
          class: 'drag', type: 'button', 'data-action': 'drag-habit',
          'aria-label': 'Move habit ' + h.name, text: '≡'
        }),
        el('span', { class: 'seg', 'data-action': 'edit-habit', text: h.name }),
        el('button', {
          class: 'del', type: 'button', 'data-action': 'del-habit',
          'aria-label': 'Delete habit ' + h.name, text: '×'
        })
      ));
    }
    for (var d = 1; d <= n; d++) {
      var on = !!checks[d];
      li.append(el('span', {
        class: 'habit-cell',
        'data-action': 'toggle-habit',
        'data-habit': h.id,
        'data-day': d,
        role: 'checkbox',
        'aria-checked': String(on),
        tabindex: '0',
        'aria-label': h.name + ' — ' + MONTH_NAMES[m - 1] + ' ' + d
      }, el('span', { class: 'habit-dot' + (on ? ' on' : ''), 'aria-hidden': 'true' })));
    }
    return li;
  }

  function goalsSection(mo) {
    var goalsSec = el('section', { class: 'goals-sec' });
    goalsSec.append(el('h2', { class: 'section-title', text: 'Goals' }));
    var gl = el('ul', { class: 'goal-list' });
    mo.goals.forEach(function (g) {
      var li = el('li', { class: 'item', 'data-id': g.id });
      li.append(el('span', { class: 'bullet', text: '•' }));
      if (editing && editing.type === 'goal' && editing.id === g.id) {
        li.append(el('input', { class: 'edit-input', type: 'text', value: g.text }));
      } else {
        li.append(el('span', { class: 'item-text', 'data-action': 'edit-goal', text: g.text }));
      }
      li.append(el('button', { class: 'del', type: 'button', 'data-action': 'del-goal', 'aria-label': 'Delete goal', text: '×' }));
      gl.append(li);
    });
    goalsSec.append(gl);
    goalsSec.append(el('div', { class: 'add-row' },
      el('span', { class: 'bullet ghost-mark', text: '•' }),
      el('input', {
        class: 'ghost-input', type: 'text', id: 'goal-input',
        placeholder: mo.goals.length ? 'Add a goal…' : 'No goals yet — write one…'
      })
    ));
    return goalsSec;
  }

  /* important: whatever was flagged on this month's day pages, hoisted up here
     so the spread is the only thing you have to look at. Nothing flagged means
     no section at all — it never sits there empty, so this returns null. */
  function importantSection(mo, m, dated) {
    var byDay = {};
    Object.keys(mo.days).forEach(function (dk) {
      mo.days[dk].forEach(function (t) {
        if (t.imp) (byDay[dk] || (byDay[dk] = [])).push({ task: t, project: null });
      });
    });
    Object.keys(dated).forEach(function (dk) {
      dated[dk].forEach(function (e) {
        if (e.task.imp) (byDay[dk] || (byDay[dk] = [])).push(e);
      });
    });
    var flagged = [];
    Object.keys(byDay).sort().forEach(function (dk) {
      byDay[dk].forEach(function (e) {
        flagged.push({ day: +dk, task: e.task, project: e.project });
      });
    });
    if (!flagged.length) return null;
    var impSec = el('section', { class: 'imp-sec' });
    impSec.append(el('h2', { class: 'section-title', text: 'Important' }));
    var il = el('ul', { class: 'imp-list' });
    flagged.forEach(function (f) {
      var li = el('li', {
        class: 'item imp-row' + (f.task.done ? ' done' : ''),
        'data-action': 'open-day',
        'data-day': f.day,
        role: 'button',
        tabindex: '0',
        'aria-label': f.task.text + ' — ' + MONTH_NAMES[m - 1] + ' ' + f.day
      });
      li.append(el('span', { class: 'imp-mark', 'aria-hidden': 'true', text: '!' }));
      li.append(el('span', { class: 'imp-day', text: ordinal(f.day) }));
      li.append(el('span', { class: 'item-text', text: f.task.text }));
      if (f.project) li.append(el('span', { class: 'task-proj', text: f.project.name }));
      il.append(li);
    });
    impSec.append(il);
    return impSec;
  }

  /* a read-only index of the projects page, so the spread shows what is on the
     go without having to turn to it */
  function projectSection() {
    var sec = el('section', { class: 'proj-sec' });
    sec.append(el('h2', { class: 'section-title', text: 'Projects' }));
    if (!state.projects.length) {
      sec.append(el('p', { class: 'lesson-hint', text: 'No projects yet — open Projects to start one.' }));
      return sec;
    }
    var ul = el('ul', { class: 'proj-list' });
    state.projects.forEach(function (p) {
      ul.append(el('li', {
        class: 'item proj-row',
        'data-action': 'go-page', 'data-page': 'projects',
        role: 'button', tabindex: '0',
        'aria-label': p.name + ' — ' + countDone(p.tasks) + ' done'
      },
        el('span', { class: 'bullet', text: '▸' }),
        el('span', { class: 'item-text', text: p.name }),
        el('span', { class: 'proj-count', text: countDone(p.tasks) })
      ));
    });
    sec.append(ul);
    return sec;
  }

  function birthdaySection(m) {
    var bdaySec = el('section', { class: 'bday-sec' });
    bdaySec.append(el('h2', { class: 'section-title', text: 'Birthdays' }));
    var bl = el('ul', { class: 'bday-list' });
    state.birthdays
      .filter(function (b) { return b.month === m; })
      .sort(function (a, b) { return a.day - b.day; })
      .forEach(function (b) {
        var li = el('li', { class: 'item', 'data-id': b.id });
        if (editing && editing.type === 'bday' && editing.id === b.id) {
          li.append(
            el('input', { class: 'edit-input', 'data-field': 'name', type: 'text', value: b.name }),
            el('input', { class: 'edit-input f-day', 'data-field': 'day', type: 'text', value: b.day, inputmode: 'numeric', maxlength: '2' })
          );
        } else {
          li.append(el('span', { class: 'item-text' },
            el('span', { class: 'seg', 'data-action': 'edit-bday', 'data-field': 'name', text: b.name }),
            ' – ',
            el('span', { class: 'seg', 'data-action': 'edit-bday', 'data-field': 'day', text: ordinal(b.day) })
          ));
        }
        li.append(el('button', { class: 'del', type: 'button', 'data-action': 'del-bday', 'aria-label': 'Delete birthday', text: '×' }));
        bl.append(li);
      });
    bdaySec.append(bl);
    bdaySec.append(el('div', { class: 'bday-add' },
      el('input', { class: 'ghost-input', type: 'text', id: 'bday-name', placeholder: 'Name' }),
      el('input', { class: 'ghost-input bday-day-input', type: 'text', id: 'bday-day', placeholder: 'Day', inputmode: 'numeric', maxlength: '2' })
    ));
    return bdaySec;
  }

  /* lessons: the weekly timetable first, then this month's one-offs */
  function lessonSection(y, m, mo) {
    var lessonSec = el('section', { class: 'lesson-sec' });
    lessonSec.append(el('h2', { class: 'section-title', text: 'Lessons' }));
    var ll = el('ul', { class: 'lesson-list' });
    var weekly = state.lessons.slice().sort(function (a, b) {
      return (weekRank(a.weekday) - weekRank(b.weekday)) || byTime(a, b);
    });
    weekly.forEach(function (l) { ll.append(lessonRow(l, 'lesson')); });
    var once = mo.lessons.slice().sort(function (a, b) {
      return (a.day - b.day) || byTime(a, b);
    });
    if (once.length && weekly.length) {
      ll.append(el('li', { class: 'lesson-divider', 'aria-hidden': 'true' }));
    }
    once.forEach(function (l) { ll.append(lessonRow(l, 'lesson-once')); });
    lessonSec.append(ll);
    lessonSec.append(el('div', { class: 'lesson-add' },
      el('input', { class: 'ghost-input', type: 'text', id: 'lesson-name', placeholder: 'Student' }),
      el('input', { class: 'ghost-input lesson-when-input', type: 'text', id: 'lesson-when', placeholder: 'Mon or 3' }),
      el('input', { class: 'ghost-input lesson-time-input', type: 'text', id: 'lesson-time', placeholder: fmtTime('16:00') })
    ));
    lessonSec.append(el('p', { class: 'lesson-hint', text: 'A weekday repeats every week; a date is a one-off.' }));
    return lessonSec;
  }

  function renderDay() {
    var y = view.y, m = view.m, day = view.day;
    var inner = el('div', { class: 'page-inner' });

    var weekday = new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'long' });
    inner.append(el('div', { class: 'day-head' },
      el('button', { class: 'back-link', type: 'button', 'data-action': 'go-back', text: '‹ ' + MONTH_NAMES[m - 1] }),
      el('h1', { class: 'day-title', text: weekday + ', ' + MONTH_NAMES[m - 1] + ' ' + ordinal(day) })
    ));

    var names = !secOn('birthdays') ? [] : state.birthdays
      .filter(function (b) { return b.month === m && b.day === day; })
      .map(function (b) { return b.name; });
    if (names.length) {
      inner.append(el('p', { class: 'day-bday', text: '★ Birthday: ' + names.join(', ') }));
    }

    var les = secOn('lessons') ? lessonsOn(y, m, day) : [];
    if (les.length) {
      var lp = el('p', { class: 'day-lesson' }, '✎ Lessons: ');
      les.forEach(function (l, i) {
        if (i) lp.append(' · ');
        lp.append(el('button', {
          class: 'lesson-link', type: 'button',
          'data-action': 'open-plan', 'data-lesson': l.id, 'data-day': day,
          text: fmtTime(l.time) + ' ' + l.name
        }));
      });
      inner.append(lp);
    }

    // the same ticks as the spread, reachable as bubbles — tap one and the
    // month table agrees, since both write the one habitChecks map
    var habits = secOn('habits') ? state.habits : [];
    if (habits.length) {
      var hc = getMonth(y, m).habitChecks || {};
      var hline = el('p', { class: 'day-lesson' }, '✎ Habits: ');
      habits.forEach(function (h) {
        var on = !!(hc[h.id] && hc[h.id][day]);
        // inline-flex bubble: the dot is a block in the month table, and a
        // bare block here would break the line apart
        hline.append(el('span', { class: 'habit-bubble' },
          el('span', {
            class: 'habit-dot' + (on ? ' on' : ''),
            'data-action': 'toggle-habit-day',
            'data-habit': h.id,
            role: 'checkbox', 'aria-checked': String(on), tabindex: '0',
            'aria-label': h.name + ' — ' + MONTH_NAMES[m - 1] + ' ' + ordinal(day)
          }),
          el('span', { text: h.name })
        ));
      });
      inner.append(hline);
    }

    var list = el('ul', { class: 'task-list' });
    // the day's own tasks, then anything a project has dated to today
    var entries = tasksOn(y, m, day);
    entries.forEach(function (e) { appendTask(list, e.task, { project: e.project }); });
    inner.append(list);

    var add = el('div', { class: 'task-add' },
      el('span', { class: 'checkbox ghost', 'aria-hidden': 'true' }),
      el('input', {
        class: 'ghost-input', type: 'text', id: 'task-input',
        placeholder: entries.length ? 'Add a task…' : 'Nothing planned — add a task…'
      })
    );
    inner.append(add);

    setPage(pageDay, inner);
  }

  function renderProjects() {
    var inner = el('div', { class: 'page-inner' });

    inner.append(el('div', { class: 'day-head' },
      el('button', { class: 'back-link', type: 'button', 'data-action': 'go-back', text: backLabel() }),
      el('h1', { class: 'day-title', text: 'Projects' })
    ));

    state.projects.forEach(function (p) {
      var sec = el('section', { class: 'proj', 'data-project': p.id, 'data-id': p.id });
      var head = el('div', { class: 'proj-head' });
      if (editing && editing.type === 'project' && editing.id === p.id) {
        head.append(el('input', { class: 'edit-input proj-name-input', type: 'text', value: p.name }));
      } else {
        head.append(el('h2', { class: 'section-title proj-name' },
          el('span', { class: 'seg', 'data-action': 'edit-project', text: p.name })
        ));
      }
      head.append(el('span', { class: 'proj-count', text: countDone(p.tasks) }));
      head.append(el('button', {
        class: 'del', type: 'button', 'data-action': 'del-project',
        'aria-label': 'Delete the project ' + p.name, text: '×'
      }));
      sec.append(head);

      var list = el('ul', { class: 'task-list' });
      p.tasks.forEach(function (t) { appendTask(list, t, { showDay: true }); });
      sec.append(list);

      sec.append(el('div', { class: 'task-add' },
        el('span', { class: 'checkbox ghost', 'aria-hidden': 'true' }),
        el('input', {
          class: 'ghost-input', type: 'text', 'data-add': 'proj-task',
          'aria-label': 'Add a task to ' + p.name,
          placeholder: p.tasks.length ? 'Add a task…' : 'Nothing here yet — add a task…'
        })
      ));
      inner.append(sec);
    });

    inner.append(el('div', { class: 'proj-add' },
      el('input', {
        class: 'ghost-input', type: 'text', id: 'project-input',
        'aria-label': 'New project',
        placeholder: state.projects.length ? 'New project…' : 'No projects yet — name one…'
      })
    ));
    inner.append(el('p', { class: 'set-hint', text: 'Give a task a date and it shows up on that day as well — still the same task, kept here.' }));

    setPage(pageProjects, inner);
  }

  // The Lessons index: every weekly lesson and this month's one-offs, like the
  // spread's list but with clickable names — a student's name opens their plan.
  function renderLessons() {
    var inner = el('div', { class: 'page-inner' });

    inner.append(el('div', { class: 'day-head' },
      el('button', { class: 'back-link', type: 'button', 'data-action': 'go-back', text: backLabel() }),
      el('h1', { class: 'day-title', text: 'Lessons' })
    ));

    var sec = el('section', { class: 'lesson-sec' });
    sec.append(el('h2', { class: 'section-title', text: 'Weekly' }));
    var ll = el('ul', { class: 'lesson-list' });
    var weekly = state.lessons.slice().sort(function (a, b) {
      return (weekRank(a.weekday) - weekRank(b.weekday)) || byTime(a, b);
    });
    weekly.forEach(function (l) { ll.append(lessonRow(l, 'lesson', { openPlan: true })); });

    var mo = getMonth(view.y, view.m);
    var once = mo.lessons.slice().sort(function (a, b) {
      return (a.day - b.day) || byTime(a, b);
    });
    if (once.length) {
      if (weekly.length) ll.append(el('li', { class: 'lesson-divider', 'aria-hidden': 'true' }));
      once.forEach(function (l) { ll.append(lessonRow(l, 'lesson-once', { openPlan: true })); });
    }
    sec.append(ll);
    sec.append(el('div', { class: 'lesson-add' },
      el('input', { class: 'ghost-input', type: 'text', id: 'lesson-name', placeholder: 'Student' }),
      el('input', { class: 'ghost-input lesson-when-input', type: 'text', id: 'lesson-when', placeholder: 'Mon or 3' }),
      el('input', { class: 'ghost-input lesson-time-input', type: 'text', id: 'lesson-time', placeholder: fmtTime('16:00') })
    ));
    sec.append(el('p', { class: 'lesson-hint',
      text: 'Click a student to open their lesson plan. A weekday repeats every week; a date is a one-off in ' + MONTH_NAMES[view.m - 1] + '.' }));
    inner.append(sec);

    setPage(pageLessons, inner);
  }

  // One lesson's plan for one date: an activity checklist (project-style task
  // rows, minus the Important flag) and a free-text notes box. Weekly lessons
  // step a week at a time and keep every week's plan; one-offs have one date.
  function renderLessonPlan() {
    var hit = findLesson(view.planLesson);
    if (!hit) { // the lesson was deleted or replaced under us — land on the index
      view.planLesson = null;
      view.planDate = null;
      showPageNow('lessons');
      renderLessons();
      return;
    }
    var inner = el('div', { class: 'page-inner' });
    var weekly = hit.kind === 'lesson';
    var p = view.planDate.split('-');
    var pd = new Date(+p[0], +p[1] - 1, +p[2]);

    // the schedule on the left (when it happens), the concrete date on the
    // right; a weekly plan steps a week at a time, a one-off is its own date
    var sub = el('p', { class: 'plan-subtitle' });
    if (weekly) {
      sub.append(el('button', { class: 'nav-arrow', type: 'button', 'data-action': 'plan-prev', 'aria-label': 'Previous lesson', text: '‹' }));
      sub.append(el('span', {
        text: WEEKDAY_ABBR[hit.lesson.weekday] + ' · ' + fmtTime(hit.lesson.time) + ' · ' +
          MONTH_NAMES[pd.getMonth()] + ' ' + ordinal(pd.getDate())
      }));
      sub.append(el('button', { class: 'nav-arrow', type: 'button', 'data-action': 'plan-next', 'aria-label': 'Next lesson', text: '›' }));
    } else {
      sub.append(el('span', {
        text: MONTH_NAMES[hit.m - 1] + ' ' + ordinal(hit.lesson.day) + ' · ' + fmtTime(hit.lesson.time)
      }));
    }

    inner.append(el('div', { class: 'day-head' },
      el('button', { class: 'back-link', type: 'button', 'data-action': 'go-back', text: backLabel() }),
      el('h1', { class: 'day-title', text: hit.lesson.name })
    ), sub);

    var plan = getPlan(view.planLesson, view.planDate);
    var list = el('ul', { class: 'task-list' });
    plan.tasks.forEach(function (t) { appendTask(list, t, { plan: true }); });
    inner.append(list);

    inner.append(el('div', { class: 'task-add' },
      el('span', { class: 'checkbox ghost', 'aria-hidden': 'true' }),
      el('input', {
        class: 'ghost-input', type: 'text', 'data-add': 'plan-task',
        'aria-label': 'Add a plan item',
        placeholder: plan.tasks.length ? 'Add a plan item…' : 'Plan this lesson — add an item…'
      })
    ));

    inner.append(el('section', { class: 'set-sec plan-notes-sec' },
      el('h2', { class: 'section-title', text: 'Notes' }),
      el('textarea', {
        class: 'plan-notes', id: 'plan-notes', rows: '4',
        'aria-label': 'Lesson notes',
        placeholder: 'Homework, materials, things to watch…'
      })
    ));

    setPage(pageLessonPlan, inner);
    var ta = $('#plan-notes');
    if (ta) ta.value = plan.notes;
  }

  // parents only: a count is about the things you listed, not their innards
  function countDone(tasks) {
    return tasks.filter(function (t) { return t.done; }).length + '/' + tasks.length;
  }

  function renderSettings() {
    var inner = el('div', { class: 'page-inner' });

    inner.append(el('div', { class: 'day-head' },
      el('button', { class: 'back-link', type: 'button', 'data-action': 'go-back', text: backLabel() }),
      el('h1', { class: 'day-title', text: 'Settings' })
    ));

    /* which sections the month spread shows */
    var secs = el('section', { class: 'set-sec' });
    secs.append(el('h2', { class: 'section-title', text: 'Sections' }));
    SECTIONS.forEach(function (sec) {
      var on = secOn(sec.key);
      var box = el('span', {
        class: 'checkbox' + (on ? ' on' : ''),
        'data-action': 'toggle-section', 'data-section': sec.key,
        role: 'checkbox', 'aria-checked': String(on), tabindex: '0',
        'aria-label': sec.label
      });
      box.innerHTML = CHECK_SVG; // static trusted markup, never user text
      secs.append(el('div', { class: 'set-row' }, box,
        el('span', {
          class: 'set-label', 'data-action': 'toggle-section', 'data-section': sec.key,
          text: sec.label
        })
      ));
    });
    secs.append(el('p', { class: 'set-hint', text: 'Switching a section off only hides it — everything you wrote stays.' }));
    inner.append(secs);

    /* clock */
    var clock = el('section', { class: 'set-sec' });
    clock.append(el('h2', { class: 'section-title', text: 'Clock' }));
    var picked = state.timeFormat || 'auto';
    var row = el('div', { class: 'chip-row' });
    [['auto', 'Follow this device'], ['24', '24-hour'], ['12', '12-hour']].forEach(function (c) {
      row.append(el('button', {
        class: 'chip' + (picked === c[0] ? ' on' : ''), type: 'button',
        'data-action': 'set-clock', 'data-fmt': c[0],
        'aria-pressed': String(picked === c[0]), text: c[1]
      }));
    });
    clock.append(row);
    clock.append(el('p', { class: 'set-hint', text: 'Times are always stored the same way — this only changes how they read.' }));
    inner.append(clock);

    /* pomodoro */
    var p = state.settings.pomodoro;
    var pomSec = el('section', { class: 'set-sec' });
    pomSec.append(el('h2', { class: 'section-title', text: 'Timer' }));
    pomSec.append(el('div', { class: 'set-row' },
      el('span', { class: 'set-label', text: 'Focus' }),
      el('input', {
        class: 'num-input', type: 'text', 'data-set': 'pom-work',
        value: p.work, inputmode: 'numeric', maxlength: '3', 'aria-label': 'Focus minutes'
      }),
      el('span', { class: 'set-label', text: 'min · Break' }),
      el('input', {
        class: 'num-input', type: 'text', 'data-set': 'pom-rest',
        value: p.rest, inputmode: 'numeric', maxlength: '3', 'aria-label': 'Break minutes'
      }),
      el('span', { class: 'set-label', text: 'min' })
    ));
    var presets = el('div', { class: 'chip-row' });
    POM_PRESETS.forEach(function (c) {
      var on = p.work === c[0] && p.rest === c[1];
      presets.append(el('button', {
        class: 'chip' + (on ? ' on' : ''), type: 'button',
        'data-action': 'pom-preset', 'data-work': c[0], 'data-rest': c[1],
        'aria-pressed': String(on), text: c[0] + ' / ' + c[1]
      }));
    });
    pomSec.append(presets);
    var chimeOn = p.chime !== false;
    var chimeBox = el('span', {
      class: 'checkbox' + (chimeOn ? ' on' : ''),
      'data-action': 'toggle-chime',
      role: 'checkbox', 'aria-checked': String(chimeOn), tabindex: '0',
      'aria-label': 'Chime when a stretch ends'
    });
    chimeBox.innerHTML = CHECK_SVG; // static trusted markup, never user text
    pomSec.append(el('div', { class: 'set-row' }, chimeBox,
      el('span', { class: 'set-label', 'data-action': 'toggle-chime', text: 'Chime when a stretch ends' })
    ));
    pomSec.append(el('p', { class: 'set-hint', text: 'When a stretch ends the timer switches over and waits — it never starts the next one for you. Reloading the page starts a fresh focus stretch.' }));
    inner.append(pomSec);

    /* about + backups */
    var about = el('section', { class: 'set-sec' });
    about.append(el('h2', { class: 'section-title', text: 'About' }));
    about.append(el('p', { class: 'about-line', text: 'Turnleaf ' + VERSION }));
    about.append(el('p', { class: 'about-line dim', text: 'Notes format ' + state.version + ' · ' + storageUsed() + ' stored' }));
    about.append(el('div', { class: 'about-btns' },
      el('button', { class: 'ink-btn', type: 'button', 'data-action': 'export', text: 'Export a backup' }),
      el('button', { class: 'ink-btn', type: 'button', 'data-action': 'import', text: 'Import a backup…' })
    ));
    about.append(el('p', { class: 'about-line dim', text: 'Your notes live in this browser and nowhere else. Importing replaces everything, so it downloads a safety copy first.' }));
    about.append(el('p', { class: 'about-line dim', text: 'Backups written by this version will not open in older builds of Turnleaf.' }));

    /* wiping one shelf at a time, inside About with the backups — every wipe
       confirms, safety-exports, and leaves the rest of the book untouched */
    var counts = wipeCounts(state);
    var wipeKinds = [
      ['tasks', 'Day tasks', counts.tasks],
      ['goals', 'Goals', counts.goals],
      ['projects', 'Projects (with their tasks)', counts.projects],
      ['lessons', 'Lessons (with their plans)', counts.lessons],
      ['birthdays', 'Birthdays', counts.birthdays],
      ['habits', 'Habits (with tick history)', counts.habits]
    ];
    var wipeSec = el('section', { class: 'set-sec wipe-sec' });
    wipeSec.append(el('h2', { class: 'section-title', text: 'Wipe data' }));
    wipeKinds.forEach(function (w) {
      wipeSec.append(el('div', { class: 'wipe-row' },
        el('span', { class: 'set-label', text: w[1] }),
        el('span', { class: 'wipe-count', text: w[2] }),
        el('button', { class: 'ink-btn wipe-btn', type: 'button', 'data-action': 'wipe-' + w[0], text: 'Wipe…' })
      ));
    });
    wipeSec.append(el('div', { class: 'wipe-row' },
      el('span', { class: 'set-label wipe-all-label', text: 'Everything' }),
      el('button', { class: 'ink-btn wipe-btn wipe-everything', type: 'button', 'data-action': 'wipe-all', text: 'Wipe all' })
    ));
    wipeSec.append(el('p', { class: 'set-hint', text: 'Wiping is permanent — each wipe downloads a safety backup first, and only that shelf is cleared.' }));
    about.append(wipeSec);

    if (!storageOk || saveFailed) {
      about.append(el('p', { class: 'about-line warn', text: 'Storage is unavailable right now — export often.' }));
    }
    inner.append(about);

    setPage(pageSettings, inner);
  }

  // where the back link goes: the top of the trail — whichever page Back
  // would return to
  function backLabel() {
    var top = backStack.length ? backStack[backStack.length - 1] : 'month';
    if (top === 'day' && view.day != null) {
      return '‹ ' + MONTH_NAMES[view.m - 1] + ' ' + ordinal(view.day);
    }
    if (top === 'month') return '‹ ' + MONTH_NAMES[view.m - 1];
    if (top === 'projects') return '‹ Projects';
    if (top === 'lessons') return '‹ Lessons';
    if (top === 'lesson-plan') return '‹ Plan';
    if (top === 'settings') return '‹ Settings';
    return '‹ Back';
  }

  function storageUsed() {
    var raw = '';
    try { raw = localStorage.getItem(KEY) || ''; } catch (e) { return 'unknown size'; }
    return raw.length < 1024 ? raw.length + ' bytes' : (raw.length / 1024).toFixed(1) + ' KB';
  }

  // One row shape for both kinds of lesson — they differ only in what "when"
  // means (a weekday vs a date), and editing that field converts between them.
  // opts.openPlan (the Lessons page) makes the name open the plan page instead
  // of editing — planning is the point of that page.
  function lessonRow(l, kind, opts) {
    var li = el('li', { class: 'item', 'data-id': l.id });
    var when = kind === 'lesson' ? WEEKDAY_ABBR[l.weekday] : ordinal(l.day);
    if (editing && editing.type === kind && editing.id === l.id) {
      li.append(
        el('input', { class: 'edit-input f-when', 'data-field': 'when', type: 'text',
          value: kind === 'lesson' ? WEEKDAY_ABBR[l.weekday] : String(l.day) }),
        el('input', { class: 'edit-input f-time', 'data-field': 'time', type: 'text', value: fmtTime(l.time) }),
        el('input', { class: 'edit-input', 'data-field': 'name', type: 'text', value: l.name })
      );
    } else {
      li.append(el('span', { class: 'item-text' },
        el('span', { class: 'seg', 'data-action': 'edit-' + kind, 'data-field': 'when', text: when }),
        ' ',
        el('span', { class: 'seg', 'data-action': 'edit-' + kind, 'data-field': 'time', text: fmtTime(l.time) }),
        ' – ',
        (opts && opts.openPlan)
          ? el('button', {
            class: 'lesson-link', type: 'button',
            'data-action': 'open-plan', 'data-lesson': l.id,
            'aria-label': 'Plan a lesson with ' + l.name, text: l.name
          })
          : el('span', { class: 'seg', 'data-action': 'edit-' + kind, 'data-field': 'name', text: l.name })
      ));
    }
    li.append(el('button', {
      class: 'del', type: 'button',
      'data-action': kind === 'lesson' ? 'del-lesson' : 'del-lesson-once',
      'aria-label': kind === 'lesson' ? 'Delete weekly lesson' : 'Delete lesson', text: '×'
    }));
    return li;
  }

  // ctx.project — this row is a project's task showing on a day page, so it
  //   carries the project's name; ctx.showDay — it is on the projects page, so
  //   its optional date is shown and editable; ctx.plan — it is a lesson-plan
  //   item: planning material, not a todo, so there is no Important flag.
  function taskRow(t, ctx) {
    ctx = ctx || {};
    var li = el('li', {
      class: 'task' + (t.done ? ' done' : '') + (t.imp ? ' imp' : '') + (ctx.project ? ' from-proj' : ''),
      'data-id': t.id
    });
    li.append(el('button', {
      class: 'drag', type: 'button', 'data-action': 'drag-task',
      'aria-label': 'Move task', text: '≡'
    }));
    var box = el('span', {
      class: 'checkbox', 'data-action': 'toggle-task',
      role: 'checkbox', 'aria-checked': String(t.done), tabindex: '0'
    });
    box.innerHTML = CHECK_SVG; // static trusted markup, never user text
    li.append(box);
    var open = editing && editing.type === 'task' && editing.id === t.id;
    if (open) {
      li.append(el('input', { class: 'edit-input', type: 'text', value: t.text }));
    } else {
      li.append(el('span', { class: 'item-text', 'data-action': 'edit-task', text: t.text }));
    }
    if (t.subs.length) li.append(el('span', { class: 'sub-count', text: subCount(t) }));
    if (ctx.project) {
      // inert: the label says where the task lives, it is not a way to get there
      li.append(el('span', { class: 'task-proj', text: ctx.project.name }));
    }
    if (ctx.showDay) {
      if (open) {
        li.append(el('input', {
          class: 'edit-input f-when', 'data-field': 'day', type: 'text',
          value: t.day ? fmtDate(t.day, view.y, view.m) : '', placeholder: 'date'
        }));
      } else {
        li.append(el('span', {
          class: 'task-day seg' + (t.day ? '' : ' ghost-mark'),
          'data-action': 'edit-task', 'data-field': 'day',
          text: t.day ? fmtDate(t.day, view.y, view.m) : '+ date'
        }));
      }
    }
    if (!ctx.plan) {
      li.append(el('button', {
        class: 'flag', type: 'button', 'data-action': 'toggle-imp',
        'aria-label': 'Show on the month spread', 'aria-pressed': String(!!t.imp), text: '!'
      }));
    }
    li.append(el('button', {
      class: 'addsub', type: 'button', 'data-action': 'add-sub',
      'aria-label': 'Add a subtask to ' + t.text, text: '+'
    }));
    li.append(el('button', { class: 'del', type: 'button', 'data-action': 'del-task', 'aria-label': 'Delete task', text: '×' }));
    return li;
  }

  /* A task and its subtasks are siblings in one list, not a nested <ul>.
     Nesting would put every subtask inside the .task.done / .task:hover /
     .task.imp selectors and quietly strike through and light up each child;
     siblings keep every row a direct child, and keep the 28px grid true. */
  function appendTask(list, t, ctx) {
    list.append(taskRow(t, ctx));
    t.subs.forEach(function (s) { list.append(subRow(s, t)); });
  }

  function subRow(s, parent) {
    var li = el('li', {
      class: 'task sub' + (s.done ? ' done' : ''),
      'data-id': s.id, 'data-parent': parent.id
    });
    var box = el('span', {
      class: 'checkbox', 'data-action': 'toggle-sub',
      role: 'checkbox', 'aria-checked': String(s.done), tabindex: '0',
      // flat rows lose the parent/child relation for a screen reader, so the
      // checkbox says out loud what the indent says visually
      'aria-label': (s.text || 'New subtask') + ' — subtask of ' + parent.text
    });
    box.innerHTML = CHECK_SVG; // static trusted markup, never user text
    li.append(box);
    if (editing && editing.type === 'sub' && editing.id === s.id) {
      li.append(el('input', { class: 'edit-input', type: 'text', value: s.text }));
    } else {
      li.append(el('span', { class: 'item-text', 'data-action': 'edit-sub', text: s.text }));
    }
    li.append(el('button', {
      class: 'del', type: 'button', 'data-action': 'del-sub',
      'aria-label': 'Delete subtask', text: '×'
    }));
    return li;
  }

  /* ------------------------------ page flip ----------------------------- */
  // A temporary two-faced leaf rotates over the left spine. Its front face is a
  // clone of the sheet being turned — the page we are leaving on the way in, the
  // page we are returning to on the way out — and its back is the blank verso.
  function flip(fromName, toName, dir) {
    var fromEl = PAGES[fromName].el;
    var toEl = PAGES[toName].el;
    scrollMemo[fromName] = fromEl.scrollTop;

    if (reduceMotion.matches) {
      fromEl.hidden = true;
      toEl.hidden = false;
      toEl.scrollTop = dir === 'back' ? (scrollMemo[toName] || 0) : 0;
      afterFlip(toName);
      return;
    }

    flipping = true;
    var leaf = el('div', { class: 'leaf', 'aria-hidden': 'true' });
    var front = el('div', { class: 'leaf-face leaf-front' });
    var back = el('div', { class: 'leaf-face leaf-back' });

    var faceName = dir === 'forward' ? fromName : toName;
    var clone = PAGES[faceName].el.cloneNode(true);
    clone.hidden = false;
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    // the clone is a second copy of live rows — leaving data-id on it would let
    // editRow()'s book-wide lookup land inside a leaf that is about to be binned
    clone.querySelectorAll('[data-id]').forEach(function (n) { n.removeAttribute('data-id'); });
    front.append(clone);
    leaf.append(front, back);

    if (dir === 'forward') {
      toEl.hidden = false;   // destination revealed beneath as the leaf turns
      toEl.scrollTop = 0;    // a page opened forward starts at the top
      fromEl.hidden = true;  // the clone stands in for the page we left
    }                        // on the way back the destination stays hidden
    book.append(leaf);       // until finish(), with the origin visible beneath

    // ORDER MATTERS: the start rotation must be committed by the leaf's FIRST
    // layout. Anything that forces layout earlier — clone.scrollTop does — lays
    // the leaf out untransformed, and then offsetWidth finds layout clean and
    // commits nothing (a transform never dirties layout). The transition then
    // sees start == end on the way back and simply never runs.
    leaf.style.transform = dir === 'forward' ? 'rotateY(0deg)' : 'rotateY(-180deg)';
    void leaf.offsetWidth;   // commit start state before transitioning
    clone.scrollTop = scrollMemo[faceName] || 0;
    leaf.classList.add('turning');
    leaf.style.transform = dir === 'forward' ? 'rotateY(-180deg)' : 'rotateY(0deg)';

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      leaf.remove();
      if (dir === 'back') {
        toEl.hidden = false;
        fromEl.hidden = true;
        toEl.scrollTop = scrollMemo[toName] || 0; // put you back where you were
      }
      flipping = false;
      afterFlip(toName);
    }
    leaf.addEventListener('transitionend', function (e) {
      if (e.target === leaf) finish();
    });
    setTimeout(finish, 750); // transitionend can be missed (tab switch etc.)
  }

  function afterFlip(toName) {
    var page = PAGES[toName];
    if (page && page.enter) page.enter();
  }

  function focusTaskInput() {
    var inp = $v('#task-input');
    if (inp) inp.focus({ preventScroll: true });
  }

  /* ------------------------------ export/import ------------------------- */
  function exportData() {
    var now = new Date();
    var stamp = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: 'notes-backup-' + stamp + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  importFile.addEventListener('change', function () {
    var file = importFile.files[0];
    importFile.value = '';
    if (!file) return;
    file.text().then(function (raw) {
      var data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        alert("That file isn't valid JSON.");
        return;
      }
      var clean = sanitize(data);
      if (!clean) {
        alert("That file doesn't look like a Notes backup (wrong shape or version).");
        return;
      }
      if (!confirm('Replace all current notes with this backup?\n\nYour current notes will first download as a safety backup.')) return;
      exportData(); // safety net before replacing
      state = clean;
      editing = null;
      save();
      view.day = null;
      paintBar();    // the backup carries its own clock and section settings
      renderMonth();
      showPageNow('month');
    }).catch(function () {
      alert("Couldn't read that file.");
    });
  });

  /* ------------------------------ pomodoro ------------------------------ */
  // Durations are saved; the running timer is not. A reload starts a fresh
  // focus stretch rather than resuming one you were not watching.
  var pom = { mode: 'work', running: false, endAt: 0, left: 0, timer: 0 };
  var pomTime = document.getElementById('pom-time');
  var pomMode = document.getElementById('pom-mode');
  var pomBtn = document.getElementById('pom-toggle');
  var pomGroup = document.getElementById('pom');
  var pomSay = document.getElementById('pom-say');
  var audioCtx = null;

  function pomFull() {
    var p = state.settings.pomodoro;
    return (pom.mode === 'work' ? p.work : p.rest) * 60000;
  }

  function pomToggle() { if (pom.running) pomPause(); else pomStart(); }

  function pomStart() {
    if (pom.running) return;
    if (pom.left <= 0) pom.left = pomFull();
    pom.endAt = Date.now() + pom.left;   // an absolute deadline, never a sum
    pom.running = true;
    pom.timer = setInterval(pomTick, 250);
    paintPom();
  }

  function pomPause() {
    if (!pom.running) return;
    pom.left = Math.max(0, pom.endAt - Date.now());
    pomHalt();
    paintPom();
  }

  // no interval while idle, so a paused app does no work at all
  function pomHalt() { clearInterval(pom.timer); pom.timer = 0; pom.running = false; }

  function pomReset() {
    pomHalt();
    pom.mode = 'work';
    pom.left = pomFull();
    paintPom();
  }

  // The remainder is always derived from the deadline, never accumulated, so a
  // throttled background tab catches up on wake instead of falling behind.
  function pomTick() {
    pom.left = pom.endAt - Date.now();
    if (pom.left <= 0) {
      // the stretch changes but does not auto-start — an unattended tab should
      // not cycle forever, and you decide when the break begins
      pomHalt();
      pom.mode = pom.mode === 'work' ? 'rest' : 'work';
      pom.left = pomFull();
      pomAlert();
    }
    paintPom();
  }

  // Touches five nodes and nothing else. This runs four times a second, so it
  // must never call render() — that would throw away an edit in progress, steal
  // focus and restart the task animations.
  function paintPom() {
    var secs = Math.max(0, Math.ceil(pom.left / 1000));
    var resting = pom.mode === 'rest';
    pomTime.textContent = pad2(Math.floor(secs / 60)) + ':' + pad2(secs % 60);
    pomMode.textContent = resting ? 'break' : 'focus';
    pomGroup.classList.toggle('rest', resting);
    pomBtn.textContent = pom.running ? '❚❚' : '▶';
    pomBtn.setAttribute('aria-label',
      (pom.running ? 'Pause' : 'Start') + ' the ' + (resting ? 'break' : 'focus') + ' timer');
  }

  function pomAlert() {
    // announced on a hidden live region; the ticking numerals are not live, or
    // a screen reader would read every second out loud
    pomSay.textContent = pom.mode === 'rest' ? 'Focus over. Time for a break.' : 'Break over.';
    pomGroup.classList.remove('ringing');
    void pomGroup.offsetWidth; // restart the pulse if it is already running
    pomGroup.classList.add('ringing');
    if (state.settings.pomodoro.chime) chime();
  }

  // Synthesised rather than an audio file, so the app stays one file. The
  // context needs a user gesture, and starting the timer is always one.
  function chime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime;
      var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pom.mode === 'rest' ? 784 : 587, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.7);
    } catch (e) { /* silence is an acceptable outcome */ }
  }

  // Durations are plain settings, not an editable record — there is no id'd row
  // behind them, so they never go through startEdit/commitEdit.
  function commitNum(inp) {
    var key = inp.getAttribute('data-set') === 'pom-work' ? 'work' : 'rest';
    var n = Math.round(+inp.value);
    if (n >= 1 && n <= 180) state.settings.pomodoro[key] = n;
    save();
    renderSettings(); // an out-of-range value snaps back to the stored one
    // an idle timer picks up the new length straight away; a running one is
    // left alone rather than being yanked to a different duration mid-stretch
    if (!pom.running) { pom.left = pomFull(); paintPom(); }
  }

  function setPomPreset(work, rest) {
    state.settings.pomodoro.work = work;
    state.settings.pomodoro.rest = rest;
    save();
    renderSettings();
    if (!pom.running) { pom.left = pomFull(); paintPom(); }
  }

  function toggleChime() {
    state.settings.pomodoro.chime = !state.settings.pomodoro.chime;
    save();
    renderSettings();
  }

  /* ------------------------------ banner -------------------------------- */
  function showBanner(text) {
    banner.replaceChildren(
      el('span', { text: text }),
      el('button', { class: 'banner-close', type: 'button', 'aria-label': 'Dismiss', text: '×' })
    );
    banner.hidden = false;
  }
  function hideBanner() { banner.hidden = true; }
  banner.addEventListener('click', function (e) {
    if (e.target.classList.contains('banner-close')) hideBanner();
  });

  /* ------------------------------ events -------------------------------- */
  book.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target || flipping) return;
    var itemEl = target.closest('[data-id]');
    var id = itemEl ? itemEl.getAttribute('data-id') : null;
    switch (target.getAttribute('data-action')) {
      case 'prev-month': gotoMonth(-1); break;
      case 'next-month': gotoMonth(1); break;
      case 'open-day': openDay(+target.getAttribute('data-day')); break;
      case 'open-plan':
        openPlan(target.getAttribute('data-lesson'),
          target.getAttribute('data-day') != null ? +target.getAttribute('data-day') : null);
        break;
      case 'plan-prev': stepPlanDate(-7); break;
      case 'plan-next': stepPlanDate(7); break;
      case 'go-page': goPage(target.getAttribute('data-page')); break;
      case 'go-back': goBack(); break;
      case 'toggle-task': toggleTask(id, itemEl); break;
      case 'toggle-sub': toggleSub(id, itemEl); break;
      case 'toggle-imp': toggleImp(id, itemEl); break;
      case 'add-sub': addSub(id); break;
      case 'edit-sub': startEdit('sub', id); break;
      case 'del-sub': deleteSub(id); break;
      case 'edit-goal': startEdit('goal', id); break;
      case 'edit-task': startEdit('task', id, target.getAttribute('data-field')); break;
      case 'edit-project': startEdit('project', id); break;
      case 'del-project': deleteProject(id); break;
      case 'edit-bday': startEdit('bday', id, target.getAttribute('data-field')); break;
      case 'edit-lesson': startEdit('lesson', id, target.getAttribute('data-field')); break;
      case 'edit-lesson-once': startEdit('lesson-once', id, target.getAttribute('data-field')); break;
      case 'del-goal': deleteGoal(id); break;
      case 'edit-habit': startEdit('habit', id); break;
      case 'del-habit': deleteHabit(id); break;
      case 'toggle-habit':
        toggleHabit(target.getAttribute('data-habit'), +target.getAttribute('data-day'), target);
        break;
      case 'toggle-habit-day':
        toggleHabit(target.getAttribute('data-habit'), view.day, target);
        break;
      case 'del-task': deleteTask(id); break;
      case 'del-bday': deleteBirthday(id); break;
      case 'del-lesson': deleteLesson(id); break;
      case 'del-lesson-once': deleteLessonOnce(id); break;
      case 'toggle-section': toggleSection(target.getAttribute('data-section')); break;
      case 'set-clock': setClock(target.getAttribute('data-fmt')); break;
      case 'export': exportData(); break;
      case 'import': importFile.click(); break;
      case 'pom-preset':
        setPomPreset(+target.getAttribute('data-work'), +target.getAttribute('data-rest'));
        break;
      case 'toggle-chime': toggleChime(); break;
      case 'wipe-tasks': wipeData('tasks'); break;
      case 'wipe-goals': wipeData('goals'); break;
      case 'wipe-projects': wipeData('projects'); break;
      case 'wipe-lessons': wipeData('lessons'); break;
      case 'wipe-birthdays': wipeData('birthdays'); break;
      case 'wipe-habits': wipeData('habits'); break;
      case 'wipe-all': wipeData('all'); break;
    }
  });

  // the leather bar lives outside #book, so it needs its own delegated handler.
  // It honours the same `flipping` guard — no navigating mid-turn.
  document.querySelector('.leather-bar').addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target || flipping) return;
    switch (target.getAttribute('data-action')) {
      case 'go-page': goPage(target.getAttribute('data-page')); break;
      case 'go-home': goHome(); break;
      case 'pom-toggle': pomToggle(); break;
      case 'pom-reset': pomReset(); break;
    }
  });

  book.addEventListener('pointerdown', startDrag);
  book.addEventListener('pointermove', onDragMove);
  book.addEventListener('pointerup', endDrag);
  book.addEventListener('pointercancel', endDrag);

  book.addEventListener('keydown', function (e) {
    if (drag) return; // a drag owns the interaction until it ends
    var t = e.target;
    if (t.id === 'goal-input') {
      if (e.key === 'Enter') commitAddGoal(t.value);
      else if (e.key === 'Escape') { t.value = ''; t.blur(); }
    } else if (t.id === 'habit-input') {
      if (e.key === 'Enter') commitAddHabit(t.value);
      else if (e.key === 'Escape') { t.value = ''; t.blur(); }
    } else if (t.id === 'task-input') {
      if (e.key === 'Enter') commitAddTask(t.value, view.day);
      else if (e.key === 'Escape') { t.value = ''; t.blur(); }
    } else if (t.id === 'project-input') {
      if (e.key === 'Enter') commitAddProject(t.value);
      else if (e.key === 'Escape') { t.value = ''; t.blur(); }
    } else if (t.getAttribute && t.getAttribute('data-add') === 'proj-task') {
      // there is one of these per project, so it is keyed off an attribute
      // rather than an id like the other add rows
      if (e.key === 'Enter') {
        var owner = t.closest('[data-project]');
        if (owner) commitAddProjectTask(owner.getAttribute('data-project'), t.value);
      } else if (e.key === 'Escape') { t.value = ''; t.blur(); }
    } else if (t.getAttribute && t.getAttribute('data-add') === 'plan-task') {
      if (e.key === 'Enter') commitAddPlanTask(t.value);
      else if (e.key === 'Escape') { t.value = ''; t.blur(); }
    } else if (t.id === 'bday-name' || t.id === 'bday-day') {
      if (e.key === 'Enter') commitAddBirthday();
      else if (e.key === 'Escape') {
        var n = $v('#bday-name'), d = $v('#bday-day');
        if (n) n.value = '';
        if (d) d.value = '';
        t.blur();
      }
    } else if (t.id === 'lesson-name' || t.id === 'lesson-when' || t.id === 'lesson-time') {
      if (e.key === 'Enter') commitAddLesson();
      else if (e.key === 'Escape') {
        // the lesson add row exists on the month spread and the Lessons page —
        // clear the copy on the visible page, not a stale one
        ['#lesson-name', '#lesson-when', '#lesson-time'].forEach(function (sel) {
          var n = $v(sel);
          if (n) n.value = '';
        });
        t.blur();
      }
    } else if (t.classList && t.classList.contains('edit-input')) {
      if (e.key === 'Enter') commitEdit();
      else if (e.key === 'Escape') cancelEdit();
    } else if (t.classList && t.classList.contains('num-input')) {
      if (e.key === 'Enter') commitNum(t);
      else if (e.key === 'Escape') renderSettings(); // put the stored value back
    } else if (t.classList && (t.classList.contains('habit-cell') ||
               (t.classList.contains('habit-dot') && t.hasAttribute('data-action'))) &&
               (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      // on the spread the cell carries the day; on a day page the dot itself
      // means today, which is view.day
      var hday = t.classList.contains('habit-cell') ? +t.getAttribute('data-day') : view.day;
      toggleHabit(t.getAttribute('data-habit'), hday, t);
    } else if (t.classList && t.classList.contains('checkbox') && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      if (t.getAttribute('data-action') === 'toggle-section') {
        toggleSection(t.getAttribute('data-section'));
        return;
      }
      if (t.getAttribute('data-action') === 'toggle-chime') { toggleChime(); return; }
      var li = t.closest('[data-id]');
      if (!li) return;
      if (t.getAttribute('data-action') === 'toggle-sub') toggleSub(li.getAttribute('data-id'), li);
      else toggleTask(li.getAttribute('data-id'), li);
    } else if (t.classList && (t.classList.contains('date-row') || t.classList.contains('imp-row')) &&
               (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      if (!flipping) openDay(+t.getAttribute('data-day'));
    } else if (t.classList && t.classList.contains('proj-row') && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      goPage('projects');
    }
  });

  // clicking away from an in-progress edit commits it (Enter/Escape re-renders
  // first, detaching the input — the isConnected check skips those). Tabbing
  // between fields of the same row is not "away", so it must not commit.
  book.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t.classList || !t.isConnected) return;
    if (t.classList.contains('num-input')) { commitNum(t); return; }
    if (!t.classList.contains('edit-input') || !editing) return;
    var row = editRow();
    if (row && e.relatedTarget && row.contains(e.relatedTarget)) return;
    commitEdit();
  });

  // the lesson-plan notes box saves as you type — it is a plain shelf, not a
  // record with rows, so it needs no Enter/Escape or focus bookkeeping
  book.addEventListener('input', function (e) {
    if (e.target.id !== 'plan-notes' || !view.planLesson || !view.planDate) return;
    ensurePlan(view.planLesson, view.planDate).notes = e.target.value;
    planPrune(state, view.planLesson, view.planDate);
    save();
  });

  document.addEventListener('keydown', function (e) {
    // Escape during a drag abandons the gesture — and must not also turn the
    // page back, so a drag owns the key first
    if (drag) {
      if (e.key === 'Escape') cancelDrag();
      return;
    }
    // Guard on the event's target, not on document.activeElement: the handler
    // on #book has already run by now, and if it re-rendered (Escape cancelling
    // an edit) or blurred (Escape clearing an add row) the focus has fallen to
    // <body>, and this would read as "not typing" and turn the page as well.
    var t = e.target;
    var inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (inInput || flipping) return;
    if (e.key === 'Escape' && view.page !== 'month') goBack();
    if (view.page === 'month') {
      if (e.key === 'ArrowLeft') gotoMonth(-1);
      if (e.key === 'ArrowRight') gotoMonth(1);
    }
  });

  /* ------------------------------ init ---------------------------------- */
  if (location.hash === '#grid') document.querySelector('.app').classList.add('show-grid');
  // Inside the Tauri shell the window has no title bar: the native traffic
  // lights float over the leather bar, and the CSS gives them room. Tauri
  // defines window.isTauri in an init script before ours runs; a browser
  // never has it, so the preview keeps its old layout.
  if (window.isTauri) document.body.classList.add('tauri');
  state = load();
  var t = new Date();
  view.y = t.getFullYear();
  view.m = t.getMonth() + 1;
  pom.left = pomFull();
  paintPom();
  paintBar();
  renderMonth();

  // Pure logic for the unit tests (tests/). In the browser `module` does not
  // exist, so this line is invisible; under Node it exposes the internals.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      moveHabit: moveHabit,
      moveTask: moveTask,
      parseWhen: parseWhen,
      parseDate: parseDate,
      parseTime: parseTime,
      cleanDay: cleanDay,
      daysInMonth: daysInMonth,
      dateWeekday: dateWeekday,
      sanitize: sanitize,
      planPrune: planPrune,
      wipeCounts: wipeCounts,
      wipeTasks: wipeTasks,
      wipeGoals: wipeGoals,
      wipeProjects: wipeProjects,
      wipeLessons: wipeLessons,
      wipeBirthdays: wipeBirthdays,
      wipeHabits: wipeHabits,
      wipeAll: wipeAll,
      goPage: goPage,
      goBack: goBack,
      goHome: goHome,
      showPageNow: showPageNow,
      getView: function () { return view; }
    };
  }
})();
