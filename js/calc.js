/* BurnLog — exercise index + calorie math.
 * Formula (default, "gross"): kcal = MET × body-mass(kg) × duration(h)
 * Optional "net" formula:      kcal = (MET − 1) × kg × h  (excludes resting burn)
 * MET values: 2024 Adult Compendium of Physical Activities (see js/db.js header / NOTES.md).
 */
(function (root) {
  'use strict';
  const DB = root.BL_DB;
  const KG_PER_LB = 0.45359237, KM_PER_MI = 1.609344, M_PER_YD = 0.9144;

  const byCode = {};
  DB.rows.forEach(r => { byCode[r[0]] = { code: r[0], cat: DB.cats[r[1]], met: r[2], d: r[3] }; });

  // Unified exercise list: presets (friendly names, rep/distance aware) + every Compendium row.
  const exercises = [];
  const byId = {};
  DB.presets.forEach(p => {
    const ex = { id: p.id, name: p.n, code: p.c, met: p.m, cat: p.cat, kind: p.k, spr: p.spr || null,
      syn: p.s || [], table: p.table || null, fallback: p.fallback || p.c, preset: true,
      desc: byCode[p.c] ? byCode[p.c].d : '' };
    exercises.push(ex); byId[ex.id] = ex;
  });
  DB.rows.forEach(r => {
    const ex = { id: 'c:' + r[0], name: r[3], code: r[0], met: r[2], cat: DB.cats[r[1]], kind: 'duration',
      spr: null, syn: [], table: null, fallback: r[0], preset: false, desc: r[3] };
    exercises.push(ex); byId[ex.id] = ex;
  });

  // Which activities count as "running" for distance/pace charts.
  function isRun(entry) { return entry && (entry.exId === 'p:run' || (entry.code || '').startsWith('12')) && entry.distanceKm > 0; }

  function lookupTable(table, value) {
    const t = DB.tables[table]; if (!t) return null;
    for (const row of t) if (value < row[0]) return { code: row[1], met: row[2] };
    const last = t[t.length - 1]; return { code: last[1], met: last[2] };
  }

  function defaultSpeedMph(ex) {
    const d = DB.defaults;
    if (ex.id === 'p:run') return d.run_mph;
    if (ex.id === 'p:walk') return d.walk_mph;
    if (ex.id === 'p:bike') return d.bike_mph;
    if (ex.id === 'p:hike') return d.hike_mph;
    return null;
  }

  /**
   * compute(ex, input, ctx)
   *  input: { mode: 'duration'|'reps'|'distance', durationMin, reps, sets, spr, distanceKm }
   *  ctx:   { weightKg, formula: 'gross'|'net' }
   * returns { met, code, codeDesc, durationMin, distanceKm, speedKmh, paceMinPerKm, totalReps, kcal, notes[], estimate }
   */
  function compute(ex, input, ctx) {
    const notes = [];
    let met = ex.met, code = ex.code, estimate = false;
    let durationMin = num(input.durationMin), distanceKm = num(input.distanceKm);
    let speedKmh = null, totalReps = null;
    const mode = input.mode || (ex.kind === 'reps' ? 'reps' : ex.kind === 'distance' ? 'distance' : 'duration');

    if (mode === 'reps') {
      const reps = num(input.reps) || 0, sets = Math.max(1, num(input.sets) || 1);
      const spr = num(input.spr) || ex.spr || 3;
      totalReps = reps * sets;
      durationMin = totalReps * spr / 60;
      estimate = true;
      notes.push(`Estimate: ${totalReps} rep${totalReps === 1 ? '' : 's'} × ~${spr}s/rep ≈ ${fmtMin(durationMin)} of work`);
    } else if (mode === 'distance' && ex.kind === 'distance') {
      if (distanceKm > 0 && durationMin > 0) {
        speedKmh = distanceKm / (durationMin / 60);
      } else if (distanceKm > 0) {
        if (ex.table === 'swim') {
          const ydmin = DB.defaults.swim_ydmin; durationMin = (distanceKm * 1000 / M_PER_YD) / ydmin;
          notes.push(`No time given — assumed ~${ydmin} yd/min`); estimate = true;
          speedKmh = distanceKm / (durationMin / 60);
        } else {
          const mph = defaultSpeedMph(ex) || 3;
          speedKmh = mph * KM_PER_MI; durationMin = distanceKm / speedKmh * 60;
          notes.push(`No time given — assumed ${mph} mph (${fmtPace(60 / mph)}/mi)`); estimate = true;
        }
      }
      if (speedKmh && ex.table) {
        let hit;
        if (ex.table === 'swim') hit = lookupTable('swim', (speedKmh * 1000 / 60) / M_PER_YD);
        else {
          const mph = speedKmh / KM_PER_MI;
          if (ex.table === 'run' && mph < 4.0) { hit = lookupTable('walk', mph); notes.push('Speed is walking pace — used walking MET'); }
          else hit = lookupTable(ex.table, mph);
        }
        if (hit) { met = hit.met; code = hit.code; }
      } else if (!speedKmh && ex.fallback && byCode[ex.fallback]) {
        met = byCode[ex.fallback].met; code = ex.fallback;
        if (ex.table) notes.push('No distance — general MET used');
      }
    }
    if (!(durationMin > 0)) durationMin = 0;
    const kg = num(ctx.weightKg) || 70;
    const metUsed = ctx.formula === 'net' ? Math.max(met - 1, 0) : met;
    const kcal = metUsed * kg * (durationMin / 60);
    const paceMinPerKm = speedKmh ? 60 / speedKmh : null;
    return { met, metUsed, code, codeDesc: byCode[code] ? byCode[code].d : '', durationMin, distanceKm: distanceKm || null,
      speedKmh, paceMinPerKm, totalReps, kcal, notes, estimate, mode, weightKg: kg, formula: ctx.formula || 'gross' };
  }

  function num(v) { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; }
  function fmtMin(m) {
    if (!(m > 0)) return '0 min';
    if (m < 1) return Math.round(m * 60) + ' s';
    if (m < 60) return (m < 10 ? Math.round(m * 10) / 10 : Math.round(m)) + ' min';
    const h = Math.floor(m / 60), r = Math.round(m - h * 60); return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  function fmtPace(minPerUnit) {
    if (!(minPerUnit > 0) || !isFinite(minPerUnit)) return '—';
    let m = Math.floor(minPerUnit), s = Math.round((minPerUnit - m) * 60);
    if (s === 60) { m++; s = 0; }
    return m + ':' + String(s).padStart(2, '0');
  }

  root.BLCalc = { DB, byCode, exercises, byId, compute, lookupTable, isRun, fmtMin, fmtPace,
    KG_PER_LB, KM_PER_MI, M_PER_YD, lbToKg: lb => lb * KG_PER_LB, kgToLb: kg => kg / KG_PER_LB,
    miToKm: mi => mi * KM_PER_MI, kmToMi: km => km / KM_PER_MI };
})(typeof window !== 'undefined' ? window : globalThis);
