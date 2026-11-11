const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/assets/app.js', 'utf8');

function load({ lang = 'en', mounted = true, present = true, count = 1, from = 7, to = 19, chrome = false, resizeObserver = true, dockDisplay = 'block' } = {}) {
  const listeners = new Map();
  const observers = [];
  const sizes = [];
  const windowListeners = new Map();
  const properties = new Map();
  const barBox = { bottom: 62.1 };
  const dockBox = { top: 765.2 };
  const bar = { getBoundingClientRect: () => barBox };
  const dock = { getBoundingClientRect: () => dockBox };
  const groups = Array.from({ length: count }, () => {
    const buttons = ['auto', 'light', 'dark'].map((mode, index) => {
      const label = { textContent: ['Auto', 'Chiaro', 'Scuro'][index] };
      return {
        dataset: { m: mode },
        title: [`Automatico: chiaro dalle ${from} alle ${to}`, 'Tema chiaro', 'Tema scuro'][index],
        attrs: { 'aria-pressed': mode === 'auto' ? 'true' : 'false' },
        label, icon: { textContent: ['◐', '☀', '☾'][index] },
        suffix: { en: ', theme', it: ', tema' },
        setAttribute(name, value) { this.attrs[name] = value; },
        querySelector(selector) {
          if (selector === '.l') return label;
          assert.equal(selector, '.lang-en');
          return { textContent: this.suffix.en };
        }
      };
    });
    return {
      attrs: { role: 'group', 'aria-label': 'Tema' }, buttons,
      click: () => {},
      setAttribute(name, value) { this.attrs[name] = value; },
      querySelectorAll(selector) { assert.equal(selector, 'button[data-m]'); return buttons; }
    };
  });
  const hosts = groups.map(group => ({
    group: mounted ? group : null,
    querySelector(selector) { assert.equal(selector, '.jk-thsw'); return this.group; }
  }));
  const document = {
    documentElement: { lang, dataset: { theme: 'light' }, style: { setProperty: (k, v) => properties.set(k, v) } },
    body: { dataset: { page: 'test' } },
    querySelector: selector => chrome ? ({ 'header.jk-top': bar, '.jk-dock': dock }[selector] || null) : null,
    querySelectorAll: selector => present && selector === '[data-jk-theme-switch]' ? hosts : [],
    getElementById: () => null,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    }
  };
  const window = {
    getComputedStyle: target => { assert.equal(target, dock); return { display: dockDisplay }; },
    innerHeight: 844, visualViewport: { height: 700 },
    JaackTheme: { FROM: from, TO: to },
    addEventListener(name, callback) { windowListeners.set(name, callback); }
  };
  vm.runInNewContext(source, {
    document, window, addEventListener() {},
    AbortSignal: { timeout: () => ({}) },
    fetch: () => new Promise(() => {}),
    ResizeObserver: resizeObserver ? class {
      constructor(callback) { this.callback = callback; this.targets = []; sizes.push(this); }
      observe(target) { this.targets.push(target); }
    } : undefined,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
      observe(host, options) {
        assert.ok(hosts.includes(host));
        assert.deepEqual({ ...options }, { childList: true, subtree: true });
        this.host = host; this.active = true;
      }
      disconnect() { this.active = false; this.disconnected = true; }
    }
  });
  return {
    groups, hosts, observers, sizes, properties, barBox, dockBox, bar, dock, window, windowListeners,
    domReady() {
      present = true;
      for (const callback of listeners.get('DOMContentLoaded') || []) callback();
    },
    mount(index = 0) { hosts[index].group = groups[index]; },
    flush() { observers.filter(observer => observer.active).forEach(observer => observer.callback()); }
  };
}

function assertEnglish(group, from = 7, to = 19) {
  assert.equal(group.attrs['aria-label'], 'Theme');
  assert.deepEqual(group.buttons.map(button => button.label.textContent), ['Auto', 'Light', 'Dark']);
  assert.deepEqual(group.buttons.map(button => button.title),
    [`Automatic: light from ${from} to ${to}`, 'Light theme', 'Dark theme']);
  assert.deepEqual(group.buttons.map(button => button.attrs['aria-label']),
    ['Auto, theme', 'Light, theme', 'Dark, theme']);
}

function assertControlsUnchanged(group, original) {
  assert.equal(group.attrs.role, 'group');
  assert.equal(group.click, original.click);
  group.buttons.forEach((button, index) => {
    assert.equal(button, original.buttons[index]);
    assert.equal(button.dataset.m, ['auto', 'light', 'dark'][index]);
    assert.equal(button.attrs['aria-pressed'], index === 0 ? 'true' : 'false');
    assert.equal(button.suffix, original.suffixes[index]);
    assert.deepEqual(button.suffix, { en: ', theme', it: ', tema' });
    assert.equal(button.icon.textContent, ['◐', '☀', '☾'][index]);
  });
}

const snapshot = group => ({ click: group.click, buttons: [...group.buttons], suffixes: group.buttons.map(b => b.suffix) });

