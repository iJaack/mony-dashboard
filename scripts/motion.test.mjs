import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('site/assets/app.js', root), 'utf8');
const tokens = readFileSync(new URL('site/vendor/jaack/tokens.css', root), 'utf8');
const motion = app.slice(app.indexOf('  const reduced ='), app.indexOf('  const dateFormatter ='));

function node() {
  const element = {
    style: {}, children: [], attrs: {}, className: '', writes: 0,
    setAttribute(name, value) { this.attrs[name] = value; },
    replaceChildren(...children) { this.children = children; this.text = ''; },
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text || ''; },
    set textContent(value) { this.writes++; this.children = []; this.text = value; },
    set innerHTML(value) { assert.fail(`headlines must use text nodes: ${value}`); },
  };
  element.classList = {
    contains: name => element.className.split(' ').includes(name),
    toggle(name, on) {
      const classes = new Set(element.className.split(' ').filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      element.className = [...classes].join(' ');
    },
  };
  return element;
}

function harness({ mediaReduced = false, classReduced = false, duration, curve } = {}) {
  let now = 0, nextFrame = 0;
  const pending = new Map(), elements = new Map(), requestedTokens = [];
  const rootNode = node();
  rootNode.classList.toggle('jk-rm', classReduced);
  const media = { matches: mediaReduced, addEventListener(name, fn) { assert.equal(name, 'change'); this.change = fn; } };
  let mutation;
  const css = {
    '--jk-dur-2': duration ?? tokens.match(/--jk-dur-2:\s*([^;]+)/)[1],
    '--jk-ease-out': curve ?? tokens.match(/--jk-ease-out:\s*([^;]+)/)[1],
  };
  const window = {
    matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; },
    getComputedStyle(target) {
      assert.equal(target, rootNode);
      return { getPropertyValue(name) { requestedTokens.push(name); return css[name]; } };
    },
  };
  const document = { documentElement: rootNode, createElement: node };
  runInNewContext(motion, {
    window, document,
    el(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    performance: { now: () => now },
    requestAnimationFrame(fn) { const id = ++nextFrame; pending.set(id, fn); return id; },
    cancelAnimationFrame(id) { pending.delete(id); },
    setTimeout() { assert.fail('number motion must not use timers'); },
    setInterval() { assert.fail('number motion must not use intervals'); },
    MutationObserver: class {
      constructor(fn) { mutation = fn; }
      observe(target, options) {
        assert.equal(target, rootNode);
        assert.deepEqual(Array.from(options.attributeFilter), ['class']);
      }
    },
  });
  return {
    set: window.__monyMotion.setFigure, pending, elements, requestedTokens,
    label: (id = 'nav-title') => elements.get(id).children.at(-1),
    advance(time) {
      now = time;
      const callbacks = [...pending.values()]; pending.clear();
      for (const fn of callbacks) fn(now);
    },
    reduceMedia() { media.matches = true; media.change?.(); },
    reduceClass() { rootNode.classList.toggle('jk-rm', true); mutation?.(); },
  };
}

test('first assignment and placeholder to first real value are instant', () => {
  for (const initial of ['', '—', '-', 'Unavailable', null]) {
    const h = harness();
    if (initial !== null) h.set('nav-title', initial);
    h.set('nav-title', '$123.45');
    assert.equal(h.label().textContent, '$123.45');
    assert.equal(h.label().style.opacity, '1');
    assert.equal(h.pending.size, 0);
  }
});

