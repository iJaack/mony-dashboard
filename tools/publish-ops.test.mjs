import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { sanitizeDecision, sanitizeValuation, sanitizeAudits, upsertDecision } from './publish-ops.mjs';

const base = {
  id: '2026-10-17-savax-trim-1', date: '2026-10-17T16:41:00Z', outcome: 'execute',
  title: 'sAVAX trim, tranche 1', reason: 'Reduced concentration above the 15% cap.', asset: 'sAVAX', action: 'trim',
  size: { amount: 0.55, asset: 'sAVAX', usd: 6.98 }, received: { amount: 0.7097, asset: 'WAVAX' },
  txs: [{ label: 'swap', hash: '0x3dc1541819b4e4c05aeeb34216fea419fe3c69d18450f0c4cdc9bbcc0de06abe', block: 97809086, gasUsed: 383647, gasAvax: 0.002301882 }],
  trim: { completedAmount: 0.55, asset: 'sAVAX', targetWeight: 0.15 },
};

test('recursive allowlist strips private fields at every level', () => {
  const privateFields = { nonce: 42, signature: 'private', intent: {}, approval: {}, signer: 'private', pubkey: 'private', caps: {}, slippageBps: 100, paths: '/var/private' };
  const dirty = { ...base, ...privateFields, size: { ...base.size, ...privateFields }, received: { ...base.received, ...privateFields }, txs: base.txs.map((row) => ({ ...row, ...privateFields })), trim: { ...base.trim, ...privateFields } };
  assert.deepEqual(sanitizeDecision(dirty), sanitizeDecision(base));
});

test('remaining leaky strings are rejected, including a leak beyond the length limit', () => {
  for (const reason of ['signer active', 'verifier approved', 'nonce 42', 'signature exists', 'socket ready', 'token path', 'secret exists', '/var/lib/private', '/etc/private', '/home/box/file', '/Users/person/file', 'https://notion.so/private', 'Ops approved', 'Ed25519', base.txs[0].hash, 'slippage 2%', 'local.local', '<script>alert(1)</script>', 'x'.repeat(300) + ' signer']) {
    assert.throws(() => sanitizeDecision({ ...base, reason }), /Unsafe/);
  }
  assert.throws(() => sanitizeDecision({ ...base, reason: 'sig\u200bnature' }), /Unsafe/);
});

test('validates categories, nested amounts, dates and hash placement', () => {
  assert.throws(() => sanitizeDecision({ ...base, outcome: 'approved' }));
  assert.throws(() => sanitizeDecision({ ...base, action: 'send' }));
  assert.throws(() => sanitizeDecision({ ...base, date: 'tomorrow' }));
  assert.throws(() => sanitizeDecision({ ...base, date: '2026-02-31T12:01:00Z' }));
  assert.throws(() => sanitizeDecision({ ...base, size: { ...base.size, amount: Infinity } }));
  assert.throws(() => sanitizeDecision({ ...base, txs: [{ label: 'swap', hash: '0x123' }] }));
  assert.throws(() => sanitizeDecision({ ...base, title: base.txs[0].hash }));
  assert.equal(sanitizeDecision(base).txs[0].hash, base.txs[0].hash);
  assert.equal(sanitizeDecision({ ...base, reason: 'a'.repeat(400) }).reason.length, 280);
});

test('upsert replaces the same obligation, orders by date and caps 500', () => {
  const old = Array.from({ length: 510 }, (_, i) => ({ ...base, id: `decision-${i}`, date: new Date(Date.UTC(2026, 9, 17) + i * 1000).toISOString() }));
  const result = upsertDecision({ decisions: old }, { ...base, id: 'decision-509', title: 'Revised public reason', date: '2026-10-17T17:01:00Z' });
  assert.equal(result.decisions.length, 500);
  assert.equal(result.decisions[0].title, 'Revised public reason');
  assert.equal(result.decisions.filter((row) => row.id === 'decision-509').length, 1);
  assert.equal(result.updatedAt, result.decisions[0].date);
});

test('valuation and audit modes apply their own recursive allowlists', () => {
  const v = { updatedAt: base.date, intent: {}, rows: [{ token: 'AVAX', priceUsd: 9.98, priceAt: base.date, modeledValue: 9.72, buyLevel: 0.32, marginOfSafety: -0.027, gatePass: false, note: 'Dated research.', signer: 'hidden' }] };
  assert.equal(Object.hasOwn(sanitizeValuation(v).rows[0], 'signer'), false);
  const a = { updatedAt: base.date, rows: [{ token: 'AVAX', isSafe: null, createdAt: null, assessment: 'No assessment supplied.', pubkey: 'hidden' }] };
  assert.deepEqual(Object.keys(sanitizeAudits(a).rows[0]), ['token', 'isSafe', 'createdAt', 'assessment']);
  assert.throws(() => sanitizeAudits({ ...a, rows: [{ ...a.rows[0], assessment: 'Ops approval received' }] }));
  assert.throws(() => sanitizeValuation({ ...v, rows: [v.rows[0], v.rows[0]] }));
});

test('stdin dry-run prints sanitized JSON without changing public decisions', async () => {
  const before = await readFile(new URL('../site/data/decisions.json', import.meta.url), 'utf8');
  const result = spawnSync(process.execPath, ['tools/publish-ops.mjs', '--dry-run', '-'], { input: JSON.stringify({ ...base, signer: 'hidden' }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), sanitizeDecision(base));
  assert.equal(await readFile(new URL('../site/data/decisions.json', import.meta.url), 'utf8'), before);
});

test('CLI rejection does not echo unsafe input', () => {
  const result = spawnSync(process.execPath, ['tools/publish-ops.mjs', '--dry-run', '-'], { input: JSON.stringify({ ...base, reason: 'secret material' }), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /secret material/);
});

test('CLI file input and real upsert operate only on an isolated copy', async () => {
  const { writeFile, copyFile } = await import('node:fs/promises');
  await mkdir('shots', { recursive: true });
  const directory = await mkdtemp('shots/publisher-test-');
  try {
    await mkdir(`${directory}/tools`);
    await mkdir(`${directory}/site/data`, { recursive: true });
    await copyFile('tools/publish-ops.mjs', `${directory}/tools/publish-ops.mjs`);
    await writeFile(`${directory}/input.json`, JSON.stringify(base));
    for (let i = 0; i < 2; i++) {
      const result = spawnSync(process.execPath, [`${directory}/tools/publish-ops.mjs`, `${directory}/input.json`], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const saved = JSON.parse(await readFile(`${directory}/site/data/decisions.json`, 'utf8'));
    assert.equal(saved.decisions.length, 1);
    assert.deepEqual(saved.decisions[0], sanitizeDecision(base));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
