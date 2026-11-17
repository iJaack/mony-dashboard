import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { positionKey } from './update-public-data.mjs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const adapter = read('site/assets/holdings.js');
const vendor = read('site/vendor/jaack/components/figure.js');
const tokens = read('site/vendor/jaack/tokens.css');
const fixtures = 'tests/fixtures/synthetic/';
const treasury = JSON.parse(read(fixtures + 'treasury.json'));
const history = JSON.parse(read(fixtures + 'positions-history.json'));
const now = Date.parse(treasury.generatedAt);
const pure = runInNewContext(adapter + '\nwindow.MonyHoldings', { window: {} });
const data = (asset, h = history, at = now) => pure.figureData(treasury.positions.find(row => row.asset === asset), h, at);
const plain = (value) => JSON.parse(JSON.stringify(value));

// A small tree with the actual vendor, not a mock of its rendering/update API.
function harness({ mediaReduced = false, classReduced = false, duration = '200ms', curve = 'cubic-bezier(0.2, 0, 0, 1)' } = {}) {
  let clock = 0, serial = 0;
  const frames = new Map(), timers = new Map(), observers = [], requestedTokens = [];
  function node(tag = 'span') {
    const n = {
      tag, children: [], style: {}, attrs: {}, dataset: {}, parent: null, hidden: false,
      get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { this.children = []; this.text = String(value); },
      setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'class') this.className = value; },
      getAttribute(name) { return this.attrs[name] ?? null; },
      appendChild(child) { child.remove(); this.children.push(child); child.parent = this; return child; },
      append(...children) { children.forEach(child => this.appendChild(child)); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; },
      closest() { return null; },
      querySelector(selector) { return this.children.flatMap(child => [child, ...child.descendants()]).find(child => child.className?.split(' ').includes(selector.slice(1))) || null; },
      descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); },
      getBoundingClientRect() { return { width: 60, height: 12 }; },
    };
    n.classList = {
      contains(name) { return n.className?.split(' ').includes(name) || false; },
      add(name) { n.className = [n.className, name].filter(Boolean).join(' '); },
    };
    return n;
  }
  const group = node('ul'), root = node('html');
  if (classReduced) root.classList.add('jk-rm');
  const media = { matches: mediaReduced, listeners: new Set(), addEventListener(name, fn) { this.listeners.add(fn); }, removeEventListener(name, fn) { this.listeners.delete(fn); } };
  const document = { documentElement: root, getElementById: id => id === 'holdings-figures' ? group : null, createElement: node, createElementNS: (ns, tag) => node(tag), addEventListener() {} };
  const window = {};
  const context = {
    window, document, performance: { now: () => clock }, matchMedia: () => media,
    getComputedStyle: () => ({ fontSize: '17px', getPropertyValue(name) {
      requestedTokens.push(name);
      return { '--jk-dur-2': duration, '--jk-ease-out': curve, '--jk-figure-ratio': '5', '--jk-figure-dot': '3' }[name] || '';
    } }),
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.target = null; }
    },
  };
  window.MutationObserver = context.MutationObserver;
  runInNewContext(vendor + '\n' + adapter, context);
  return {
    ...window.MonyHoldings, init: window.JaackFigure.init, group, node, frames, timers, requestedTokens,
    advance(time) {
      clock = time;
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time));
      for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
      observers.filter(observer => observer.target).forEach(observer => observer.fn());
    },
    reduceMedia() { media.matches = true; media.listeners.forEach(fn => fn()); },
    reduceClass() { root.classList.add('jk-rm'); observers.filter(observer => observer.target === root).forEach(observer => observer.fn()); },
  };
}

const find = (node, name) => node.querySelector('.jk-figure-' + name);
const visibleText = (node) => node.hidden || node.style.visibility === 'hidden' || node.style.display === 'none' || node.className === 'jk-figure-alt'
  ? '' : (node.text || '') + node.children.map(visibleText).join(' ');

