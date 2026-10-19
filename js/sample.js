/* BurnLog — demo data generator (Settings → Load sample data). Entries are tagged source:'sample'
 * so "Remove sample data" deletes only these. Deterministic PRNG so screenshots are reproducible. */
(function (root) {
  'use strict';
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function generate(days, weightKg, formula) {
    const C = root.BLCalc, R = rng(42), out = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    function add(d, exId, input, hour, note) {
      const ex = C.byId[exId]; const c = C.compute(ex, input, { weightKg, formula });
      const ts = new Date(d); ts.setHours(hour, Math.floor(R() * 60));
      out.push({ date: ymd(d), ts: ts.toISOString(), exId, name: ex.name, code: c.code, cat: ex.cat, met: c.met, mode: c.mode,
        durationMin: +c.durationMin.toFixed(2), reps: input.reps || null, sets: input.sets || null, spr: input.spr || ex.spr || null,
        distanceKm: c.distanceKm ? +c.distanceKm.toFixed(3) : null, speedKmh: c.speedKmh ? +c.speedKmh.toFixed(3) : null,
        weightKg, formula, kcal: +c.kcal.toFixed(1), estimate: c.estimate, source: 'sample', note: note || '' });
    }
    for (let i = days; i >= 1; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const dow = d.getDay(), progress = 1 - i / days;           // fitness improves over time
      if (R() < 0.12) continue;                                    // rest days
      // Runs: Tue / Thu / Sat (long run)
      if (dow === 2 || dow === 4 || (dow === 6)) {
        const long = dow === 6;
        const mi = long ? 5 + R() * 4 + progress * 2 : 2.5 + R() * 2.5;
        const paceMin = (long ? 10.2 : 9.6) - progress * 1.4 + (R() - 0.5) * 0.7;   // min/mile
        add(d, 'p:run', { mode: 'distance', distanceKm: mi * C.KM_PER_MI, durationMin: mi * paceMin }, 7, long ? 'Long run' : '');
      }
      if (dow === 1 || dow === 5) {
        add(d, 'p:weights', { mode: 'duration', durationMin: 40 + Math.round(R() * 20) }, 18);
        add(d, 'p:pushups', { mode: 'reps', reps: 15 + Math.round(R() * 10), sets: 3 }, 18);
      }
      if (dow === 3) add(d, R() < 0.5 ? 'p:yoga' : 'p:vinyasa', { mode: 'duration', durationMin: 30 + Math.round(R() * 30) }, 19);
      if (dow === 0) add(d, 'p:bike', { mode: 'distance', distanceKm: (10 + R() * 15) * C.KM_PER_MI, durationMin: 50 + R() * 60 }, 10);
      if (R() < 0.35) add(d, 'p:walk', { mode: 'distance', distanceKm: (1 + R() * 2) * C.KM_PER_MI, durationMin: 20 + R() * 25 }, 12);
      if (R() < 0.15) add(d, 'p:hiit', { mode: 'duration', durationMin: 15 + Math.round(R() * 10) }, 17);
      if (R() < 0.12) add(d, 'p:basketball', { mode: 'duration', durationMin: 45 + Math.round(R() * 30) }, 20);
      if (R() < 0.2) add(d, 'p:burpees', { mode: 'reps', reps: 20, sets: 2 }, 8);
      if (R() < 0.08) add(d, 'p:hike', { mode: 'distance', distanceKm: (4 + R() * 4) * C.KM_PER_MI, durationMin: 120 + R() * 80 }, 9);
      if (R() < 0.06) add(d, 'p:mowing', { mode: 'duration', durationMin: 40 }, 16);
    }
    return out;
  }
  root.BLSample = { generate };
})(window);
