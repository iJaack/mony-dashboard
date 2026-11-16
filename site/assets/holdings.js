// Mony's USD/English adapter. Rendering and number motion stay in JaackFigure.
(() => {
  'use strict';
  const DAY = 86_400_000;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const key = ({ asset, venue }) => `${encodeURIComponent(asset)}@${encodeURIComponent(venue)}`;
  const money = (value) => finite(value) ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2 }) : 'Unavailable';
  const percent = (value) => `${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const pair = (value) => Array.isArray(value) && value.length === 2 && value.every(finite) && value[0] <= value[1];

  function figureData(row, history, now = Date.now()) {
    const cutoff = Math.floor(now / DAY) * DAY - 29 * DAY;
    const records = history?.positions?.[key(row)];
    const days = new Map();
    if (Array.isArray(records)) {
      const valid = records.filter((point) => point && finite(point.valueUsd) && Number.isFinite(Date.parse(point.t)) && Date.parse(point.t) >= cutoff && Date.parse(point.t) <= now);
      for (const point of valid.sort((a, b) => Date.parse(a.t) - Date.parse(b.t))) days.set(Math.floor(Date.parse(point.t) / DAY), point.valueUsd);
    }
    const dates = [...days.keys()];
    const firstDay = dates[0], lastDay = dates.at(-1);
    // Only internal missing days become nulls. No pre-birth padding or interpolation.
    const series = dates.length ? Array.from({ length: lastDay - firstDay + 1 }, (_, index) => days.get(firstDay + index) ?? null) : [];
    const points = series.filter(finite);
    const band = pair(row.targetBand) ? [...row.targetBand] : null;
    const bounds = points.concat(band ?? []);
    const scale = points.length ? [Math.min(...bounds), Math.max(...bounds)] : null;
    const change = points.length >= 2 && points[0] !== 0 ? (points.at(-1) - points[0]) / Math.abs(points[0]) * 100 : null;
    const delta = finite(change) ? Math.round(change * 10) / 10 || 0 : null;
    const window = `last ${series.length} ${series.length === 1 ? 'day' : 'days'} (UTC)`;
    let alt = finite(row.valueUsd) ? '' : 'Value unavailable; ';
    if (!points.length) alt += 'History unavailable';
    else {
      const difference = points.at(-1) - points[0];
      const stable = finite(change) ? Math.abs(change) <= 0.5 : difference === 0;
      const trend = points.length === 1 ? 'Trend unavailable' : stable ? 'Stable' : difference > 0 ? 'Rising' : 'Falling';
      alt += `${trend}${!stable && finite(change) ? ` by ${percent(change).replace('%', ' percent')}` : ''}, minimum ${money(Math.min(...points))}, maximum ${money(Math.max(...points))}, ${window}`;
      if (points.length === 1) alt += '; one reading';
      const gaps = series.length - points.length;
      if (gaps) alt += `; ${gaps} ${gaps === 1 ? 'day' : 'days'} missing`;
    }
    if (band) alt += `; target band ${money(band[0])} to ${money(band[1])}`;
    return { label: row.asset, value: finite(row.valueUsd) ? row.valueUsd : null, formatter: money, delta, series, scale, band, window, mode: 'mony', threshold: 0.5, reserveChars: 10, state: 'ready', alt };
  }

  const rows = new Map();
  function render(positions, history, now) {
    const group = document.getElementById('holdings-figures');
    if (!group) return;
    document.getElementById('holdings-loading')?.remove();
    group.setAttribute('aria-busy', 'false');
    const active = new Set();
    for (const row of positions) {
      const id = key(row);
      active.add(id);
      let entry = rows.get(id);
      const data = figureData(row, history, now);
      if (!entry) {
        const node = document.createElement('li');
        group.appendChild(node);
        entry = { node, figure: window.JaackFigure.init(node, data) };
        rows.set(id, entry);
      } else entry.figure.update(data);
      // The vendor's default captions/delta use it-IT; localize after every update.
      entry.node.querySelector('.jk-figure-alt').textContent = data.alt;
      const delta = entry.node.querySelector('.jk-figure-delta');
      if (finite(data.delta)) delta.textContent = `${data.delta < 0 ? '−' : data.delta > 0 ? '+' : ''}${percent(data.delta)}`;
      if (data.value === null) {
        const number = entry.node.querySelector('.jk-figure-number');
        if (!entry.unavailableObserver) {
          entry.unavailableObserver = new MutationObserver(() => {
            if (number.textContent === 'Non disponibile') number.textContent = 'Unavailable';
          });
          entry.unavailableObserver.observe(number, { childList: true, characterData: true, subtree: true });
        }
        number.textContent = 'Unavailable';
      } else {
        entry.unavailableObserver?.disconnect();
        entry.unavailableObserver = null;
      }
      const label = entry.node.querySelector('.jk-figure-label');
      const venue = document.createElement('small');
      venue.className = 'sub';
      venue.textContent = `${row.venue}${row.inManagedNav === false ? ' · not in drawdown basis' : ''}`;
      const details = document.createElement('small');
      details.className = 'sub';
      const balance = finite(row.balance) ? row.balance.toLocaleString('en-GB', { maximumFractionDigits: 6 }) : 'Unavailable';
      const weight = finite(row.weight) ? `${row.weight < 0 ? '−' : ''}${percent(row.weight * 100)}` : 'Unavailable';
      details.textContent = `Balance ${balance} · Weight ${weight}`;
      label.append(venue, details);
      // Appending an existing node preserves the vendor instance and active count.
      group.appendChild(entry.node);
    }
    for (const [id, entry] of rows) if (!active.has(id)) {
      entry.figure.destroy();
      entry.unavailableObserver?.disconnect();
      entry.node.remove();
      rows.delete(id);
    }
  }
  window.MonyHoldings = { figureData, render, key };
})();