test('all loaded public files have full-shape, explicitly synthetic fixtures and a dummy wallet', () => {
  const production = readdirSync(new URL('../site/data/', import.meta.url)).filter(name => name.endsWith('.json')).sort();
  const synthetic = readdirSync(new URL('../' + fixtures, import.meta.url)).filter(name => name.endsWith('.json')).sort();
  assert.deepEqual(synthetic, production);
  assert.equal(treasury.wallet, '0x0000000000000000000000000000000000000001');
  assert.match(treasury.note, /Synthetic fixture/);
  for (const file of synthetic) {
    const value = JSON.parse(read(fixtures + file));
    assert.ok(Array.isArray(value) ? value.length : Object.keys(value).length, file);
  }
  assert.doesNotMatch(read(fixtures + 'generate.mjs'), /Math\.random|readFile|fetch\(/);
});

test('browser and updater use identical stable asset/venue keys', () => {
  for (const row of treasury.positions.concat([{ asset: 'A@ B/€', venue: 'V@ /%' }])) assert.equal(pure.key(row), positionKey(row));
});

test('synthetic A/B/C use USD figures, signed deltas, local scales including declared bands', () => {
  const a = data('Fondo A'), b = data('Fondo B'), c = data('Fondo C');
  assert.equal(a.formatter(a.value), '$12,480.00');
  assert.equal(a.delta, 2.1); assert.equal(b.delta, -0.8); assert.equal(c.delta, 0);
  assert.deepEqual(plain(a.scale), [11900, 13000]);
  assert.deepEqual(plain(b.scale), [4150, 4410]); assert.equal(b.band, null);
  assert.deepEqual(plain(c.scale), [8500, 9000]);
  assert.match(a.alt, /Rising by 2.1 percent, minimum \$11,900.00, maximum \$12,510.00, 30 days with readings in the last 30 days \(UTC\); target band \$12,000.00 to \$13,000.00/);
  assert.match(b.alt, /^Falling/); assert.match(c.alt, /^Stable/);
});

test('the window is 30 UTC civil days, last daily reading wins and internal gaps stay null', () => {
  const row = treasury.positions[0], key = positionKey(row);
  const points = [
    { t: '2026-10-17T23:59:59Z', valueUsd: 1 }, // outside the oldest UTC day
    { t: '2026-10-18T00:00:00Z', valueUsd: 100 },
    { t: '2026-10-18T23:59:59Z', valueUsd: 110 },
    { t: '2026-11-16T12:00:00Z', valueUsd: 130 },
    { t: '2026-11-17T00:00:00Z', valueUsd: 1000 },
    { t: 'bad', valueUsd: 2 }, { t: '2026-11-15T12:00:00Z', valueUsd: null },
  ];
  const result = pure.figureData(row, { positions: { [key]: points.toReversed() } }, now);
  assert.equal(result.series.length, 30); assert.equal(result.series[0], 110); assert.equal(result.series[29], 130);
  assert.ok(result.series.slice(1, 29).every(value => value === null));
  assert.match(result.alt, /28 days missing/);
});

test('a young position leaves 18 leading slots empty on the fixed 30-day axis', () => {
  const young = data('Fondo D');
  assert.equal(young.series.length, 30);
  assert.equal(young.series.findIndex(Number.isFinite), 18);
  assert.ok(young.series.slice(0, 18).every(value => value === null));
  assert.ok(young.series.slice(18).every(value => value > 0));
  assert.match(young.alt, /12 days with readings in the last 30 days \(UTC\)/);
});

for (const count of [0, 1, 2, 5, 30]) test(`${count} daily readings use a fixed axis or an empty drawable series`, () => {
  const row = treasury.positions[0], key = positionKey(row);
  const readings = count ? history.positions[key].slice(-count) : [];
  const result = pure.figureData(row, { positions: { [key]: readings } }, now);
  assert.equal(result.value, row.valueUsd);
  if (count < 2) {
    assert.deepEqual(plain(result.series), []);
    assert.equal(result.scale, null); assert.equal(result.band, null); assert.equal(result.delta, null);
    assert.equal(result.alt, count ? 'One reading' : 'No history yet');
  } else {
    assert.equal(result.series.length, 30);
    assert.equal(result.series.filter(Number.isFinite).length, count);
    assert.equal(result.series.findIndex(Number.isFinite), 30 - count);
    assert.ok(result.series.slice(0, 30 - count).every(value => value === null));
    assert.deepEqual(plain(result.series.slice(30 - count)), readings.map(point => point.valueUsd));
    assert.equal(result.series[29], readings.at(-1).valueUsd);
    assert.match(result.alt, new RegExp(`${count} days with readings in the last 30 days`));
  }
  const h = harness(); h.render([row], { positions: { [key]: readings } }, now);
  const rendered = h.group.children[0];
  assert.equal(find(rendered, 'number').textContent, '$12,480.00');
  assert.ok(find(rendered, 'history')); assert.equal(find(rendered, 'history').hidden, false);
  for (const name of ['delta', 'min', 'spark', 'max']) {
    assert.equal(find(rendered, name).hidden, false);
    assert.equal(find(rendered, name).style.visibility, count < 2 ? 'hidden' : '');
    assert.notEqual(find(rendered, name).style.display, 'none');
  }
  assert.equal(!!find(rendered, 'line'), count >= 2);
  assert.equal(!!find(rendered, 'dot'), count >= 2);
  if (count < 2) {
    assert.equal(find(rendered, 'spark').children.length, 0, 'no marks, including a synthetic band');
    assert.doesNotMatch(visibleText(rendered), /insufficient|unavailable|history|reading|\+0\.0%/i);
    assert.equal(find(rendered, 'min').textContent, '$12,480.00');
    assert.equal(find(rendered, 'max').textContent, '$12,480.00');
    assert.equal(find(rendered, 'delta').textContent, '+0.0%');
    assert.equal(find(rendered, 'alt').textContent, count ? 'One reading' : 'No history yet');
  } else {
    assert.equal(find(rendered, 'min').textContent, result.formatter(result.scale[0]));
    assert.equal(find(rendered, 'max').textContent, result.formatter(result.scale[1]));
    assert.equal(find(rendered, 'delta').textContent, `${result.delta < 0 ? '−' : result.delta > 0 ? '+' : ''}${Math.abs(result.delta).toFixed(1)}%`);
  }
});

test('reserved history pieces remain in every row without exposing placeholder text', () => {
  for (const count of [0, 1]) {
    const h = harness();
    const selected = { positions: Object.fromEntries(Object.entries(history.positions).map(([key, points]) => [key, count ? points.slice(-count) : []])) };
    h.render(treasury.positions, selected, now);
    for (const [index, rendered] of h.group.children.entries()) {
      const formatted = h.figureData(treasury.positions[index], selected, now).formatter(treasury.positions[index].valueUsd);
      assert.equal(visibleText(rendered).split(formatted).length - 1, 1, 'only the current value is visible');
      for (const name of ['delta', 'min', 'spark', 'max']) {
        const piece = find(rendered, name);
        assert.ok(rendered.descendants().includes(piece));
        assert.equal(piece.hidden, false);
        assert.equal(piece.style.visibility, 'hidden');
        assert.notEqual(piece.style.display, 'none');
      }
      assert.equal(find(rendered, 'min').textContent, formatted);
      assert.equal(find(rendered, 'max').textContent, formatted);
    }
  }
});

test('stale readings leave today empty; the dot remains on yesterday rather than stretching right', () => {
  const row = treasury.positions[0], key = positionKey(row);
  const stale = { positions: { [key]: history.positions[key].slice(-3, -1) } };
  const result = pure.figureData(row, stale, now);
  assert.equal(result.series.length, 30);
  assert.equal(result.series.findIndex(Number.isFinite), 27);
  assert.equal(result.series[28], stale.positions[key].at(-1).valueUsd);
  assert.equal(result.series[29], null);
  const h = harness(); h.render([row], stale, now);
  const dot = find(h.group.children[0], 'dot');
  assert.ok(Math.abs(Number(dot.attrs.cx) - (2.5 + 28 / 29 * 55)) < 1e-9);
});

test('an internal missing day breaks the path and preserves both calendar positions', () => {
  const row = treasury.positions[0], key = positionKey(row);
  const gap = { positions: { [key]: history.positions[key].slice(-3).filter((_, index) => index !== 1) } };
  const result = pure.figureData(row, gap, now);
  assert.equal(result.series.length, 30);
  assert.equal(result.series[28], null);
  assert.equal(result.series[27], gap.positions[key][0].valueUsd);
  assert.equal(result.series[29], gap.positions[key][1].valueUsd);
  const h = harness(); h.render([row], gap, now);
  assert.match(find(h.group.children[0], 'line').attrs.d, /^M[^L]+M/);
  assert.equal(Number(find(h.group.children[0], 'dot').attrs.cx), 57.5);
});

test('UTC midnight rolls the calendar even when the final reading is stale', () => {
  const row = treasury.positions[0], key = positionKey(row);
  const readings = { positions: { [key]: history.positions[key].slice(-2) } };
  const before = pure.figureData(row, readings, Date.parse('2026-11-16T23:59:59.999Z'));
  const after = pure.figureData(row, readings, Date.parse('2026-11-17T00:00:00.000Z'));
  assert.equal(before.series[29], row.valueUsd);
  assert.equal(after.series[28], row.valueUsd); assert.equal(after.series[29], null);
  assert.equal(after.series.length, 30);
});

test('invalid and duplicate same-day readings cannot enable a one-point chart', () => {
  const row = treasury.positions[0], key = positionKey(row);
  const records = [
    { t: treasury.updatedAt, valueUsd: 1 }, { t: treasury.updatedAt, valueUsd: 2 },
    { t: 'bad', valueUsd: 3 }, { t: '2026-11-15T12:00:00Z', valueUsd: null },
    { t: '2026-11-15T12:00:00Z', valueUsd: NaN }, { t: '2026-11-15T12:00:00Z', valueUsd: Infinity },
    { t: '2026-11-15T12:00:00Z', valueUsd: '5' },
    { t: '2026-11-16T13:00:00Z', valueUsd: 6 }, { t: '2026-10-17T23:59:59Z', valueUsd: 7 },
  ];
  const result = pure.figureData(row, { positions: { [key]: records } }, now);
  assert.equal(result.series.length, 0); assert.equal(result.delta, null); assert.equal(result.alt, 'One reading');
});

test('refreshing from a chart to 0/1 readings reuses the reserved hidden layout and restores it at 2', () => {
  const row = treasury.positions[0], key = positionKey(row), h = harness();
  h.render([row], history, now);
  const rendered = h.group.children[0], historyBox = find(rendered, 'history');
  const pieces = ['delta', 'min', 'spark', 'max'].map(name => find(rendered, name));
  for (const count of [1, 0, 2]) {
    h.render([row], { positions: { [key]: count ? history.positions[key].slice(-count) : [] } }, now);
    assert.equal(find(rendered, 'history'), historyBox);
    assert.equal(find(rendered, 'history').hidden, false);
    assert.equal(!!find(rendered, 'line'), count >= 2);
    assert.equal(!!find(rendered, 'dot'), count >= 2);
    for (const [index, name] of ['delta', 'min', 'spark', 'max'].entries()) {
      const piece = find(rendered, name);
      assert.equal(piece, pieces[index]);
      assert.ok(rendered.descendants().includes(piece), 'reserved pieces remain in the tree');
      assert.equal(piece.hidden, false);
      assert.equal(piece.style.visibility, count < 2 ? 'hidden' : '');
      assert.notEqual(piece.style.display, 'none');
    }
    assert.equal(find(rendered, 'number').textContent, '$12,480.00');
    if (count < 2) {
      assert.equal(find(rendered, 'spark').children.length, 0);
      assert.equal(find(rendered, 'min').textContent, '$12,480.00');
      assert.equal(find(rendered, 'max').textContent, '$12,480.00');
      assert.equal(find(rendered, 'delta').textContent, '+0.0%');
      assert.doesNotMatch(visibleText(rendered), /history|reading|\+0\.0%/i);
    } else {
      const expected = h.figureData(row, { positions: { [key]: history.positions[key].slice(-count) } }, now);
      assert.equal(find(rendered, 'min').textContent, expected.formatter(expected.scale[0]));
      assert.equal(find(rendered, 'max').textContent, expected.formatter(expected.scale[1]));
      assert.equal(find(rendered, 'delta').textContent, `${expected.delta < 0 ? '−' : expected.delta > 0 ? '+' : ''}${Math.abs(expected.delta).toFixed(1)}%`);
    }
  }
});

test('trend uses the 0.5% relative threshold and zero/near-zero deltas stay neutral', () => {
  const row = treasury.positions[0], key = positionKey(row);
  for (const [last, trend] of [[100.5, 'Stable'], [100.51, 'Rising'], [99.49, 'Falling']]) {
    const result = pure.figureData(row, { positions: { [key]: [{ t: '2026-11-15T12:00:00Z', valueUsd: 100 }, { t: treasury.updatedAt, valueUsd: last }] } }, now);
    assert.match(result.alt, new RegExp('^' + trend));
  }
  const result = pure.figureData(row, { positions: { [key]: [{ t: '2026-11-15T12:00:00Z', valueUsd: 100 }, { t: treasury.updatedAt, valueUsd: 99.99 }] } }, now);
  assert.equal(result.delta, 0);
  const zero = pure.figureData(row, { positions: { [key]: [{ t: '2026-11-15T12:00:00Z', valueUsd: 0 }, { t: treasury.updatedAt, valueUsd: 1 }] } }, now);
  assert.equal(zero.delta, null); assert.match(zero.alt, /^Rising/);
});

test('missing or invalid history preserves values and hidden English alternatives', () => {
  for (const missing of [null, {}, [], { positions: [] }, { positions: { [positionKey(treasury.positions[0])]: 'bad' } }]) {
    const result = data('Fondo A', missing);
    assert.equal(result.value, 12480); assert.equal(result.delta, null); assert.equal(result.series.length, 0);
    assert.equal(result.scale, null); assert.match(result.alt, /^No history yet/);
  }
  const h = harness(); h.render(treasury.positions, null, now);
  assert.equal(find(h.group.children[0], 'number').textContent, '$12,480.00');
  assert.equal(find(h.group.children[0], 'spark').children.length, 0);
  assert.match(find(h.group.children[0], 'alt').textContent, /^No history yet/);
});

test('fixture rows render once with metadata, English alternatives and unsigned neutral zero', () => {
  const h = harness(); h.render(treasury.positions, history, now);
  assert.equal(h.group.children.length, 8); assert.equal(h.group.attrs['aria-busy'], 'false');
  assert.equal(h.frames.size, 0, 'first paint is instant');
  const [a, b, c] = h.group.children;
  assert.equal(find(a, 'delta').textContent, '+2.1%'); assert.equal(find(b, 'delta').textContent, '−0.8%');
  assert.equal(find(c, 'delta').textContent, '0.0%'); assert.equal(find(c, 'delta').dataset.sign, 'zero');
  assert.equal(find(a, 'min').textContent, '$11,900.00'); assert.equal(find(a, 'max').textContent, '$13,000.00');
  assert.ok(find(a, 'band')); assert.equal(find(b, 'band'), null);
  assert.match(find(a, 'label').textContent, /Fondo AAvalancheBalance 1,248 · Weight 31.4%/);
  assert.match(find(h.group.children[7], 'label').textContent, /not in drawdown basis/);
  for (const row of h.group.children) {
    assert.equal(find(row, 'spark').attrs['aria-hidden'], 'true');
    assert.equal(row.attrs['aria-busy'], 'false');
    assert.match(find(row, 'alt').textContent, /minimum .*maximum .*(?:12|30) days with readings in the last 30 days/);
  }
});

test('refresh reuses each vendor instance, counting values while marks and bands update immediately', () => {
  const h = harness(); h.render(treasury.positions, history, now);
  const row = h.group.children[0], instance = row._jkFigure, number = find(row, 'number');
  const changed = treasury.positions.map((row, i) => i ? row : { ...row, valueUsd: 13000, targetBand: [10000, 14000] });
  const nextHistory = structuredClone(history); nextHistory.positions[positionKey(changed[0])].at(-1).valueUsd = 13000;
  const oldLine = find(row, 'line').attrs.d;
  h.render(changed, nextHistory, now);
  assert.equal(h.group.children[0], row); assert.equal(row._jkFigure, instance); assert.equal(find(row, 'number'), number);
  assert.equal(number.textContent, '$12,480.00'); assert.notEqual(find(row, 'line').attrs.d, oldLine);
  assert.equal(find(row, 'max').textContent, '$14,000.00');
  h.advance(40); assert.equal(number.textContent, '$12,740.00');
  for (const time of [80, 120, 160, 200, 280]) h.advance(time);
  assert.equal(number.textContent, '$13,000.00'); assert.equal(h.frames.size, 0);
  assert.ok(h.requestedTokens.includes('--jk-dur-2')); assert.ok(h.requestedTokens.includes('--jk-ease-out'));
  h.render(changed.slice(1), nextHistory, now);
  assert.equal(h.group.children.length, 7); assert.equal(row._jkFigure, undefined); assert.equal(row.parent, null);
});

test('the figure reads computed timing, caps it at 280ms, and the marks never animate', () => {
  for (const [duration, midpoint, end] of [['0.1s', 50, 100], ['1s', 140, 280]]) {
    const h = harness({ duration, curve: 'cubic-bezier(0, 0, 1, 1)' });
    const row = h.node(); const api = h.init(row, { value: 100, formatter: String, series: [1, 2] });
    api.update({ value: 200, series: [1, null, 3], band: [0, 5] });
    assert.match(find(row, 'line').attrs.d, /^M[^L]+M/);
    h.advance(midpoint); assert.ok(Math.abs(Number(find(row, 'number').textContent) - 150) < 0.000001);
    h.advance(end); assert.equal(find(row, 'number').textContent, '200');
    assert.equal(h.frames.size, 0);
  }
  const css = read('site/vendor/jaack/components/figure.css');
  assert.match(css, /\.jk-figure \.jk-figure-line,\.jk-figure \.jk-figure-band,\.jk-figure \.jk-figure-dot\{transition:none!important;animation:none!important\}/);
  assert.doesNotMatch(vendor + css, /--jk-(?:ease-inout|spring)|stroke-dashoffset|\.animate\(/);
  assert.match(tokens, /--jk-dur-2:\s*200ms/);
});

for (const preference of ['media', 'class']) test(`figure ${preference} reduced motion is instant and settles a running count immediately`, () => {
  const h = harness({ mediaReduced: preference === 'media', classReduced: preference === 'class' });
  const row = h.node(); const api = h.init(row, { value: 100, formatter: String });
  api.update({ value: 200 }); assert.equal(find(row, 'number').textContent, '200'); assert.equal(h.frames.size, 0);
  const active = harness(); const el = active.node(); const figure = active.init(el, { value: 100, formatter: String });
  figure.update({ value: 200 }); active.advance(40); assert.ok(Math.abs(Number(find(el, 'number').textContent) - 150) < 0.000001);
  if (preference === 'media') active.reduceMedia(); else active.reduceClass();
  assert.equal(find(el, 'number').textContent, '200'); assert.equal(active.frames.size, 0);
});

test('loading reserves space with aria-busy and no zero; missing values keep history without an accent dot', () => {
  const h = harness(), row = h.node();
  h.init(row, { value: null, series: [], state: 'loading', reserveChars: 10 });
  assert.equal(row.attrs['aria-busy'], 'true'); assert.equal(find(row, 'number').textContent, '—');
  assert.equal(find(row, 'value').style.minWidth, '10ch'); assert.equal(find(row, 'spark').children.length, 0);
  h.render([{ ...treasury.positions[0], valueUsd: null }], history, now);
  const missing = h.group.children[0];
  assert.equal(find(missing, 'number').textContent, 'Unavailable'); assert.equal(find(missing, 'dot'), null);
  assert.ok(find(missing, 'line')); assert.match(find(missing, 'alt').textContent, /^Value unavailable/);
  h.render(treasury.positions.slice(0, 1), history, now); h.advance(200);
  h.render([{ ...treasury.positions[0], valueUsd: null }], history, now); h.advance(400);
  assert.equal(find(missing, 'number').textContent, 'Unavailable');
  const html = read('site/index.html');
  assert.match(html, /id="holdings-loading" class="jk-figure" data-state="loading" aria-busy="true"/);
  assert.match(html, /<span class="jk-figure-alt">Loading<\/span>/);
});

test('list breakpoints and fixed spark geometry come from v2.2.0, with no app figure-token overrides', () => {
  const css = read('site/vendor/jaack/components/figure.css');
  assert.match(css, /\.jk-figures\[data-layout="list"\]\{grid-template-columns:1fr;gap:0\}/);
  assert.match(css, /@media \(min-width:1280px\)\{\.jk-figures\[data-layout="list"\]\{grid-template-columns:repeat\(2,1fr\)\}\}/);
  assert.match(css, /@media \(min-width:2560px\)\{\.jk-figures\[data-layout="list"\]\{grid-template-columns:repeat\(4,1fr\)\}\}/);
  assert.match(css, /max-width:720px/); assert.match(css, /height:var\(--jk-figure-height\);width:calc\(var\(--jk-figure-ratio\) \* var\(--jk-figure-height\)\)/);
  assert.doesNotMatch(read('site/assets/app.css') + read('site/assets/jaack-local.css'), /--jk-figure-[\w-]+\s*:/);
  const html = read('site/index.html');
  assert.match(html, /class="jk-figures" data-layout="list"/);
  assert.match(html, /<div class="jk-group">\s*<h3 class="jk-lab">The holdings/);
});

test('contrast figure fixtures resolve to the actual vendor tokens and ink-band alpha', () => {
  const { mony } = JSON.parse(read('tests/forma-v2/palettes.json'));
  for (const { figure } of Object.values(mony)) {
    assert.equal(figure.value, 'accentText'); assert.equal(figure.dot, 'accentText'); assert.equal(figure.line, 'ink2');
    assert.equal(figure.label, 't2'); assert.equal(figure.limits, 't3'); assert.equal(figure.bandInk, 'ink'); assert.equal(figure.bandAlpha, 0.08);
  }
  assert.match(tokens, /--jk-figure-mark:\s*var\(--jk-accent-text\)/);
  assert.match(tokens, /--jk-figure-line:\s*var\(--jk-ink-2\)/);
  assert.match(tokens, /--jk-figure-band:\s*color-mix\(in oklch, var\(--jk-ink\) 8%, transparent\)/);
});
