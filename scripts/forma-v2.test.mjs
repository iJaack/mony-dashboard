import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const vendor = new URL('site/vendor/jaack/', root);
const fixture = new URL('../tests/forma-v2/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const assetFiles = (await readdir(new URL('site/assets/', root), { recursive: true }))
  .filter((name) => /\.(css|js)$/.test(name)).map((name) => `site/assets/${name}`);
const cssFiles = [
  ...assetFiles.filter((name) => name.endsWith('.css')),
  'site/vendor/jaack/jaack.css',
  'site/vendor/jaack/tokens.css',
  ...(await readdir(new URL('components/', vendor))).filter((name) => name.endsWith('.css')).map((name) => `site/vendor/jaack/components/${name}`),
];

test('Forma v2 shipped CSS has no pure black or infinite animations', async () => {
  for (const path of cssFiles) {
    const css = await read(path);
    assert.doesNotMatch(css, /#000\b|#000000|(?<![-\w])black\b|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/i, path);
    assert.doesNotMatch(css, /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i, path);
    assert.doesNotMatch(css, /(?:animation|animation-iteration-count)\s*:[^;}]*\binfinite\b/i, path);
  }
});

test('shipped padding and scroll offsets use root measurements with vendor fallbacks', async () => {
  const html = await read('site/index.html');
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)];
  assert.ok(stylesheets.some(([, path]) => path === 'assets/jaack-local.css'));
  const css = (await Promise.all(stylesheets.map(([, path]) => read(`site/${path}`))))
    .join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const pageRules = [...css.matchAll(/(?:^|[}\s])\.jk-page\s*\{([^}]+)\}/g)];
  for (const [edge, token] of [['top', '--jk-top-clearance'], ['bottom', '--jk-dock-clearance']]) {
    const padding = pageRules.flatMap(([, block]) => [...block.matchAll(new RegExp(`padding-${edge}\\s*:\\s*([^;]+);`, 'g'))]).at(-1)?.[1];
    assert.equal(padding?.trim(), `var(${token})`);
    for (const [, block] of pageRules) assert.ok(!block.includes(`${token}:`), `page must inherit ${token}`);
  }
  const local = await read('site/assets/jaack-local.css');
  assert.doesNotMatch(local, /--jk-(?:top|dock)-clearance\s*:/);
  const tokens = await read('site/vendor/jaack/tokens.css');
  assert.match(tokens, /--jk-top-clearance:calc\(var\(--jk-bar-h\) \+ var\(--jk-bar-gap\) \+ env\(safe-area-inset-top,0px\) \+ var\(--jk-breath\)\)/);
  assert.match(tokens, /--jk-dock-clearance:calc\(var\(--jk-dock-h\) \+ var\(--jk-dock-gap\) \+ env\(safe-area-inset-bottom,0px\) \+ var\(--jk-breath\)\)/);
  const appCss = await read('site/assets/app.css');
  assert.match(appCss, /scroll-padding-top:\s*var\(--jk-top-clearance\)/);
  assert.match(appCss, /scroll-padding-bottom:\s*var\(--jk-dock-clearance\)/);
  assert.match(appCss, /\.jk-ch\s*\{\s*scroll-margin-top:\s*var\(--jk-top-clearance\)/);
  const app = await read('site/assets/app.js');
  assert.ok(app.indexOf('Math.ceil(bar.getBoundingClientRect().bottom) + 14') < app.indexOf('async function main()'));
  assert.match(app, /Math\.ceil\(window\.innerHeight - dock\.getBoundingClientRect\(\)\.top\) \+ 14/);
  assert.match(app, /getComputedStyle\(dock\)\.display !== "none"/);
  assert.match(app, /new ResizeObserver\(measure\)/);
  for (const event of ['resize', 'orientationchange']) assert.ok(app.includes(`window.addEventListener("${event}", measure)`));
  // Retain the compact first-screen decision layout for the owner's 390×844 measurement.
  assert.match(local, /@media \(max-width: 390px\)/);
  assert.match(local, /#operations \.decision-title \+ \.jk-note\s*\{ padding-bottom: calc\(var\(--jk-dock-clearance\) \+ 16px\)/);
});