test('numeric changes use the duration and ease-out tokens and finish within 200ms without overshoot', () => {
  const h = harness();
  h.set('nav-title', '$100.00'); h.set('nav-title', '$200.00');
  assert.equal(h.label().textContent, '$100.00');
  assert.equal(h.pending.size, 1);
  // For cubic-bezier(.2,0,0,1), parameter .5 gives time .2 and value .5.
  h.advance(40);
  assert.equal(h.label().textContent, '$150.00');
  let previous = 150;
  for (const time of [80, 120, 160, 199, 200, 250]) {
    h.advance(time);
    const value = Number(h.label().textContent.slice(1));
    assert.ok(value >= previous && value <= 200);
    previous = value;
  }
  assert.equal(h.label().textContent, '$200.00');
  assert.equal(h.pending.size, 0);
  assert.ok(h.requestedTokens.includes('--jk-dur-2'));
  assert.ok(h.requestedTokens.includes('--jk-ease-out'));
  assert.doesNotMatch(motion, /\b(?:160|200)ms\b/);
});

test('computed token values drive timing and easing rather than hardcoded copies', () => {
  const h = harness({ duration: '0.1s', curve: 'cubic-bezier(0, 0, 1, 1)' });
  h.set('nav-title', '100'); h.set('nav-title', '200');
  h.advance(50); assert.equal(h.label().textContent, '150');
  h.advance(100); assert.equal(h.label().textContent, '200');
  assert.equal(h.pending.size, 0);
});

test('counting preserves money, percent, integer and passing/total format in both directions', () => {
  for (const [from, to, middle] of [
    ['≈ $1,000.00', '≈ $2,000.00', '≈ $1,500.00'],
    ['$0.1000', '$0.3000', '$0.2000'],
    ['−10.0%', '10.0%', '0.0%'],
    ['10.0%', '20.0%', '15.0%'],
    ['30', '10', '20'],
    ['1/5', '5/5', '3/5'],
  ]) {
    const h = harness(); h.set('nav-title', from); h.set('nav-title', to);
    h.advance(40); assert.equal(h.label().textContent, middle);
    assert.equal(h.label().style.opacity, '1');
    h.advance(200); assert.equal(h.label().textContent, to);
    assert.equal(h.pending.size, 0);
  }
});

test('identical values leave completed and in-flight figures alone', () => {
  const h = harness(); h.set('nav-title', '10');
  let writes = h.label().writes;
  h.set('nav-title', '10');
  assert.equal(h.label().writes, writes); assert.equal(h.pending.size, 0);
  h.set('nav-title', '100'); h.advance(40);
  const frames = [...h.pending.keys()]; writes = h.label().writes;
  h.set('nav-title', '100');
  assert.deepEqual([...h.pending.keys()], frames);
  assert.equal(h.label().writes, writes);
  h.advance(200); assert.equal(h.label().textContent, '100');
  assert.equal(h.pending.size, 0);
});

test('new numeric targets cancel previous frames and start from the displayed number', () => {
  const h = harness(); h.set('nav-title', '100'); h.set('nav-title', '200');
  h.advance(40); assert.equal(h.label().textContent, '150');
  const oldFrame = [...h.pending.keys()][0];
  h.set('nav-title', '50');
  assert.equal(h.label().textContent, '150');
  assert.ok(!h.pending.has(oldFrame)); assert.equal(h.pending.size, 1);
  h.advance(80); assert.equal(h.label().textContent, '100');
  h.advance(240); assert.equal(h.label().textContent, '50');
  assert.equal(h.pending.size, 0);
});

test('reserved width grows for longer strings and retains its high-water mark', () => {
  const h = harness(); h.set('nav-title', '$9.00'); h.set('nav-title', '$12,345.00');
  for (const target of [h.elements.get('nav-title'), h.label()]) {
    assert.match(target.style.minWidth, /ch$/);
    assert.ok(parseFloat(target.style.minWidth) >= '$12,345.00'.length);
  }
  const width = h.label().style.minWidth;
  h.advance(200); h.set('nav-title', '$1.00'); h.advance(400);
  assert.equal(h.label().style.minWidth, width);
  assert.equal(h.label().style.display, 'inline-block');
});

