import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WALLET = '0x0fe61780bd5508b3C99e420662050e5560608cA4';
const DAY = 86_400_000;
const CORE = new Set(['AVAX', 'WAVAX', 'sAVAX', 'USDC', 'USDt', 'BTC.b', 'WETH.e', 'USDC.e', 'USDbC', 'USDT', 'pUSD', 'ETH', 'WETH', 'POL', 'BNB']);
// Positions held outside the trading mandate: valued in NAV, excluded from satellite caps.
const EXTERNAL_VENUES = new Set(['Polymarket', 'Avantis', 'YO']);
const POLYMARKET_DATA = 'https://data-api.polymarket.com';
const AVANTIS_CORE = 'https://core.avantisfi.com';
const PUSD = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const AVANTIS_VAULT = '0x944766f715b51967E56aFdE5f0Aa76cEaCc9E7f9';
const YO_VAULTS = [['yoUSD', '0x0000000f2eB9f69274678c76222B35eEc7588a65'], ['yoETH', '0x3A43AEC53490CB9Fa922847385D82fe25d0E9De7']];
export const CHAINS = {
  base: { label: 'Base', native: 'ETH', rpcs: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'], erc20: [['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6], ['USDbC', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', 6], ['USDT', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 6], ['WETH', '0x4200000000000000000000000000000000000006', 18]] },
  polygon: { label: 'Polygon', native: 'POL', rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'], erc20: [['USDC.e', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 6], ['USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6], ['USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6], ['WETH', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 18]] },
  ethereum: { label: 'Ethereum', native: 'ETH', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'], erc20: [['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6], ['USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6], ['WETH', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18]] },
  arbitrum: { label: 'Arbitrum', native: 'ETH', rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'], erc20: [['USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6], ['USDC.e', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', 6], ['USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6], ['WETH', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 18]] },
  optimism: { label: 'Optimism', native: 'ETH', rpcs: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'], erc20: [['USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6], ['USDC.e', '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', 6], ['USDT', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 6], ['WETH', '0x4200000000000000000000000000000000000006', 18]] },
  bnb: { label: 'BNB Chain', native: 'BNB', rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'], erc20: [['USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18], ['USDT', '0x55d398326f99059fF775485246999027B3197955', 18], ['WETH', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 18]] },
};
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
  WETH: 'ethereum', 'USDC.e': 'usd-coin', USDbC: 'usd-coin', USDT: 'tether', pUSD: 'usd-coin', POL: 'polygon-ecosystem-token', BNB: 'binancecoin',
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

const word = (address) => address.slice(2).toLowerCase().padStart(64, '0');
const rawOk = (raw) => typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw);

export async function evmBatch(rpcs, calls, fetcher = fetch) {
  let lastError;
  for (const url of rpcs) {
    try {
      return await request(url, calls, (data) => {
        if (!Array.isArray(data)) throw new Error('Invalid chain response');
        const byId = new Map(data.map((row) => [row.id, row.result]));
        if (calls.some((call) => !rawOk(byId.get(call.id)))) throw new Error('Incomplete chain response');
        return byId;
      }, fetcher);
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error('Provider unavailable');
}

const balanceCall = (id, to, holder = WALLET) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data: `0x70a08231${word(holder)}` }, 'latest'] });

export async function fetchChain(key, fetcher = fetch) {
  const chain = CHAINS[key];
  const calls = [{ jsonrpc: '2.0', id: 'native', method: 'eth_getBalance', params: [WALLET, 'latest'] }, ...chain.erc20.map(([asset, address]) => balanceCall(`balance-${asset}`, address))];
  const byId = await evmBatch(chain.rpcs, calls, fetcher);
  return [{ asset: chain.native, balance: units(byId.get('native'), 18), decimals: 18 }, ...chain.erc20.map(([asset, , decimals]) => ({ asset, balance: units(byId.get(`balance-${asset}`), decimals), decimals }))];
}

