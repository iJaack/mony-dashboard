(() => {
  'use strict';
  const DAY = 86_400_000;
  const el = (id) => document.getElementById(id);
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const amount = (value, digits = 4) => finite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: digits }) : 'Unavailable';
  const money = (value) => finite(value) ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2 }) : 'Unavailable';
  const percent = (value) => finite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const zoneFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', timeZoneName: 'long' });
  function stamp(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
    const date = new Date(value);
    const zone = zoneFormatter.formatToParts(date).find((part) => part.type === 'timeZoneName').value.includes('Summer') ? 'CEST' : 'CET';
    return dateFormatter.formatToParts(date).map((part) => part.type === 'timeZoneName' ? zone : part.value).join('');
  }
  const time = (value) => `<time datetime="${escape(value)}">${escape(stamp(value))}</time>`;
  const updated = (id, value) => { el(id).innerHTML = `Last updated: ${value ? time(value) : 'unavailable'} <span class="muted">/ Europe/Rome</span>`; };
  const empty = (label = 'Unavailable') => `<p class="empty-state">${escape(label)}</p>`;
  const badge = (outcome) => `<span class="badge ${outcome === 'execute' || outcome === 'ok' ? 'good' : ['blocked', 'escalated', 'error', 'stale'].includes(outcome) ? 'warn' : ''}">${escape(outcome)}</span>`;
  function receipt(tx, short = false) {
    if (!/^0x[0-9a-f]{64}$/i.test(tx.hash)) return '';
    return `<a class="text-link" href="https://snowtrace.io/tx/${tx.hash}" target="_blank" rel="noopener noreferrer">${short ? `${tx.hash.slice(0, 10)}…${tx.hash.slice(-4)}` : escape(`${tx.label} receipt`)} ↗</a>`;
  }
  function safeRender(ids, fn) {
    try { fn(); } catch (error) { console.warn('A data section is unavailable:', error.message); for (const id of ids) el(id).innerHTML = empty(); }
  }
  async function load(name) {
    try {
      const response = await fetch(`./data/${name}.json`, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      return await response.json();
    } catch { return null; }
  }

  function extraVenues(data) {
    const venues = data.venues;
    const line = (title, detail, venue) => venue ? `<div class="venue-line"><span>${escape(title)}<small>${escape(detail)}</small><small>${time(venue.updatedAt)}</small></span><strong>${money(venue.valueUsd)}</strong></div>` : '';
    const pm = venues.polymarket;
    const av = venues.avantis;
    const yo = venues.yo;
    const wallets = ['base', 'polygon', 'ethereum', 'arbitrum', 'optimism', 'bnb'].filter((key) => venues[key]);
    const walletValue = wallets.reduce((sum, key) => sum + (venues[key].valueUsd ?? 0), 0);
    const held = wallets.filter((key) => venues[key].valueUsd >= 0.01).map((key) => venues[key].label);
    return [
      pm && line('Polymarket', `Polygon · ${pm.openPositions} open positions${pm.redeemablePositions ? `, ${pm.redeemablePositions} redeemable` : ''} · ${money(pm.cash)} cash · outside the trading mandate`, pm),
      av && line('Avantis', `Base · avUSDC vault at redeem value${av.openTrades ? ` · ${av.openTrades} open trades` : ' · no open trades'} · outside the trading mandate`, av),
      yo && yo.valueUsd >= 0.01 ? line('YO', 'Base · vault at redeem value · outside the trading mandate', yo) : '',
      wallets.length ? `<div class="venue-line"><span>Other chains<small>Native and stable balances · ${escape(held.join(', ') || 'no holdings')}</small><small>${time(venues[wallets[0]].updatedAt)}</small></span><strong>${money(walletValue)}</strong></div>` : '',
    ].join('');
  }

  function renderTreasury(data) {
    if (!data || !finite(data.nav) || !Array.isArray(data.positions)) return;
    el('nav-title').textContent = `${data.estimated ? '≈ ' : ''}${money(data.nav)}`;
    updated('treasury-updated', data.updatedAt);
    el('execution-status').textContent = `Execution: ${data.execution.status === 'paused' ? 'paused' : 'active'}`;
    el('execution-status').classList.toggle('warn', data.execution.status === 'paused' || data.execution.escalated);
    const concentration = data.allocation.sAVAX;
    if (finite(data.managedNav)) el('managed-line').textContent = `Weights, caps and tiers use total holdings. Drawdown alarms use managed NAV ${money(data.managedNav)} (excludes open prediction-market positions).`;
    el('hero-context').textContent = concentration.overCap ? 'sAVAX remains above its 15% cap.' : 'Holdings are measured against the treasury limits.';
    const venues = data.venues;
    el('venues-content').innerHTML = `<div class="venue-line"><span>Avalanche<small>C-Chain · ${escape(data.positions.filter((row) => row.venue === 'Avalanche').map((row) => row.asset).join(', ') || 'no holdings')}</small><small>${time(venues.avalanche.updatedAt)}</small></span><strong>${money(venues.avalanche.valueUsd)}</strong></div>
      <div class="venue-line"><span>Hyperliquid<small>Margin equity + spot · ${venues.hyperliquid.assetPositions.length} open positions</small><small>${time(venues.hyperliquid.updatedAt)}</small></span><strong>${money(venues.hyperliquid.valueUsd)}</strong></div>${extraVenues(data)}`;
    const satellites = data.allocation.satellites;
    el('allocation-content').innerHTML = `<div class="allocation-label"><span>sAVAX concentration <small class="muted">of total holdings</small></span><strong><span class="${concentration.overCap ? 'warn' : 'good'}">${percent(concentration.weight)}</span> <span class="muted">/ 15% cap</span></strong></div>
      <div class="cap-track" role="img" aria-label="sAVAX weight ${percent(concentration.weight)}, cap 15 percent"><svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="${concentration.overCap ? 'bar-warning' : 'bar-good'}" width="${Math.min(100, Math.max(0, concentration.weight * 100))}" height="6"/></svg><span class="cap-mark"></span></div>
      <div class="cap-scale"><span>0%</span><span class="cap-tag">15% cap</span><span>100%</span></div>
      <p>${concentration.overCap ? `Over cap by ${money(concentration.excessUsd)}. About ${amount(concentration.trimAmount)} sAVAX would reach the target at current marks.` : 'Within the concentration cap.'}</p>
      ${data.allocation.external ? `<p>Outside the trading mandate: ${percent(data.allocation.external.weight)} · ${data.allocation.external.venues.map((row) => `${escape(row.venue)} ${percent(row.weight)}`).join('; ') || 'none'}. Counted in total holdings and weights, not traded by the treasury run and not satellites. Open prediction-market positions are excluded from the drawdown basis.</p>` : ''}
      ${data.allocation.tiers ? `<p>Tier sizes on total holdings ${money(data.allocation.basis?.valueUsd)}: T1 ${money(data.allocation.tiers.t1Usd)} · T2 ${money(data.allocation.tiers.t2Usd)}.</p>` : ''}
      <p>Satellites: ${percent(satellites.weight)} / 40% combined cap${satellites.overCap ? ' · over cap' : ''}. ${satellites.assets.length ? satellites.assets.map((row) => `${escape(row.asset)} ${percent(row.weight)} / 10%${row.overCap ? ' · over cap' : ''}`).join('; ') : 'No satellite holdings.'}</p>`;
    const priority = ['sAVAX', 'USDC', 'WAVAX', 'AVAX', 'USDt', 'BTC.b', 'WETH.e'];
    const positions = [...data.positions].sort((a, b) => (priority.indexOf(a.asset) < 0 ? 99 : priority.indexOf(a.asset)) - (priority.indexOf(b.asset) < 0 ? 99 : priority.indexOf(b.asset)));
    el('holdings-content').innerHTML = `<table><caption class="sr-only">Treasury holdings across all venues, in USD.</caption><thead><tr><th scope="col">Asset / venue</th><th scope="col">Balance</th><th scope="col">Value</th><th scope="col">Weight <small class="muted">of total holdings</small></th></tr></thead><tbody>${positions.map((row) => `<tr><th scope="row"><span class="asset"><span class="app-monogram ${row.asset === 'sAVAX' ? '' : 'outline'}" aria-hidden="true">${escape(row.asset.slice(0, 1))}</span><span>${escape(row.asset)}<small>${escape(row.venue)}</small></span></span></th><td data-label="Balance">${amount(row.balance, 6)}</td><td data-label="Value">${money(row.valueUsd)}</td><td data-label="Weight">${percent(row.weight)}${row.inManagedNav === false ? ' <small class="muted" title="Excluded from the drawdown basis">· not in drawdown basis</small>' : ''}</td></tr>`).join('')}</tbody></table>${venues.hyperliquid.assetPositions.length ? `<div class="derivatives"><h3>Open positions</h3>${venues.hyperliquid.assetPositions.map((row) => `<p class="small muted">${escape(row.asset)} · ${amount(row.balance)} · position value ${money(row.positionValue)} · unrealized P&amp;L ${money(row.unrealizedPnl)}. Included in margin equity.</p>`).join('')}</div>` : ''}`;
    el('holdings-note').textContent = data.note;
    el('trim-content').innerHTML = `<strong>Trim progress <span class="muted">/ ${amount(concentration.trimmedAmount)} sAVAX completed</span></strong><p>Current weight ${percent(concentration.weight)} / 15% target.</p>`;
    el('gas-content').textContent = `Gas spent: ${amount(data.gasAvax, 9)} AVAX${data.execution.escalated ? ' · Peak drawdown threshold reached; escalation required.' : ''}`;
    updated('holdings-updated', data.updatedAt);
    updated('venues-updated', data.updatedAt);
  }

  function renderDecisions(data) {
    if (!data || !Array.isArray(data.decisions)) return;
    const rows = [...data.decisions].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const latest = rows[0];
    if (!latest) {
      for (const id of ['latest-content', 'decisions-content', 'execution-content']) el(id).innerHTML = empty('No published decisions');
      return;
    }
    el('latest-content').innerHTML = `<div class="inline spread">${badge(latest.outcome)}<span class="small muted">${time(latest.date)}</span></div><h3 class="decision-title">${escape(latest.title)}</h3>
      <div class="trade-pair"><strong>${amount(latest.size.amount)}<small>${escape(latest.size.asset)}</small></strong>${latest.received ? `<span class="trade-arrow" aria-hidden="true">→</span><strong>${amount(latest.received.amount)}<small>${escape(latest.received.asset)}</small></strong>` : ''}</div>
      <p class="trade-note">${escape(latest.reason)}</p><div class="receipt-row">${(latest.txs ?? []).map((tx) => receipt(tx)).join('')}</div>`;
    const execution = rows.find((row) => row.outcome === 'execute');
    el('execution-content').innerHTML = execution ? `<ol class="timeline"><li><div class="work-meta">${time(execution.date)}</div><div><h3><span class="good">✓</span>${escape(execution.title)}</h3><p>${escape(execution.outcome)} · ${amount(execution.size.amount)} ${escape(execution.asset)}${finite(execution.size.usd) ? ` · ${money(execution.size.usd)}` : ''}</p><p>${escape(execution.reason)}</p></div></li></ol>
      <div class="transaction-list">${(execution.txs ?? []).map((tx, index) => `<article class="transaction-row"><div class="inline spread"><h3>${String(index + 1).padStart(2, '0')} <span class="muted">/ ${escape(tx.label)}</span></h3>${receipt(tx, true)}</div><p>Block ${amount(tx.block, 0)} · gas ${amount(tx.gasUsed, 0)} · ${amount(tx.gasAvax, 9)} AVAX</p></article>`).join('')}</div>` : empty('No published executions');
    el('decisions-content').innerHTML = rows.map((row) => `<article class="decision"><div class="inline spread">${badge(row.outcome)}<span>${time(row.date)}</span></div><h3>${escape(row.title)}</h3><p>${escape(row.reason)}</p><p>${escape(row.action)} · ${amount(row.size.amount)} ${escape(row.size.asset)}${finite(row.size.usd) ? ` · ${money(row.size.usd)}` : ''}</p><div class="receipt-row">${(row.txs ?? []).map((tx) => receipt(tx)).join('')}</div></article>`).join('');
    updated('latest-updated', latest.date);
    updated('decisions-updated', data.updatedAt);
    updated('execution-updated', execution?.date);
  }

  function validHistory(data) {
    if (!Array.isArray(data)) return null;
    return data.filter((row) => row && finite(row.nav) && row.nav >= 0 && Number.isFinite(Date.parse(row.t)) && Date.parse(row.t) <= Date.now()).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  }
  function renderChart(history, days) {
    if (!history) { el('history-chart').innerHTML = empty(); return; }
    updated('history-updated', history.at(-1)?.t);
    const rows = history.filter((row) => Date.parse(row.t) >= Date.now() - days * DAY);
    if (rows.length < 2) {
      el('history-chart').innerHTML = empty(history.length < 2 ? 'history starts 17 Oct 2026' : 'Insufficient history for this period');
      return;
    }
    const low = Math.min(...rows.map((row) => row.nav));
    const high = Math.max(...rows.map((row) => row.nav));
    const span = high - low || Math.max(1, high * 0.01);
    const start = Date.parse(rows[0].t);
    const duration = Date.parse(rows.at(-1).t) - start || 1;
    const points = rows.map((row) => [(Date.parse(row.t) - start) / duration * 632 + 4, 132 - (row.nav - low) / span * 110]);
    const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const last = points.at(-1);
    el('history-chart').innerHTML = `<svg viewBox="0 0 640 150" preserveAspectRatio="none" role="img" aria-label="${days}-day treasury NAV, ${money(low)} to ${money(high)}"><path class="chart-grid" d="M0 25H640M0 75H640M0 125H640"/><path class="chart-area" d="${path} L636 150 L4 150Z"/><path class="chart-line" d="${path}"/><circle cx="${last[0]}" cy="${last[1]}" r="4" class="chart-point"/></svg><div class="chart-labels"><span>${time(rows[0].t)}</span><span>${time(rows.at(-1).t)}</span></div>`;
  }

  function renderRisk(history, treasury) {
    if (!treasury || !finite(treasury.nav) || !treasury.drawdown) return;
    const risk = treasury.drawdown;
    const managed = risk.basis === 'managed';
    const sevenDay = finite(risk.sevenDay) ? risk.sevenDay : null;
    const fromPeak = finite(risk.fromPeak) ? risk.fromPeak : null;
    const basis = managed ? `<p class="small muted">Drawdown uses managed NAV ${money(risk.managedNav)}: the full treasury excluding open prediction-market positions (prediction-market cash stays in). Managed peak ${money(risk.peakNav)}; tracking started 18 Oct 2026.</p>` : '';
    el('risk-content').innerHTML = basis + [
      ['7-day drawdown', sevenDay, 25, 'pause', '−10% pause', '−25%'],
      ['From peak', fromPeak, 30, 'escalate', '−25% escalate', '−30%'],
    ].map(([label, value, max, kind, threshold, end]) => `<div class="risk-row"><span>${label}</span><strong>${finite(value) ? percent(value) : '— <small>insufficient history</small>'}</strong></div><div class="risk-track" role="img" aria-label="${label}: ${finite(value) ? percent(value) : 'insufficient history'}; ${threshold}"><svg viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-neutral" width="${finite(value) ? Math.min(100, Math.max(0, -value * 100 / max * 100)) : 0}" height="5"/></svg><span class="risk-limit ${kind}"></span></div><div class="risk-scale"><span>0%</span><span>${threshold}</span><span>${end}</span></div>`).join('');
    updated('risk-updated', history?.at(-1)?.t ?? treasury.updatedAt);
  }

  function renderSignals(data, priceData) {
    if (!data || !Array.isArray(data.rows)) return;
    const rows = [...data.rows];
    if (!rows.some((row) => row.token === 'sAVAX')) rows.splice(1, 0, { token: 'sAVAX', modeledValue: null, buyLevel: null, marginOfSafety: null, gatePass: null, note: 'Not modeled' });
    const order = ['AVAX', 'sAVAX', 'PHAR', 'p33', 'NEAR', 'ZEC', 'VVV', 'AAVE', 'HYPE'];
    rows.sort((a, b) => (order.indexOf(a.token) < 0 ? 99 : order.indexOf(a.token)) - (order.indexOf(b.token) < 0 ? 99 : order.indexOf(b.token)));
    el('signals-summary').innerHTML = `Watchlist <span class="badge">${data.rows.filter((row) => row.gatePass === true).length} / ${data.rows.length} gates pass</span>`;
    el('signals-content').innerHTML = `<table><caption class="sr-only">Latest available quotes and dated valuation research.</caption><thead><tr><th scope="col">Asset</th><th scope="col">Price</th><th scope="col">Modeled value</th><th scope="col">Buy level</th><th scope="col">MoS</th><th scope="col">Gate</th></tr></thead><tbody>${rows.map((row) => {
      const quote = priceData?.prices?.[row.token];
      return `<tr><th scope="row">${escape(row.token)}</th><td data-label="Price"><span>${money(quote?.priceUsd)}${quote ? `<span class="quote-date">${time(quote.updatedAt)}</span>` : ''}</span></td><td data-label="Modeled value">${row.modeledValue === null ? '—' : money(row.modeledValue)}</td><td data-label="Buy level">${row.buyLevel === null ? '—' : money(row.buyLevel)}</td><td data-label="MoS" class="${row.marginOfSafety > 0 ? 'good' : 'muted'}">${percent(row.marginOfSafety)}</td><td data-label="Valuation gate"><span class="${row.gatePass === true ? 'good' : row.gatePass === false ? 'gate-fail' : 'muted'}" title="${escape(row.note)}">${row.gatePass === null ? 'Not modeled' : row.gatePass ? 'Pass' : row.buyLevel === null ? 'Fail · no model' : 'Fail'}</span></td></tr>`;
    }).join('')}</tbody></table>`;
    updated('signals-updated', data.updatedAt);
    el('signals-updated').insertAdjacentHTML('beforeend', `<br>Quotes: ${priceData ? time(priceData.updatedAt) : 'unavailable'}. Each price shows its own timestamp.`);
  }

  function renderAudits(data) {
    if (!data || !Array.isArray(data.rows)) return;
    el('audit-content').innerHTML = `<table><caption class="sr-only">Serialized Audit verdicts and dates in Europe/Rome.</caption><thead><tr><th scope="col">Asset</th><th scope="col">isSafe</th><th scope="col">Audit created</th><th scope="col">Provider assessment</th></tr></thead><tbody>${data.rows.map((row) => `<tr><th scope="row">${escape(row.token)}</th><td data-label="isSafe"><span class="badge ${row.isSafe === true ? 'good' : row.isSafe === false ? 'warn' : ''}">${row.isSafe === null ? 'Unavailable' : row.isSafe ? 'True' : 'False'}</span></td><td data-label="Audit created">${row.createdAt ? time(row.createdAt) : '—'}</td><td data-label="Provider assessment">${escape(row.assessment)}</td></tr>`).join('')}</tbody></table>`;
    updated('audit-updated', data.updatedAt);
  }

  function renderSources(data) {
    if (!data || !data.sources) return;
    const labels = { avalanche_rpc: 'Avalanche RPC', hyperliquid: 'Hyperliquid', polymarket: 'Polymarket', avantis: 'Avantis', yo: 'YO', evm_wallets: 'Other chains RPC', coingecko: 'CoinGecko', serialized_audit: 'Serialized Audit', decisions: 'Decisions' };
    el('sources-content').innerHTML = Object.entries(labels).map(([key, label]) => {
      const row = data.sources[key];
      return `<article class="source-item"><div class="work-meta">${row?.updatedAt ? time(row.updatedAt) : 'No snapshot'}</div><div><div class="inline spread"><h3>${label}</h3>${badge(row?.status ?? 'error')}</div><p>${escape(row?.note ?? 'Unavailable')}</p>${row?.lastSuccessAt ? `<p>Last success: ${time(row.lastSuccessAt)}</p>` : ''}</div></article>`;
    }).join('');
    updated('sources-updated', data.generatedAt);
  }

  const romeDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  const day = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? `<time datetime="${escape(value)}">${escape(dayLabel.format(new Date(`${value}T00:00:00Z`)))}</time>` : '—';
  function renderForecasts(data) {
    if (!data || !Array.isArray(data.rows)) return;
    const today = romeDay.format(new Date());
    const pct = (value) => `${Math.round(value * 100)}%`;
    const rows = data.rows.filter((row) => Array.isArray(row.band) && finite(row.band[0]) && finite(row.band[1]));
    const stale = rows.filter((row) => row.staleAfter && today > row.staleAfter).length;
    el('forecasts-summary').innerHTML = `${escape(data.source ?? 'Forecast book')} <span class="badge">${rows.length} active</span>${stale ? ` <span class="badge warn">${stale} stale</span>` : ''}`;
    el('forecasts-content').innerHTML = rows.length ? rows.map((row) => {
      const [lo, hi] = row.band.map((value) => Math.min(1, Math.max(0, value)));
      const isStale = row.staleAfter && today > row.staleAfter;
      const linked = typeof row.treasuryLink === 'string' && row.treasuryLink;
      return `<article class="forecast${linked ? ' linked' : ''}"><div class="forecast-head"><h3>${escape(row.title)}</h3><strong class="forecast-band">${pct(lo)}–${pct(hi)}</strong></div><div class="forecast-track" role="img" aria-label="Probability band ${pct(lo)} to ${pct(hi)}"><svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><path class="forecast-grid" d="M25 0V6M50 0V6M75 0V6"/><rect class="forecast-range" x="${(lo * 100).toFixed(2)}" width="${Math.max(0.8, (hi - lo) * 100).toFixed(2)}" height="6"/></svg></div><div class="forecast-meta"><span>By ${day(row.horizon)}</span><span>${escape(row.confidence)} confidence</span><span>${escape(row.market)}</span>${row.lastReviewed ? `<span>Reviewed ${day(row.lastReviewed)}</span>` : ''}${isStale ? '<span class="badge warn">stale</span>' : ''}</div>${linked ? `<p class="forecast-link"><span class="badge gold">Treasury</span> ${escape(row.treasuryLink)}</p>` : ''}</article>`;
    }).join('') : empty('No active forecasts');
    el('forecasts-updated').innerHTML = `As of: ${day(data.asOf)} <span class="muted">/ bands are probabilities of Yes</span>`;
  }

  async function main() {
    const [treasury, prices, historyData, sources, decisions, valuation, audits, forecasts] = await Promise.all(['treasury', 'prices', 'nav-history', 'sources', 'decisions', 'valuation', 'audits', 'forecasts'].map(load));
    const history = validHistory(historyData);
    safeRender(['nav-title', 'venues-content', 'holdings-content', 'allocation-content', 'trim-content'], () => renderTreasury(treasury));
    safeRender(['latest-content', 'decisions-content', 'execution-content'], () => renderDecisions(decisions));
    safeRender(['history-chart'], () => renderChart(history, 7));
    safeRender(['risk-content'], () => renderRisk(history, treasury));
    safeRender(['signals-content'], () => renderSignals(valuation, prices));
    safeRender(['forecasts-content'], () => renderForecasts(forecasts));
    safeRender(['audit-content'], () => renderAudits(audits));
    safeRender(['sources-content'], () => renderSources(sources));
    document.querySelectorAll('[data-days]').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('[data-days]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      safeRender(['history-chart'], () => renderChart(history, Number(button.dataset.days)));
    }));
    document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => {
      document.querySelectorAll('.nav-links a').forEach((item) => item.removeAttribute('aria-current'));
      link.setAttribute('aria-current', 'location');
    }));
    document.documentElement.dataset.ready = 'true';
  }
  main();
})();
