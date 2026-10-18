import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { units, request, fetchAvalanche, updatePublicData, drawdown, compactHistory, allocation, gasSpent } from './update-public-data.mjs';

const NOW = new Date('2026-10-17T20:41:00Z');
const DAY = 86_400_000;
const json = (value) => ({ ok: true, json: async () => value });
const failing = async () => { throw new Error('Network unavailable'); };

async function temporaryData(fn) {
  await mkdir('shots', { recursive: true });
  const directory = await mkdtemp('shots/data-test-');
  await cp('site/data', directory, { recursive: true });
  const current = JSON.parse(await readFile(`${directory}/treasury.json`, 'utf8'));
  await writeFile(`${directory}/nav-history.json`, JSON.stringify([{ t: new Date(NOW - 2 * 3600000).toISOString(), nav: current.nav }]));
  try { return await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function provider({ spot = [], open = [], margin = '32.38', decimals = 18, omitPrice = false } = {}) {
  return async (url, options) => {
    if (url.includes('coingecko')) {
      const prices = Object.fromEntries(['avalanche-2', 'benqi-liquid-staked-avax', 'usd-coin', 'tether', 'bitcoin', 'ethereum', 'near', 'zcash', 'venice-token', 'pharaoh-2', 'aave', 'hyperliquid', 'polygon-ecosystem-token', 'binancecoin'].map((id) => [id, { usd: id.includes('usd-coin') || id === 'tether' ? 1 : 10, usd_24h_change: 2 }]));
      if (omitPrice) delete prices['benqi-liquid-staked-avax'];
      return json(prices);
    }
    if (url.includes('polymarket.com')) return json([]);
    if (url.includes('avantisfi.com')) return json({ positions: [], limitOrders: [] });
    const body = JSON.parse(options.body);
    if (/publicnode|base\.org|drpc|arbitrum\.io|optimism\.io|binance\.org/.test(url)) return json(body.map((row) => ({ id: row.id, jsonrpc: '2.0', result: '0x0' })));
    if (url.includes('avax.network')) return json(body.map((row) => ({ id: row.id, jsonrpc: '2.0', result: row.id === 'native' ? '0xde0b6b3a7640000' : row.id.startsWith('decimals-') ? `0x${decimals.toString(16)}` : row.id === 'balance-sAVAX' ? `0x${(2n * 10n ** BigInt(decimals)).toString(16)}` : '0x0' })));
    if (body.type === 'clearinghouseState') return json({ marginSummary: { accountValue: margin }, withdrawable: '20', assetPositions: open });
    if (body.type === 'spotClearinghouseState') return json({ balances: spot });
    if (body.type === 'allMids') return json({ PURR: '2.5' });
    throw new Error('Unexpected request');
  };
}

test('raw amounts retain BigInt precision until decimal conversion', () => {
  assert.equal(units('0xde0b6b3a7640000', 18), 1);
  assert.equal(units('0xf4241', 6), 1.000001);
  assert.equal(units('0x1', 0), 1);
  assert.throws(() => units('0x', 18));
});

test('RPC uses on-chain decimals, with bounded metadata fallback', async () => {
  const result = await fetchAvalanche(provider({ decimals: 6 }));
  assert.equal(result.balances.find((row) => row.asset === 'sAVAX').balance, 2);
  assert.equal(result.balances.find((row) => row.asset === 'sAVAX').decimals, 6);
  const fallback = await fetchAvalanche(async (url, options) => {
    const response = await provider()(url, options);
    const data = await response.json();
    return json(data.map((row) => row.id.startsWith('decimals-') ? { id: row.id, error: { code: -1 } } : row));
  });
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.balances.find((row) => row.asset === 'sAVAX').balance, 2);
});

test('requests retry twice and use a timeout and public request header', async () => {
  let attempts = 0;
  const result = await request('https://public.invalid', null, (value) => value, async (_, options) => {
    attempts++;
    assert.ok(options.signal instanceof AbortSignal);
    assert.match(options.headers['User-Agent'], /Mony/);
    if (attempts < 3) throw new Error('Unavailable');
    return json({ value: 42 });
  });
  assert.equal(attempts, 3);
  assert.equal(result.value, 42);
  attempts = 0;
  await assert.rejects(request('https://public.invalid', null, (value) => value, async () => { attempts++; return { ok: false }; }));
  assert.equal(attempts, 3);
});

test('complete source failure preserves NAV, positions and history without throwing', async () => temporaryData(async (dataDir) => {
  const before = JSON.parse(await readFile(`${dataDir}/treasury.json`, 'utf8'));
  const history = JSON.parse(await readFile(`${dataDir}/nav-history.json`, 'utf8'));
  const result = await updatePublicData({ dataDir, fetcher: failing, now: NOW });
  assert.equal(result.treasury.nav, before.nav);
  assert.deepEqual(result.treasury.positions, before.positions);
  assert.deepEqual(result['nav-history'], history.map((row) => ({ ...row, t: new Date(row.t).toISOString() })));
  assert.ok(['error', 'stale'].includes(result.sources.sources.avalanche_rpc.status));
  assert.ok(['error', 'stale'].includes(result.sources.sources.hyperliquid.status));
}));

test('refresh counts equity once, values spot, drops display dust and updates caps', async () => temporaryData(async (dataDir) => {
  const open = [{ position: { coin: 'BTC', szi: '-0.01', entryPx: '60000', positionValue: '610', unrealizedPnl: '-10', marginUsed: '61' } }];
  const result = await updatePublicData({ dataDir, fetcher: provider({ spot: [{ coin: 'USDC', total: '5' }, { coin: 'PURR', total: '4' }, { coin: 'HYPE', total: '0.0001' }], open }), now: NOW });
  assert.equal(result.treasury.venues.avalanche.valueUsd, 30);
  assert.equal(result.treasury.venues.hyperliquid.valueUsd, 47.381);
  assert.equal(result.treasury.nav, 77.381);
  assert.equal(result.treasury.venues.hyperliquid.assetPositions[0].balance, -0.01);
  assert.equal(result.treasury.positions.some((row) => row.asset === 'HYPE'), false);
  assert.equal(result.prices.prices.PURR.priceUsd, 2.5);
  assert.equal(result.treasury.allocation.satellites.assets[0].overCap, true);
  assert.equal(result.treasury.allocation.sAVAX.overCap, true);
  assert.equal(result.treasury.estimated, false);
  assert.equal(result.sources.sources.avalanche_rpc.status, 'ok');
  assert.equal(result['nav-history'].at(-1).nav, result.treasury.nav);
}));

test('a held asset without a current or previous price prevents a false NAV', async () => temporaryData(async (dataDir) => {
  const before = JSON.parse(await readFile(`${dataDir}/treasury.json`, 'utf8'));
  const prices = JSON.parse(await readFile(`${dataDir}/prices.json`, 'utf8'));
  delete prices.prices.sAVAX;
  await writeFile(`${dataDir}/prices.json`, JSON.stringify(prices));
  const result = await updatePublicData({ dataDir, fetcher: provider({ omitPrice: true }), now: NOW });
  assert.equal(result.treasury.nav, before.nav);
  assert.equal(result.treasury.updatedAt, before.updatedAt);
  assert.match(result.sources.sources.coingecko.note, /NAV not refreshed/);
}));

test('a failed venue keeps its last good equity while other sources refresh', async () => temporaryData(async (dataDir) => {
  const before = JSON.parse(await readFile(`${dataDir}/treasury.json`, 'utf8'));
  const result = await updatePublicData({ dataDir, fetcher: async (url, options) => url.includes('hyperliquid.xyz') ? failing() : provider()(url, options), now: NOW });
  assert.equal(result.treasury.venues.hyperliquid.accountValue, before.venues.hyperliquid.accountValue);
  assert.equal(result.treasury.venues.avalanche.valueUsd, 30);
  assert.equal(result.treasury.estimated, true);
  assert.ok(['stale', 'error'].includes(result.sources.sources.hyperliquid.status));
  assert.equal(result.sources.sources.avalanche_rpc.status, 'ok');
}));

test('published execution state changes at exact pause and escalation thresholds', async () => temporaryData(async (dataDir) => {
  const history = [8, 6].map((days) => ({ t: new Date(NOW - days * DAY).toISOString(), nav: 100 }));
  await writeFile(`${dataDir}/nav-history.json`, JSON.stringify(history));
  const previous = JSON.parse(await readFile(`${dataDir}/treasury.json`, 'utf8'));
  previous.drawdown.peakNav = 100;
  await writeFile(`${dataDir}/treasury.json`, JSON.stringify(previous));
  const paused = await updatePublicData({ dataDir, fetcher: provider({ margin: '60' }), now: NOW });
  assert.equal(paused.treasury.nav, 90);
  assert.equal(paused.treasury.execution.status, 'paused');
  assert.equal(paused.treasury.execution.escalated, false);
  const escalated = await updatePublicData({ dataDir, fetcher: provider({ margin: '45' }), now: new Date(NOW.valueOf() + 900_000) });
  assert.equal(escalated.treasury.nav, 75);
  assert.equal(escalated.treasury.execution.status, 'paused');
  assert.equal(escalated.treasury.execution.escalated, true);
}));

test('failure without previous data records errors without creating a zero NAV', async () => {
  await mkdir('shots', { recursive: true });
  const dataDir = await mkdtemp('shots/no-data-test-');
  try {
    const result = await updatePublicData({ dataDir, fetcher: failing, now: NOW });
    assert.equal(result.treasury, null);
    assert.equal(result['nav-history'].length, 0);
    assert.equal(result.sources.sources.avalanche_rpc.status, 'error');
    await assert.rejects(readFile(`${dataDir}/treasury.json`), { code: 'ENOENT' });
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('drawdown requires seven days and handles both threshold boundaries', () => {
  const point = (days, nav) => ({ t: new Date(NOW - days * DAY).toISOString(), nav });
  assert.equal(drawdown([point(0, 100)], 100, NOW.valueOf()).fromPeak, null);
  assert.equal(drawdown([point(1, 100), point(0, 90)], 90, NOW.valueOf()).sevenDay, null);
  const result = drawdown([point(8, 120), point(6, 100), point(0, 75)], 75, NOW.valueOf());
  assert.equal(result.sevenDay, -0.25);
  assert.equal(result.fromPeak, -0.375);
  assert.equal(drawdown([point(8, 100), point(1, 100), point(0, 100)], 100, NOW.valueOf(), 200).fromPeak, -0.5);
  assert.equal(drawdown([point(8, 100), point(1, 100), point(0, 90)], 90, NOW.valueOf()).sevenDay, -0.1);
});

test('retention buckets quarter hours, keeps the last older point per day and caps length', () => {
  const history = [
    { t: new Date(NOW - 40 * DAY).toISOString(), nav: 90 },
    { t: new Date(NOW - 40 * DAY + 60000).toISOString(), nav: 95 },
    { t: '2026-10-17T20:31:00Z', nav: 101 }, { t: '2026-10-17T20:40:00Z', nav: 102 },
  ];
  const result = compactHistory(history, NOW.valueOf());
  assert.equal(result.length, 2);
  assert.equal(result[0].nav, 95);
  assert.equal(result[1].nav, 102);
  const many = Array.from({ length: 3000 }, (_, i) => ({ t: new Date(NOW - (3000 - i) * 900_000).toISOString(), nav: i === 200 ? 99999 : 100 }));
  const capped = compactHistory(many, NOW.valueOf());
  assert.ok(capped.length <= 2000);
  assert.ok(capped.some((row) => row.nav === 99999));
});

test('allocations aggregate both venues and receipt gas is deduplicated', async () => {
  const { decisions } = JSON.parse(await readFile('site/data/decisions.json', 'utf8'));
  const result = allocation([{ asset: 'sAVAX', balance: 4, valueUsd: 40 }, { asset: 'HYPE', balance: 2, valueUsd: 20 }, { asset: 'HYPE', balance: 3, valueUsd: 30 }], 100, decisions);
  assert.equal(result.sAVAX.excessUsd, 25);
  assert.equal(result.sAVAX.trimAmount, 2.5);
  assert.equal(result.satellites.weight, 0.5);
  assert.equal(result.satellites.overCap, true);
  assert.equal(gasSpent([...decisions, ...decisions]), gasSpent(decisions));
  assert.equal(gasSpent(decisions.map((row) => ({ ...row, outcome: 'blocked' }))), gasSpent(decisions));
});

test('multichain venues add Polymarket, Avantis and wallet balances to NAV and cap math', async () => temporaryData(async (dataDir) => {
  const base = provider();
  const fetcher = async (url, options) => {
    if (url.includes('polymarket.com')) return json([{ size: 10, curPrice: 0.5, currentValue: 5, redeemable: false, endDate: '2027-01-01' }, { size: 100, curPrice: 0, currentValue: 0, redeemable: true, endDate: '2026-06-07' }]);
    if (/publicnode|base\.org|drpc|arbitrum\.io|optimism\.io|binance\.org/.test(url)) {
      const body = JSON.parse(options.body);
      return json(body.map((row) => {
        const to = row.params?.[0]?.to?.toLowerCase();
        let result = '0x0';
        if (row.id === 'pusd') result = '0xf4240'; // 1 pUSD
        else if (row.id === 'shares-avUSDC') result = '0x989680'; // 10 shares
        else if (row.id === 'redeem-avUSDC') result = '0xe4e1c0'; // 15 USDC
        else if (row.id === 'balance-USDC' && to === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') result = '0x1e8480'; // 2 USDC on Base
        return { id: row.id, jsonrpc: '2.0', result };
      }));
    }
    return base(url, options);
  };
  const result = await updatePublicData({ dataDir, fetcher, now: NOW });
  const t = result.treasury;
  assert.equal(t.venues.polymarket.valueUsd, 6);
  assert.equal(t.venues.polymarket.openPositions, 1);
  assert.equal(t.venues.avantis.valueUsd, 15);
  assert.equal(t.venues.base.valueUsd, 2);
  assert.equal(t.nav, 85.38);
  assert.equal(t.allocation.satellites.assets.length, 0);
  assert.ok(Math.abs(t.allocation.external.weight - 21 / t.nav) < 1e-9);
  assert.ok(Math.abs(t.allocation.sAVAX.weight - 20 / t.nav) < 1e-9);
  for (const key of ['polymarket', 'avantis', 'yo', 'evm_wallets']) assert.equal(result.sources.sources[key].status, 'ok');
}));
