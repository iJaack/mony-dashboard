// Run: node tests/forma-v2/capture-figure.mjs
// Uses the existing Playwright install (or PLAYWRIGHT_MODULE=/path/to/playwright).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = resolve(root, 'tests/fixtures/synthetic');
const site = resolve(root, 'site');
const output = resolve(root, 'output/figure-2026-11-17');
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
} catch (error) {
  if (process.env.PLAYWRIGHT_MODULE) throw error;
  // playwright-cli already installs Playwright here; no install or network needed.
  const cache = resolve(process.env.npm_config_cache || resolve(homedir(), '.npm'), '_npx');
  for (const name of (await readdir(cache).catch(() => [])).sort()) {
    try { playwright = require(resolve(cache, name, 'node_modules/playwright')); break; } catch {}
  }
  if (!playwright) throw new Error('Set PLAYWRIGHT_MODULE to an existing Playwright installation.');
}

const files = Object.fromEntries(await Promise.all((await readdir(fixtures))
  .filter(name => name.endsWith('.json')).map(async name => [name, await readFile(resolve(fixtures, name), 'utf8')])));
const treasury = JSON.parse(files['treasury.json']);
const history = JSON.parse(files['positions-history.json']);
const now = Date.parse(treasury.generatedAt);
const day = 86_400_000;
const today = Math.floor(now / day);
const variants = [null, 0, 1, 5, 30];
const sizes = [[466, 678], [669, 951], [1280, 800], [2560, 1440], [3440, 1440]];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };

