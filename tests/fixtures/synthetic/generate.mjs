// All values in this directory are synthetic. Never read production data here.
import { writeFile } from 'node:fs/promises';
import { allocation, positionKey } from '../../../scripts/update-public-data.mjs';
const note = 'Synthetic fixture — not real data';
const at = '2026-11-16T12:00:00.000Z';
const DAY = 86_400_000;
const date = (i) => new Date(Date.parse(at) - (29 - i) * DAY).toISOString();
function series(anchors, length = 30) {
  return Array.from({ length }, (_, i) => {
    const next = anchors.findIndex(([index]) => index >= i);
    if (anchors[next][0] === i) return anchors[next][1];
    const [a, lo] = anchors[next - 1], [b, hi] = anchors[next];
    return Math.round(lo + (hi - lo) * (i - a) / (b - a));
  });
}
const definitions = [
  ['Fondo A', 12480, series([[0, 12220], [5, 11900], [14, 12300], [23, 12510], [29, 12480]]), [12000, 13000]],
  ['Fondo B', 4230, series([[0, 4264], [7, 4410], [18, 4150], [29, 4230]])],
  ['Fondo C', 8750, Array(30).fill(8750), [8500, 9000]],
  ['Fondo D', 3300, series([[0, 3000], [4, 3100], [11, 3300]], 12)],
  ['Fondo E', 6000, series([[0, 5800], [13, 6200], [29, 6000]])],
  ['Fondo F', 2500, series([[0, 2700], [16, 2400], [29, 2500]])],
  ['Fondo G', 1500, series([[0, 1500], [10, 1400], [20, 1600], [29, 1500]])],
  ['Fondo H', 1000, series([[0, 900], [15, 1100], [29, 1000]])],
];
const nav = definitions.reduce((sum, [, value]) => sum + value, 0);
const positions = definitions.map(([asset, valueUsd, , targetBand], i) => ({
  asset, venue: i < 4 ? 'Avalanche' : i === 7 ? 'Polymarket' : 'Hyperliquid spot', balance: valueUsd / 10, priceUsd: 10, valueUsd, weight: valueUsd / nav,
  ...(targetBand ? { targetBand } : {}), ...(i === 7 ? { inManagedNav: false } : {}),
}));
const treasury = {
  generatedAt: at, updatedAt: at, wallet: '0x0000000000000000000000000000000000000001', currency: 'USD', estimated: false, note,
  nav, managedNav: nav - 1000,
  venues: {
    avalanche: { valueUsd: 28760, updatedAt: at },
    hyperliquid: { valueUsd: 10000, updatedAt: at, accountValue: 0, withdrawable: 0, spotBalances: [{ asset: 'SYNTH', balance: 1000 }], assetPositions: [{ asset: 'SYNTH', balance: 1, entryPrice: 100, positionValue: 100, unrealizedPnl: 0, marginUsed: 10 }] },
    polymarket: { label: 'Polymarket', chain: 'Polygon', valueUsd: 1000, updatedAt: at, positionsValue: 1000, cash: 0, openPositions: 1, redeemablePositions: 0, redeemableValue: 0, positions: [] },
  },
  avalancheBalances: [{ asset: 'SYNTH', balance: 2876, decimals: 18 }], positions,
  allocation: allocation(positions, nav),
  drawdown: { sevenDay: -0.01, fromPeak: -0.02, peakNav: 40000, pauseThreshold: -0.1, escalateThreshold: -0.25, basis: 'managed', managedNav: nav - 1000 },
  execution: { status: 'active', escalated: false }, gasAvax: 0,
};
const files = {
  treasury,
  'positions-history': { note, positions: Object.fromEntries(positions.map((row, i) => [positionKey(row), definitions[i][2].map((valueUsd, n, values) => ({ t: date(30 - values.length + n), valueUsd }))])) },
  'nav-history': Array.from({ length: 30 }, (_, i) => ({ t: date(i), nav: 38000 + Math.round(1760 * i / 29), managed: 37000 + Math.round(1760 * i / 29) })),
  prices: { generatedAt: at, updatedAt: at, prices: { SYNTH: { priceUsd: 10, change24h: 0, updatedAt: at, source: 'Snapshot' } } },
  sources: { generatedAt: at, sources: Object.fromEntries(['avalanche_rpc', 'hyperliquid', 'coingecko', 'serialized_audit', 'polymarket', 'avantis', 'yo', 'evm_wallets', 'decisions'].map(key => [key, { status: 'ok', updatedAt: at, lastSuccessAt: at, note }])) },
  decisions: { updatedAt: at, decisions: [{ id: 'synthetic-no-trade', date: at, outcome: 'no_op', title: note, reason: 'Synthetic amounts stay within the declared limits.', asset: 'SYNTH', action: 'none', size: { amount: 0, asset: 'SYNTH', usd: 0 }, txs: [] }] },
  valuation: { updatedAt: at, rows: [{ token: 'SYNTH', priceUsd: 10, priceAt: at, modeledValue: 12, buyLevel: 9, marginOfSafety: 0.1, gatePass: false, note }] },
  audits: { updatedAt: at, rows: [{ token: 'SYNTH', isSafe: null, createdAt: at, assessment: note }] },
  forecasts: { asOf: at.slice(0, 10), source: note, rows: [{ title: 'Synthetic outcome', band: [0.4, 0.6], confidence: 'Medium', horizon: '2026-12-01', staleAfter: '2026-11-25', lastReviewed: '2026-11-16', market: 'Synthetic market' }] },
};
for (const [name, value] of Object.entries(files)) await writeFile(new URL(`${name}.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
