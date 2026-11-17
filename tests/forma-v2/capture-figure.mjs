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
const results = [], captures = [], measurements = [], browserErrors = [], external = [];
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
    for (const [width, height] of sizes.filter(([w]) => count === null || w !== 3440)) {
      await page.setViewportSize({ width, height });
      // Let layout settle after a viewport change before measuring or scrolling.
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      for (const theme of ['light', 'dark']) for (const motion of ['normal', 'media', 'class']) {
        await page.emulateMedia({ reducedMotion: motion === 'media' ? 'reduce' : 'no-preference' });
        await page.evaluate(({ theme, motion }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.classList.toggle('jk-rm', motion === 'class');
          const group = document.getElementById('holdings-figures');
          const top = document.querySelector('.jk-top');
          const offset = (top ? top.getBoundingClientRect().height : 0) + 16;
          window.scrollTo(0, Math.max(0, group.getBoundingClientRect().top + scrollY - offset));
        }, { theme, motion });
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
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
                pieces: ['delta', 'min', 'spark', 'max'].map(name => {
                  const piece = node.querySelector('.jk-figure-' + name);
                  return { name, hidden: piece.hidden, hiddenAttribute: piece.hasAttribute('hidden'), visibility: piece.style.visibility, display: getComputedStyle(piece).display, width: piece.getBoundingClientRect().width };
                }),
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
          if (row.numeric < 2) {
            assert.ok(row.empty && row.noLabel, JSON.stringify(row));
            assert.ok(row.pieces.every(piece => !piece.hidden && !piece.hiddenAttribute && piece.visibility === 'hidden' && piece.display !== 'none' && piece.width > 0), JSON.stringify(row));
          }
          else {
            assert.ok(row.pieces.every(piece => piece.visibility === ''), JSON.stringify(row));
            assert.equal(row.slots, 30); assert.equal(row.leading, 30 - row.numeric);
            assert.ok(row.alt.includes(`${row.numeric} days with readings in the last 30 days (UTC)`));
          }
        }
        results.push({ count: count ?? 'full', width, height, theme, motion, ...evidence });
        if (motion === 'normal') {
          if (width === 1280) {
            const layout = await page.evaluate(() => {
              // All rows are rendered (no virtualization), so DOM rects also measure
              // rows below the viewport without cropping them to the screenshot.
              const rows = [...document.querySelectorAll('#holdings-figures > li')].map(node => {
                const rect = node.getBoundingClientRect();
                const subtitle = [...node.querySelectorAll('.jk-figure-label .sub')].find(node => node.textContent.startsWith('Balance '));
                const range = document.createRange();
                range.selectNodeContents(subtitle);
                const clientRects = [...range.getClientRects()].map(rect => ({ x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height }));
                const lineHeight = parseFloat(getComputedStyle(subtitle).lineHeight);
                return {
                  label: node.querySelector('.jk-figure-label').firstChild.textContent,
                  valueX: node.querySelector('.jk-figure-value').getBoundingClientRect().x,
                  top: rect.top + scrollY, viewportTop: rect.top, height: rect.height,
                  subtitle: { text: subtitle.textContent, clientRects, lineHeight, height: subtitle.getBoundingClientRect().height,
                    wraps: clientRects.length > 1 || subtitle.getBoundingClientRect().height > lineHeight + 0.5 },
                };
              });
              const tops = [...new Set(rows.map(row => row.top))].sort((a, b) => a - b);
              for (const [index, row] of rows.entries()) {
                const level = tops.indexOf(row.top);
                row.nextRowTopDelta = index + 1 < rows.length ? rows[index + 1].top - row.top : null;
                // Adjacent cells in the same grid row have delta zero. Pitch is
                // the next distinct grid-row top, or the preceding pitch at the end.
                row.pitch = tops.length === 1 ? row.height : level + 1 < tops.length ? tops[level + 1] - row.top : row.top - tops[level - 1];
              }
              return { rows, rowHeightsDiffer: rows.some(row => Math.abs(row.height - rows[0].height) > 0.02) };
            });
            assert.equal(layout.rows.length, treasury.positions.length);
            measurements.push({ days: count ?? 'full', width, height, theme, ...layout });
          }
          const name = count === null ? `holdings-${width}-${theme}.png` : `days-${count}-${width}-${theme}.png`;
          const firstTop = await page.evaluate(() => document.querySelector('#holdings-figures > li')?.getBoundingClientRect().top ?? null);
          assert.ok(firstTop != null && firstTop >= 0 && firstTop < 220, `Holdings first row off-screen in ${name}: top=${firstTop}`);
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
  for (const layout of measurements) {
    const baseline = measurements.find(item => item.days === 30 && item.theme === layout.theme);
    layout.matches30 = {
      valueX: layout.rows.every((row, index) => Math.abs(row.valueX - baseline.rows[index].valueX) <= 0.02),
      pitch: layout.rows.every((row, index) => Math.abs(row.pitch - baseline.rows[index].pitch) <= 0.02),
      wrapping: layout.rows.every((row, index) => row.subtitle.wraps === baseline.rows[index].subtitle.wraps),
    };
  }
  await writeFile(resolve(output, 'measurements.json'), JSON.stringify({
    units: 'CSS px', topOrigin: 'document', pitch: 'Successive distinct grid-row tops; adjacent cells also retain nextRowTopDelta. Last row uses preceding pitch; a single grid row uses height.',
    tolerance: 0.02, measurements,
  }, null, 2) + '\n');
  const unique = (rows, value) => [...new Set(rows.map(value))].map(value => value.toFixed(3)).join(', ');
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
Under two readings: empty drawable series, no line/dot/band; delta, min, spark and max
remain in layout with visibility hidden, no hidden attribute or display:none, and nonzero widths;
value shown, history box reserved, no visible empty-state label (0/1 day). Hidden English alt remains.
All data JSON requests used fixtures; no external requests or browser errors.
Detailed evidence: [checks.json](checks.json).

## Layout measurements at 1280 × 800

All eight rendered rows are measured, including rows below the viewport. Coordinates are CSS pixels.
Full per-row value x, document top, viewport top, height, pitch and subtitle text client rects:
[measurements.json](measurements.json). Pitch uses successive distinct grid-row tops because
adjacent cells in the two-column grid share a top. The final grid row uses the preceding pitch.
Matches compare each row to the 30-day set in the same theme (tolerance 0.02px).

| Days | Theme | Value x (row order) | Row pitch | Heights | X / pitch match 30 | Wrapped Balance/Weight rows |
| --- | --- | --- | --- | --- | --- | --- |
${measurements.map(item => `| ${item.days} | ${item.theme} | ${item.rows.map(row => row.valueX.toFixed(3)).join(', ')} | ${unique(item.rows, row => row.pitch)} | ${unique(item.rows, row => row.height)} | ${item.matches30.valueX} / ${item.matches30.pitch} | ${item.rows.filter(row => row.subtitle.wraps).map(row => row.label).join(', ') || 'none'} |`).join('\n')}

${measurements.map(item => `${item.days} days, ${item.theme}: row heights ${item.rowHeightsDiffer ? 'differ' : 'equal'}; subtitle wrapping ${item.matches30.wrapping ? 'matches' : 'differs from'} 30 days.`).join('\n\n')}

## Other validation

Project checks run separately; retain their output alongside this pack:

- \`npm test\` — [npm-test.log](npm-test.log)
- \`python3 tests/forma-v2/contrast.py\` — [contrast.log](contrast.log)
- \`python3 tests/forma-v2/validate-data.py\` — [schema.log](schema.log), public and test-only synthetic schemas
- \`(cd site/vendor/jaack && shasum -a 256 -c MANIFEST.txt)\` — [vendor-manifest.log](vendor-manifest.log)
- \`gitleaks detect --no-banner --redact\` — [gitleaks-git.log](gitleaks-git.log)
- \`gitleaks detect --no-git --no-banner --redact\` — [gitleaks-tree.log](gitleaks-tree.log)

## Open points

The supplied spec includes Stage 2 decisions 9–11. The app continues to pass its
refresh timestamp as now; changing that existing call site to wall-clock time is outside this adapter change.
Synthetic bands exercise optional support; live treasury positions have no targetBand.
Design acceptance remains with Jaack. No push or deployment is performed.
`);
  console.log(`${results.length} browser checks passed; ${captures.length} PNGs in ${output}`);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