export async function fetchPolymarket(fetcher = fetch) {
  const [rows, cash] = await Promise.all([
    request(`${POLYMARKET_DATA}/positions?user=${WALLET}&sizeThreshold=0&limit=500`, null, (data) => {
      if (!Array.isArray(data)) throw new Error('Invalid positions');
      return data.map((row) => ({ size: numeric(row.size), price: numeric(row.curPrice), valueUsd: numeric(row.currentValue), redeemable: row.redeemable === true, endDate: typeof row.endDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.endDate) ? row.endDate.slice(0, 10) : null }));
    }, fetcher),
    evmBatch(CHAINS.polygon.rpcs, [balanceCall('pusd', PUSD)], fetcher).then((byId) => units(byId.get('pusd'), 6)),
  ]);
  const open = rows.filter((row) => row.valueUsd > 0);
  return {
    positionsValue: tidy(rows.reduce((sum, row) => sum + row.valueUsd, 0)),
    cash,
    openPositions: open.length,
    redeemablePositions: open.filter((row) => row.redeemable).length,
    redeemableValue: tidy(open.filter((row) => row.redeemable).reduce((sum, row) => sum + row.valueUsd, 0)),
    positions: open.map(({ size, price, valueUsd, redeemable, endDate }) => ({ size, price, valueUsd, redeemable, endDate })),
  };
}

async function vaultShares(vaults, fetcher) {
  const byId = await evmBatch(CHAINS.base.rpcs, vaults.map(([name, address]) => balanceCall(`shares-${name}`, address)), fetcher);
  const held = vaults.map(([name, address]) => ({ name, address, raw: BigInt(byId.get(`shares-${name}`)) }));
  const redeem = held.filter((row) => row.raw > 0n);
  // previewRedeem returns the assets received after vault withdrawal fees.
  const values = redeem.length ? await evmBatch(CHAINS.base.rpcs, redeem.map((row) => ({ jsonrpc: '2.0', id: `redeem-${row.name}`, method: 'eth_call', params: [{ to: row.address, data: `0x4cdad506${row.raw.toString(16).padStart(64, '0')}` }, 'latest'] })), fetcher) : new Map();
  return held.map((row) => ({ ...row, redeemRaw: row.raw > 0n ? values.get(`redeem-${row.name}`) : '0x0' }));
}

export async function fetchAvantis(fetcher = fetch) {
  const [[vault], trades] = await Promise.all([
    vaultShares([['avUSDC', AVANTIS_VAULT]], fetcher),
    request(`${AVANTIS_CORE}/user-data?trader=${WALLET}`, null, (data) => {
      if (!Array.isArray(data?.positions) || !Array.isArray(data?.limitOrders)) throw new Error('Invalid trader data');
      return { openTrades: data.positions.length, limitOrders: data.limitOrders.length };
    }, fetcher),
  ]);
  return { shares: units(`0x${vault.raw.toString(16)}`, 6), redeemUsdc: units(vault.redeemRaw, 6), ...trades };
}