// Fail closed: even an unintercepted /data request can only receive a fixture.
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/data/')) {
      const body = files[pathname.slice(6)];
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(body || '{}');
      return;
    }
    const path = resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(site + sep) || extname(path) === '.json') { res.writeHead(404); res.end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(output, { recursive: true });
const results = [], captures = [], browserErrors = [], external = [];
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true });
  for (const count of variants) {
    // Derive variants in memory from the existing 30-day synthetic set. Fondo D
    // keeps its genuine 12-day history; no missing observations are invented.
    const selected = count === null ? history : {
      ...history, positions: Object.fromEntries(Object.entries(history.positions)
        .map(([id, readings]) => [id, count ? readings.slice(-count) : []])),
    };
    const context = await browser.newContext();
    const requested = new Set();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
      if (url.pathname.startsWith('/data/')) {
        const name = url.pathname.slice(6);
        assert.ok(Object.hasOwn(files, name), `Unknown fixture requested: ${name}`);
        requested.add(name);
        await route.fulfill({ contentType: 'application/json', body: name === 'positions-history.json' ? JSON.stringify(selected) : files[name] });
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await page.goto(origin + '/#holdings');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of sizes.filter(([w]) => count === null || w === 466 || w === 1280)) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) for (const motion of ['normal', 'media', 'class']) {
        await page.emulateMedia({ reducedMotion: motion === 'media' ? 'reduce' : 'no-preference' });
        await page.evaluate(({ theme, motion }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.classList.toggle('jk-rm', motion === 'class');
          const group = document.getElementById('holdings-figures');
          window.scrollTo(0, group.getBoundingClientRect().top + scrollY - 100);
        }, { theme, motion });
        const evidence = await page.evaluate(({ positions, selected, now, today, day }) => {
          const group = document.getElementById('holdings-figures');
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            rowOverflow: [...group.children].some(row => row.scrollWidth > row.clientWidth + 1),
            columns: getComputedStyle(group).gridTemplateColumns.split(' ').length,
            rows: [...group.children].map(node => {
              const label = node.querySelector('.jk-figure-label').firstChild.textContent;
              const position = positions.find(row => row.asset === label);
              const data = window.MonyHoldings.figureData(position, selected, now);
              const readings = selected.positions[window.MonyHoldings.key(position)] || [];
              const expected = Array.from({ length: 30 }, (_, index) => {
                const reading = readings.find(point => Math.floor(Date.parse(point.t) / day) === today - 29 + index);
                return reading?.valueUsd ?? null;
              });
              const numeric = expected.filter(Number.isFinite).length;
              const spark = node.querySelector('svg'), dot = node.querySelector('.jk-figure-dot');
              const rect = spark.getBoundingClientRect(), pad = 2.5;
              const last = expected.findLastIndex(Number.isFinite);
              return {
                label, numeric, axis: numeric < 2 ? data.series.length === 0 : JSON.stringify(data.series) === JSON.stringify(expected),
                slots: data.series.length, leading: data.series.findIndex(Number.isFinite),
                line: !!node.querySelector('.jk-figure-line'), dot: !!dot,
                dotOnCalendarDay: !dot || Math.abs(Number(dot.getAttribute('cx')) - (pad + last / 29 * (rect.width - 2 * pad))) < 0.02,
                deltaHidden: node.querySelector('.jk-figure-delta').hidden,
                limitsHidden: ['min', 'max'].every(name => node.querySelector('.jk-figure-' + name).hidden),
                empty: spark.children.length === 0,
                reserved: node.querySelector('.jk-figure-history').getBoundingClientRect().width > 0 && rect.height > 0,
                noLabel: !/insufficient|unavailable|no history|one reading/i.test([...node.children].filter(child => !child.matches('.jk-figure-alt')).map(child => child.innerText || '').join(' ')),
                valueShown: node.querySelector('.jk-figure-number').innerText.length > 0,
                alt: node.querySelector('.jk-figure-alt').textContent,
                instant: [...node.querySelectorAll('.jk-figure-line,.jk-figure-dot,.jk-figure-band')].every(mark => getComputedStyle(mark).transitionDuration === '0s' && getComputedStyle(mark).animationName === 'none'),
              };
            }),
          };
        }, { positions: treasury.positions, selected, now, today, day });
        assert.equal(evidence.overflow, false); assert.equal(evidence.rowOverflow, false);
        assert.equal(evidence.columns, width < 1280 ? 1 : width < 2560 ? 2 : 4);
        assert.equal(evidence.rows.length, treasury.positions.length);
        for (const row of evidence.rows) {
          assert.ok(row.axis && row.dotOnCalendarDay && row.reserved && row.valueShown && row.instant, JSON.stringify(row));
          assert.equal(row.line, row.numeric >= 2); assert.equal(row.dot, row.numeric >= 2);
          if (row.numeric < 2) assert.ok(row.empty && row.deltaHidden && row.limitsHidden && row.noLabel, JSON.stringify(row));
          else {
            assert.equal(row.slots, 30); assert.equal(row.leading, 30 - row.numeric);
            assert.ok(row.alt.includes(`${row.numeric} days with readings in the last 30 days (UTC)`));
          }
        }
        results.push({ count: count ?? 'full', width, height, theme, motion, ...evidence });
        if (motion === 'normal') {
          const name = count === null ? `holdings-${width}-${theme}.png` : `days-${count}-${width}-${theme}.png`;
          await page.screenshot({ path: resolve(output, name) }); captures.push(name);
          if (width === 466) {
            // Supplemental strip lets reviewers inspect all eight synthetic rows.
            const strip = 'rows-' + name;
            await page.evaluate(() => document.querySelectorAll('.jk-top,.jk-dock').forEach(node => { node.style.visibility = 'hidden'; }));
            await page.locator('#holdings-figures').screenshot({ path: resolve(output, strip) });
            await page.evaluate(() => document.querySelectorAll('.jk-top,.jk-dock').forEach(node => { node.style.visibility = ''; }));
            captures.push(strip);
          }
        }
      }
    }
    assert.deepEqual([...requested].sort(), Object.keys(files).sort(), 'every data JSON must be synthetic');
    await context.close();
  }
  assert.deepEqual(external, []); assert.deepEqual(browserErrors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify(results, null, 2) + '\n');
  await writeFile(resolve(output, 'README.md'), `# Holdings figure captures — 17 November 2026

Synthetic data only. Reproduce from the repo root with \`node tests/forma-v2/capture-figure.mjs\`.
Uses the existing Playwright install or \`PLAYWRIGHT_MODULE=/path/to/playwright\`.
The local server and browser both route every data/*.json to tests/fixtures/synthetic;
external requests are blocked. No provider or live updater is called.
The fixture clock is fixed at ${treasury.generatedAt}; today is its UTC day, matching
the app's existing refresh-time anchor. Variants truncate histories in memory, with no new JSON fixtures.
Fondo D has 12 genuine fixture readings, so the 30-day variant retains 12 for D and 30 for other rows.

## Captures

Light is light; dark is Ombra. Main PNGs use the requested viewport dimensions and scroll to Holdings.
Supplemental rows-* strips at 466px show all eight rows beyond the viewport.

${captures.map(name => `- [${name}](${name})`).join('\n')}

## Browser checks

${results.length} viewport/theme/motion checks passed (normal, reduced media, reduced class), eight rows each.
No horizontal page or row overflow. Fixed 30-day calendar axis matches every observation;
today is slot 29, leading null count equals 30 minus reading days. Dot stays on the last recorded day.
Under two readings: empty drawable series, no line/dot/band/scale ends, delta hidden,
value shown, history box reserved, no visible empty-state label (0/1 day). Hidden English alt remains.
All data JSON requests used fixtures; no external requests or browser errors.
Detailed evidence: [checks.json](checks.json).

## Other validation

Project checks run separately; retain their output alongside this pack:

- \`npm test\` — [npm-test.log](npm-test.log)
- \`python3 tests/forma-v2/contrast.py\` — [contrast.log](contrast.log)
- \`python3 tests/forma-v2/validate-data.py\` — [schema.log](schema.log), public and test-only synthetic schemas
- \`(cd site/vendor/jaack && shasum -a 256 -c MANIFEST.txt)\` — [vendor-manifest.log](vendor-manifest.log)
- \`gitleaks detect --no-banner --redact\` — [gitleaks-git.log](gitleaks-git.log)
- \`gitleaks detect --no-git --no-banner --redact\` — [gitleaks-tree.log](gitleaks-tree.log)

## Open points

The supplied SPEC-jk-figure.md ends at section 10 and lacks the named revision and Stage 2 decisions.
The explicit Stage 2 task requirements control this implementation. The app continues to pass its
refresh timestamp as now; changing that existing call site to wall-clock time is outside this adapter change.
Synthetic bands exercise optional support; live treasury positions have no targetBand.
Design acceptance remains with Jaack. No push or deployment is performed.
`);
  console.log(`${results.length} browser checks passed; ${captures.length} PNGs in ${output}`);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
