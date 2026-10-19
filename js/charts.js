/* BurnLog — chart aggregation + Chart.js rendering */
(function (root) {
  'use strict';
  const C = root.BLCalc;
  const COLORS = ['#ff5a1f', '#22d3ee', '#a3e635', '#ffb020', '#a78bfa', '#f472b6', '#34d399', '#60a5fa', '#fb7185', '#facc15', '#2dd4bf', '#c084fc'];
  let chart = null;

  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function startOfWeek(d) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; } // Monday
  function bucketKey(dateStr, group) {
    const d = parseYmd(dateStr);
    if (group === 'week') return ymd(startOfWeek(d));
    if (group === 'month') return dateStr.slice(0, 7);
    return dateStr;
  }
  function rangeStart(range, entries) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const n = { '7d': 6, '30d': 29, '90d': 89, '1y': 364 }[range];
    if (n != null) { t.setDate(t.getDate() - n); return t; }
    if (!entries.length) return t;
    return parseYmd(entries.reduce((m, e) => e.date < m ? e.date : m, entries[0].date));
  }
  function inRange(entries, range) {
    const s = ymd(rangeStart(range, entries)), today = ymd(new Date());
    return entries.filter(e => e.date >= s && e.date <= today);
  }
  function buckets(range, group, entries) {
    const start = rangeStart(range, entries), end = new Date(); end.setHours(0, 0, 0, 0);
    const keys = []; const d = new Date(start);
    if (group === 'week') { let w = startOfWeek(d); while (w <= end) { keys.push(ymd(w)); w.setDate(w.getDate() + 7); } }
    else if (group === 'month') { let m = new Date(d.getFullYear(), d.getMonth(), 1); while (m <= end) { keys.push(ymd(m).slice(0, 7)); m.setMonth(m.getMonth() + 1); } }
    else { while (d <= end) { keys.push(ymd(d)); d.setDate(d.getDate() + 1); } }
    return keys;
  }
  function label(key, group) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (group === 'month') { const [y, m] = key.split('-'); return MON[+m - 1] + ' ’' + y.slice(2); }
    const d = parseYmd(key); return MON[d.getMonth()] + ' ' + d.getDate();
  }

  function streaks(entries) {
    const days = new Set(entries.map(e => e.date));
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let cur = 0; const d = new Date(t);
    if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);           // streak survives until end of today
    while (days.has(ymd(d))) { cur++; d.setDate(d.getDate() - 1); }
    const sorted = [...days].sort(); let best = 0, run = 0, prev = null;
    sorted.forEach(s => { const x = parseYmd(s); if (prev && (x - prev) / 864e5 === 1) run++; else run = 1; best = Math.max(best, run); prev = x; });
    return { current: cur, best };
  }

  function totals(entries) {
    const runs = entries.filter(C.isRun);
    const allDist = entries.reduce((s, e) => s + (e.distanceKm || 0), 0);
    const runDist = runs.reduce((s, e) => s + e.distanceKm, 0);
    const kcal = entries.reduce((s, e) => s + (e.kcal || 0), 0);
    const minutes = entries.reduce((s, e) => s + (e.durationMin || 0), 0);
    const eligible = runs.filter(e => e.distanceKm >= 1.6 && e.durationMin > 0);   // best pace: runs ≥ 1 mi
    const best = eligible.reduce((b, e) => (!b || e.durationMin / e.distanceKm < b.durationMin / b.distanceKm) ? e : b, null);
    const longest = runs.reduce((b, e) => (!b || e.distanceKm > b.distanceKm) ? e : b, null);
    const days = new Set(entries.map(e => e.date)).size;
    return { workouts: entries.length, days, kcal, minutes, allDist, runDist, runs: runs.length, best, longest, streak: streaks(entries) };
  }

  function baseOpts(extra) {
    const grid = 'rgba(255,255,255,.06)', tick = '#8b94a8';
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, transitions: { resize: { animation: { duration: 0 } } },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false, labels: { color: '#cbd2df', boxWidth: 12, usePointStyle: true } },
        tooltip: { backgroundColor: '#0f1218', borderColor: '#2b3346', borderWidth: 1, titleColor: '#fff', bodyColor: '#d6dbe6', padding: 10, cornerRadius: 10 } },
      scales: {
        x: { grid: { color: 'transparent' }, ticks: { color: tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }, border: { color: grid } },
        y: { grid: { color: grid }, ticks: { color: tick }, border: { display: false }, beginAtZero: true },
      },
    }, extra || {});
  }
  function gradient(ctx, area, c1, c2) {
    if (!area) return c1;
    const g = ctx.createLinearGradient(0, area.bottom, 0, area.top); g.addColorStop(0, c2); g.addColorStop(1, c1); return g;
  }

  /** render(canvas, view, cfg) cfg: {entries, range, group, type, distUnit} -> {empty, title, summary} */
  function render(canvas, view, cfg) {
    if (chart) { chart.destroy(); chart = null; }
    if (!root.Chart) return { empty: true, title: 'Charts unavailable', summary: '' };
    root.Chart.defaults.font.family = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    root.Chart.defaults.color = '#8b94a8';
    const ctx = canvas.getContext('2d');
    const all = cfg.entries, list = inRange(all, cfg.range);
    const dU = cfg.distUnit, toU = km => dU === 'mi' ? C.kmToMi(km) : km;
    let res = { empty: false, title: '', summary: '' };

    if (view === 'calories') {
      const keys = buckets(cfg.range, cfg.group, all);
      const sums = Object.fromEntries(keys.map(k => [k, 0]));
      list.forEach(e => { const k = bucketKey(e.date, cfg.group); if (k in sums) sums[k] += e.kcal || 0; });
      const data = keys.map(k => Math.round(sums[k]));
      const total = data.reduce((a, b) => a + b, 0);
      const line = cfg.type === 'line';
      chart = new root.Chart(ctx, { type: line ? 'line' : 'bar', data: { labels: keys.map(k => label(k, cfg.group)), datasets: [{
        label: 'kcal', data, borderColor: '#ff7a1a', borderWidth: line ? 2.5 : 0, tension: .35, fill: line, pointRadius: line && keys.length < 40 ? 3 : 0,
        backgroundColor: c => line ? gradient(c.chart.ctx, c.chart.chartArea, 'rgba(255,122,26,.45)', 'rgba(255,122,26,0)') : gradient(c.chart.ctx, c.chart.chartArea, '#ffb020', '#ff3d1f'),
        borderRadius: 6, maxBarThickness: 28 }] }, options: baseOpts() });
      const per = cfg.group === 'day' ? 'day' : cfg.group;
      res = { empty: total === 0, title: 'Calories per ' + per, summary: total.toLocaleString() + ' kcal · avg ' + Math.round(total / Math.max(keys.length, 1)).toLocaleString() + '/' + per };
    } else if (view === 'category') {
      const by = {};
      list.forEach(e => { by[e.cat || 'Other'] = (by[e.cat || 'Other'] || 0) + (e.kcal || 0); });
      const cats = Object.keys(by).sort((a, b) => by[b] - by[a]);
      const data = cats.map(c => Math.round(by[c]));
      chart = new root.Chart(ctx, { type: cfg.type === 'pie' ? 'pie' : 'doughnut', data: { labels: cats, datasets: [{ data, backgroundColor: cats.map((_, i) => COLORS[i % COLORS.length]), borderColor: '#151922', borderWidth: 3, hoverOffset: 8 }] },
        options: Object.assign(baseOpts(), { scales: {}, interaction: { mode: 'nearest', intersect: true }, cutout: cfg.type === 'pie' ? 0 : '62%',
          plugins: Object.assign(baseOpts().plugins, { legend: { display: true, position: 'bottom', labels: { color: '#cbd2df', boxWidth: 10, usePointStyle: true, padding: 12 } },
            tooltip: Object.assign(baseOpts().plugins.tooltip, { callbacks: { label: c => ` ${c.label}: ${c.raw.toLocaleString()} kcal (${Math.round(c.raw / data.reduce((a, b) => a + b, 0) * 100)}%)` } }) }) }) });
      res = { empty: !data.length, title: 'Calories by category', summary: cats.length + ' categories' };
    } else if (view === 'distance') {
      const keys = buckets(cfg.range, cfg.group, all);
      const sums = Object.fromEntries(keys.map(k => [k, 0]));
      const runs = list.filter(C.isRun);
      runs.forEach(e => { const k = bucketKey(e.date, cfg.group); if (k in sums) sums[k] += e.distanceKm; });
      const data = keys.map(k => +toU(sums[k]).toFixed(2));
      const total = data.reduce((a, b) => a + b, 0), line = cfg.type === 'line';
      chart = new root.Chart(ctx, { type: line ? 'line' : 'bar', data: { labels: keys.map(k => label(k, cfg.group)), datasets: [{
        label: dU, data, borderColor: '#22d3ee', borderWidth: line ? 2.5 : 0, tension: .35, fill: line, pointRadius: line && keys.length < 40 ? 3 : 0,
        backgroundColor: c => line ? gradient(c.chart.ctx, c.chart.chartArea, 'rgba(34,211,238,.4)', 'rgba(34,211,238,0)') : gradient(c.chart.ctx, c.chart.chartArea, '#67e8f9', '#0e7490'),
        borderRadius: 6, maxBarThickness: 28 }] },
        options: baseOpts({ plugins: Object.assign(baseOpts().plugins, { tooltip: Object.assign(baseOpts().plugins.tooltip, { callbacks: { label: c => ` ${c.raw} ${dU}` } }) }) }) });
      res = { empty: !runs.length, title: 'Running distance', summary: total.toFixed(1) + ' ' + dU + ' · ' + runs.length + ' runs' };
    } else if (view === 'pace') {
      const runs = list.filter(e => C.isRun(e) && e.durationMin > 0).sort((a, b) => (a.ts || a.date) < (b.ts || b.date) ? -1 : 1);
      const pace = runs.map(e => +(e.durationMin / toU(e.distanceKm)).toFixed(3));
      const avg = pace.map((_, i) => { const s = pace.slice(Math.max(0, i - 4), i + 1); return +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3); });
      const fmt = v => C.fmtPace(v) + '/' + dU;
      const scatter = cfg.type === 'scatter';
      chart = new root.Chart(ctx, { type: 'line', data: { labels: runs.map(e => label(e.date, 'day')), datasets: [
        { label: 'Pace', data: pace, borderColor: '#a3e635', backgroundColor: '#a3e635', borderWidth: scatter ? 0 : 2, showLine: !scatter, pointRadius: scatter ? 4 : (runs.length < 40 ? 3 : 1.5), tension: .25 },
        { label: '5-run avg', data: avg, borderColor: 'rgba(255,176,32,.9)', borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: .35 } ] },
        options: baseOpts({ scales: { x: baseOpts().scales.x, y: Object.assign({}, baseOpts().scales.y, { beginAtZero: false, reverse: true, ticks: { color: '#8b94a8', callback: v => C.fmtPace(v) } }) },
          plugins: Object.assign(baseOpts().plugins, { legend: { display: true, labels: { color: '#cbd2df', boxWidth: 10, usePointStyle: true } },
            tooltip: Object.assign(baseOpts().plugins.tooltip, { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }) }) }) });
      const best = pace.length ? Math.min(...pace) : null;
      res = { empty: !runs.length, title: 'Running pace (min/' + dU + ')', summary: best ? 'best ' + fmt(best) + ' · ↑ faster' : '' };
    }
    return res;
  }
  root.BLCharts = { render, totals, streaks, inRange, ymd, parseYmd, destroy() { if (chart) { chart.destroy(); chart = null; } }, get chart() { return chart; } };
})(window);
