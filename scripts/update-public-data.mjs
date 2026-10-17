import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WALLET = '0x0fe61780bd5508b3C99e420662050e5560608cA4';
const DAY = 86_400_000;
const CORE = new Set(['AVAX', 'WAVAX', 'sAVAX', 'USDC', 'USDt', 'BTC.b', 'WETH.e']);
const CONTRACTS = [
  ['sAVAX', '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE', 18],
  ['WAVAX', '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 18],
  ['USDC', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 6],
  ['USDt', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 6],
  ['BTC.b', '0x152b9d0FdC40C096757F570A51E494bd4b943E50', 8],
  ['WETH.e', '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', 18],
];
const IDS = {
  AVAX: 'avalanche-2', WAVAX: 'avalanche-2', sAVAX: 'benqi-liquid-staked-avax',
  USDC: 'usd-coin', USDt: 'tether', 'BTC.b': 'bitcoin', 'WETH.e': 'ethereum',
  NEAR: 'near', ZEC: 'zcash', VVV: 'venice-token', PHAR: 'pharaoh-2', AAVE: 'aave', HYPE: 'hyperliquid',
  BTC: 'bitcoin', ETH: 'ethereum',
};
const tidy = (value) => Math.round(value * 1e12) / 1e12;

function numeric(value, signed = false) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Missing numeric value');
  const result = Number(value);
  if (!Number.isFinite(result) || (!signed && result < 0)) throw new Error('Invalid numeric value');
  return result;
}

export function units(raw, decimals) {
  if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid chain amount');
  const amount = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const decimal = decimals ? `${amount / scale}.${(amount % scale).toString().padStart(decimals, '0')}` : amount.toString();
  return numeric(decimal);
}

export async function request(url, body, validate = (value) => value, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mony-Public-Dashboard/1.0' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Provider response failed');
      return validate(await response.json());
    } catch {
      if (attempt === 2) throw new Error('Provider unavailable');
    }
  }
}

export async function fetchAvalanche(fetcher = fetch) {
  const calls = [{ jsonrpc: '2.0', id: 'native', method: 'eth_getBalance', params: [WALLET, 'latest'] }];
  for (const [asset, address] of CONTRACTS) {
    calls.push({ jsonrpc: '2.0', id: `balance-${asset}`, method: 'eth_call', params: [{ to: address, data: `0x70a08231${WALLET.slice(2).padStart(64, '0')}` }, 'latest'] });
    calls.push({ jsonrpc: '2.0', id: `decimals-${asset}`, method: 'eth_call', params: [{ to: address, data: '0x313ce567' }, 'latest'] });
  }
  return request('https://api.avax.network/ext/bc/C/rpc', calls, (data) => {
    if (!Array.isArray(data)) throw new Error('Invalid chain response');
    const byId = new Map(data.map((row) => [row.id, row]));
    const balances = [{ asset: 'AVAX', balance: units(byId.get('native')?.result, 18), decimals: 18 }];
    let fallback = false;
    for (const [asset, , fallbackDecimals] of CONTRACTS) {
      let decimals = fallbackDecimals;
      try {
        const raw = byId.get(`decimals-${asset}`)?.result;
        if (!/^0x[0-9a-f]+$/i.test(raw ?? '')) throw new Error('Missing decimals');
        decimals = Number(BigInt(raw));
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid decimals');
      } catch { fallback = true; decimals = fallbackDecimals; }
      balances.push({ asset, balance: units(byId.get(`balance-${asset}`)?.result, decimals), decimals });
    }
    return { balances, fallback };
  }, fetcher);
}

export async function fetchHyperliquid(fetcher = fetch) {
  const endpoint = 'https://api.hyperliquid.xyz/info';
  const [margin, spot] = await Promise.all([
    request(endpoint, { type: 'clearinghouseState', user: WALLET }, (data) => {
      const accountValue = numeric(data.marginSummary?.accountValue, true);
      const withdrawable = numeric(data.withdrawable);
      if (!Array.isArray(data.assetPositions)) throw new Error('Missing positions');
      const assetPositions = data.assetPositions.map(({ position: row }) => {
        if (!row || typeof row.coin !== 'string' || !/^[A-Za-z0-9._-]{1,24}$/.test(row.coin)) throw new Error('Invalid position');
        return { asset: row.coin, balance: numeric(row.szi, true), entryPrice: row.entryPx === null ? null : numeric(row.entryPx), positionValue: numeric(row.positionValue), unrealizedPnl: numeric(row.unrealizedPnl, true), marginUsed: numeric(row.marginUsed) };
      });
      return { accountValue, withdrawable, assetPositions };
    }, fetcher),
    request(endpoint, { type: 'spotClearinghouseState', user: WALLET }, (data) => {
      if (!Array.isArray(data.balances)) throw new Error('Missing spot balances');
      return data.balances.map((row) => {
        if (typeof row.coin !== 'string' || !/^[A-Za-z0-9._-]{1,24}$/.test(row.coin)) throw new Error('Invalid spot asset');
        return { asset: row.coin, balance: numeric(row.total) };
      });
    }, fetcher),
  ]);
  return { ...margin, spotBalances: spot };
}

