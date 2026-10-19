/* BurnLog — rule-based free-text activity parser.
 * parse(text, opts) -> { items: [ {status:'ok'|'unmatched', text, exId, input, notes, confidence, suggestions, dateOffset} ] }
 * Pipeline: normalize (word numbers, idioms) -> split into clauses -> find activity phrases (synonym
 * dictionary, longest match first; fuzzy Compendium search as fallback) -> extract quantities
 * (sets×reps, durations, distances, weights) -> attach quantities to the nearest activity.
 * AI hook: BLParser.register(async (text, ctx) => items|null) — registered parsers run first (see app.js).
 */
(function (root) {
  'use strict';
  const C = root.BLCalc;

  const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  const STOP = new Set(('i im i\'m ive i\'ve did do done doing a an the of for in at my me some today this morning afternoon evening tonight ' +
    'yesterday just went go got had have about around approx approximately roughly nearly almost over and with then total ' +
    'workout workouts session sessions quick little bit on to it was were is be been also plus few couple reps rep sets set times time ' +
    'x min mins minute minutes hour hours hr hrs h sec secs second seconds mile miles mi km k kms kilometer kilometers kilometre kilometres ' +
    'meter meters metre metres m yd yds yard yards lap laps lb lbs pound pounds kg kgs kilo kilos my our we us played play playing ' +
    'easy hard light moderate vigorous fast slow long short good great quickly straight non stop nonstop pace a.m p.m am pm ' +
    'did\'nt then after before during while like each every').split(/\s+/));

  // ---- synonym dictionary (normalized phrase -> exercise id), longest first ----
  const SYN = [];
  C.exercises.forEach(ex => { if (ex.preset) ex.syn.concat([ex.name]).forEach(s => SYN.push({ p: normPhrase(s), id: ex.id })); });
  const seen = new Set();
  const SYNS = SYN.filter(s => { if (!s.p || seen.has(s.p)) return false; seen.add(s.p); return true; })
    .sort((a, b) => b.p.length - a.p.length);
  const SYN_RE = SYNS.map(s => ({ id: s.id, p: s.p, re: new RegExp('(^|[^a-z])(' + s.p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+') + ')(?=$|[^a-z])', 'g') }));

  function normPhrase(s) { return String(s).toLowerCase().replace(/[‐-―-]/g, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(); }

  function wordNumbers(t) {
    // "twenty five" -> 25, "thirty" -> 30, "one" -> 1
    t = t.replace(new RegExp('\\b(' + Object.keys(TENS).join('|') + ')(?:[\\s-](' + Object.keys(ONES).filter(k => ONES[k] > 0 && ONES[k] < 10).join('|') + '))?\\b', 'g'),
      (m, a, b) => String(TENS[a] + (b ? ONES[b] : 0)));
    t = t.replace(new RegExp('\\b(' + Object.keys(ONES).join('|') + ')\\b', 'g'), (m, a) => String(ONES[a]));
    t = t.replace(/\b(\d+) hundred\b/g, (m, a) => String(+a * 100)).replace(/\b(?:a|one) hundred\b/g, '100');
    t = t.replace(/\ba dozen\b/g, '12').replace(/\bdozen\b/g, '12');
    t = t.replace(/\ba couple(?: of)?\b/g, '2').replace(/\ba few\b/g, '3');
    return t;
  }

  function normalize(text) {
    let t = ' ' + String(text || '').toLowerCase() + ' ';
    t = t.replace(/[’']/g, "'").replace(/[–—]/g, '-').replace(/×/g, 'x');
    t = wordNumbers(t);
    // fractions & idioms
    t = t.replace(/(\d+)\s+(\d)\/(\d)/g, (m, w, a, b) => String(+w + a / b));
    t = t.replace(/(\d)\/(\d)/g, (m, a, b) => String(a / b));
    t = t.replace(/(\d+(?:\.\d+)?)\s*(?:and a half|& a half|½)/g, (m, a) => String(+a + 0.5));
    t = t.replace(/\b(?:an|a|1) hour and a half\b/g, ' 90 min ').replace(/\bhour and a half\b/g, ' 90 min ');
    t = t.replace(/\bhalf (?:an|a) hour\b/g, ' 30 min ').replace(/\bhalf hour\b/g, ' 30 min ');
    t = t.replace(/\bquarter (?:of )?(?:an|a) hour\b/g, ' 15 min ');
    t = t.replace(/\bhalf (?:a )?mile\b/g, ' 0.5 mi ');
    t = t.replace(/\bhalf[\s-]?marathon\b/g, ' 21.0975 km run ').replace(/\bmarathon\b/g, ' 42.195 km run ');
    t = t.replace(/\b(?:an|a) (hour|hr|mile|minute|min|kilometer|kilometre|km|lap)\b/g, ' 1 $1');
    // "1h30", "1h 30m", "1 hr 20 min" -> minutes
    t = t.replace(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:and\s*)?(\d{1,2})\s*(?:m|min|mins|minute|minutes)?\b(?!\s*(?:mi|mile|miles|km|k\b|meters?|metres?|yards?|yd|laps?|reps?|sets?))/g,
      (m, h, mm) => ' ' + (+h * 60 + +mm) + ' min ');
    // "28 min and 30 sec", "28m30s"
    t = t.replace(/\b(\d+)\s*(?:m|min|mins|minutes?)\s*(?:and\s*)?(\d{1,2})\s*(?:s|sec|secs|seconds?)\b/g, (m, a, b) => ' ' + (+a + b / 60).toFixed(3) + ' min ');
    // h:mm:ss and mm:ss clocks
    t = t.replace(/\b(\d{1,2}):(\d{2}):(\d{2})\b/g, (m, h, mm, ss) => ' ' + (+h * 60 + +mm + ss / 60).toFixed(3) + ' min ');
    t = t.replace(/\b(\d{1,3}):(\d{2})\s*(h|hr|hrs|hours?)\b/g, (m, h, mm) => ' ' + (+h * 60 + +mm) + ' min ');
    t = t.replace(/\b(\d{1,3}):(\d{2})\b/g, (m, mm, ss) => ' ' + (+mm + ss / 60).toFixed(3) + ' min ');
    t = t.replace(/(\d),(\d{3})\b/g, '$1$2');               // 1,000 -> 1000
    t = t.replace(/(\d)\s*-\s*(min|minute|mile|hour|km|k)\b/g, '$1 $2');  // 30-minute
    t = t.replace(/[‐-―-]/g, ' ').replace(/[!?;]+/g, ' , ').replace(/\s+/g, ' ');
    return t.trim();
  }

  const RX = {
    steps: /\b(\d+(?:\.\d+)?)\s*(k)?\s*steps?\b/g,
    setsReps: /\b(\d+)\s*(?:x|sets? of|sets? x)\s*(\d+)\b(?:\s*reps?\b)?/g,
    repsSets: /\b(\d+)\s*reps?\s*(?:x|by|,)?\s*(\d+)\s*sets?\b/g,
    weight: /\b(?:at|@|with)?\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?|kg|kgs|kilos?)\b/g,
    dist: /\b(\d+(?:\.\d+)?)\s*(mi|miles?|km|kms|k|kilomet(?:er|re)s?|m|meters?|metres?|yd|yds|yards?|laps?)(?![a-z])/g,
    dur: /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)(?![a-z])/g,
    sets: /\b(\d+)\s*sets?\b/g,
    reps: /\b(\d+)\s*(?:reps?|times|x)\b/g,
    bare: /\b(\d+(?:\.\d+)?)\b/g,
  };

  function splitClauses(t) {
    return t.split(/\s*(?:,|\.(?=\s|$)|\band then\b|\bthen\b|\band also\b|\band\b|\bplus\b|&|\+|\bfollowed by\b|\balso\b|\bafter that\b|\bas well as\b|\bwith\b)\s*/)
      .map(s => s.trim()).filter(Boolean);
  }

  function findActivities(seg) {
    const hits = [];
    const taken = new Array(seg.length).fill(false);
    for (const s of SYN_RE) {
      s.re.lastIndex = 0; let m;
      while ((m = s.re.exec(seg))) {
        const start = m.index + m[1].length, end = start + m[2].length;
        let clash = false; for (let i = start; i < end; i++) if (taken[i]) { clash = true; break; }
        if (clash) continue;
        for (let i = start; i < end; i++) taken[i] = true;
        hits.push({ id: s.id, start, end, phrase: m[2] });
      }
    }
    return hits.sort((a, b) => a.start - b.start);
  }

  function extractQuantities(seg, opts) {
    const q = []; const used = new Array(seg.length).fill(false);
    function take(re, fn) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(seg))) {
        let busy = false; for (let i = m.index; i < m.index + m[0].length; i++) if (used[i]) { busy = true; break; }
        if (busy) continue;
        const r = fn(m); if (!r) continue;
        for (let i = m.index; i < m.index + m[0].length; i++) used[i] = true;
        r.start = m.index; r.end = m.index + m[0].length; q.push(r);
      }
    }
    take(RX.steps, m => ({ type: 'dist', km: (+m[1] * (m[2] ? 1000 : 1)) / 2000 * C.KM_PER_MI, steps: true, raw: m[0] }));
    take(RX.setsReps, m => ({ type: 'setsreps', sets: +m[1], reps: +m[2] }));
    take(RX.repsSets, m => ({ type: 'setsreps', sets: +m[2], reps: +m[1] }));
    take(RX.weight, m => ({ type: 'weight', value: +m[1] }));
    take(RX.dist, m => {
      const v = +m[1], u = m[2];
      if (/^(mi|miles?)$/.test(u)) return { type: 'dist', km: C.miToKm(v), raw: m[0] };
      if (/^(km|kms|k|kilomet)/.test(u)) return { type: 'dist', km: v, raw: m[0] };
      if (u === 'm') { if (v < 100) return null; return { type: 'dist', km: v / 1000, raw: m[0] }; }  // small "m" = minutes
      if (/^(meters?|metres?)$/.test(u)) return { type: 'dist', km: v / 1000, raw: m[0] };
      if (/^(yd|yds|yards?)$/.test(u)) return { type: 'dist', km: v * C.M_PER_YD / 1000, raw: m[0] };
      if (/^laps?$/.test(u)) return { type: 'laps', laps: v, raw: m[0] };
      return null;
    });
    take(RX.dur, m => {
      const v = +m[1], u = m[2];
      if (/^(h|hr|hrs|hours?)$/.test(u)) return { type: 'dur', min: v * 60 };
      if (/^(m|min|mins|minutes?)$/.test(u)) return { type: 'dur', min: v };
      return { type: 'dur', min: v / 60 };
    });
    take(RX.sets, m => ({ type: 'sets', sets: +m[1] }));
    take(RX.reps, m => ({ type: 'reps', reps: +m[1] }));
    take(RX.bare, m => ({ type: 'bare', value: +m[1] }));
    return q.sort((a, b) => a.start - b.start);
  }

  // Fuzzy fallback over the whole Compendium (+ presets). Returns ranked [{ex, score}]
  function stem(w) { return w.replace(/(ing|ed|es|s)$/, ''); }
  function contentTokens(seg) {
    return seg.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  }
  function fuzzy(seg, limit) {
    const toks = contentTokens(seg); if (!toks.length) return { toks, list: [] };
    const st = toks.map(stem);
    const list = [];
    for (const ex of C.exercises) {
      const hay = (ex.name + ' ' + ex.syn.join(' ') + ' ' + ex.cat).toLowerCase();
      const raw = hay.replace(/[^a-z\s]/g, ' ').split(/\s+/);
      const words = raw.map(stem);
      let score = 0, all = true;
      st.forEach((t, i) => {
        if (raw.includes(toks[i])) score += 2.5;
        else if (words.includes(t)) score += 2;
        else if (t.length >= 4 && words.some(w => w.startsWith(t) || (w.length >= 4 && t.startsWith(w)))) score += 1;
        else all = false;
      });
      if (score > 0) list.push({ ex, score: score + (ex.preset ? 0.5 : 0) - Math.min(ex.name.length, 120) / 400, all });
    }
    list.sort((a, b) => b.score - a.score);
    return { toks, list: list.slice(0, limit || 5) };
  }

  const POPULAR = ['p:run', 'p:walk', 'p:bike', 'p:pushups', 'p:yoga', 'p:weights', 'p:hiit', 'p:squats'];

  function buildInput(ex, qs, opts, notes) {
    const input = { mode: ex.kind === 'reps' ? 'reps' : ex.kind === 'distance' ? 'distance' : 'duration' };
    let dist = null, dur = null, reps = null, sets = null, bare = [];
    qs.forEach(x => {
      if (x.type === 'dist') { dist = (dist || 0) + x.km; if (x.steps) notes.push('Steps → distance at ~2,000 steps/mi'); }
      else if (x.type === 'laps') {
        const perLapKm = ex.table === 'swim' ? 25 * C.M_PER_YD / 1000 : 0.4;
        dist = (dist || 0) + x.laps * perLapKm;
        notes.push(ex.table === 'swim' ? 'Assumed 25-yd pool laps' : 'Assumed 400 m track laps');
      }
      else if (x.type === 'dur') dur = (dur || 0) + x.min;
      else if (x.type === 'setsreps') { sets = x.sets; reps = x.reps; }
      else if (x.type === 'sets') sets = x.sets;
      else if (x.type === 'reps') reps = x.reps;
      else if (x.type === 'weight') notes.push('Load ' + x.value + ' noted (not used in MET math)');
      else if (x.type === 'bare') bare.push(x.value);
    });
    if (ex.kind === 'reps') {
      if (reps == null && bare.length) reps = bare.shift();
      if (sets == null && bare.length && reps != null) sets = bare.shift();
      if (reps != null) { input.mode = 'reps'; input.reps = reps; input.sets = sets || 1; }
      else if (dur != null) { input.mode = 'duration'; input.durationMin = dur; }
      else { input.mode = 'reps'; input.reps = 10; input.sets = sets || 1; notes.push('No count given — assumed 10 reps'); return { input, assumed: true }; }
    } else if (ex.kind === 'distance') {
      if (dist == null && bare.length && dur == null && bare[0] > 40) { dur = bare.shift(); notes.push(`Assumed ${dur} minutes`); }
      if (dist == null && bare.length && dur == null) {
        const v = bare.shift();
        if (opts.distUnit === 'km') dist = v; else dist = C.miToKm(v);
        notes.push(`Assumed ${v} ${opts.distUnit === 'km' ? 'km' : 'mi'}`);
      }
      if (dist != null) { input.mode = 'distance'; input.distanceKm = dist; if (dur != null) input.durationMin = dur; }
      else if (dur != null) { input.mode = 'distance'; input.durationMin = dur; }
      else { input.mode = 'distance'; input.durationMin = 30; notes.push('No distance or time — assumed 30 min'); return { input, assumed: true }; }
    } else {
      if (dur == null && bare.length) { dur = bare.shift(); notes.push(`Assumed ${dur} minutes`); }
      if (dur == null && reps != null) { dur = reps * 3 / 60; notes.push('Counted reps at ~3s each'); }
      if (dur != null) input.durationMin = dur;
      else { input.durationMin = 30; notes.push('No time given — assumed 30 min'); return { input, assumed: true }; }
    }
    return { input, assumed: false };
  }

  function parse(text, opts) {
    opts = opts || {};
    const norm = normalize(text);
    const dateOffset = /\byesterday\b|\blast night\b/.test(norm) ? -1 : 0;
    const clauses = splitClauses(norm);
    const groups = [];   // {ex, phrase, qs:[], text}
    const orphans = [];  // clause text with no activity
    clauses.forEach(cl => {
      const acts = findActivities(cl);
      const qs = extractQuantities(cl, opts);
      if (!acts.length) {
        // try fuzzy over the Compendium
        const fz = fuzzy(cl, 5);
        const top = fz.list[0];
        if (top && top.all && fz.toks.length && top.score >= 2 * fz.toks.length - 0.5) {
          groups.push({ ex: top.ex, phrase: fz.toks.join(' '), qs, text: cl, fuzzy: true });
        } else if (qs.length && !fz.toks.length && groups.length) {
          // quantities only ("and 30 seconds"): attach to the previous activity
          groups[groups.length - 1].qs.push(...qs);
        } else {
          orphans.push({ text: cl, qs, suggestions: fz.list.map(x => x.ex.id) });
        }
        return;
      }
      const gs = [];
      acts.forEach(a => {
        const last = gs[gs.length - 1];
        if (last && last.ex.id === a.id) { last.end = a.end; return; }   // "ran a half marathon run" -> one activity
        gs.push({ ex: C.byId[a.id], phrase: a.phrase, start: a.start, end: a.end, qs: [], text: cl });
      });
      qs.forEach(qq => {
        // A count right before an activity ("20 squats", "3x10 push ups") belongs to the following activity.
        // Unit quantities after an activity ("ran 3 miles") belong to the preceding one.
        let target = gs.find(g => qq.start < g.end && qq.end > g.start) || null;
        if (target) { target.qs.push(qq); return; }
        const next = gs.find(g => g.start >= qq.end);
        const prev = [...gs].reverse().find(g => g.end <= qq.start);
        const gapNext = next ? cl.slice(qq.end, next.start).trim() : null;
        const countLike = ['bare', 'reps', 'setsreps', 'sets'].includes(qq.type);
        if (next && countLike && /^(?:(?:reps?|sets?|x|of|times)\s*)*$/.test(gapNext)) target = next;
        else if (next && !prev) target = next;
        else if (prev && next && !countLike && /^(?:of|for|doing|mins? of|minutes of)?\s*$/.test(gapNext) && !prev.qs.length) target = prev;
        else if (prev && next && qq.type === 'dur' && /^(?:of)?$/.test(gapNext)) target = next;
        else target = prev || next;
        target.qs.push(qq);
      });
      groups.push(...gs);
    });
    // Inherit quantity for bare activities: "10 push-ups and sit-ups"
    for (let i = 1; i < groups.length; i++) {
      const g = groups[i], p = groups[i - 1];
      if (!g.qs.length && p.qs.length && p.ex.kind === g.ex.kind) { g.qs = p.qs.map(x => ({ ...x })); g.inherited = true; }
    }
    const items = groups.map(g => {
      const notes = [];
      if (g.fuzzy) notes.push('Best guess from Compendium: ' + g.ex.code);
      if (g.inherited) notes.push('Same amount as previous activity');
      const { input, assumed } = buildInput(g.ex, g.qs, opts, notes);
      return { status: 'ok', text: g.text, phrase: g.phrase, exId: g.ex.id, input, notes,
        confidence: g.fuzzy ? 0.5 : assumed ? 0.6 : 0.95, dateOffset };
    });
    orphans.forEach(o => {
      if (!contentTokens(o.text).length && !o.qs.length) return; // filler like "today"
      const sug = o.suggestions.length ? o.suggestions.slice(0, 4) : POPULAR.slice(0, 4);
      const durQ = o.qs.find(x => x.type === 'dur');
      items.push({ status: 'unmatched', text: o.text, suggestions: sug, durationMin: durQ ? durQ.min : null,
        qs: o.qs, notes: [], dateOffset });
    });
    return { text, normalized: norm, items };
  }

  function rebuildWith(item, exId, opts) {
    const ex = C.byId[exId]; const notes = [];
    const { input } = buildInput(ex, item.qs || [], opts || {}, notes);
    return { status: 'ok', text: item.text, exId, input, notes, confidence: 0.7, dateOffset: item.dateOffset || 0 };
  }

  root.BLParser = { parse, normalize, splitClauses, fuzzy, rebuildWith, POPULAR, _syns: SYNS };
})(typeof window !== 'undefined' ? window : globalThis);
