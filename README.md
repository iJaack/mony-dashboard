# Mony treasury

A public, read-only ledger of Mony’s treasury for Giacomo Barbieri, across Avalanche and Hyperliquid. The dashboard shows holdings, allocation limits, drawdown, published decisions, valuation research and dated safety assessments.

The static website lives in `site/`, with all displayed data in `site/data/`. Presentation adapts the vendored Forma system in `site/vendor/jaack/` (package hash in `VERSION`) for this ledger: the token structure, type scale, spacing scale and local-clock theme stay in common, light from 07:00 to 19:00, with an Auto / Chiaro / Scuro override. The accent is a ruling-line slate rather than the demo gold, the background wash is stone and slate, and figures are tabular. Approximate initial values are marked as estimates; a failed refresh retains previous data and shows its freshness. History starts with the observed 17 October 2026 post-trade snapshot.

Data comes from Avalanche C-Chain JSON-RPC, Hyperliquid’s public information API, CoinGecko’s public USD prices and published Serialized Audit assessments. Research dates remain distinct from market quote dates. Open-position profit and loss is included once, through Hyperliquid margin account equity.

The refresh workflow runs about every 15 minutes and deploys the refreshed site. Decisions are published after each run, twice daily. Public automation requires no API keys. The custom domain is `mony.jaack.me`.

Local use requires Node 20 or newer and Python 3:

```sh
node --test
node scripts/update-public-data.mjs
python3 -m http.server 8080 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:8080`. Seeded files work without access to data providers. See [SCHEMA.md](SCHEMA.md) for the public data contract.