test('Mony light and dark tokens match the authoritative palette fixture', async () => {
  const { mony } = JSON.parse(await readFile(new URL('palettes.json', fixture), 'utf8'));
  const css = await read('site/assets/app.css');
  const names = { ink2: 'ink-2', surface2: 'surface-2', accentText: 'accent-text', onAccent: 'on-accent' };
  for (const [theme, values] of Object.entries(mony)) {
    const block = css.match(new RegExp(`html\\[data-theme="${theme}"\\][^{]*\\{([^}]+)\\}`))?.[1];
    assert.ok(block, `${theme} palette exists`);
    for (const [key, expected] of Object.entries(values)) {
      const token = `--jk-${names[key] || key}`;
      const actual = block.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))?.[1];
      assert.equal(actual?.replace(/\s/g, ''), expected, `${theme} ${token}`);
    }
  }
});

test('v2.0.0 vendor file set, every manifest hash and release provenance stay intact', async () => {
  const tokens = await read('site/vendor/jaack/tokens.css');
  assert.match(tokens, /html\[data-theme="dark"\]\s*\{[^}]*--jk-bg:\s*#130e0b\s*;/);
  const manifest = await read('site/vendor/jaack/MANIFEST.txt');
  const entries = manifest.trim().split('\n').map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `valid manifest line: ${line}`);
    return match.slice(1);
  });
  const paths = entries.map(([, path]) => path);
  assert.equal(new Set(paths).size, paths.length, 'no duplicate entries');
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      assert.ok(!entry.isSymbolicLink(), `no symlinks: ${path}`);
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, directory), path + '/');
      else files.push(path);
    }
  }
  await walk(vendor);
  assert.deepEqual(files.sort(), [...paths, 'MANIFEST.txt', 'SOURCE'].sort());
  for (const [expected, path] of entries) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), `safe manifest path: ${path}`);
    const bytes = await readFile(new URL(path, vendor));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
  }
  assert.equal(await read('site/vendor/jaack/SOURCE'), 'iJaack/jaack-design v2.0.0 008ab6f2f0a30091543db16ac70f02cab041338e\n');
});