test('non-countable values and incompatible formats fade opacity with the same 200ms ease-out', () => {
  for (const [from, to] of [
    ['$100.00', 'Unavailable'], ['100', '—'], ['$100.00', '10.0%'],
    ['3/5', '4/6'], ['$0.1000', '$1.00'], ['$100.00', '≈ $100.00'],
    ['$100.00', '<img src=x onerror=alert(1)>'],
  ]) {
    const h = harness(); h.set('nav-title', from); h.set('nav-title', to);
    assert.equal(h.label().textContent, to);
    assert.equal(h.label().style.opacity, '0');
    h.advance(40); assert.ok(Math.abs(Number(h.label().style.opacity) - 0.5) < 0.00001);
    const width = h.label().style.minWidth;
    h.advance(200);
    assert.equal(h.label().style.opacity, '1'); assert.equal(h.pending.size, 0);
    assert.equal(h.label().style.minWidth, width);
    assert.equal(h.label().style.transform, undefined);
  }
});

test('a non-countable change during a count fades, and an interrupted fade resumes current opacity', () => {
  const h = harness(); h.set('nav-title', '100'); h.set('nav-title', '200');
  h.advance(40); h.set('nav-title', 'Unavailable');
  assert.equal(h.label().style.opacity, '0');
  h.advance(80); const opacity = Number(h.label().style.opacity);
  h.set('nav-title', '—');
  assert.equal(Number(h.label().style.opacity), opacity);
  assert.equal(h.pending.size, 1);
  h.advance(280); assert.equal(h.label().style.opacity, '1');
  assert.equal(h.label().textContent, '—'); assert.equal(h.pending.size, 0);
});

for (const preference of ['media', 'class']) {
  test(`${preference} reduced motion makes numeric and text changes instant`, () => {
    const h = harness({ mediaReduced: preference === 'media', classReduced: preference === 'class' });
    h.set('nav-title', '10'); h.set('nav-title', '100');
    assert.equal(h.label().textContent, '100'); assert.equal(h.pending.size, 0);
    h.set('nav-title', 'Unavailable');
    assert.equal(h.label().textContent, 'Unavailable');
    assert.equal(h.label().style.opacity, '1'); assert.equal(h.pending.size, 0);
  });
  test(`${preference} reduced motion cancels every active count and fade immediately`, () => {
    const h = harness();
    h.set('nav-title', '10'); h.set('nav-title', '100');
    h.set('book-value', '$10.00'); h.set('book-value', 'Unavailable');
    h.advance(40); assert.equal(h.pending.size, 2);
    if (preference === 'media') h.reduceMedia(); else h.reduceClass();
    assert.equal(h.pending.size, 0);
    assert.equal(h.label().textContent, '100');
    assert.equal(h.label('book-value').textContent, 'Unavailable');
    assert.equal(h.label().style.opacity, '1');
    assert.equal(h.label('book-value').style.opacity, '1');
    h.advance(300); assert.equal(h.label().textContent, '100');
  });
}

test('day delta keeps the same trusted mark node and animates only its text', () => {
  const h = harness(); h.set('day-delta', '−$100.00');
  const parent = h.elements.get('day-delta'), mark = parent.children[0];
  assert.equal(mark.className, 'jk-mark neg'); assert.equal(mark.attrs['aria-hidden'], 'true');
  h.set('day-delta', '$100.00'); h.advance(16);
  assert.match(h.label('day-delta').textContent, /^−\$/);
  assert.equal(mark.style.opacity, undefined);
  h.advance(200);
  assert.equal(parent.children[0], mark); assert.equal(mark.className, 'jk-mark pos');
  h.set('day-delta', 'Unavailable'); h.advance(400);
  assert.equal(parent.children[0], mark); assert.equal(mark.style.visibility, 'hidden');
  assert.ok(h.label('day-delta').classList.contains('jk-na'));
});

