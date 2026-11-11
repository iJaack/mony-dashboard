const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/assets/menu.js', 'utf8');

function load({ mobile = true, reduced = false } = {}) {
  const classes = new Set();
  const listeners = {};
  const timers = new Map();
  let document;
  function element(attrs = {}) {
    return {
      attrs, listeners: {},
      getAttribute(name) { return this.attrs[name]; },
      setAttribute(name, value) { this.attrs[name] = value; },
      removeAttribute(name) { delete this.attrs[name]; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      focus() { document.activeElement = this; }
    };
  }
  const button = element({ 'aria-controls': 'mony-menu', 'aria-expanded': 'false' });
  const links = Array.from({ length: 5 }, () => element());
  links.forEach(link => { link.closest = selector => selector === 'a[href]' ? link : null; });
  const sheet = element({ id: 'mony-menu' });
  sheet.querySelector = () => links[0];
  sheet.querySelectorAll = () => links;
  const nav = {
    classList: { add: name => classes.add(name), remove: (...names) => names.forEach(name => classes.delete(name)) },
    querySelector: selector => selector === '.mony-menu-toggle' ? button : sheet,
    contains: target => [nav, button, sheet, ...links].includes(target)
  };
  const media = { matches: mobile, addEventListener(name, fn) { assert.equal(name, 'change'); this.change = fn; } };
  document = { activeElement: null, querySelector: () => nav, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(source, {
    document, window: { matchMedia(query) {
      if (query.includes('reduced-motion')) return { matches: reduced };
      assert.equal(query, '(max-width: 716.98px)');
      return media;
    } },
    setTimeout(fn, delay) { assert.equal(delay, 160); timers.set(fn, fn); return fn; },
    clearTimeout(id) { timers.delete(id); }
  });
  function key(key, shiftKey = false) {
    const event = { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
    listeners.keydown(event);
    return event;
  }
  return { document, classes, button, sheet, links, media, key, listeners,
    toggle: () => button.listeners.click(), finishFade: () => { timers.forEach(fn => fn()); timers.clear(); } };
}

test('Menu CSS and JavaScript share the measured breakpoint and disable reduced-motion fades', () => {
  const css = fs.readFileSync('site/assets/jaack-local.css', 'utf8');
  assert.match(source, /matchMedia\('\(max-width: 716\.98px\)'\)/);
  assert.match(css, /@media \(max-width:716\.98px\)/);
  assert.match(css, /@media \(max-width:716\.98px\) and \(prefers-reduced-motion:reduce\)\{\s*\.jk-top.has-menu \.jk-links\{transition:none\}/);
  assert.match(css, /\.mony-menu-toggle\{display:none\}/);
  assert.match(css, /\.jk-top.has-menu \.jk-links\{/);
  assert.match(css, /min-height:44px;padding:0 14px/);
});

test('open exposes the sheet, updates expanded state and focuses the first link', () => {
  const p = load();
  assert.ok(p.classes.has('has-menu'));
  assert.equal(p.sheet.inert, true);
  p.toggle();
  assert.equal(p.button.attrs['aria-expanded'], 'true');
  assert.ok(p.classes.has('is-menu-open'));
  assert.equal(p.sheet.inert, false);
  assert.equal(p.sheet.attrs['aria-hidden'], undefined);
  assert.equal(p.document.activeElement, p.links[0]);
});
test('button closes the sheet and returns focus after opening', () => {
  const p = load(); p.toggle(); p.toggle();
  assert.equal(p.button.attrs['aria-expanded'], 'false');
  assert.ok(!p.classes.has('is-menu-open'));
  assert.equal(p.sheet.inert, true);
  assert.equal(p.sheet.attrs['aria-hidden'], 'true');
  assert.equal(p.document.activeElement, p.button);
  assert.ok(p.classes.has('is-menu-closing'));
  p.finishFade();
  assert.ok(!p.classes.has('is-menu-closing'));
});
test('Escape closes and returns focus to Menu', () => {
  const p = load(); p.toggle();
  assert.equal(p.key('Escape').prevented, true);
  assert.equal(p.button.attrs['aria-expanded'], 'false');
  assert.equal(p.document.activeElement, p.button);
});
for (const event of ['click', 'pointerdown']) {
  test(`outside ${event} closes; inside ${event} keeps the sheet open`, () => {
    const p = load(); p.toggle();
    p.listeners[event]({ target: p.links[0] });
    assert.equal(p.button.attrs['aria-expanded'], 'true');
    let prevented = false;
    p.listeners[event]({ type: event, target: {}, preventDefault() { prevented = true; } });
    assert.equal(prevented, event === 'pointerdown');
    assert.equal(p.button.attrs['aria-expanded'], 'false');
    assert.equal(p.document.activeElement, p.button);
  });
}
test('a nested link click closes without overriding navigation focus', () => {
  const p = load(); p.toggle();
  p.sheet.listeners.click({ target: { closest: () => p.links[0] } });
  assert.equal(p.button.attrs['aria-expanded'], 'false');
  assert.equal(p.document.activeElement, p.links[0]);
});
test('the Menu button controls the existing section links and precedes the switch', () => {
  const markup = fs.readFileSync('site/index.html', 'utf8');
  const button = markup.match(/<button[^>]*class="mony-menu-toggle"[^>]*>Menu<\/button>/)[0];
  assert.match(button, /aria-expanded="false"/);
  assert.match(button, /aria-controls="mony-menu"/);
  assert.match(markup, /<nav class="jk-links" id="mony-menu" aria-label="Primary">/);
  assert.equal((markup.match(/id="mony-menu"/g) || []).length, 1);
  assert.ok(markup.indexOf(button) > markup.indexOf('class="jk-mark"'));
  assert.ok(markup.indexOf(button) < markup.indexOf('<span data-jk-theme-switch>'));
});

test('focus trap wraps Tab last to first and Shift+Tab first to last', () => {
  const p = load(); p.toggle();
  p.links[4].focus();
  assert.equal(p.key('Tab').prevented, true);
  assert.equal(p.document.activeElement, p.button);
  p.key('Tab', true);
  assert.equal(p.document.activeElement, p.links[4]);
  p.button.focus(); p.key('Tab');
  assert.equal(p.document.activeElement, p.links[0]);
});
test('crossing to desktop clears hidden/inert state and returning to mobile stays closed', () => {
  const p = load(); p.toggle();
  p.media.matches = false; p.media.change();
  assert.equal(p.button.attrs['aria-expanded'], 'false');
  assert.equal(p.sheet.inert, false);
  assert.equal(p.sheet.attrs['aria-hidden'], undefined);
  assert.ok(!p.classes.has('is-menu-closing'));
  assert.equal(p.key('Tab').prevented, false);
  p.toggle();
  assert.equal(p.button.attrs['aria-expanded'], 'false');
  p.media.matches = true; p.media.change();
  assert.equal(p.sheet.inert, true);
});
test('reduced motion closes immediately and reopening cancels a pending fade', () => {
  const reduced = load({ reduced: true }); reduced.toggle(); reduced.toggle();
  assert.ok(!reduced.classes.has('is-menu-closing'));
  const p = load(); p.toggle(); p.toggle(); p.toggle(); p.finishFade();
  assert.ok(p.classes.has('is-menu-open'));
  assert.ok(!p.classes.has('is-menu-closing'));
});

test('desktop startup leaves bar links available and ignores the hidden Menu button', () => {
  const p = load({ mobile: false });
  assert.ok(p.classes.has('has-menu'));
  assert.equal(p.sheet.inert, false);
  assert.equal(p.sheet.attrs['aria-hidden'], undefined);
  p.toggle();
  assert.equal(p.button.attrs['aria-expanded'], 'false');
  assert.equal(p.key('Tab').prevented, false);
  p.media.matches = true; p.media.change();
  assert.equal(p.sheet.inert, true);
  assert.equal(p.sheet.attrs['aria-hidden'], 'true');
  p.toggle();
  assert.equal(p.button.attrs['aria-expanded'], 'true');
});

test('non-Tab keys and internal pointer taps keep the open menu intact', () => {
  const p = load(); p.toggle();
  assert.equal(p.key('ArrowDown').prevented, false);
  p.listeners.pointerdown({ target: p.button });
  assert.equal(p.button.attrs['aria-expanded'], 'true');
});