test('site acceptance scans reject retired colours, shadows, offsets and ghost numerals', async () => {
  const retired = /#(?:14110e|1b1714|231e1a|11100e|191714|13120e|1a1915|15110f|1d1815|15100e|1e1814|161210|1e1916|120f0c|1a1612|12100e|1a1714|f4eee5|cdc3b6|0c0c0c|f0ede6|cac5bb|8eb4c9|a9c8d9|231f19)/i;
  for (const path of ['site/index.html', ...assetFiles, 'site/favicon.svg']) {
    const content = await read(path);
    assert.doesNotMatch(content, /#000\b|#000000|:\s*black\b|rgba\(0,\s*0,\s*0/i, path);
    assert.doesNotMatch(content, retired, path);
    assert.doesNotMatch(content, /jk-topbar-h|rgba\(8,\s*6,\s*4|jk-deco/, path);
  }
  const html = await read('site/index.html');
  assert.equal((html.match(/<b>0[1-7]<\/b>/g) || []).length, 7, 'chapter eyebrows stay');
});

test('NAV chart and favicon use the Ombra accent', async () => {
  const css = await read('site/assets/app.css');
  assert.match(css, /\.nav-line\s*\{ stroke: var\(--jk-accent\)/);
  const app = await read('site/assets/app.js');
  assert.match(app, /svgEl\('circle', \{[^}]*fill: 'var\(--jk-accent\)'/);
  assert.match(css, /html\[data-theme="dark"\] \.nav-area\s*\{ opacity: \.16; \}/);
  const favicon = await read('site/favicon.svg');
  assert.match(favicon, /<rect\b[^>]*fill="#130e0b"/);
  assert.match(favicon, /<text\b[^>]*fill="#708ea2"/);
});

test('menu is a deferred self-hosted enhancement under the existing CSP', async () => {
  const html = await read('site/index.html');
  assert.match(html, /script-src 'self'/);
  assert.match(html, /<script src="\.\/assets\/menu\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  const links = html.match(/<nav class="jk-links" id="mony-menu"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(links);
  assert.deepEqual([...links.matchAll(/>(\w+)<\/a>/g)].map(([, label]) => label), ['Treasury', 'Book', 'Limits', 'Research', 'Sources']);
  const local = await read('site/assets/jaack-local.css');
  const fallbackLinks = local.match(/\.jk-top:not\(\.has-menu\) \.jk-links \{([^}]*)\}/)?.[1] ?? '';
  assert.match(fallbackLinks, /min-width: 0;/);
  assert.match(fallbackLinks, /overflow-x: auto;/);
  assert.match(local, /\.jk-top:not\(\.has-menu\) \.jk-mark \{[^}]*flex: none;/);
  assert.match(local, /padding: 6px 6px 6px 16px/);
  assert.match(local, /\.jk-top.has-menu \.jk-links\{[^}]*left:0;right:0;/);
  assert.match(local, /\.jk-top.has-menu \.jk-links\{[^}]*-webkit-mask-image:none;mask-image:none;/);
});

test('Mony palette passes the offline WCAG contrast checker', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('contrast.py', fixture))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stderr, /FAIL: 0\b/);
});

test('dock and bar use the same section names, in the intended order', async () => {
  const html = await read('site/index.html');
  const dock = html.match(/id="chapter-nav"[^>]*>([\s\S]*?)<\/div>/)[1];
  const bar = html.match(/id="mony-menu"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const buttons = [...dock.matchAll(/data-v="([^"]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map(([, , label]) => label), ['Treasury', 'Book', 'Limits', 'Research', 'Forecasts', 'Decisions', 'Sources']);
  const names = new Map(buttons.map(([, id, label]) => [id, label]));
  for (const [, id, label] of bar.matchAll(/href="#([^"]+)">([^<]+)<\/a>/g)) assert.equal(names.get(id), label);
});

test('all dock and fallback bar fade masks use 24px and the edge token stays .39', async () => {
  const css = await read('site/assets/app.css');
  const rules = [...css.matchAll(/:where\(\.dock-scroll, \.jk-top:not\(\.has-menu\) \.jk-links\)([^{}]+)\{([^}]+)\}/g)];
  assert.equal(rules.length, 3);
  assert.deepEqual(rules.map(([, selector]) => selector.trim()), [
    '.can-scroll:not(.at-end)', '.can-scroll:not(.at-start)', '.can-scroll:not(.at-start):not(.at-end)',
  ]);
  for (const [, , block] of rules) {
    const masks = [...block.matchAll(/(?:-webkit-)?mask-image:\s*([^;]+);/g)];
    assert.equal(masks.length, 2);
    assert.equal(masks[0][1], masks[1][1]);
    assert.match(masks[0][1], /24px/);
    assert.doesNotMatch(masks[0][1], /22px/);
  }
  assert.match(css, /--jk-edge:\s*rgba\(233,228,218,\.39\);/);
});

test('sheet text and numeric column headers align with their cells at desktop widths', async () => {
  const css = await read('site/assets/app.css');
  const desktop = css.slice(0, css.indexOf('@container (max-width: 720px)'));
  assert.match(desktop, /\.sheet th, \.sheet td\s*\{[^}]*text-align:\s*right;/);
  assert.match(desktop, /\.sheet th:first-child, \.sheet td:first-child\s*\{\s*text-align:\s*left;/);
  const app = await read('site/assets/app.js');
  const tables = [...app.matchAll(/<table class="sheet">([\s\S]*?)<\/table>/g)];
  assert.equal(tables.length, 1, 'audit every generated sheet table');
  const table = tables[0][1];
  assert.deepEqual([...table.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(([, label]) => label), ['Asset', 'Balance', 'Value', 'Weight']);
  assert.match(table, /<tbody>[^]*?<tr><th scope="row">/);
  assert.deepEqual([...table.matchAll(/<td class="num" data-label="([^"]+)">/g)].map(([, label]) => label), ['Balance', 'Value', 'Weight']);
  assert.doesNotMatch(await read('site/index.html'), /class="sheet"/, 'no additional static sheet tables to audit');
});

async function dockHarness({ view = 0, width = 200, total = 600, left = 260, buttonWidth = 80 } = {}) {
  const app = await read('site/assets/app.js');
  const source = app.slice(app.indexOf('  function hintScroll('), app.indexOf('  async function main()'));
  const callbacks = {}, observers = {}, classes = new Set(), writes = [];
  const nav = { querySelector: () => button };
  const scroller = {
    scrollWidth: total, clientWidth: width, clientLeft: 2,
    get scrollLeft() { return view; },
    set scrollLeft(value) { writes.push(value); view = value; },
    getBoundingClientRect: () => ({ left: 100 }),
    querySelector: () => nav,
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
    addEventListener(name, fn, options) { assert.equal(name, 'scroll'); assert.equal(options.passive, true); callbacks.scroll = fn; },
    scrollTo() { assert.fail('use scrollLeft directly'); },
  };
  const button = {
    closest: () => scroller,
    getBoundingClientRect: () => ({ left: 102 + left - view, width: buttonWidth }),
    scrollIntoView() { assert.fail('must not scroll the page'); },
  };
  const window = { ResizeObserver: true, scrollY: 777, scrollTo() { assert.fail('must not scroll the page'); } };
  const api = runInNewContext(source + '\n({hintScroll, revealDock})', {
    window,
    document: { fonts: { ready: { then(fn) { callbacks.fonts = fn; } } } },
    addEventListener(name, fn) { callbacks[name] = fn; },
    ResizeObserver: class { constructor(fn) { callbacks.observer = fn; observers.resize = []; } observe(node) { observers.resize.push(node); } },
    MutationObserver: class { constructor(fn) { callbacks.mutation = fn; } observe(node, options) { observers.mutation = { node, options }; } },
  });
  return { ...api, scroller, button, nav, window, callbacks, observers, classes, writes, move(value) { left = value; } };
}

test('active dock reveal sets only horizontal scrollLeft, with 24px fade clearance', async () => {
  for (const [options, expected] of [
    [{ left: 260 }, 164],
    [{ view: 200, left: 170 }, 146],
    [{ view: 100, left: 130 }, 100],
    [{ view: 80, left: 4 }, 0],
    [{ left: 514 }, 400],
    [{ total: 180, left: 4 }, 0],
  ]) {
    const h = await dockHarness(options);
    h.revealDock(h.button);
    assert.equal(h.scroller.scrollLeft, expected, JSON.stringify(options));
    assert.equal(h.window.scrollY, 777);
    assert.equal(h.writes.length, 1);
  }
});

test('dock fades track manual scrolling; active reveal runs on load, pressed changes, resizing and fonts', async () => {
  const h = await dockHarness({ left: 4 });
  h.hintScroll(h.scroller);
  assert.equal(h.scroller.scrollLeft, 0);
  assert.ok(h.classes.has('can-scroll'));
  assert.ok(h.classes.has('at-start'));
  assert.ok(!h.classes.has('at-end'));
  assert.deepEqual(h.observers.resize, [h.scroller, h.nav]);
  assert.equal(h.observers.mutation.node, h.nav);
  assert.equal(h.observers.mutation.options.subtree, true);
  assert.equal(h.observers.mutation.options.attributes, true);
  assert.deepEqual(Array.from(h.observers.mutation.options.attributeFilter), ['aria-pressed']);
  for (const [view, atStart, atEnd] of [[1, true, false], [2, false, false], [100, false, false], [398, false, false], [399, false, true], [400, false, true]]) {
    h.scroller.scrollLeft = view;
    h.callbacks.scroll();
    assert.equal(h.scroller.scrollLeft, view, 'manual scrolling does not snap back to active');
    assert.equal(h.classes.has('at-start'), atStart);
    assert.equal(h.classes.has('at-end'), atEnd);
  }
  for (const callback of ['mutation', 'resize', 'observer', 'fonts']) {
    h.scroller.scrollLeft = 0;
    h.move(260);
    h.callbacks[callback]();
    assert.equal(h.scroller.scrollLeft, 164, callback);
    assert.ok(!h.classes.has('at-start') && !h.classes.has('at-end'), 'both fades in the middle');
    assert.equal(h.window.scrollY, 777);
  }
  h.scroller.scrollWidth = 180;
  h.move(4);
  h.callbacks.observer();
  assert.ok(!h.classes.has('can-scroll'));
  assert.ok(h.classes.has('at-start') && h.classes.has('at-end'));
});