test('EN switch already mounted is localized immediately and uses the theme API hours', () => {
  const page = load({ from: 6, to: 22 });
  assertEnglish(page.groups[0], 6, 22);
  assert.equal(page.observers.length, 0);
  page.domReady();
  assertEnglish(page.groups[0], 6, 22);
});

for (const order of ['vendor-first', 'localizer-first']) {
  test(`EN switch mounted at DOMContentLoaded is localized with ${order} script order`, () => {
    const page = load({ mounted: false });
    const original = snapshot(page.groups[0]);
    assert.equal(page.observers.length, 1);
    assert.equal(page.observers[0].host, page.hosts[0]);
    if (order === 'vendor-first') page.mount();
    page.domReady();
    if (order === 'localizer-first') page.mount();
    page.flush();
    assertEnglish(page.groups[0]);
    assertControlsUnchanged(page.groups[0], original);
    assert.equal(page.observers.length, 1, 'DOMContentLoaded must not add a duplicate observer');
    assert.equal(page.observers[0].disconnected, true);
    assert.equal(page.observers[0].active, false);
  });
}

test('DOMContentLoaded discovers a host absent when the script first ran', () => {
  const page = load({ present: false });
  assert.equal(page.groups[0].attrs['aria-label'], 'Tema');
  page.domReady();
  assertEnglish(page.groups[0]);
});

test('each host is observed independently until its own switch is relabelled', () => {
  const page = load({ mounted: false, count: 2 });
  page.mount(1); page.flush();
  assertEnglish(page.groups[1]);
  assert.equal(page.observers[0].active, true);
  assert.equal(page.observers[1].active, false);
  page.mount(0); page.flush();
  assertEnglish(page.groups[0]);
  assert.ok(page.observers.every(observer => observer.disconnected));
});

for (const mounted of [true, false]) {
  test(`IT labels, titles and group name remain unchanged (${mounted ? 'already mounted' : 'mounted later'})`, () => {
    const page = load({ lang: 'it', mounted });
    const group = page.groups[0];
    const original = snapshot(group);
    page.domReady(); page.mount(); page.flush();
    assert.equal(group.attrs['aria-label'], 'Tema');
    assert.deepEqual(group.buttons.map(button => button.label.textContent), ['Auto', 'Chiaro', 'Scuro']);
    assert.deepEqual(group.buttons.map(button => button.title),
      ['Automatico: chiaro dalle 7 alle 19', 'Tema chiaro', 'Tema scuro']);
    assert.deepEqual(group.buttons.map(button => button.label.textContent + button.suffix.it),
      ['Auto, tema', 'Chiaro, tema', 'Scuro, tema']);
    assertControlsUnchanged(group, original);
    assert.equal(page.observers.length, 0);
  });
}

test('IT never receives an English aria-label override', () => {
  const page = load({ lang: 'it' });
  page.domReady(); page.flush();
  for (const button of page.groups[0].buttons) assert.equal(button.attrs['aria-label'], undefined);
});

test('chrome is measured before data, rounding up and using innerHeight rather than visualViewport', () => {
  const p = load({ chrome: true, mounted: false });
  assert.equal(p.properties.get('--jk-top-clearance'), '77px');
  assert.equal(p.properties.get('--jk-dock-clearance'), '93px');
  assert.equal(p.sizes.length, 1);
  assert.deepEqual(p.sizes[0].targets, [p.bar, p.dock]);
  p.barBox.bottom = 66.7;
  p.dockBox.top = 750.5;
  p.sizes[0].callback();
  assert.equal(p.properties.get('--jk-top-clearance'), '81px');
  assert.equal(p.properties.get('--jk-dock-clearance'), '108px');
  p.barBox.bottom = 58;
  p.windowListeners.get('resize')();
  assert.equal(p.properties.get('--jk-top-clearance'), '72px');
  p.window.innerHeight = 900;
  p.windowListeners.get('orientationchange')();
  assert.equal(p.properties.get('--jk-dock-clearance'), '164px');
});

test('measurement and resize events still work without ResizeObserver', () => {
  const p = load({ chrome: true, resizeObserver: false });
  assert.equal(p.properties.get('--jk-top-clearance'), '77px');
  assert.equal(p.properties.get('--jk-dock-clearance'), '93px');
  p.barBox.bottom = 70;
  p.windowListeners.get('resize')();
  assert.equal(p.properties.get('--jk-top-clearance'), '84px');
});

test('hidden dock keeps the CSS fallback and is measured when shown', () => {
  const p = load({ chrome: true, dockDisplay: 'none' });
  assert.equal(p.properties.get('--jk-top-clearance'), '77px');
  assert.equal(p.properties.has('--jk-dock-clearance'), false);
  p.window.getComputedStyle = () => ({ display: 'block' });
  p.sizes[0].callback();
  assert.equal(p.properties.get('--jk-dock-clearance'), '93px');
  p.window.getComputedStyle = () => ({ display: 'none' });
  p.dockBox.top = 0;
  p.windowListeners.get('resize')();
  assert.equal(p.properties.get('--jk-dock-clearance'), '93px', 'hidden box must not overwrite the last valid measurement');
});
