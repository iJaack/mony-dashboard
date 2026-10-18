import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = /signer|verifier|nonce|signature|socket|token|secret|\/(?:var|etc|home|Users|private|tmp)\/|notion\.(?:so|site|com)|\bops\b|ed25519|pubkey|slippage|0x[0-9a-fA-F]{64}|[A-Z]:\\|\b(?:localhost|[\w-]+\.local)\b|https?:\/\/|[<>]/i;
// Internal names are matched by SHA-256 of each lowercased word so the public source does not spell them out.
const PRIVATE_WORDS = new Set(['c29d95402fd9be7a029be3466b33c4c458cdbec279691a0d542791ae7f61dcb9']);
const privateWord = (text) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).some((word) => PRIVATE_WORDS.has(createHash('sha256').update(word).digest('hex')));
const HASH = /^0x[0-9a-fA-F]{64}$/;
const OUTCOMES = ['execute', 'no_op', 'blocked', 'escalated'];
const ACTIONS = ['trim', 'buy', 'sell', 'rebalance', 'none'];

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a record');
  return value;
}

function string(value, max, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${name}`);
  const normalized = value.normalize('NFKC');
  if (FORBIDDEN.test(normalized) || privateWord(normalized) || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(normalized)) {
    throw new Error(`Unsafe public text in ${name}`);
  }
  return normalized.trim().slice(0, max);
}

function asset(value) {
  const result = string(value, 24, 'asset');
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,23}$/.test(result)) throw new Error('Invalid asset');
  return result;
}

function number(value, name, { signed = false, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!signed && value < 0) || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Expected an ISO UTC date');
  }
  const result = new Date(value).toISOString();
  if (result.slice(0, 19) !== value.slice(0, 19)) throw new Error('Invalid calendar date');
  return result;
}

function enumeration(value, values) {
  if (!values.includes(value)) throw new Error('Invalid category');
  return value;
}

function size(value, includeUsd = false) {
  object(value);
  const result = { amount: number(value.amount, 'amount'), asset: asset(value.asset) };
  if (includeUsd && value.usd !== undefined) result.usd = number(value.usd, 'usd');
  return result;
}

export function sanitizeDecision(value) {
  object(value);
  const id = string(value.id, 100, 'id');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error('Invalid id');
  const result = {
    id,
    date: date(value.date),
    outcome: enumeration(value.outcome, OUTCOMES),
    title: string(value.title, 100, 'title'),
    reason: string(value.reason, 280, 'reason'),
    asset: asset(value.asset),
    action: enumeration(value.action, ACTIONS),
    size: size(value.size, true),
  };
  if (value.received !== undefined) result.received = size(value.received);
  if (value.txs !== undefined) {
    if (!Array.isArray(value.txs) || value.txs.length > 20) throw new Error('Invalid transactions');
    result.txs = value.txs.map((tx) => {
      object(tx);
      if (typeof tx.hash !== 'string' || !HASH.test(tx.hash)) throw new Error('Invalid transaction hash');
      const clean = { label: enumeration(tx.label, ['approve', 'swap', 'transfer']), hash: tx.hash.toLowerCase() };
      for (const field of ['block', 'gasUsed', 'gasAvax']) {
        if (tx[field] !== undefined) clean[field] = number(tx[field], field, { integer: field !== 'gasAvax' });
      }
      return clean;
    });
  }
  if (value.trim !== undefined) {
    object(value.trim);
    if (value.trim.targetWeight !== 0.15) throw new Error('Invalid trim target');
    result.trim = { completedAmount: number(value.trim.completedAmount, 'completed amount'), asset: asset(value.trim.asset), targetWeight: 0.15 };
  }
  return result;
}

export function sanitizeValuation(value) {
  object(value);
  if (!Array.isArray(value.rows) || value.rows.length > 100) throw new Error('Invalid rows');
  const rows = value.rows.map((row) => {
    object(row);
    const clean = { token: asset(row.token), priceUsd: row.priceUsd === null ? null : number(row.priceUsd, 'price'), priceAt: row.priceAt === null ? null : date(row.priceAt) };
    for (const field of ['modeledValue', 'buyLevel', 'marginOfSafety']) clean[field] = row[field] === null ? null : number(row[field], field, { signed: field === 'marginOfSafety' });
    if (![true, false, null].includes(row.gatePass)) throw new Error('Invalid gate');
    clean.gatePass = row.gatePass;
    clean.note = string(row.note, 280, 'note');
    return clean;
  });
  if (new Set(rows.map((row) => row.token)).size !== rows.length) throw new Error('Duplicate asset');
  return { updatedAt: date(value.updatedAt), rows };
}

export function sanitizeAudits(value) {
  object(value);
  if (!Array.isArray(value.rows) || value.rows.length > 100) throw new Error('Invalid rows');
  const rows = value.rows.map((row) => {
    object(row);
    if (![true, false, null].includes(row.isSafe)) throw new Error('Invalid verdict');
    return { token: asset(row.token), isSafe: row.isSafe, createdAt: row.createdAt === null ? null : date(row.createdAt), assessment: string(row.assessment, 200, 'assessment') };
  });
  if (new Set(rows.map((row) => row.token)).size !== rows.length) throw new Error('Duplicate asset');
  return { updatedAt: date(value.updatedAt), rows };
}

const CONFIDENCE = ['Low', 'Medium', 'High'];

function day(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function sanitizeForecasts(value) {
  object(value);
  if (!Array.isArray(value.rows) || value.rows.length > 50) throw new Error('Invalid rows');
  const rows = value.rows.map((row) => {
    object(row);
    if (!Array.isArray(row.band) || row.band.length !== 2) throw new Error('Invalid band');
    const band = row.band.map((item) => number(item, 'band'));
    if (band[0] > band[1] || band[1] > 1) throw new Error('Invalid band');
    const clean = { title: string(row.title, 120, 'title'), band, confidence: enumeration(row.confidence, CONFIDENCE), horizon: day(row.horizon, 'horizon') };
    if (row.staleAfter !== undefined && row.staleAfter !== null) clean.staleAfter = day(row.staleAfter, 'staleAfter');
    if (row.lastReviewed !== undefined && row.lastReviewed !== null) clean.lastReviewed = day(row.lastReviewed, 'lastReviewed');
    clean.market = string(row.market, 60, 'market');
    if (row.treasuryLink !== undefined && row.treasuryLink !== null) clean.treasuryLink = string(row.treasuryLink, 80, 'treasuryLink');
    return clean;
  });
  if (new Set(rows.map((row) => row.title)).size !== rows.length) throw new Error('Duplicate forecast');
  return { asOf: day(value.asOf, 'asOf'), source: string(value.source, 40, 'source'), rows };
}

export function upsertDecision(existing, decision) {
  const rows = (existing?.decisions ?? []).map(sanitizeDecision).filter((item) => item.id !== decision.id);
  rows.push(sanitizeDecision(decision));
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const decisions = rows.slice(0, 500);
  return { updatedAt: decisions[0].date, decisions };
}

async function main(args) {
  const dryRun = args.includes('--dry-run');
  const inputs = args.filter((arg) => arg !== '--dry-run');
  let kind = 'decisions';
  if (['--valuation', '--audits', '--forecasts'].includes(inputs[0])) kind = inputs.shift().slice(2);
  if (inputs.length !== 1) throw new Error('Provide one JSON file or - for stdin');
  let raw;
  if (inputs[0] === '-') {
    raw = '';
    for await (const chunk of process.stdin) raw += chunk;
  } else raw = await readFile(resolve(inputs[0]), 'utf8');
  const sanitize = { decisions: sanitizeDecision, valuation: sanitizeValuation, audits: sanitizeAudits, forecasts: sanitizeForecasts }[kind];
  const clean = sanitize(JSON.parse(raw));
  if (dryRun) {
    process.stdout.write(`${JSON.stringify(clean, null, 2)}\n`);
    return;
  }
  const destination = resolve(ROOT, 'site/data', `${kind}.json`);
  let result = clean;
  if (kind === 'decisions') {
    let previous;
    try { previous = JSON.parse(await readFile(destination, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    result = upsertDecision(previous, clean);
  }
  await writeFile(`${destination}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  await rename(`${destination}.tmp`, destination);
  process.stdout.write(`Published ${kind === 'decisions' ? clean.id : `${clean.rows.length} ${kind} rows`}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write('Publication rejected: invalid input or unsafe public content.\n');
    process.exitCode = 1;
  });
}