test('all nine headline render paths use setFigure, leaving tables, lists and gauges instant', () => {
  for (const id of ['nav-title', 'day-delta', 'book-value', 'savax-value', 'external-value', 'signals-value', 'forecasts-value', 'decisions-value', 'sources-value']) {
    assert.ok(app.includes(`setFigure('${id}',`), id);
    assert.doesNotMatch(app, new RegExp(`el\\('${id}'\\)\\.(?:textContent|innerHTML)\\s*=`), id);
  }
  for (const id of ['holdings-content', 'venues-content', 'signals-content', 'forecasts-content', 'decisions-content', 'sources-content', 'savax-gauge']) {
    assert.ok(app.includes(`el('${id}').innerHTML =`), id);
    assert.ok(!app.includes(`setFigure('${id}',`), id);
  }
});

test('NAV line, area and last dot are complete on initial render, resize and period changes', () => {
  const elements = new Map();
  for (const id of ['history-plot', 'history-chart', 'history-caption']) elements.set(id, { ...node(), dataset: {}, clientWidth: 700 });
  const chart = app.slice(app.indexOf('  let chartWidth ='), app.indexOf('  // Keep empty/hidden tooltips'));
  const api = runInNewContext(chart + '\n({ renderChart })', {
    el: id => elements.get(id), window: { innerHeight: 900 }, DAY: 86400000,
    updated() {}, money: n => `$${n}`, axisDay: { format: () => '1 Nov' }, axisDayYear: { format: () => '1 Nov 2026' },
    svgEl(name, attrs) { return { name, attrs, style: {}, children: [], append(...nodes) { this.children.push(...nodes); } }; },
    bindScrub() {},
  });
  const history = [6, 3, 1].map((days, i) => ({ t: new Date(Date.now() - days * 86400000).toISOString(), nav: 100 + i * 10 }));
  for (const [width, period, readings] of [[700, 7, 3], [400, 7, 3], [400, 4, 2]]) {
    elements.get('history-plot').clientWidth = width;
    api.renderChart(history, period);
    const svg = elements.get('history-plot').children[0];
    const line = svg.children.find(child => child.attrs.class === 'nav-line');
    const area = svg.children.find(child => child.attrs.class === 'nav-area');
    assert.equal((line.attrs.d.match(/[ML]/g) || []).length, readings);
    assert.ok(area.attrs.d.endsWith('Z'));
    assert.ok(svg.children.some(child => child.name === 'circle'));
    for (const child of svg.children) {
      assert.deepEqual(Object.keys(child.style), []);
      assert.ok(!Object.keys(child.attrs).some(key => /stroke-dash(?:offset|array)/i.test(key)));
    }
  }
  assert.doesNotMatch(app, /armChartDraw|chartAnimated|chartObserver|strokeDash(?:offset|array)|stroke-dashoffset/);
  assert.match(app, /days = Number\(value\);\s*safeRender\(\['history-plot'\]/);
  assert.match(app, /addEventListener\('resize', redraw\)/);
});

function assertCurrentCurves(source, path) {
  assert.doesNotMatch(source, /--jk-(?:ease-inout|spring)\b/, path);
}

test('every site-owned CSS and JS file avoids deprecated curves', () => {
  function scan(directory, prefix = 'site/') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (path === 'site/vendor') continue;
      if (entry.isDirectory()) scan(new URL(`${entry.name}/`, directory), path + '/');
      else if (/\.(?:css|[cm]?js)$/.test(entry.name)) assertCurrentCurves(readFileSync(new URL(entry.name, directory), 'utf8'), path);
    }
  }
  scan(new URL('site/', root));
});

test('deprecated-curve guard rejects CSS and script fixtures for both aliases', () => {
  for (const name of ['--jk-ease-inout', '--jk-spring']) {
    for (const fixture of [`.value { transition: opacity var(--jk-dur-2) var(${name}); }`, `style.easing = 'var(${name})';`]) {
      assert.throws(() => assertCurrentCurves(fixture, 'fixture'), assert.AssertionError);
    }
  }
});
