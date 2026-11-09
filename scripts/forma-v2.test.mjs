import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const vendor = new URL('site/vendor/jaack/', root);
const fixture = new URL('../tests/forma-v2/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const cssFiles = [
  ...(await readdir(new URL('site/assets/', root))).filter((name) => name.endsWith('.css')).map((name) => `site/assets/${name}`),
  'site/vendor/jaack/jaack.css',
  'site/vendor/jaack/tokens.css',
  ...(await readdir(new URL('components/', vendor))).filter((name) => name.endsWith('.css')).map((name) => `site/vendor/jaack/components/${name}`),
];

test('Forma v2 shipped CSS has no pure black or infinite animations', async () => {
  const black = /#000\b|#000000|(?<![-\w])black\b|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/i;
  const rgbaBlack = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i;
  for (const path of cssFiles) {
    const css = await read(path);
    assert.doesNotMatch(css, black, path);
    assert.doesNotMatch(css, rgbaBlack, path);
    assert.doesNotMatch(css, /(?:animation|animation-iteration-count)\s*:[^;}]*\binfinite\b/i, path);
  }
});

test('Mony light and dark tokens match the authoritative palette fixture', async () => {
  const { mony } = JSON.parse(await readFile(new URL('palettes.json', fixture), 'utf8'));
  const css = await read('site/assets/app.css');
  const names = { ink2: 'ink-2', accentText: 'accent-text', onAccent: 'on-accent' };
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

test('canonical dark background and vendored checksums stay intact', async () => {
  const tokens = await read('site/vendor/jaack/tokens.css');
  assert.match(tokens, /html\[data-theme="dark"\]\s*\{[^}]*--jk-bg:\s*#14110e\s*;/);
  const version = await read('site/vendor/jaack/VERSION');
  assert.match(version, /iJaack\/Jaack assets\/jaack-design-system at e626247 \(Forma v2\)/);
  const hashes = [...version.matchAll(/^([a-f0-9]{64})  (.+)$/gm)];
  assert.ok(hashes.length > 0, 'VERSION includes current sha256 hashes');
  for (const [, expected, path] of hashes) {
    const bytes = await readFile(new URL(path, vendor));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
  }
});

test('vendored bundles equal build.sh output without modifying shipped files', async () => {
  const temporaryRoot = new URL('.tmp-forma/', root);
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL('vendor-test-', temporaryRoot)));
  try {
    await cp(vendor, directory, { recursive: true });
    const result = spawnSync('sh', ['build.sh'], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    for (const name of ['jaack.css', 'jaack.js']) {
      assert.deepEqual(await readFile(`${directory}/${name}`), await readFile(new URL(name, vendor)), name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Mony palette passes the offline WCAG contrast checker', (t) => {
  const result = spawnSync('python3', [fileURLToPath(new URL('contrast.py', fixture))], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('python3 is not installed');
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stderr, /FAIL: 0\b/);
});
