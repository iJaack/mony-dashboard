(() => {
  'use strict';
  const DAY = 86_400_000;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (id) => document.getElementById(id);
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const amount = (value, digits = 4) => finite(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: digits }) : 'Unavailable';
  const money = (value) => finite(value) ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2 }) : 'Unavailable';
  const plain = (value) => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Unavailable';
  const percent = (value) => {
    if (!finite(value)) return '—';
    const text = (value * 100).toFixed(1);
    return `${text.startsWith('-') ? `−${text.slice(1)}` : text}%`;
  };
  const reduced = () => document.documentElement.classList.contains('jk-rm') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const zoneFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', timeZoneName: 'long' });
  const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  const axisDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' });
  const axisDayYear = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', year: 'numeric' });
  function stamp(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
    const date = new Date(value);
    const zone = zoneFormatter.formatToParts(date).find((part) => part.type === 'timeZoneName').value.includes('Summer') ? 'CEST' : 'CET';
    return dateFormatter.formatToParts(date).map((part) => part.type === 'timeZoneName' ? zone : part.value).join('');
  }
  const time = (value) => `<time datetime="${escape(value)}">${escape(stamp(value))}</time>`;
  const updated = (id, value) => { const node = el(id); if (node) node.innerHTML = `Last updated: ${value ? time(value) : 'unavailable'} <span class="quiet">/ Europe/Rome</span>`; };
  const empty = (label = 'Unavailable') => `<p class="jk-note">${escape(label)}</p>`;
  const na = () => '<span class="jk-na">Unavailable</span>';
  const OUTCOMES = {
    execute: ['Executed', 'ok'],
    ok: ['Fresh', 'ok'],
    blocked: ['Blocked', 'bad'],
    escalated: ['Escalated', 'bad'],
    error: ['Error', 'bad'],
    stale: ['Stale', 'warn'],
    paused: ['Paused', 'warn'],
    no_op: ['No trade', 'neutral'],
  };
  function outcomeMark(outcome) {
    const [label, kind] = OUTCOMES[outcome] || [outcome || 'Unavailable', 'neutral'];
    return `<span class="outcome ${kind}">${escape(label)}</span>`;
  }
  function receipt(tx) {
    if (!tx || !/^0x[0-9a-f]{64}$/i.test(tx.hash)) return '';
    const text = `${tx.label} ${tx.hash.slice(0, 10)}…${tx.hash.slice(-4)}`;
    return `<a class="jk-a" href="https://snowtrace.io/tx/${tx.hash}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;
  }
  function safeRender(ids, fn) {
    try { fn(); } catch (error) {
      console.warn('A data section is unavailable:', error.message);
      for (const id of ids) { const node = el(id); if (node) node.innerHTML = empty(); }
    }
  }
  async function load(name) {
    try {
      const response = await fetch(`./data/${name}.json`, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      return await response.json();
    } catch { return null; }
  }
  function svgEl(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function pointAt(history, ms) {
    let best = null;
    for (const row of history) {
      if (Date.parse(row.t) <= ms) best = row;
      else break;
    }
    return best;
  }

  function extraVenues(data) {
    const venues = data.venues;
    const line = (title, detail, venue) => venue ? `<li><span>${escape(title)}<small class="sub">${escape(detail)} · ${stamp(venue.updatedAt)}</small></span><span class="r">${money(venue.valueUsd)}</span></li>` : '';
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
      wallets.length ? `<li><span>Other chains<small class="sub">Native and stable balances · ${escape(held.join(', ') || 'no holdings')} · ${stamp(venues[wallets[0]].updatedAt)}</small></span><span class="r">${money(walletValue)}</span></li>` : '',
    ].join('');
  }

  function renderTreasury(data, history) {
    if (!data || !finite(data.nav) || !Array.isArray(data.positions)) return;
    const status = data.execution.status === 'paused' ? 'paused' : 'active';
    const tag = el('execution-status');
    tag.textContent = `Public · read-only · Execution ${status}`;
    tag.classList.toggle('is-warn', status === 'paused' || data.execution.escalated);
    el('nav-title').textContent = `${data.estimated ? '≈ ' : ''}$${plain(data.nav)}`;
    const last = history?.at(-1);
    const start = history?.[0];
    const spanDays = last && start ? (Date.parse(last.t) - Date.parse(start.t)) / DAY : 0;
    const windowRows = history ? history.filter((row) => Date.parse(row.t) >= Date.parse(last.t) - 30 * DAY) : [];
    const mean = windowRows.length ? windowRows.reduce((sum, row) => sum + row.nav, 0) / windowRows.length : null;
    const yest = last ? pointAt(history, Date.parse(last.t) - DAY) : null;
    const managed = finite(data.managedNav) ? `managed NAV <b>${money(data.managedNav)}</b>` : 'managed NAV unavailable';
    const since = start ? `since ${escape(axisDay.format(new Date(start.t)))} <b>${money(start.nav)}</b>` : 'no earlier snapshot';
    const meanText = finite(mean) ? `mean over ${Math.max(1, Math.round(spanDays))} days <b>${money(mean)}</b>` : 'mean unavailable';
    el('nav-cmp').innerHTML = `${managed} · ${since} · ${meanText}. Weights use total holdings.`;
    if (yest && yest !== last) {
      const delta = last.nav - yest.nav;
      el('day-delta').innerHTML = `<i class="jk-mark ${delta < 0 ? 'neg' : 'pos'}" aria-hidden="true"></i>${money(delta).replace('-', '−')}`;
      const ratio = yest.nav ? delta / yest.nav : null;
      const peak = data.drawdown && finite(data.drawdown.fromPeak) ? `from the managed peak <b>${percent(data.drawdown.fromPeak)}</b>` : 'managed peak unavailable';
      el('day-cmp').innerHTML = `yesterday <b>${money(yest.nav)}</b> · ${finite(ratio) ? `<b>${percent(ratio)}</b>` : '—'} · ${peak}`;
    } else {
      el('day-delta').innerHTML = na();
      el('day-cmp').textContent = history && history.length ? 'No reading from a day earlier yet.' : 'History has not loaded.';
    }
    const concentration = data.allocation.sAVAX;
    el('treasury-lede').textContent = concentration.overCap
      ? 'sAVAX is above its 15% cap. Weights use total holdings; drawdown uses managed NAV.'
      : 'Weights, caps and tiers use total holdings. Drawdown alarms use managed NAV, excluding open prediction-market positions.';
    updated('treasury-updated', data.updatedAt);
    const venues = data.venues;
    const avalancheNames = data.positions.filter((row) => row.venue === 'Avalanche').map((row) => row.asset).join(', ') || 'no holdings';
    el('venues-content').innerHTML = `<ul class="jk-rows rows-venues wrap" aria-label="Capital by venue">${[
      `<li><span>Avalanche<small class="sub">C-Chain · ${escape(avalancheNames)} · ${stamp(venues.avalanche.updatedAt)}</small></span><span class="r">${money(venues.avalanche.valueUsd)}</span></li>`,
      `<li><span>Hyperliquid<small class="sub">Margin equity + spot · ${venues.hyperliquid.assetPositions.length} open positions · ${stamp(venues.hyperliquid.updatedAt)}</small></span><span class="r">${money(venues.hyperliquid.valueUsd)}</span></li>`,
      extraVenues(data),
    ].join('')}</ul>`;

    const ranked = [...data.positions].sort((a, b) => b.valueUsd - a.valueUsd);
    const top = ranked[0];
    const next = ranked[1];
    if (top) {
      el('book-label').textContent = `Largest line · ${top.asset}`;
      el('book-value').textContent = money(top.valueUsd);
      el('book-cmp').innerHTML = `<b>${escape(top.asset)}</b> on ${escape(top.venue)} · ${percent(top.weight)} of holdings${next ? ` · next <b>${escape(next.asset)}</b> ${money(next.valueUsd)}` : ''}`;
    }
    const priority = ['sAVAX', 'USDC', 'WAVAX', 'AVAX', 'USDt', 'BTC.b', 'WETH.e'];
    const positions = [...data.positions].sort((a, b) => (priority.indexOf(a.asset) < 0 ? 99 : priority.indexOf(a.asset)) - (priority.indexOf(b.asset) < 0 ? 99 : priority.indexOf(b.asset)) || b.valueUsd - a.valueUsd);
    const open = venues.hyperliquid.assetPositions;
    el('holdings-content').innerHTML = `<table class="sheet"><caption class="sr-only">Treasury holdings across all venues, in USD.</caption><thead><tr><th scope="col">Asset</th><th scope="col">Balance</th><th scope="col">Value</th><th scope="col">Weight</th></tr></thead><tbody>${positions.map((row) => `<tr><th scope="row">${escape(row.asset)}<small class="sub">${escape(row.venue)}${row.inManagedNav === false ? ' · not in drawdown basis' : ''}</small></th><td class="num" data-label="Balance">${amount(row.balance, 6)}</td><td class="num" data-label="Value">${money(row.valueUsd)}</td><td class="num" data-label="Weight">${percent(row.weight)}</td></tr>`).join('')}</tbody></table>${open.length ? `<div class="jk-group"><h3 class="jk-lab">Open positions</h3><ul class="jk-rows rows-venues wrap">${open.map((row) => `<li><span>${escape(row.asset)}<small class="sub">${amount(row.balance)} · unrealized P&amp;L ${money(row.unrealizedPnl)} · included in margin equity</small></span><span class="r">${money(row.positionValue)}</span></li>`).join('')}</ul></div>` : ''}`;
    el('holdings-note').textContent = data.note || '';
    updated('holdings-updated', data.updatedAt);

    el('savax-value').textContent = percent(concentration.weight);
    const trim = finite(concentration.trimmedAmount) ? `trimmed <b>${amount(concentration.trimmedAmount)} sAVAX</b>` : 'trim progress unavailable';
    el('savax-cmp').innerHTML = concentration.overCap
      ? `over the <b>15%</b> cap by ${money(concentration.excessUsd)} · about ${amount(concentration.trimAmount)} sAVAX would reach the cap at current marks · ${trim}`
      : `within the <b>15%</b> cap · ${trim}`;
    el('savax-gauge').innerHTML = gauge({
      label: `sAVAX weight ${percent(concentration.weight)}, cap 15 percent`,
      width: Math.min(100, Math.max(0, concentration.weight * 100)),
      tick: 15,
      past: concentration.overCap,
      scale: ['0%', '15% cap', '100%'],
    });
    const external = data.allocation.external;
    if (external && finite(external.weight)) {
      el('external-value').textContent = percent(external.weight);
      el('external-cmp').innerHTML = external.venues.length
        ? external.venues.map((row) => `${escape(row.venue)} <b>${percent(row.weight)}</b>`).join(' · ')
        : 'No venue is outside the mandate.';
    } else {
      el('external-value').innerHTML = na();
    }
    const satellites = data.allocation.satellites;
    const notes = [];
    if (data.allocation.tiers) notes.push(`Tier sizes on total holdings ${money(data.allocation.basis?.valueUsd)}: T1 ${money(data.allocation.tiers.t1Usd)} · T2 ${money(data.allocation.tiers.t2Usd)}.${data.allocation.tiers.note ? ` ${escape(data.allocation.tiers.note)}` : ''}`);
    if (satellites) notes.push(`Satellites: ${percent(satellites.weight)} / 40% combined cap${satellites.overCap ? ' · over cap' : ''}. ${satellites.assets.length ? satellites.assets.map((row) => `${escape(row.asset)} ${percent(row.weight)} / 10%${row.overCap ? ' · over cap' : ''}`).join('; ') : 'No satellite holdings.'}`);
    if (external) notes.push('Outside venues are counted in total holdings and weights, not traded by the treasury run, and not satellites. Open prediction-market positions are excluded from the drawdown basis. Prediction-market cash stays in.');
    el('allocation-content').innerHTML = notes.map((note) => `<p class="jk-note">${note}</p>`).join('');
    el('trim-content').innerHTML = `<b>Trim progress</b> · ${amount(concentration.trimmedAmount)} sAVAX completed · current weight ${percent(concentration.weight)} / 15% target.`;
    const gas = `Gas spent: ${amount(data.gasAvax, 9)} AVAX`;
    el('gas-content').textContent = data.execution.escalated ? `${gas} · Peak drawdown threshold reached; escalation required.` : gas;
  }

  function gauge({ label, width, tick, past, scale }) {
    const fill = past ? 'none' : 'url(#jk-warm)';
    const stroke = past ? 'var(--jk-fail)' : 'none';
    const dash = past ? '3 2' : '';
    return `<div class="gauge"><svg viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label="${escape(label)}"><rect x="0" y="4" width="100" height="6" rx="3" fill="var(--jk-hair)"></rect><rect x="0" y="3" width="${width.toFixed(2)}" height="8" rx="4" fill="${fill}" stroke="${stroke}" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"></rect><line x1="${tick}" x2="${tick}" y1="0" y2="14" stroke="var(--jk-ink)" stroke-width="1.25" vector-effect="non-scaling-stroke"></line></svg><div class="gauge-scale">${scale.map((item) => `<span>${escape(item)}</span>`).join('')}</div></div>`;
  }

  function renderDecisions(data) {
    if (!data || !Array.isArray(data.decisions)) return;
    const rows = [...data.decisions].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const latest = rows[0];
    if (!latest) {
      for (const id of ['latest-content', 'decisions-content', 'execution-content']) el(id).innerHTML = empty('No published decisions');
      el('decisions-value').innerHTML = na();
      return;
    }
    const executed = rows.filter((row) => row.outcome === 'execute');
    el('decisions-value').textContent = String(rows.length);
    el('decisions-cmp').innerHTML = `latest <b>${escape(OUTCOMES[latest.outcome]?.[0] || latest.outcome)}</b> · ${time(latest.date)} · <b>${executed.length}</b> executed in this record`;
    const sizeLine = latest.received
      ? `${amount(latest.size.amount)} ${escape(latest.size.asset)} → ${amount(latest.received.amount)} ${escape(latest.received.asset)}${finite(latest.size.usd) ? ` · ${money(latest.size.usd)}` : ''}`
      : `${escape(latest.action)} · ${amount(latest.size.amount)} ${escape(latest.size.asset)}${finite(latest.size.usd) ? ` · ${money(latest.size.usd)}` : ''}`;
    el('latest-content').innerHTML = `<div class="jk-lab" id="latest-label">Latest decision</div><div class="jk-mid">${outcomeMark(latest.outcome)}</div><p class="jk-cmp"><b>${escape(latest.title)}</b></p><p class="jk-note">${escape(latest.reason)}</p><p class="jk-cmp">${sizeLine}</p><div class="receipts">${(latest.txs ?? []).map((tx) => receipt(tx)).join('')}</div><p class="jk-note">${time(latest.date)}</p><p class="jk-cmp"><a class="jk-a" href="#decisions">Decision feed</a></p>`;
    const execution = executed[0];
    el('execution-content').innerHTML = execution ? `<article class="tx"><div class="spread"><h3><span class="outcome ok">Executed</span> ${escape(execution.title)}</h3><span class="quiet">${time(execution.date)}</span></div><p>${amount(execution.size.amount)} ${escape(execution.asset)}${finite(execution.size.usd) ? ` · ${money(execution.size.usd)}` : ''}${execution.received ? ` → ${amount(execution.received.amount)} ${escape(execution.received.asset)}` : ''}</p><p>${escape(execution.reason)}</p></article><div>${(execution.txs ?? []).map((tx, index) => `<article class="tx"><div class="spread"><h3>${String(index + 1).padStart(2, '0')} <span class="quiet">/ ${escape(tx.label)}</span></h3>${receipt(tx)}</div><p>Block ${amount(tx.block, 0)} · gas ${amount(tx.gasUsed, 0)} · ${amount(tx.gasAvax, 9)} AVAX</p></article>`).join('')}</div>` : empty('No published executions');
    el('decisions-content').innerHTML = rows.map((row) => `<article><div class="spread">${outcomeMark(row.outcome)}<span class="quiet">${time(row.date)}</span></div><h3>${escape(row.title)}</h3><p>${escape(row.reason)}</p><p>${escape(row.action)} · ${amount(row.size.amount)} ${escape(row.size.asset)}${finite(row.size.usd) ? ` · ${money(row.size.usd)}` : ''}${row.received ? ` → ${amount(row.received.amount)} ${escape(row.received.asset)}` : ''}</p><div class="receipts">${(row.txs ?? []).map((tx) => receipt(tx)).join('')}</div></article>`).join('');
    updated('decisions-updated', data.updatedAt);
    updated('execution-updated', execution?.date);
  }

  function validHistory(data) {
    if (!Array.isArray(data)) return null;
    return data.filter((row) => row && finite(row.nav) && row.nav >= 0 && Number.isFinite(Date.parse(row.t)) && Date.parse(row.t) <= Date.now()).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  }

  let chartWidth = 0;
  let chartAnimated = false;
  let chartObserver = null;
  function renderChart(history, days) {
    const plot = el('history-plot');
    const box = el('history-chart');
    updated('history-updated', history?.at(-1)?.t);
    if (!history) { plot.innerHTML = empty(); box._points = []; return; }
    const rows = history.filter((row) => Date.parse(row.t) >= Date.now() - days * DAY);
    box._points = rows;
    if (rows.length < 2) {
      plot.innerHTML = empty(history.length < 2 ? 'History starts 17 Oct 2026' : 'Insufficient history for this period');
      el('history-caption').textContent = 'NAV history';
      return;
    }
    const width = Math.round(plot.clientWidth);
    if (width < 40) return;
    chartWidth = width;
    const low = Math.min(...rows.map((row) => row.nav));
    const high = Math.max(...rows.map((row) => row.nav));
    const span = high - low || Math.max(1, high * 0.02);
    const y0 = low - span * 0.12;
    const y1 = high + span * 0.12;
    const height = Math.round(Math.max(160, Math.min(window.innerHeight * 0.27, width * 0.24, 300)));
    const padBottom = 28;
    const padTop = 14;
    const padRight = 56;
    const xOf = (index) => index / (rows.length - 1) * (width - padRight);
    const yOf = (value) => padTop + (height - padTop - padBottom) * (1 - (value - y0) / (y1 - y0));
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': `${days}-day treasury NAV, ${money(low)} to ${money(high)}, ${rows.length} readings` });
    const defs = svgEl('defs', {});
    const gradient = svgEl('linearGradient', { id: 'jk-nav-line', x1: '0', y1: '0', x2: '1', y2: '0' });
    gradient.append(svgEl('stop', { offset: '0', 'stop-color': 'var(--jk-c-yellow)' }), svgEl('stop', { offset: '1', 'stop-color': 'var(--jk-c-orange)' }));
    defs.append(gradient);
    svg.append(defs);
    [low, (low + high) / 2, high].forEach((value) => {
      const y = yOf(value);
      svg.append(svgEl('line', { x1: '0', x2: String(width - padRight), y1: y.toFixed(1), y2: y.toFixed(1), stroke: 'var(--jk-hair)' }));
      const label = svgEl('text', { x: String(width - padRight + 8), y: String(y + 4), 'font-size': '12', fill: 'var(--jk-t2)' });
      label.textContent = `$${Math.round(value).toLocaleString('en-US')}`;
      svg.append(label);
    });
    const path = svgEl('path', {
      d: rows.map((row, index) => `${index ? 'L' : 'M'}${xOf(index).toFixed(1)} ${yOf(row.nav).toFixed(1)}`).join(' '),
      fill: 'none', stroke: 'url(#jk-nav-line)', 'stroke-width': '3.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'nav-line',
    });
    svg.append(path);
    const last = rows.at(-1);
    svg.append(svgEl('circle', { cx: xOf(rows.length - 1).toFixed(1), cy: yOf(last.nav).toFixed(1), r: '5', fill: 'var(--jk-c-orange)', stroke: 'var(--jk-bg)', 'stroke-width': '2' }));
    const marks = width < 520 ? [0, rows.length - 1] : [0, Math.round((rows.length - 1) / 2), rows.length - 1];
    marks.forEach((index, nth) => {
      const label = svgEl('text', { x: Math.max(8, Math.min(width - padRight - 8, xOf(index))).toFixed(1), y: String(height - 8), 'text-anchor': nth === 0 ? 'start' : nth === marks.length - 1 ? 'end' : 'middle', 'font-size': '12', fill: 'var(--jk-t2)' });
      label.textContent = axisDay.format(new Date(rows[index].t));
      svg.append(label);
    });
    plot.replaceChildren(svg);
    const covered = (Date.parse(rows.at(-1).t) - Date.parse(rows[0].t)) / DAY;
    el('history-caption').textContent = `NAV, ${days}-day window · ${money(low)} to ${money(high)} · ${covered < days - 0.5 ? `${Math.max(1, Math.round(covered))} days on record, from ${axisDayYear.format(new Date(history[0].t))}` : `${rows.length} readings`} · the dot is the latest reading`;
    armChartDraw(path, box);
    bindScrub(box);
  }
  function armChartDraw(path, box) {
    if (chartObserver) chartObserver.disconnect();
    if (reduced() || chartAnimated) return;
    const length = path.getTotalLength();
    if (!length) return;
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    const go = () => {
      chartAnimated = true;
      path.style.transition = 'stroke-dashoffset var(--jk-d-draw) var(--jk-ease)';
      path.style.strokeDashoffset = '0';
    };
    if (!('IntersectionObserver' in window)) { go(); return; }
    chartObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { go(); chartObserver.disconnect(); }
    }, { threshold: 0.3 });
    chartObserver.observe(box);
  }
  function bindScrub(box) {
    if (box._scrub) return;
    box._scrub = true;
    box.classList.add('jk-tipwrap');
    const tip = document.createElement('div');
    tip.className = 'jk-tip jk-glass';
    tip.setAttribute('role', 'tooltip');
    const hair = document.createElement('div');
    hair.className = 'jk-hair';
    box.append(tip, hair);
    const hide = () => { tip.classList.remove('on'); hair.classList.remove('on'); };
    const move = (event) => {
      const points = box._points || [];
      if (!points.length) return hide();
      const rect = box.getBoundingClientRect();
      const index = Math.max(0, Math.min(points.length - 1, Math.floor((event.clientX - rect.left) / rect.width * points.length)));
      const row = points[index];
      tip.replaceChildren();
      const when = document.createElement('div');
      when.className = 'd';
      when.textContent = stamp(row.t);
      const value = document.createElement('b');
      value.textContent = money(row.nav);
      tip.append(when, value);
      if (finite(row.managed)) {
        const extra = document.createElement('div');
        extra.className = 'd';
        extra.textContent = `Managed ${money(row.managed)}`;
        tip.append(extra);
      }
      tip.classList.add('on');
      hair.classList.add('on');
      const x = (index + 0.5) / points.length * rect.width;
      hair.style.transform = `translateX(${x}px)`;
      const tipWidth = tip.offsetWidth;
      tip.style.transform = `translate(${Math.max(0, Math.min(rect.width - tipWidth, x - tipWidth / 2))}px, 8px)`;
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerleave', hide);
  }

  function renderRisk(history, treasury) {
    if (!treasury || !finite(treasury.nav) || !treasury.drawdown) return;
    const risk = treasury.drawdown;
    const managed = risk.basis === 'managed';
    const sevenDay = finite(risk.sevenDay) ? risk.sevenDay : null;
    const fromPeak = finite(risk.fromPeak) ? risk.fromPeak : null;
    const basis = managed ? `<p class="jk-note risk-basis">Drawdown uses managed NAV ${money(risk.managedNav)}: the full treasury excluding open prediction-market positions (prediction-market cash stays in). Managed peak ${money(risk.peakNav)}; tracking started 18 Oct 2026.</p>` : '';
    const row = (label, value, max, threshold, thresholdText, end, past) => {
      const reading = finite(value) ? percent(value) : 'insufficient history';
      const state = !finite(value) ? 'No reading yet' : past ? `Past the ${thresholdText}` : `Within the ${thresholdText}`;
      const width = finite(value) ? Math.min(100, Math.max(0, -value * 100 / max * 100)) : 0;
      return `<div class="gauge"><div class="spread"><span>${label}</span><strong>${finite(value) ? percent(value) : na()}</strong></div><svg viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label="${escape(label)}: ${escape(reading)}; ${escape(state)}"><rect x="0" y="4" width="100" height="6" rx="3" fill="var(--jk-hair)"></rect><rect x="0" y="3" width="${width.toFixed(2)}" height="8" rx="4" fill="${past ? 'none' : 'url(#jk-warm)'}" stroke="${past ? 'var(--jk-fail)' : 'none'}" stroke-dasharray="${past ? '3 2' : ''}" vector-effect="non-scaling-stroke"></rect><line x1="${(Math.abs(threshold) / max * 100).toFixed(2)}" x2="${(Math.abs(threshold) / max * 100).toFixed(2)}" y1="0" y2="14" stroke="var(--jk-ink)" stroke-width="1.25" vector-effect="non-scaling-stroke"></line></svg><div class="gauge-scale"><span>0%</span><span>${escape(thresholdText)}</span><span>${escape(end)}</span></div><p class="jk-note">${escape(state)}</p></div>`;
    };
    el('risk-content').innerHTML = basis + row('7-day drawdown', sevenDay, 25, -10, '−10% pause line', '−25%', finite(sevenDay) && sevenDay <= -0.10) + row('From peak', fromPeak, 30, -25, '−25% escalate line', '−30%', finite(fromPeak) && fromPeak <= -0.25);
    updated('risk-updated', history?.at(-1)?.t ?? treasury.updatedAt);
  }

  function renderSignals(data, priceData) {
    if (!data || !Array.isArray(data.rows)) return;
    const rows = [...data.rows];
    if (!rows.some((row) => row.token === 'sAVAX')) rows.splice(1, 0, { token: 'sAVAX', modeledValue: null, buyLevel: null, marginOfSafety: null, gatePass: null, note: 'Not modeled' });
    const order = ['AVAX', 'sAVAX', 'PHAR', 'p33', 'NEAR', 'ZEC', 'VVV', 'AAVE', 'HYPE'];
    rows.sort((a, b) => (order.indexOf(a.token) < 0 ? 99 : order.indexOf(a.token)) - (order.indexOf(b.token) < 0 ? 99 : order.indexOf(b.token)));
    const passing = data.rows.filter((row) => row.gatePass === true).length;
    el('signals-value').textContent = `${passing}/${data.rows.length}`;
    el('signals-summary').textContent = 'Watchlist';
    el('signals-cmp').innerHTML = `<b>${passing}</b> of ${data.rows.length} gates pass · quotes ${priceData ? time(priceData.updatedAt) : 'unavailable'}`;
    const gate = (row) => row.gatePass === true
      ? `<span class="outcome ok" title="${escape(row.note)}">Pass</span>`
      : row.gatePass === false
        ? `<span class="outcome bad" title="${escape(row.note)}">${row.buyLevel === null ? 'Fail · no model' : 'Fail'}</span>`
        : `<span class="outcome neutral" title="${escape(row.note)}">Not modeled</span>`;
    el('signals-content').innerHTML = rows.map((row) => {
      const quote = priceData?.prices?.[row.token];
      return `<article class="sig"><header><span class="name">${escape(row.token)}</span>${gate(row)}</header><dl><div><dt>Price</dt><dd>${money(quote?.priceUsd)}${quote ? `<small class="sub">${stamp(quote.updatedAt)}</small>` : ''}</dd></div><div><dt>Modeled</dt><dd>${row.modeledValue === null ? '—' : money(row.modeledValue)}</dd></div><div><dt>Buy level</dt><dd>${row.buyLevel === null ? '—' : money(row.buyLevel)}</dd></div><div><dt>Margin of safety</dt><dd class="${row.marginOfSafety > 0 ? 'pos' : ''}">${percent(row.marginOfSafety)}</dd></div></dl></article>`;
    }).join('');
    updated('signals-updated', data.updatedAt);
    el('signals-updated').insertAdjacentHTML('beforeend', `<br>Quotes: ${priceData ? time(priceData.updatedAt) : 'unavailable'}. Each price shows its own timestamp.`);
  }

  const romeDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? `<time datetime="${escape(value)}">${escape(dayLabel.format(new Date(`${value}T00:00:00Z`)))}</time>` : '—';
  function renderForecasts(data) {
    if (!data || !Array.isArray(data.rows)) return;
    const today = romeDay.format(new Date());
    const pct = (value) => `${Math.round(value * 100)}%`;
    const rows = data.rows.filter((row) => Array.isArray(row.band) && finite(row.band[0]) && finite(row.band[1]));
    const stale = rows.filter((row) => row.staleAfter && today > row.staleAfter).length;
    el('forecasts-value').textContent = String(rows.length);
    el('forecasts-summary').textContent = data.source || 'Forecast book';
    el('forecasts-cmp').innerHTML = `as of <b>${day(data.asOf)}</b> · <b>${stale}</b> past review · ${escape(data.source || 'forecast book')}`;
    el('forecasts-content').innerHTML = rows.length ? `<ul class="jk-rows rows-forecast wrap" aria-label="Forecast probability bands">${rows.map((row) => {
      const [lo, hi] = row.band.map((value) => Math.min(1, Math.max(0, value)));
      const isStale = row.staleAfter && today > row.staleAfter;
      const linked = typeof row.treasuryLink === 'string' && row.treasuryLink;
      const width = Math.max(0.8, (hi - lo) * 100);
      return `<li><span class="t">${day(row.horizon)}</span><span>${escape(row.title)}<small class="sub">${escape(row.market)} · ${escape(row.confidence)} confidence${row.lastReviewed ? ` · reviewed ${dayLabel.format(new Date(`${row.lastReviewed}T00:00:00Z`))}` : ''}${isStale ? ' · stale' : ''}</small>${linked ? `<small class="sub"><span class="outcome neutral">Treasury</span> ${escape(row.treasuryLink)}</small>` : ''}</span><span class="r">${pct(lo)}–${pct(hi)}${isStale ? '<small class="sub"><span class="outcome warn">Stale</span></small>' : ''}</span><span class="jk-opt band"><svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="Probability band ${pct(lo)} to ${pct(hi)}"><rect x="0" y="2" width="100" height="4" rx="2" fill="var(--jk-hair)"></rect><rect x="${(lo * 100).toFixed(2)}" y="1" width="${width.toFixed(2)}" height="6" rx="3" fill="${isStale ? 'none' : 'url(#jk-warm)'}" stroke="${isStale ? 'var(--jk-c-orange)' : 'none'}" stroke-dasharray="${isStale ? '2 1.5' : ''}"></rect></svg></span></li>`;
    }).join('')}</ul>` : empty('No active forecasts');
    el('forecasts-updated').innerHTML = `As of: ${day(data.asOf)} <span class="quiet">/ bands are probabilities of Yes</span>`;
  }

  function renderAudits(data) {
    if (!data || !Array.isArray(data.rows)) return;
    el('audit-content').innerHTML = data.rows.map((row) => {
      const mark = row.isSafe === true ? '<span class="outcome ok">True</span>' : row.isSafe === false ? '<span class="outcome bad">False</span>' : '<span class="outcome neutral">Unavailable</span>';
      return `<article class="sig"><header><span class="name">${escape(row.token)}</span>${mark}</header><p class="jk-note">${escape(row.assessment)}</p><p class="jk-note">Audit created ${row.createdAt ? time(row.createdAt) : '—'}</p></article>`;
    }).join('');
    updated('audit-updated', data.updatedAt);
  }

  function renderSources(data) {
    if (!data || !data.sources) return;
    const labels = { avalanche_rpc: 'Avalanche RPC', hyperliquid: 'Hyperliquid', polymarket: 'Polymarket', avantis: 'Avantis', yo: 'YO', evm_wallets: 'Other chains RPC', coingecko: 'CoinGecko', serialized_audit: 'Serialized Audit', decisions: 'Decisions' };
    const keys = [...Object.keys(labels), ...Object.keys(data.sources).filter((key) => !labels[key])];
    const fresh = keys.filter((key) => data.sources[key]?.status === 'ok').length;
    el('sources-value').textContent = `${fresh}/${keys.length}`;
    el('sources-cmp').innerHTML = `last refresh ${data.generatedAt ? time(data.generatedAt) : 'unavailable'} · Europe/Rome`;
    el('sources-content').innerHTML = keys.map((key) => {
      const row = data.sources[key];
      const label = labels[key] || key.replaceAll('_', ' ');
      return `<article class="sig"><header><span class="name">${escape(label)}</span>${outcomeMark(row?.status ?? 'error')}</header><p class="jk-note">${escape(row?.note ?? 'Unavailable')}</p><p class="jk-note">${row?.updatedAt ? `Updated ${time(row.updatedAt)}` : 'No snapshot'}${row?.lastSuccessAt ? ` · last success ${time(row.lastSuccessAt)}` : ''}</p></article>`;
    }).join('');
    updated('sources-updated', data.generatedAt);
  }

  function revealDock(button) {
    const scroller = button.closest('.dock-scroll');
    if (!scroller) return;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    const view = scroller.scrollLeft;
    if (left >= view && right <= view + scroller.clientWidth) return;
    scroller.scrollTo({ left: Math.max(0, left - (scroller.clientWidth - button.offsetWidth) / 2), behavior: reduced() ? 'auto' : 'smooth' });
  }

  async function main() {
    const [treasury, prices, historyData, sources, decisions, valuation, audits, forecasts] = await Promise.all(['treasury', 'prices', 'nav-history', 'sources', 'decisions', 'valuation', 'audits', 'forecasts'].map(load));
    const history = validHistory(historyData);
    let days = 7;
    safeRender(['nav-title', 'venues-content', 'holdings-content', 'allocation-content', 'trim-content', 'savax-value'], () => renderTreasury(treasury, history));
    safeRender(['latest-content', 'decisions-content', 'execution-content', 'decisions-value'], () => renderDecisions(decisions));
    safeRender(['history-plot'], () => renderChart(history, days));
    safeRender(['risk-content'], () => renderRisk(history, treasury));
    safeRender(['signals-content', 'signals-value'], () => renderSignals(valuation, prices));
    safeRender(['forecasts-content', 'forecasts-value'], () => renderForecasts(forecasts));
    safeRender(['audit-content'], () => renderAudits(audits));
    safeRender(['sources-content', 'sources-value'], () => renderSources(sources));
    const period = el('history-period');
    if (window.JaackPill && period) {
      JaackPill.init(period, (value) => {
        days = Number(value);
        chartAnimated = true;
        safeRender(['history-plot'], () => renderChart(history, days));
      });
    }
    const nav = el('chapter-nav');
    const chapterIds = ['treasury', 'holdings', 'rules', 'signals', 'forecasts', 'decisions', 'sources'];
    if (window.JaackPill && nav) {
      const pill = JaackPill.init(nav, (value) => {
        const section = el(value);
        if (section) section.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      });
      let ticking = false;
      const spy = () => {
        ticking = false;
        let current = chapterIds[0];
        for (const id of chapterIds) {
          const section = el(id);
          if (section && section.getBoundingClientRect().top < window.innerHeight * 0.34) current = id;
        }
        if (current === nav.dataset.current) return;
        nav.dataset.current = current;
        pill.set(current);
        const button = nav.querySelector(`button[data-v="${current}"]`);
        if (button) revealDock(button);
      };
      addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
      spy();
    }
    const redraw = () => {
      const plot = el('history-plot');
      if (!plot || Math.abs(plot.clientWidth - chartWidth) < 2) return;
      chartAnimated = true;
      safeRender(['history-plot'], () => renderChart(history, days));
    };
    if ('ResizeObserver' in window) new ResizeObserver(redraw).observe(el('history-plot'));
    addEventListener('resize', redraw);
    document.documentElement.dataset.ready = 'true';
  }
  main();
})();
