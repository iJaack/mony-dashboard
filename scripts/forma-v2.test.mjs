import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
