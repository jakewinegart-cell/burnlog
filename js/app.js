/* BurnLog — app controller (vanilla JS, no build step) */
(function () {
  'use strict';
  const C = window.BLCalc, P = window.BLParser, S = window.BLStore, CH = window.BLCharts;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymd = CH.ymd, parseYmd = CH.parseYmd;
  const todayStr = () => ymd(new Date());

  // ---------- AI parser hook ----------
  // Register an async parser: BurnLog.registerParser(async (text, ctx) => ({items:[...]}) | null).
  // Items use the same shape as BLParser.parse(). Returning null falls through to the rule-based parser.
  const extraParsers = [];
  async function parseQuick(text) {
    const ctx = { distUnit: S.getSettings().distUnit, exercises: C.exercises };
    for (const fn of extraParsers) {
      try { const r = await fn(text, ctx); if (r && r.items && r.items.length) return Object.assign({ via: fn.label || 'custom' }, r); } catch (e) { console.warn('parser failed', e); }
    }
    return Object.assign({ via: 'rules' }, P.parse(text, ctx));
  }
  window.BurnLog = { registerParser(fn, label) { fn.label = label || 'ai'; extraParsers.unshift(fn); const s = $('#ai-status'); if (s) s.textContent = 'connected (' + fn.label + ')'; },
    parse: parseQuick, store: S, calc: C };

  // ---------- formatting ----------
  const st = () => S.getSettings();
  const prof = () => S.getProfile() || {};
  const fmtKcal = k => Math.round(k || 0).toLocaleString();
  const distOut = km => st().distUnit === 'mi' ? C.kmToMi(km) : km;
  const fmtDist = km => (Math.round(distOut(km) * 100) / 100).toFixed(distOut(km) >= 100 ? 0 : 2) + ' ' + st().distUnit;
  const fmtPaceE = e => e.distanceKm > 0 && e.durationMin > 0 ? C.fmtPace(e.durationMin / distOut(e.distanceKm)) + '/' + st().distUnit : '';
  const fmtWt = kg => st().weightUnit === 'lb' ? Math.round(C.kgToLb(kg)) + ' lb' : (Math.round(kg * 10) / 10) + ' kg';
  function fmtDur(min) {
    if (!(min > 0)) return '0 min';
    if (min < 1) return Math.round(min * 60) + ' s';
    const h = Math.floor(min / 60), m = Math.floor(min % 60), s = Math.round((min - Math.floor(min)) * 60);
    if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return m + (s && m < 20 ? ':' + String(s).padStart(2, '0') : '') + ' min';
  }
  function dayLabel(ds) {
    const t = todayStr(); const y = new Date(); y.setDate(y.getDate() - 1);
    const d = parseYmd(ds); const nice = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (ds === t) return 'Today · ' + nice; if (ds === ymd(y)) return 'Yesterday · ' + nice; return nice;
  }
  const ICON = { 'Running': '🏃', 'Walking': '🚶', 'Bicycling': '🚴', 'Water Activities': '🏊', 'Conditioning Exercise': '💪', 'Sports': '🏀', 'Dancing': '💃',
    'Winter Activities': '⛷️', 'Home Activities': '🏠', 'Lawn & Garden': '🌿', 'Home Repair': '🔨', 'Occupation': '🧰', 'Fishing & Hunting': '🎣', 'Video Games': '🎮', 'Transportation': '🚲', 'Inactivity': '🛋️' };
  function iconFor(e) {
    const id = e.exId || '';
    if (/yoga|vinyasa|pilates|stretch|taichi|meditate/.test(id)) return '🧘';
    if (/pushups|situps|crunch|burpee|squat|pullup|chinup|lunge|plank|dips|jacks|climbers|legraise/.test(id)) return '🔥';
    if (/weights|bench|deadlift|curl|ohp|rows|kbswing/.test(id)) return '🏋️';
    if (id === 'p:hike') return '🥾';
    return ICON[e.cat] || '⚡';
  }
  function entryDetail(e) {
    const bits = [];
    if (e.mode === 'reps' && e.reps) bits.push((e.sets > 1 ? e.sets + '×' : '') + e.reps + ' reps');
    if (e.distanceKm > 0) bits.push(fmtDist(e.distanceKm));
    if (e.durationMin > 0) bits.push(fmtDur(e.durationMin));
    const p = C.isRun(e) || e.exId === 'p:walk' || e.exId === 'p:hike' ? fmtPaceE(e) : (e.speedKmh && e.exId === 'p:bike' ? (distOut(e.speedKmh)).toFixed(1) + ' ' + (st().distUnit === 'mi' ? 'mph' : 'km/h') : '');
    if (p) bits.push(p);
    bits.push('MET ' + e.met);
    return bits.join(' · ');
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast'); t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button>' + esc(action.label) + '</button>' : '');
    t.hidden = false; clearTimeout(toastTimer);
    if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.fn(); };
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 5000 : 2400);
  }

  // ---------- entries ----------
  function buildEntry(ex, input, dateStr, extra) {
    const weightKg = (extra && extra.weightKg) || prof().weightKg || 70;
    const c = C.compute(ex, input, { weightKg, formula: st().formula });
    const ts = (extra && extra.ts) || (() => { const d = parseYmd(dateStr); const n = new Date(); d.setHours(n.getHours(), n.getMinutes()); return d.toISOString(); })();
    return Object.assign({
      date: dateStr, ts, exId: ex.id, name: ex.name, code: c.code, cat: ex.cat, met: c.met, mode: c.mode,
      durationMin: +c.durationMin.toFixed(3), reps: c.mode === 'reps' ? +input.reps || 0 : null, sets: c.mode === 'reps' ? +input.sets || 1 : null,
      spr: c.mode === 'reps' ? (+input.spr || ex.spr) : null,
      distanceKm: c.distanceKm ? +c.distanceKm.toFixed(4) : null, speedKmh: c.speedKmh ? +c.speedKmh.toFixed(3) : null,
      weightKg: +(+weightKg).toFixed(2), formula: st().formula, kcal: +c.kcal.toFixed(1), estimate: c.estimate,
    }, extra || {});
  }
  const activeEntries = () => S.listEntries();

  // ---------- navigation ----------
  let currentView = 'today';
  function go(view) {
    currentView = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    if (view === 'charts') renderCharts();
    if (view === 'history') renderHistory();
    if (view === 'settings') renderSettings();
    if (view === 'log' && !logState.ex) renderLog();
    if (view !== 'charts') CH.destroy();
    window.scrollTo({ top: 0 });
  }

  // ---------- TODAY ----------
  let selDate = todayStr();
  function renderToday() {
    $('#day-label').textContent = dayLabel(selDate);
    $('#day-next').disabled = selDate >= todayStr();
    const list = activeEntries().filter(e => e.date === selDate).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const kcal = list.reduce((s, e) => s + (e.kcal || 0), 0), min = list.reduce((s, e) => s + (e.durationMin || 0), 0);
    $('#today-kcal').textContent = fmtKcal(kcal);
    $('#today-min').textContent = Math.round(min);
    $('#today-count').textContent = list.length;
    $('#today-streak').textContent = CH.streaks(activeEntries()).current;
    $('#today-sub').textContent = list.length ? `burned across ${list.length} ${list.length === 1 ? 'activity' : 'activities'}` : (selDate === todayStr() ? 'No workouts yet today — let’s go.' : 'Rest day');
    $('#today-list').innerHTML = list.map(entryHtml).join('');
    $('#today-empty').hidden = list.length > 0;
    renderTopbar();
  }
  function entryHtml(e) {
    return `<li class="entry" data-id="${e.id}">
      <div class="e-ico">${iconFor(e)}</div>
      <div><div class="e-name">${esc(e.name)} ${e.estimate ? '<span class="badge est">EST</span>' : ''} ${e.source === 'sample' ? '<span class="badge sample">SAMPLE</span>' : ''}</div>
        <div class="e-detail">${esc(entryDetail(e))}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
      <div class="e-right"><div class="e-kcal">${fmtKcal(e.kcal)} <small>kcal</small></div>
        <div class="e-acts"><button data-act="edit" aria-label="Edit">Edit</button><button data-act="del" aria-label="Delete">✕</button></div></div></li>`;
  }
  async function deleteEntry(id) {
    await S.deleteEntry(id);
    toast('Entry deleted', { label: 'Undo', fn: async () => { await S.updateEntry(id, { deletedAt: null }); refresh(); } });
    refresh();
  }
  function onEntryClick(ev) {
    const li = ev.target.closest('.entry'); if (!li) return;
    const act = ev.target.closest('button') && ev.target.closest('button').dataset.act;
    if (act === 'del') return deleteEntry(li.dataset.id);
    openEdit(li.dataset.id);
  }

  // ---------- QUICK ADD ----------
  const EXAMPLES = ['I did 3 push-ups', 'ran 3.2 miles in 28 min', '30 min yoga', 'biked 10k', '20 squats and 15 burpees', 'walked 2 miles', '3x12 pull-ups'];
  let quick = [];   // [{item, calc, ex, added}]
  async function runQuick(text) {
    text = (text || '').trim(); if (!text) return;
    const res = await parseQuick(text);
    quick = res.items.map(it => decorate(it));
    if (!quick.length) quick = [decorate({ status: 'unmatched', text, suggestions: P.POPULAR.slice(0, 4), qs: [], notes: [] })];
    renderQuick();
  }
  function decorate(it) {
    if (it.status !== 'ok') return { item: it };
    const ex = C.byId[it.exId];
    const date = it.dateOffset ? (() => { const d = parseYmd(selDate); d.setDate(d.getDate() + it.dateOffset); return ymd(d); })() : selDate;
    const entry = buildEntry(ex, it.input, date, { source: 'quick', text: it.text });
    const calcNotes = C.compute(ex, it.input, { weightKg: entry.weightKg, formula: st().formula }).notes.filter(n => !/^Estimate:/.test(n));
    return { item: it, ex, entry, notes: (it.notes || []).concat(calcNotes, entry.estimate && ex.kind === 'reps' && it.input.mode === 'reps' ? ['Reps → time estimate (~' + ex.spr + 's/rep)'] : []) };
  }
  function renderQuick() {
    const box = $('#quick-results');
    const pending = quick.filter(q => q.entry && !q.added);
    box.innerHTML = quick.map((q, i) => {
      const it = q.item;
      if (!q.entry) {
        return `<div class="qchip unmatched" data-i="${i}"><div class="q-name">Couldn’t match “${esc(it.text)}”</div>
          <div class="q-detail">Did you mean one of these?</div>
          <div class="q-actions">${it.suggestions.map(id => `<button class="q-sug" data-sug="${id}">${esc(short(C.byId[id].name))}</button>`).join('')}
          <button class="q-sug" data-act="browse">Browse all…</button><button class="q-sug" data-act="dismiss">✕</button></div></div>`;
      }
      const e = q.entry;
      return `<div class="qchip ${q.added ? 'added' : ''}" data-i="${i}">
        <div class="q-name">${q.added ? '✓ ' : ''}${esc(q.ex.name)}</div>
        <div class="q-detail">${esc(entryDetail(e))}${e.date !== selDate ? ' · ' + esc(dayLabel(e.date)) : ''}</div>
        <div class="q-kcal">${fmtKcal(e.kcal)}<small>${e.estimate ? 'est. kcal' : 'kcal'}</small></div>
        ${q.notes && q.notes.length ? `<div class="q-notes">${esc(q.notes.join(' · '))}</div>` : ''}
        ${q.added ? '' : `<div class="q-actions"><button class="btn sm primary" data-act="add">Add</button><button class="btn sm" data-act="edit">Edit</button><button class="btn sm ghost" data-act="dismiss">✕</button></div>`}</div>`;
    }).join('') + (pending.length > 1 ? `<div class="quick-bulk"><button class="btn sm primary" data-act="addall">Add all ${pending.length} · ${fmtKcal(pending.reduce((s, q) => s + q.entry.kcal, 0))} kcal</button></div>` : '');
  }
  function short(s) { return s.length > 34 ? s.slice(0, 32) + '…' : s; }
  async function onQuickClick(ev) {
    const b = ev.target.closest('button'); if (!b) return;
    const chip = b.closest('.qchip'); const i = chip ? +chip.dataset.i : -1; const q = quick[i];
    const act = b.dataset.act;
    if (act === 'addall') {
      const pend = quick.filter(x => x.entry && !x.added);
      await S.addEntries(pend.map(x => x.entry)); pend.forEach(x => x.added = true);
      toast(`Added ${pend.length} activities`); renderQuick(); refresh(); return;
    }
    if (b.dataset.sug) { quick[i] = decorate(P.rebuildWith(q.item, b.dataset.sug, { distUnit: st().distUnit })); renderQuick(); return; }
    if (act === 'dismiss') { quick.splice(i, 1); renderQuick(); return; }
    if (act === 'browse') { openPicker(ex => { quick[i] = decorate(P.rebuildWith(q.item, ex.id, { distUnit: st().distUnit })); renderQuick(); }, q.item.text); return; }
    if (act === 'add') { await S.addEntry(q.entry); q.added = true; toast('Added ' + q.ex.name + ' · ' + fmtKcal(q.entry.kcal) + ' kcal'); renderQuick(); refresh(); return; }
    if (act === 'edit') { quick.splice(i, 1); renderQuick(); openLogWith(q.ex, q.entry); }
  }

  // ---------- LOG ----------
  const logState = { ex: null, seg: 'time', editingId: null, weightKg: null, source: null, text: null };
  function segsFor(ex) {
    if (ex.kind === 'distance') return [['dist', 'Distance + time'], ['time', 'Time only']];
    if (ex.kind === 'reps') return [['reps', 'Reps × sets'], ['time', 'Time']];
    return [['time', 'Duration']];
  }
  function selectExercise(ex, keepSeg) {
    logState.ex = ex;
    const segs = segsFor(ex);
    if (!keepSeg || !segs.find(s => s[0] === logState.seg)) logState.seg = segs[0][0];
    $('#pick-cat').textContent = ex.cat;
    $('#pick-name').textContent = ex.name;
    $('#pick-meta').textContent = (ex.preset ? 'Compendium ' + ex.code + (ex.table ? ' · MET matched to speed' : ' · MET ' + ex.met) : 'Code ' + ex.code + ' · MET ' + ex.met) + (ex.kind === 'reps' ? ' · ~' + ex.spr + 's/rep' : '');
    $('#log-form').hidden = false;
    $('#mode-seg').innerHTML = segs.map(s => `<button type="button" data-seg="${s[0]}">${s[1]}</button>`).join('');
    $('#mode-seg').hidden = segs.length < 2;
    if (!keepSeg) $('#f-spr').value = ex.spr || 3;
    applySeg();
  }
  function applySeg() {
    const seg = logState.seg;
    $$('#mode-seg button').forEach(b => b.classList.toggle('on', b.dataset.seg === seg));
    $$('#log-form .field-group').forEach(g => {
      const m = g.dataset.mode; g.hidden = !(m === 'distance' ? seg === 'dist' : m === 'reps' ? seg === 'reps' : (seg === 'dist' || seg === 'time'));
    });
    $('#time-label').textContent = seg === 'dist' ? 'Time' + (logState.ex && logState.ex.kind === 'distance' ? ' (for pace)' : '') : 'Duration';
    $('#f-dist-unit').textContent = st().distUnit;
    updateCalc();
  }
  function readInput() {
    const ex = logState.ex, seg = logState.seg;
    const dur = (+$('#f-h').value || 0) * 60 + (+$('#f-m').value || 0) + (+$('#f-s').value || 0) / 60;
    if (seg === 'reps') return { mode: 'reps', reps: +$('#f-reps').value || 0, sets: +$('#f-sets').value || 1, spr: +$('#f-spr').value || ex.spr };
    if (ex.kind === 'distance') {
      const dv = +$('#f-dist').value || 0;
      return { mode: 'distance', distanceKm: seg === 'dist' && dv > 0 ? (st().distUnit === 'mi' ? C.miToKm(dv) : dv) : null, durationMin: dur || null };
    }
    return { mode: 'duration', durationMin: dur };
  }
  function updateCalc() {
    const ex = logState.ex; if (!ex) return;
    const input = readInput();
    const kg = logState.weightKg || prof().weightKg || 70;
    const c = C.compute(ex, input, { weightKg: kg, formula: st().formula });
    $('#calc-kcal').textContent = fmtKcal(c.kcal);
    $('#calc-est').hidden = !c.estimate;
    const metTxt = st().formula === 'net' ? `(${c.met} − 1) MET` : `${c.met} MET`;
    $('#calc-formula').textContent = `${metTxt} × ${(+kg).toFixed(1)} kg × ${(c.durationMin / 60).toFixed(2)} h = ${fmtKcal(c.kcal)} kcal`;
    $('#calc-src').textContent = `Compendium ${c.code}: ${c.codeDesc}`;
    let pace = '';
    if (c.speedKmh) {
      const u = st().distUnit, sp = u === 'mi' ? C.kmToMi(c.speedKmh) : c.speedKmh;
      if (ex.table === 'swim') pace = `${Math.round(c.speedKmh * 1000 / 60 / C.M_PER_YD)} yd/min · ${fmtDur(c.durationMin)}`;
      else pace = `Pace ${C.fmtPace(60 / sp)}/${u} · ${sp.toFixed(1)} ${u === 'mi' ? 'mph' : 'km/h'} · ${fmtDur(c.durationMin)}`;
    }
    $('#calc-pace').textContent = pace; $('#calc-pace').hidden = !pace;
    $('#calc-notes').innerHTML = c.notes.map(n => '<li>' + esc(n) + '</li>').join('');
    $('#log-save').disabled = !(c.durationMin > 0);
  }
  function resetLogForm() {
    logState.editingId = null; logState.weightKg = null; logState.source = null; logState.text = null;
    $('#log-title').textContent = 'Log a workout';
    $('#log-save').textContent = 'Save workout';
    $('#log-delete').hidden = true; $('#log-cancel').hidden = true;
    ['#f-dist', '#f-h', '#f-s', '#f-note'].forEach(s => $(s).value = '');
    $('#f-m').value = ''; $('#f-reps').value = 10; $('#f-sets').value = 1;
    $('#f-date').value = selDate;
    const n = new Date(); $('#f-time').value = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  }
  function renderLog() {
    $('#popular-row').innerHTML = ['p:run', 'p:walk', 'p:bike', 'p:pushups', 'p:squats', 'p:burpees', 'p:pullups', 'p:yoga', 'p:weights', 'p:hiit', 'p:swim', 'p:hike', 'p:rower', 'p:elliptical']
      .map(id => `<button class="chip" data-ex="${id}">${esc(C.byId[id].name.replace(/ \(.*\)/, ''))}</button>`).join('');
    if (!logState.editingId && !$('#f-date').value) resetLogForm();
  }
  function fillTime(min) {
    if (!(min > 0)) { $('#f-h').value = ''; $('#f-m').value = ''; $('#f-s').value = ''; return; }
    const totalS = Math.round(min * 60); const h = Math.floor(totalS / 3600), m = Math.floor(totalS % 3600 / 60), s = totalS % 60;
    $('#f-h').value = h || ''; $('#f-m').value = m || (h ? 0 : ''); $('#f-s').value = s || '';
  }
  function openLogWith(ex, e) {   // prefill from a (draft) entry
    go('log'); resetLogForm(); renderLog();
    logState.source = e.source; logState.text = e.text;
    logState.seg = e.mode === 'reps' ? 'reps' : (ex.kind === 'distance' ? (e.distanceKm ? 'dist' : 'time') : 'time');
    selectExercise(ex, true);
    $('#f-spr').value = e.spr || ex.spr || 3;
    if (e.mode === 'reps') { $('#f-reps').value = e.reps || 0; $('#f-sets').value = e.sets || 1; }
    else if (e.distanceKm) { $('#f-dist').value = +distOut(e.distanceKm).toFixed(2); fillTime(e.estimate ? 0 : e.durationMin); }  // estimated time stays blank
    else fillTime(e.durationMin);
    $('#f-date').value = e.date; if (e.ts) { const d = new Date(e.ts); $('#f-time').value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    $('#f-note').value = e.note || '';
    applySeg();
  }
  function openEdit(id) {
    const e = S.getEntry(id); if (!e) return;
    const ex = C.byId[e.exId] || C.byId['c:' + e.code]; if (!ex) return toast('Exercise not found');
    openLogWith(ex, e);
    logState.editingId = id; logState.weightKg = e.weightKg;
    $('#log-title').textContent = 'Edit workout'; $('#log-save').textContent = 'Save changes';
    $('#log-delete').hidden = false; $('#log-cancel').hidden = false;
    updateCalc();
  }
  async function saveLog(ev) {
    ev.preventDefault();
    const ex = logState.ex; if (!ex) return;
    const input = readInput();
    const date = $('#f-date').value || selDate;
    const [hh, mm] = ($('#f-time').value || '12:00').split(':').map(Number);
    const d = parseYmd(date); d.setHours(hh || 0, mm || 0);
    const extra = { ts: d.toISOString(), note: $('#f-note').value.trim(), source: logState.source || 'manual' };
    if (logState.text) extra.text = logState.text;
    if (logState.weightKg) extra.weightKg = logState.weightKg;
    const entry = buildEntry(ex, input, date, extra);
    if (!(entry.durationMin > 0)) return toast('Add a duration, distance or reps');
    if (logState.editingId) { await S.updateEntry(logState.editingId, entry); toast('Saved'); }
    else { await S.addEntry(entry); toast('Logged ' + ex.name.replace(/ \(.*\)/, '') + ' · ' + fmtKcal(entry.kcal) + ' kcal'); }
    selDate = date; resetLogForm(); logState.ex = null; $('#log-form').hidden = true;
    $('#pick-name').textContent = 'Choose an exercise…'; $('#pick-cat').textContent = 'Exercise'; $('#pick-meta').textContent = '1,200+ activities · 2024 Compendium';
    refresh(); go('today');
  }

  // ---------- PICKER ----------
  let pickerCb = null, pickerCat = 'Popular';
  function openPicker(cb, query) {
    pickerCb = cb; $('#picker').hidden = false; document.body.style.overflow = 'hidden';
    const cats = ['Popular', 'All'].concat(C.DB.cats);
    $('#picker-cats').innerHTML = cats.map(c => `<button class="chip ${c === pickerCat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    $('#picker-search').value = query ? P.normalize(query).replace(/[\d.]+\s*(min|mins|minutes|mi|miles|km|k|reps|x)?\b/g, '').replace(/\b(i|did|some|for|of|a|the|an)\b/g, '').trim() : '';
    renderPicker(); setTimeout(() => $('#picker-search').focus(), 50);
  }
  function closePicker() { $('#picker').hidden = true; document.body.style.overflow = ''; pickerCb = null; }
  function renderPicker() {
    const q = $('#picker-search').value.trim().toLowerCase();
    let list = C.exercises;
    if (q) {
      const toks = q.split(/\s+/).filter(Boolean);
      list = list.map(ex => {
        const hay = (ex.name + ' ' + ex.syn.join(' ') + ' ' + ex.cat + ' ' + ex.code).toLowerCase();
        if (!toks.every(t => hay.includes(t))) return null;
        let sc = ex.preset ? 10 : 0; if (ex.name.toLowerCase().startsWith(toks[0])) sc += 5; sc -= ex.name.length / 60;
        return { ex, sc };
      }).filter(Boolean).sort((a, b) => b.sc - a.sc).map(x => x.ex);
      if (pickerCat !== 'All' && pickerCat !== 'Popular') list = list.filter(ex => ex.cat === pickerCat);
    } else if (pickerCat === 'Popular') list = list.filter(ex => ex.preset);
    else if (pickerCat !== 'All') list = list.filter(ex => ex.cat === pickerCat);
    const MAX = 400; const shown = list.slice(0, MAX);
    $('#picker-count').textContent = list.length.toLocaleString() + (list.length === 1 ? ' activity' : ' activities') + (list.length > MAX ? ' · showing first ' + MAX + ', refine search' : '');
    $('#picker-list').innerHTML = shown.map(ex => `<li data-id="${ex.id}"><span class="pl-name">${esc(ex.name)}</span>
      <span class="pl-sub">${esc(ex.cat)} · ${ex.code}${ex.kind === 'reps' ? ' · reps' : ex.kind === 'distance' ? ' · distance' : ''}</span>
      <span class="pl-met">${ex.table ? 'speed' : ex.met}<small>MET</small></span></li>`).join('') || '<li class="pl-head">No matches — try a simpler word (e.g. “row”, “dance”, “ski”).</li>';
  }

  // ---------- CHARTS ----------
  function renderCharts() {
    const s = st(), cv = s.chart;
    $$('#chart-views .chip').forEach(b => b.classList.toggle('on', b.dataset.cview === cv.view));
    $$('#range-seg button').forEach(b => b.classList.toggle('on', b.dataset.range === cv.range));
    $$('#group-seg button').forEach(b => b.classList.toggle('on', b.dataset.group === cv.group));
    $$('#cu-dist button').forEach(b => b.classList.toggle('on', b.dataset.dist === s.distUnit));
    $$('#cu-wt button').forEach(b => b.classList.toggle('on', b.dataset.wt === s.weightUnit));
    const types = { calories: [['bar', 'Bar'], ['line', 'Line']], distance: [['bar', 'Bar'], ['line', 'Line']], category: [['doughnut', 'Donut'], ['pie', 'Pie']], pace: [['line', 'Line'], ['scatter', 'Dots']] }[cv.view];
    $('#type-seg').innerHTML = types ? types.map(t => `<button data-type="${t[0]}" class="${cv.type[cv.view] === t[0] ? 'on' : ''}">${t[1]}</button>`).join('') : '';
    $('#group-seg').hidden = !(cv.view === 'calories' || cv.view === 'distance');
    const onChip = $('#chart-views .chip.on'); if (onChip && onChip.scrollIntoView) onChip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('#range-seg').hidden = cv.view === 'totals';
    $('#chart-controls').hidden = cv.view === 'totals';
    const entries = activeEntries();
    renderTotals(entries, cv.view === 'totals');
    $('#chart-card').hidden = cv.view === 'totals';
    if (cv.view === 'totals') { CH.destroy(); return; }
    $('.chart-wrap').style.display = '';   // must be visible *before* Chart.js measures the canvas
    const r = CH.render($('#chart-canvas'), cv.view, { entries, range: cv.range, group: cv.group, type: cv.type[cv.view], distUnit: s.distUnit });
    $('#chart-title').textContent = r.title; $('#chart-sum').textContent = r.empty ? '' : r.summary;
    $('#chart-empty').hidden = !r.empty; $('.chart-wrap').style.display = r.empty ? 'none' : '';
  }
  function renderTotals(entries, full) {
    const t = CH.totals(entries), u = st().distUnit;
    const cards = [
      ['hot', fmtKcal(t.kcal), 'Calories', 'all time'],
      ['', t.workouts.toLocaleString(), 'Workouts', t.days + ' active days'],
      ['cy', t.runDist ? (Math.round(distOut(t.runDist) * 10) / 10).toLocaleString() + ' ' + u : '—', 'Run distance', t.runs + ' runs'],
      ['cy', t.allDist ? (Math.round(distOut(t.allDist) * 10) / 10).toLocaleString() + ' ' + u : '—', 'All distance', 'run + walk + ride + swim'],
      ['li', t.best ? C.fmtPace(t.best.durationMin / distOut(t.best.distanceKm)) + '/' + u : '—', 'Best pace', t.best ? fmtDist(t.best.distanceKm) + ' · ' + t.best.date : 'runs ≥ 1 mi'],
      ['li', t.longest ? fmtDist(t.longest.distanceKm) : '—', 'Longest run', t.longest ? t.longest.date : ''],
      ['vi', t.streak.current + (t.streak.current === 1 ? ' day' : ' days'), 'Current streak', 'best ' + t.streak.best + ' days'],
      ['vi', Math.round(t.minutes / 60).toLocaleString() + ' h', 'Time moving', Math.round(t.minutes).toLocaleString() + ' min'],
    ];
    $('#totals').innerHTML = (full ? cards : cards.slice(0, 4)).map(c => `<div class="tot ${c[0]}"><span>${c[2]}</span><b>${c[1]}</b><em>${esc(c[3])}</em></div>`).join('');
  }
  async function setChart(patch) {
    const cv = Object.assign({}, st().chart, patch);
    if (patch.type) cv.type = Object.assign({}, st().chart.type, patch.type);
    await S.saveSettings({ chart: cv }); renderCharts();
  }

  // ---------- HISTORY ----------
  function renderHistory() {
    const sel = $('#hist-cat');
    if (sel.options.length <= 1) sel.innerHTML += C.DB.cats.map(c => `<option>${esc(c)}</option>`).join('');
    const q = $('#hist-search').value.trim().toLowerCase(), cat = sel.value, range = $('#hist-range').value;
    let list = CH.inRange(activeEntries(), range);
    if (cat) list = list.filter(e => e.cat === cat);
    if (q) { const toks = q.split(/\s+/); list = list.filter(e => { const h = (e.name + ' ' + (e.note || '') + ' ' + (e.text || '') + ' ' + e.cat + ' ' + e.date).toLowerCase(); return toks.every(t => h.includes(t)); }); }
    list.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const groups = new Map(); list.forEach(e => { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); });
    const MAXD = 60; let html = '', n = 0;
    for (const [d, es] of groups) { if (n++ >= MAXD) break;
      html += `<div class="hist-day"><span>${esc(dayLabel(d))}</span><span>${fmtKcal(es.reduce((s, e) => s + e.kcal, 0))} kcal</span></div><ul class="entry-list">${es.map(entryHtml).join('')}</ul>`; }
    if (groups.size > MAXD) html += `<p class="muted small" style="text-align:center">Showing latest ${MAXD} days — narrow the filters to see more.</p>`;
    $('#hist-list').innerHTML = html;
    $('#hist-empty').hidden = list.length > 0;
    $('#hist-summary').textContent = list.length ? `${list.length} workouts · ${fmtKcal(list.reduce((s, e) => s + e.kcal, 0))} kcal · ${Math.round(list.reduce((s, e) => s + e.durationMin, 0) / 60)} h` : '';
  }

  // ---------- SETTINGS ----------
  function renderSettings() {
    const s = st(), p = prof();
    $$('#set-dist button').forEach(b => b.classList.toggle('on', b.dataset.dist === s.distUnit));
    $$('#set-wt button').forEach(b => b.classList.toggle('on', b.dataset.wt === s.weightUnit));
    $$('#set-formula button').forEach(b => b.classList.toggle('on', b.dataset.formula === s.formula));
    $('#formula-help').textContent = s.formula === 'net'
      ? 'Net: kcal = (MET − 1) × kg × hours. Excludes the calories you’d burn at rest anyway. Applies to new entries.'
      : 'Gross: kcal = MET × kg × hours (standard Compendium estimate, includes resting burn). Applies to new entries.';
    const h = p.heightCm ? (s.weightUnit === 'lb' ? Math.floor(p.heightCm / 2.54 / 12) + '′' + Math.round(p.heightCm / 2.54 % 12) + '″' : Math.round(p.heightCm) + ' cm') : '—';
    $('#profile-summary').innerHTML = [['Weight', p.weightKg ? fmtWt(p.weightKg) : '—'], ['Height', h], ['Age', p.age || '—'], ['Sex', p.sex ? p.sex[0].toUpperCase() + p.sex.slice(1) : '—']]
      .map(x => `<div><span>${x[0]}</span><b>${esc(x[1])}</b></div>`).join('');
    $('#adapter-name').textContent = S.adapterName;
    $('#db-count').textContent = C.DB.rows.length.toLocaleString();
    const ns = activeEntries().filter(e => e.source === 'sample').length;
    $('#btn-sample-clear').disabled = !ns; $('#btn-sample-clear').textContent = ns ? `Remove sample (${ns})` : 'Remove sample data';
  }
  function renderTopbar() {
    const p = prof();
    $('#topbar-right').innerHTML = p.weightKg ? `<button class="pill" id="tb-weight" style="border:1px solid var(--border);background:var(--surface2);border-radius:999px;padding:5px 10px;font-weight:700;font-size:12px;color:var(--muted)">${esc(fmtWt(p.weightKg))}</button>` : '';
    const b = $('#tb-weight'); if (b) b.onclick = () => openProfile(false);
  }

  // ---------- PROFILE ----------
  let pUnit = 'lb';
  function openProfile(first) {
    const p = prof(); pUnit = st().weightUnit;
    $('#profile-title').textContent = first ? 'Welcome to BurnLog' : 'Your profile';
    $('#profile-intro').hidden = !first;
    $('#profile-cancel').hidden = first;
    setPUnit(pUnit, p);
    $('#p-age').value = p.age || ''; $('#p-sex').value = p.sex || '';
    $('#profile-modal').hidden = false;
    setTimeout(() => $('#p-weight').focus(), 60);
  }
  function setPUnit(u, p) {
    const cur = p || readProfileForm();
    pUnit = u;
    $$('#p-wunit button').forEach(b => b.classList.toggle('on', b.dataset.wt === u));
    $('#p-weight').value = cur.weightKg ? (u === 'lb' ? Math.round(C.kgToLb(cur.weightKg) * 10) / 10 : Math.round(cur.weightKg * 10) / 10) : '';
    $('#p-weight').placeholder = u === 'lb' ? '180' : '82';
    $('#p-height-imp').hidden = u !== 'lb'; $('#p-height-met').hidden = u === 'lb';
    if (cur.heightCm) { const inches = cur.heightCm / 2.54; $('#p-ft').value = Math.floor(inches / 12); $('#p-in').value = Math.round(inches % 12); $('#p-cm').value = Math.round(cur.heightCm); }
    else { $('#p-ft').value = ''; $('#p-in').value = ''; $('#p-cm').value = ''; }
  }
  function readProfileForm() {
    const w = parseFloat($('#p-weight').value);
    const weightKg = w > 0 ? (pUnit === 'lb' ? C.lbToKg(w) : w) : null;
    let heightCm = null;
    if (pUnit === 'lb') { const ft = +$('#p-ft').value || 0, inch = +$('#p-in').value || 0; if (ft || inch) heightCm = (ft * 12 + inch) * 2.54; }
    else if (+$('#p-cm').value) heightCm = +$('#p-cm').value;
    return { weightKg, heightCm };
  }
  async function saveProfile(ev) {
    ev.preventDefault();
    const f = readProfileForm();
    if (!f.weightKg || f.weightKg < 25 || f.weightKg > 350) { toast('Enter a valid weight'); return; }
    await S.saveProfile({ weightKg: +f.weightKg.toFixed(3), heightCm: f.heightCm ? +f.heightCm.toFixed(1) : null, age: +$('#p-age').value || null, sex: $('#p-sex').value || null });
    await S.saveSettings({ weightUnit: pUnit, distUnit: st().distUnit || (pUnit === 'kg' ? 'km' : 'mi') });
    $('#profile-modal').hidden = true; toast('Profile saved'); refresh();
  }

  // ---------- data actions ----------
  function download(name, text) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function loadSample() {
    const existing = activeEntries().filter(e => e.source === 'sample').length;
    if (existing) await S.purgeWhere(e => e.source === 'sample');
    const list = window.BLSample.generate(200, prof().weightKg || C.lbToKg(180), st().formula);
    await S.addEntries(list); toast(`Loaded ${list.length} sample workouts`); refresh();
  }

  // ---------- refresh ----------
  function refresh() {
    renderToday();
    if (currentView === 'charts') renderCharts();
    if (currentView === 'history') renderHistory();
    if (currentView === 'settings') renderSettings();
    if (currentView === 'log') updateCalc();
  }

  // ---------- wire up ----------
  function bind() {
    $('#tabbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
    document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });
    $('#day-prev').onclick = () => { const d = parseYmd(selDate); d.setDate(d.getDate() - 1); selDate = ymd(d); quick = []; renderQuick(); renderToday(); };
    $('#day-next').onclick = () => { const d = parseYmd(selDate); d.setDate(d.getDate() + 1); if (ymd(d) <= todayStr()) { selDate = ymd(d); quick = []; renderQuick(); renderToday(); } };
    $('#day-label').onclick = () => { selDate = todayStr(); renderToday(); };
    $('#today-list').addEventListener('click', onEntryClick);
    $('#hist-list').addEventListener('click', onEntryClick);
    $('#quick-form').addEventListener('submit', e => { e.preventDefault(); runQuick($('#quick-input').value); $('#quick-input').blur(); });
    $('#quick-examples').innerHTML = EXAMPLES.map(x => `<button type="button" class="ex-chip">${esc(x)}</button>`).join('');
    $('#quick-examples').addEventListener('click', e => { const b = e.target.closest('.ex-chip'); if (b) { $('#quick-input').value = b.textContent; runQuick(b.textContent); } });
    $('#quick-results').addEventListener('click', onQuickClick);

    $('#pick-exercise').onclick = () => openPicker(ex => { if (!logState.editingId) { const keepDate = $('#f-date').value; resetLogForm(); if (keepDate) $('#f-date').value = keepDate; } selectExercise(ex); });
    $('#popular-row').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (!b) return; if (!logState.editingId) resetLogForm(); selectExercise(C.byId[b.dataset.ex]); });
    $('#mode-seg').addEventListener('click', e => { const b = e.target.closest('[data-seg]'); if (b) { logState.seg = b.dataset.seg; applySeg(); } });
    $('#log-form').addEventListener('input', updateCalc);
    $('#log-form').addEventListener('submit', saveLog);
    $('#log-form').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (!b) return; const [id, d] = b.dataset.step.split(':'); const inp = $('#' + id); inp.value = Math.max(id === 'f-sets' ? 1 : 0, (+inp.value || 0) + +d); updateCalc(); });
    $('#log-cancel').onclick = () => { resetLogForm(); logState.ex = null; $('#log-form').hidden = true; go('today'); };
    $('#log-delete').onclick = async () => { const id = logState.editingId; resetLogForm(); logState.ex = null; $('#log-form').hidden = true; go('today'); await deleteEntry(id); };

    $('#picker-close').onclick = closePicker;
    $('#picker-search').addEventListener('input', renderPicker);
    $('#picker-cats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; pickerCat = b.dataset.cat; $$('#picker-cats .chip').forEach(x => x.classList.toggle('on', x === b)); renderPicker(); });
    $('#picker-list').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (!li) return; const cb = pickerCb; closePicker(); if (cb) cb(C.byId[li.dataset.id]); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#picker').hidden) closePicker(); });

    $('#chart-views').addEventListener('click', e => { const b = e.target.closest('[data-cview]'); if (b) setChart({ view: b.dataset.cview }); });
    $('#range-seg').addEventListener('click', e => { const b = e.target.closest('[data-range]'); if (!b) return; const r = b.dataset.range; const patch = { range: r };
      if (r === '1y' || r === 'all') { if (st().chart.group === 'day') patch.group = 'week'; } else if (r === '7d') patch.group = 'day'; setChart(patch); });
    $('#group-seg').addEventListener('click', e => { const b = e.target.closest('[data-group]'); if (b) setChart({ group: b.dataset.group }); });
    $('#type-seg').addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (b) setChart({ type: { [st().chart.view]: b.dataset.type } }); });
    const unitHandler = async e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dist) await S.saveSettings({ distUnit: b.dataset.dist });
      if (b.dataset.wt) await S.saveSettings({ weightUnit: b.dataset.wt });
      refresh(); };
    ['#cu-dist', '#cu-wt', '#set-dist', '#set-wt'].forEach(s => $(s).addEventListener('click', unitHandler));
    $('#set-formula').addEventListener('click', async e => { const b = e.target.closest('[data-formula]'); if (b) { await S.saveSettings({ formula: b.dataset.formula }); refresh(); } });

    $('#hist-search').addEventListener('input', renderHistory);
    $('#hist-cat').addEventListener('change', renderHistory);
    $('#hist-range').addEventListener('change', renderHistory);

    $('#edit-profile').onclick = () => openProfile(false);
    $('#profile-form').addEventListener('submit', saveProfile);
    $('#profile-cancel').onclick = () => { $('#profile-modal').hidden = true; };
    $('#p-wunit').addEventListener('click', e => { const b = e.target.closest('[data-wt]'); if (b && b.dataset.wt !== pUnit) setPUnit(b.dataset.wt); });

    $('#btn-export').onclick = () => { download('burnlog-export-' + todayStr() + '.json', JSON.stringify(S.exportAll(), null, 1)); toast('Exported'); };
    $('#btn-import').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const data = JSON.parse(await f.text()); const n = await S.importAll(data, 'merge'); toast('Imported · ' + n + ' entries total'); refresh(); }
      catch (err) { toast('Import failed: ' + err.message); }
      e.target.value = '';
    });
    $('#btn-sample').onclick = loadSample;
    $('#btn-sample-clear').onclick = async () => { await S.purgeWhere(e => e.source === 'sample'); toast('Sample data removed'); refresh(); };
    $('#btn-clear').onclick = async () => {
      if (!confirm('Delete ALL BurnLog data on this device (profile, settings, every workout)? This cannot be undone. Export first if you want a backup.')) return;
      await S.clearAll(); quick = []; renderQuick(); refresh(); openProfile(true);
    };
  }

  async function start() {
    await S.init();
    bind(); resetLogForm(); renderLog(); renderToday();
    if (!S.getProfile() || !S.getProfile().weightKg) openProfile(true);
    window.BurnLog.ready = true;
  }
  start().catch(err => { console.error(err); document.body.insertAdjacentHTML('beforeend', '<p style="color:#f66;padding:20px">BurnLog failed to start: ' + esc(err.message) + '</p>'); });
})();
