# Synthetic fixtures — not real data

**Every JSON file here is synthetic**, including the NAV array and prices. None
was copied from a wallet, market provider or production data. The dummy wallet is
`0x0000000000000000000000000000000000000001`. All dates are fixed, ending on
16 November 2026 at 12:00 UTC. The app anchors its window to the refresh date,
so these fixtures remain usable after that day.

Regenerate deterministically with `node tests/fixtures/synthetic/generate.mjs`.
The generator calls only pure helpers; it never reads production JSON or fetches
providers. A, B and C match spec §10: $12,480 (+2.1%), $4,230 (−0.8%), and $8,750
(0.0%). A's observed extrema are $11,900–$12,510 and its scale extends to $13,000
to contain the target band. C is flat, with an $8,500–$9,000 band. D has only 12
real daily readings; E–H bring the group to eight rows. All other positions have
30 deterministic daily readings. The synthetic open-position row exercises the
unchanged margin-equity list. Prices use the schema's `Snapshot` source enum.

For a local capture, run `python3 tests/fixtures/synthetic/serve.py`, then open
`http://127.0.0.1:8080/#holdings`. The server serves the actual site and routes
**all `/data/*.json` requests to this directory**; it never serves production
JSON. Alternatively, serve `site/` and intercept each `**/data/*.json` request in
the capture browser, fulfilling it from the matching synthetic file. Do not mix
synthetic position history with production treasury data.

Reference capture sizes: 466×678, 669×951, 2560×1440, 3440×1440. Check Light and
Dark (Ombra), normal motion, media reduced motion and `html.jk-rm`. The list's
columns are 1/1/2/4/4 at <600 / 600–1279 / 1280–2559 / ≥2560 respectively;
minimum/maximum labels are scale ends, while accessible text reports history's
observed extrema. The sign on each nonzero delta supplements its colour.

Stage 2 capture pack: `node tests/forma-v2/capture-figure.mjs` reuses the installed
Playwright (or `PLAYWRIGHT_MODULE=/path/to/playwright`) and writes the requested
five viewports in Light/Ombra to `output/figure-2026-11-17/`. It also truncates
history in memory to 0/1/5/30 days at 466 and 1280px; D retains at most its 12 real
readings. Every drawable series has 30 calendar slots with nulls for missing
days. Below two readings the box stays reserved and empty, with no visible label
or delta. The runner checks normal and both reduced-motion modes, blocks external
requests, and routes every data JSON to these fixtures on both server and browser.
`python3 tests/forma-v2/validate-data.py` validates all local JSON; synthetic names
and target bands use a test-only schema overlay, leaving the live contract intact.