export async function fetchYo(fetcher = fetch) {
  const rows = await vaultShares(YO_VAULTS, fetcher);
  return rows.map((row) => ({ asset: row.name, shares: units(`0x${row.raw.toString(16)}`, row.name === 'yoETH' ? 18 : 6), redeem: units(row.redeemRaw, row.name === 'yoETH' ? 18 : 6), underlying: row.name === 'yoETH' ? 'WETH' : 'USDC' }));
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
    if (Number.isFinite(t) && t <= now && Number.isFinite(point.nav) && point.nav >= 0) points.set(t, { t: new Date(t).toISOString(), nav: point.nav, ...(Number.isFinite(point.managed) && point.managed >= 0 ? { managed: point.managed } : {}) });
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

export function drawdown(history, nav, now = Date.now(), peakNav = null, key = 'nav') {
  const points = history.filter((point) => Number.isFinite(point[key]) && point[key] >= 0 && Number.isFinite(Date.parse(point.t)) && Date.parse(point.t) <= now).map((point) => ({ t: point.t, nav: point[key] })).sort((a, b) => a.t.localeCompare(b.t));
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

export const managedRow = (row) => !(row.venue === 'Polymarket' && row.asset === 'Outcomes');

export function allocation(positions, nav, decisions = []) {
  const staked = positions.filter((row) => row.asset === 'sAVAX');
  const value = staked.reduce((sum, row) => sum + row.valueUsd, 0);
  const balance = staked.reduce((sum, row) => sum + row.balance, 0);
  const weight = nav > 0 ? value / nav : 0;
  const excessUsd = Math.max(0, value - nav * 0.15);
  const satelliteValues = new Map();
  const externalValues = new Map();
  for (const row of positions.filter((row) => EXTERNAL_VENUES.has(row.venue))) externalValues.set(row.venue, (externalValues.get(row.venue) ?? 0) + row.valueUsd);
  const externalValue = [...externalValues.values()].reduce((sum, value) => sum + value, 0);
  for (const row of positions.filter((row) => !CORE.has(row.asset) && !EXTERNAL_VENUES.has(row.venue))) satelliteValues.set(row.asset, (satelliteValues.get(row.asset) ?? 0) + row.valueUsd);
  const assets = [...satelliteValues].map(([asset, valueUsd]) => ({ asset, valueUsd, weight: nav > 0 ? valueUsd / nav : 0, overCap: valueUsd > nav * 0.1 }));
  const satelliteValue = assets.reduce((sum, row) => sum + row.valueUsd, 0);
  return {
    sAVAX: { weight, cap: 0.15, overCap: weight > 0.15, excessUsd: tidy(excessUsd), trimAmount: value > 0 ? tidy(excessUsd * balance / value) : 0, trimmedAmount: tidy(decisions.filter((row) => row.asset === 'sAVAX' && row.outcome === 'execute' && ['trim', 'sell'].includes(row.action) && row.size?.asset === 'sAVAX').reduce((sum, row) => sum + row.size.amount, 0)) },
    satellites: { weight: nav > 0 ? satelliteValue / nav : 0, capEach: 0.1, capCombined: 0.4, overCap: satelliteValue > nav * 0.4, assets },
    basis: { kind: 'full', valueUsd: tidy(nav) },
    tiers: { t1Usd: tidy(nav * 0.03), t2Usd: tidy(nav * 0.1), note: 'Percent limits on full NAV; the EUR ceilings of 1k and 5k do not bind at this size. Per-transaction caps still apply.' },
    external: { weight: nav > 0 ? externalValue / nav : 0, venues: [...externalValues].map(([venue, valueUsd]) => ({ venue, valueUsd: tidy(valueUsd), weight: nav > 0 ? valueUsd / nav : 0 })) },
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
  const chainKeys = Object.keys(CHAINS);
  const [avalanche, hyperliquid, quotes, polymarket, avantis, yo, ...chainResults] = await Promise.allSettled([fetchAvalanche(fetcher), fetchHyperliquid(fetcher), fetchPrices(assets, fetcher), fetchPolymarket(fetcher), fetchAvantis(fetcher), fetchYo(fetcher), ...chainKeys.map((key) => fetchChain(key, fetcher))]);
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
  const chainOk = chainResults.filter((row) => row.status === 'fulfilled').length;
  const oldVenue = (key) => previous?.venues?.[key];
  sources.polymarket = freshness(polymarket.status === 'fulfilled', Boolean(oldVenue('polymarket')), oldSources.sources.polymarket, at, 'Prediction market positions marked at current outcome prices, plus pUSD cash on Polygon.');
  sources.avantis = freshness(avantis.status === 'fulfilled', Boolean(oldVenue('avantis')), oldSources.sources.avantis, at, 'Vault shares valued at the current redeem preview, net of withdrawal fees; open trades checked.');
  sources.yo = freshness(yo.status === 'fulfilled', Boolean(oldVenue('yo')), oldSources.sources.yo, at, 'Vault shares valued at the current redeem preview on Base.');
  sources.evm_wallets = freshness(chainOk === chainKeys.length, chainKeys.some((key) => oldVenue(key)) || chainOk > 0, oldSources.sources.evm_wallets, at, 'Native and major stable balances refreshed on Base, Polygon, Ethereum, Arbitrum, Optimism and BNB Chain.');
  if (chainOk > 0 && chainOk < chainKeys.length) sources.evm_wallets = { ...sources.evm_wallets, status: 'stale', note: `Partial refresh: ${chainKeys.filter((_, index) => chainResults[index].status !== 'fulfilled').map((key) => CHAINS[key].label).join(', ')} kept last values.` };
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
      const usdc = prices.USDC?.priceUsd;
      let extrasComplete = true;
      const extraVenues = {};
      const extraPositions = [];
      const addVenue = (key, result, build) => {
        try {
          if (result.status !== 'fulfilled') throw new Error('Venue unavailable');
          const { venue, rows } = build(result.value);
          extraVenues[key] = { ...venue, valueUsd: tidy(rows.reduce((sum, row) => sum + row.valueUsd, 0)), updatedAt: at };
          extraPositions.push(...rows);
        } catch {
          extrasComplete = false;
          const old = oldVenue(key);
          if (old) {
            extraVenues[key] = old;
            extraPositions.push(...(previous.positions ?? []).filter((row) => row.venue === old.label));
            const listed = (previous.positions ?? []).filter((row) => row.venue === old.label).reduce((sum, row) => sum + row.valueUsd, 0);
            if (old.valueUsd - listed > 0) extraPositions.push({ asset: 'Unlisted', venue: old.label, balance: 0, priceUsd: null, valueUsd: tidy(old.valueUsd - listed), weight: 0 });
          }
        }
      };
      if (!Number.isFinite(usdc)) throw new Error('Missing held price');
      addVenue('polymarket', polymarket, (pm) => ({
        venue: { label: 'Polymarket', chain: 'Polygon', positionsValue: pm.positionsValue, cash: pm.cash, openPositions: pm.openPositions, redeemablePositions: pm.redeemablePositions, redeemableValue: pm.redeemableValue, positions: pm.positions },
        rows: [
          { asset: 'Outcomes', venue: 'Polymarket', balance: pm.openPositions, priceUsd: null, valueUsd: pm.positionsValue, weight: 0 },
          ...(pm.cash > 0 ? [{ asset: 'pUSD', venue: 'Polymarket', balance: pm.cash, priceUsd: usdc, valueUsd: tidy(pm.cash * usdc), weight: 0 }] : []),
        ],
      }));
      addVenue('avantis', avantis, (av) => ({
        venue: { label: 'Avantis', chain: 'Base', shares: av.shares, redeemUsdc: av.redeemUsdc, openTrades: av.openTrades, limitOrders: av.limitOrders },
        rows: av.shares > 0 ? [{ asset: 'avUSDC', venue: 'Avantis', balance: av.shares, priceUsd: tidy(av.redeemUsdc * usdc / av.shares), valueUsd: tidy(av.redeemUsdc * usdc), weight: 0 }] : [],
      }));
      addVenue('yo', yo, (vaults) => ({
        venue: { label: 'YO', chain: 'Base', vaults },
        rows: vaults.filter((row) => row.shares > 0).map((row) => {
          const underlying = row.underlying === 'USDC' ? usdc : prices.ETH?.priceUsd;
          if (!Number.isFinite(underlying)) throw new Error('Missing held price');
          return { asset: row.asset, venue: 'YO', balance: row.shares, priceUsd: tidy(row.redeem * underlying / row.shares), valueUsd: tidy(row.redeem * underlying), weight: 0 };
        }),
      }));
      chainKeys.forEach((key, index) => addVenue(key, chainResults[index], (balances) => ({
        venue: { label: CHAINS[key].label, balances },
        rows: valueBalances(balances, CHAINS[key].label, prices),
      })));
      const extraValue = tidy(Object.values(extraVenues).reduce((sum, row) => sum + row.valueUsd, 0));
      const nav = tidy(avalancheValue + hlValue + extraValue);
      if (!Number.isFinite(nav) || nav < 0) throw new Error('Invalid treasury value');
      // Full NAV drives weights, the sAVAX cap and tiers. Managed NAV (full NAV minus open prediction-market
      // positions, pUSD cash kept in) drives drawdown alarms only, with its own peak.
      const managedNav = tidy(Math.max(0, nav - (extraVenues.polymarket?.positionsValue ?? 0)));
      const positions = [...avalanchePositions, marginPosition, ...hlPositions, ...extraPositions].filter((row) => Math.abs(row.valueUsd) >= 0.01).map((row) => ({ ...row, weight: nav > 0 ? row.valueUsd / nav : 0, ...(managedRow(row) ? {} : { inManagedNav: false }) }));
      history.push({ t: at, nav, managed: managedNav });
      const managedPeak = previous?.drawdown?.basis === 'managed' ? previous.drawdown.peakNav : null;
      const risk = { ...drawdown(history, managedNav, now.valueOf(), managedPeak, 'managed'), basis: 'managed', managedNav };
      const currentPrices = [...avalancheBalances, ...hl.spotBalances].filter((row) => row.balance > 0 && row.asset !== 'USDC').every((row) => prices[row.asset]?.updatedAt === at);
      treasury = {
        generatedAt: at, updatedAt: at, wallet: WALLET, currency: 'USD',
        estimated: !(avalanche.status === 'fulfilled' && hlOk && currentPrices && extrasComplete),
        note: 'Margin account equity includes open-position profit and loss. Prediction market positions are marked at current outcome prices; vaults at redeem value. Positions below $0.01 are omitted from holdings, but remain in NAV.',
        nav, managedNav, venues: {
          avalanche: { valueUsd: avalancheValue, updatedAt: sources.avalanche_rpc.updatedAt },
          hyperliquid: { valueUsd: hlValue, updatedAt: sources.hyperliquid.updatedAt, accountValue: hl.accountValue, withdrawable: hl.withdrawable, spotBalances: hl.spotBalances, assetPositions: hl.assetPositions },
          ...extraVenues,
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