export async function fetchPrices(assets, fetcher = fetch) {
  const ids = [...new Set(assets.map((asset) => IDS[asset]).filter(Boolean))];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`;
  return request(url, null, (data) => {
    const result = {};
    for (const asset of assets) {
      const row = data[IDS[asset]];
      if (row?.usd !== undefined) result[asset] = { priceUsd: numeric(row.usd), change24h: row.usd_24h_change == null ? null : numeric(row.usd_24h_change, true) };
    }
    if (!Object.keys(result).length) throw new Error('No prices');
    return result;
  }, fetcher);
}

export function compactHistory(history, now = Date.now()) {
  const points = new Map();
  for (const point of history) {
    const t = Date.parse(point.t);
    if (Number.isFinite(t) && t <= now && Number.isFinite(point.nav) && point.nav >= 0) points.set(t, { t: new Date(t).toISOString(), nav: point.nav });
  }
  const bins = new Map();
  for (const [t, point] of [...points].sort((a, b) => a[0] - b[0])) {
    const bucket = t >= now - 30 * DAY ? `recent-${Math.floor(t / 900_000)}` : point.t.slice(0, 10);
    bins.set(bucket, point);
  }
  const rows = [...bins.values()];
  if (rows.length <= 2000) return rows;
  // Retain the highest sampled point; treasury also carries the all-time high.
  const peak = rows.reduce((best, row) => row.nav > best.nav ? row : best, rows[0]);
  const kept = rows.slice(-1999);
  if (!kept.some((row) => row.t === peak.t)) kept.unshift(peak);
  return kept;
}

export function drawdown(history, nav, now = Date.now(), peakNav = null) {
  const points = history.filter((point) => Number.isFinite(point.nav) && point.nav >= 0 && Number.isFinite(Date.parse(point.t)) && Date.parse(point.t) <= now).sort((a, b) => a.t.localeCompare(b.t));
  const recent = points.filter((point) => Date.parse(point.t) >= now - 7 * DAY);
  const enoughWeek = points.length >= 2 && Date.parse(points[0].t) <= now - 7 * DAY && recent.length >= 2;
  const peak = Math.max(peakNav ?? 0, nav ?? 0, ...points.map((point) => point.nav));
  const weekPeak = Math.max(nav ?? 0, ...recent.map((point) => point.nav));
  return {
    sevenDay: nav !== null && enoughWeek && weekPeak > 0 ? tidy(nav / weekPeak - 1) : null,
    fromPeak: nav !== null && points.length >= 2 && peak > 0 ? tidy(nav / peak - 1) : null,
    peakNav: peak || null,
    pauseThreshold: -0.1,
    escalateThreshold: -0.25,
  };
}

export function allocation(positions, nav, decisions = []) {
  const staked = positions.filter((row) => row.asset === 'sAVAX');
  const value = staked.reduce((sum, row) => sum + row.valueUsd, 0);
  const balance = staked.reduce((sum, row) => sum + row.balance, 0);
  const weight = nav > 0 ? value / nav : 0;
  const excessUsd = Math.max(0, value - nav * 0.15);
  const satelliteValues = new Map();
  for (const row of positions.filter((row) => !CORE.has(row.asset))) satelliteValues.set(row.asset, (satelliteValues.get(row.asset) ?? 0) + row.valueUsd);
  const assets = [...satelliteValues].map(([asset, valueUsd]) => ({ asset, valueUsd, weight: nav > 0 ? valueUsd / nav : 0, overCap: valueUsd > nav * 0.1 }));
  const satelliteValue = assets.reduce((sum, row) => sum + row.valueUsd, 0);
  return {
    sAVAX: { weight, cap: 0.15, overCap: weight > 0.15, excessUsd: tidy(excessUsd), trimAmount: value > 0 ? tidy(excessUsd * balance / value) : 0, trimmedAmount: tidy(decisions.filter((row) => row.asset === 'sAVAX' && row.outcome === 'execute' && ['trim', 'sell'].includes(row.action) && row.size?.asset === 'sAVAX').reduce((sum, row) => sum + row.size.amount, 0)) },
    satellites: { weight: nav > 0 ? satelliteValue / nav : 0, capEach: 0.1, capCombined: 0.4, overCap: satelliteValue > nav * 0.4, assets },
  };
}

export function gasSpent(decisions) {
  const seen = new Set();
  let total = 0;
  for (const row of decisions) for (const tx of row.txs ?? []) {
    if (!seen.has(tx.hash.toLowerCase()) && Number.isFinite(tx.gasAvax)) { total += tx.gasAvax; seen.add(tx.hash.toLowerCase()); }
  }
  return tidy(total);
}

function freshness(success, usable, prior, at, note) {
  if (success) return { status: 'ok', updatedAt: at, lastSuccessAt: at, note };
  const seeded = !prior?.lastSuccessAt;
  return {
    status: usable && !seeded ? 'stale' : 'error',
    updatedAt: prior?.updatedAt ?? null,
    lastSuccessAt: prior?.lastSuccessAt ?? null,
    note: usable ? (seeded ? 'Refresh failed; keeping seed estimates.' : 'Refresh failed; keeping last successful values.') : 'Unavailable; no previous usable values.',
  };
}

function valueBalances(balances, venue, prices) {
  return balances.filter((row) => row.balance > 0).map((row) => {
    const priceUsd = venue === 'Hyperliquid spot' && row.asset === 'USDC' ? 1 : prices[row.asset]?.priceUsd;
    if (!Number.isFinite(priceUsd)) throw new Error('Missing held price');
    return { asset: row.asset, venue, balance: row.balance, priceUsd, valueUsd: tidy(row.balance * priceUsd), weight: 0 };
  });
}

async function readJson(directory, name, fallback) {
  try { return JSON.parse(await readFile(resolve(directory, `${name}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function updatePublicData({ dataDir = resolve(ROOT, 'site/data'), fetcher = fetch, now = new Date() } = {}) {
  const at = now.toISOString();
  const [previous, priceFile, oldHistory, oldSources, decisionFile, valuation, audits] = await Promise.all([
    readJson(dataDir, 'treasury', null), readJson(dataDir, 'prices', { prices: {} }), readJson(dataDir, 'nav-history', []),
    readJson(dataDir, 'sources', { sources: {} }), readJson(dataDir, 'decisions', { decisions: [] }),
    readJson(dataDir, 'valuation', { rows: [] }), readJson(dataDir, 'audits', { rows: [] }),
  ]);
  const assets = [...new Set([...Object.keys(IDS), ...valuation.rows.map((row) => row.token), ...Object.keys(priceFile.prices)])];
  const [avalanche, hyperliquid, quotes] = await Promise.allSettled([fetchAvalanche(fetcher), fetchHyperliquid(fetcher), fetchPrices(assets, fetcher)]);
  const prices = { ...priceFile.prices };
  if (quotes.status === 'fulfilled') for (const [asset, row] of Object.entries(quotes.value)) prices[asset] = { ...row, updatedAt: at, source: 'CoinGecko' };
  let hl = hyperliquid.status === 'fulfilled' ? hyperliquid.value : previous?.venues?.hyperliquid;
  let hlOk = hyperliquid.status === 'fulfilled';
  if (hlOk) {
    const missing = hl.spotBalances.filter((row) => row.balance > 0 && row.asset !== 'USDC' && !quotes.value?.[row.asset]);
    if (missing.length) {
      try {
        const mids = await request('https://api.hyperliquid.xyz/info', { type: 'allMids' }, (value) => value, fetcher);
        for (const row of missing) {
          const priceUsd = numeric(mids[row.asset]);
          prices[row.asset] = { priceUsd, change24h: null, updatedAt: at, source: 'Hyperliquid' };
        }
      } catch {
        if (missing.some((row) => !Number.isFinite(prices[row.asset]?.priceUsd))) { hlOk = false; hl = previous?.venues?.hyperliquid; }
      }
    }
  }
  const avalancheBalances = avalanche.status === 'fulfilled' ? avalanche.value.balances : previous?.avalancheBalances;
  const completeQuotes = quotes.status === 'fulfilled' && assets.filter((asset) => IDS[asset]).every((asset) => quotes.value[asset]);
  const sources = {
    avalanche_rpc: freshness(avalanche.status === 'fulfilled', Boolean(avalancheBalances), oldSources.sources.avalanche_rpc, at, avalanche.value?.fallback ? 'Balances refreshed; documented decimal defaults used for unavailable metadata.' : 'Balances refreshed from Avalanche C-Chain.'),
    hyperliquid: freshness(hlOk, Boolean(hl), oldSources.sources.hyperliquid, at, 'Margin equity, positions and spot balances refreshed.'),
    coingecko: freshness(completeQuotes, Object.keys(prices).length > 0, oldSources.sources.coingecko, at, 'Available USD prices refreshed; each quote retains its own date.'),
  };
  if (quotes.status === 'fulfilled' && !completeQuotes) sources.coingecko.note = 'Partial price response; previous quotes retained for missing assets. Each quote shows its own date.';
  const auditDate = audits.updatedAt ?? null;
  sources.serialized_audit = { status: !auditDate ? 'error' : now - new Date(auditDate) > 30 * DAY ? 'stale' : 'ok', updatedAt: auditDate, lastSuccessAt: auditDate, note: 'Dated public assessments; unavailable verdicts are not a safety pass.' };
  const latestDecision = decisionFile.decisions.map((row) => row.date).sort().at(-1) ?? null;
  sources.decisions = { status: !latestDecision ? 'error' : now - new Date(latestDecision) > DAY ? 'stale' : 'ok', updatedAt: latestDecision, lastSuccessAt: latestDecision, note: 'Decisions are published after each run, twice daily.' };

  let treasury = previous;
  let history = [...oldHistory];
  const anyFresh = avalanche.status === 'fulfilled' || hlOk || quotes.status === 'fulfilled';
  if (anyFresh) {
    try {
      if (!avalancheBalances || !hl || !Array.isArray(hl.spotBalances)) throw new Error('Missing venue');
      const avalanchePositions = valueBalances(avalancheBalances, 'Avalanche', prices);
      const hlPositions = valueBalances(hl.spotBalances, 'Hyperliquid spot', prices);
      const marginPosition = { asset: 'USDC', venue: 'Hyperliquid margin', balance: hl.accountValue, priceUsd: 1, valueUsd: hl.accountValue, weight: 0 };
      const avalancheValue = tidy(avalanchePositions.reduce((sum, row) => sum + row.valueUsd, 0));
      const hlValue = tidy(hl.accountValue + hlPositions.reduce((sum, row) => sum + row.valueUsd, 0));
      const nav = tidy(avalancheValue + hlValue);
      if (!Number.isFinite(nav) || nav < 0) throw new Error('Invalid treasury value');
      const positions = [...avalanchePositions, marginPosition, ...hlPositions].filter((row) => Math.abs(row.valueUsd) >= 0.01).map((row) => ({ ...row, weight: nav > 0 ? row.valueUsd / nav : 0 }));
      history.push({ t: at, nav });
      const risk = drawdown(history, nav, now.valueOf(), previous?.drawdown?.peakNav);
      const currentPrices = [...avalancheBalances, ...hl.spotBalances].filter((row) => row.balance > 0 && row.asset !== 'USDC').every((row) => prices[row.asset]?.updatedAt === at);
      treasury = {
        generatedAt: at, updatedAt: at, wallet: WALLET, currency: 'USD',
        estimated: !(avalanche.status === 'fulfilled' && hlOk && currentPrices),
        note: 'Margin account equity includes open-position profit and loss. Positions below $0.01 are omitted from holdings, but remain in NAV.',
        nav, venues: {
          avalanche: { valueUsd: avalancheValue, updatedAt: sources.avalanche_rpc.updatedAt },
          hyperliquid: { valueUsd: hlValue, updatedAt: sources.hyperliquid.updatedAt, accountValue: hl.accountValue, withdrawable: hl.withdrawable, spotBalances: hl.spotBalances, assetPositions: hl.assetPositions },
        },
        avalancheBalances, positions, allocation: allocation(positions, nav, decisionFile.decisions), drawdown: risk,
        execution: { status: risk.sevenDay !== null && risk.sevenDay <= -0.1 ? 'paused' : 'active', escalated: risk.fromPeak !== null && risk.fromPeak <= -0.25 },
        gasAvax: gasSpent(decisionFile.decisions),
      };
    } catch {
      sources.coingecko.note += ' NAV not refreshed: complete venue balances and held prices are required.';
    }
  }
  if (treasury) {
    treasury = { ...treasury, generatedAt: at, allocation: allocation(treasury.positions, treasury.nav, decisionFile.decisions), gasAvax: gasSpent(decisionFile.decisions) };
  }
  const output = {
    treasury,
    prices: { generatedAt: at, updatedAt: quotes.status === 'fulfilled' ? at : priceFile.updatedAt ?? null, prices },
    'nav-history': compactHistory(history, now.valueOf()),
    sources: { generatedAt: at, sources },
  };
  for (const [name, data] of Object.entries(output)) {
    if (data === null) continue;
    const destination = resolve(dataDir, `${name}.json`);
    const content = `${JSON.stringify(data, null, 2)}\n`;
    let old;
    try { old = await readFile(destination, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (old !== content) { await writeFile(`${destination}.tmp`, content); await rename(`${destination}.tmp`, destination); }
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updatePublicData().then(({ sources }) => {
    process.stdout.write(`Public data refreshed: ${Object.entries(sources.sources).map(([name, row]) => `${name}=${row.status}`).join(', ')}\n`);
  }).catch(() => { process.stderr.write('Public data update failed: invalid local data or unavailable output directory.\n'); process.exitCode = 1; });
}
