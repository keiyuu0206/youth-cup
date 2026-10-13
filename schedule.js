import { roundRobin } from './grouping.js';
import { buildKnockout } from './bracket.js';
import { slotTimes, matchLength } from './time.js';

/**
 * 1カテゴリ分の試合を生成する
 * teams: [{id, group_label}]
 * koOrder: トーナメントのみの場合のチームの並び（抽選結果）
 * 戻り値: { matches, error }
 */
export function generateCategory(cfg, teams, koOrder) {
  const league = [];
  const groupSizes = {};

  if (cfg.format === 'league' || cfg.format === 'league_knockout') {
    const groups = {};
    for (const t of teams) {
      if (!t.group_label) return { matches: [], error: '組が決まっていないチームがあります' };
      (groups[t.group_label] ||= []).push(t.id);
    }
    const labels = Object.keys(groups).sort();
    labels.forEach((g, gi) => {
      groupSizes[g] = groups[g].length;
      roundRobin(groups[g]).forEach((pairs, r) => {
        pairs.forEach(([h, a], idx) => {
          league.push({ stage: 'league', group_label: g, gi, round: r + 1, idx, home_team_id: h, away_team_id: a, home_ref: null, away_ref: null });
        });
      });
    });
    if (!league.length) return { matches: [], error: '試合を作れるチーム数がありません' };
  }

  let ko = [];
  if (cfg.format === 'knockout' || cfg.format === 'league_knockout') {
    const res = buildKnockout(cfg, {
      format: cfg.format,
      teamIds: koOrder && koOrder.length ? koOrder : teams.map((t) => t.id),
      groupSizes,
    });
    if (res.error) return { matches: [], error: res.error };
    ko = res.matches.map((m) => ({
      stage: 'knockout',
      group_label: m.bracket || null, // 複数トーナメントのときのトーナメント名
      round: m.level + 1,
      code: m.code,
      label: m.label,
      level: m.level,
      base: m.base,
      place_w: m.place_w ?? null,
      place_l: m.place_l ?? null,
      home_ref: m.home,
      away_ref: m.away,
      home_team_id: m.home && m.home.t === 'team' ? m.home.id : null,
      away_team_id: m.away && m.away.t === 'team' ? m.away.id : null,
    }));
  }

  placeMatches(cfg, league, ko);
  const all = [...league, ...ko];
  dropRestAroundLunch(cfg, all);
  applyTimes(cfg, all);
  for (const m of league) m.label = `${m.group_label}組 第${m.round}節`;
  return { matches: all };
}

export function placeMatches(cfg, league, ko) {
  const courts = cfg.courts;
  const minRest = cfg.minRestSlots ?? 1;
  const lastSlot = new Map();
  const groupLast = {};
  const pending = [...league].sort((a, b) => a.round - b.round || a.gi - b.gi || a.idx - b.idx);
  let s = 0;

  const rested = (id) => s - (lastSlot.has(id) ? lastSlot.get(id) : -99) > minRest;

  while (pending.length) {
    const chosen = [];
    const busy = new Set();
    for (const strict of [true, false]) {
      if (!strict && chosen.length) break; // 休憩を確保できる試合があれば、それだけで枠を構成する
      for (const m of pending) {
        if (chosen.length >= courts) break;
        if (chosen.includes(m) || busy.has(m.home_team_id) || busy.has(m.away_team_id)) continue;
        if (strict && !(rested(m.home_team_id) && rested(m.away_team_id))) continue;
        chosen.push(m);
        busy.add(m.home_team_id);
        busy.add(m.away_team_id);
      }
    }
    const used = new Set();
    // 組とコートを対応させる（A組→1番コート…）
    for (const m of chosen) {
      const pref = m.gi % courts;
      m.court = used.has(pref) ? [...Array(courts).keys()].find((c) => !used.has(c)) : pref;
      used.add(m.court);
      m.slot = s;
      lastSlot.set(m.home_team_id, s);
      lastSlot.set(m.away_team_id, s);
      groupLast[m.group_label] = s;
      pending.splice(pending.indexOf(m), 1);
    }
    s++;
  }

  const leagueEnd = s;
  const usage = {};
  const slotOf = {};
  for (const m of ko) {
    let earliest = leagueEnd;
    for (const ref of [m.home_ref, m.away_ref]) {
      if (!ref) continue;
      if (ref.t === 'grp' && groupLast[ref.g] != null) earliest = Math.max(earliest, groupLast[ref.g] + 1 + minRest);
      if ((ref.t === 'win' || ref.t === 'lose') && slotOf[ref.m] != null) earliest = Math.max(earliest, slotOf[ref.m] + 1 + minRest);
    }
    let slot = earliest;
    while ((usage[slot] || 0) >= courts) slot++;
    m.slot = slot;
    m.court = usage[slot] || 0;
    usage[slot] = (usage[slot] || 0) + 1;
    slotOf[m.code] = slot;
  }

  // 使われなかった枠を詰める（トーナメント前の空き枠を1つまでに）
  const allM = [...league, ...ko];
  const usedSlots = [...new Set(allM.map((m) => m.slot))].sort((a, b) => a - b);
  const remap = {};
  let cursor = 0;
  let prev = null;
  for (const sl of usedSlots) {
    if (prev != null && sl - prev > 1) cursor += Math.min(sl - prev - 1, Math.max(minRest, 0));
    remap[sl] = cursor++;
    prev = sl;
  }
  for (const m of allM) m.slot = remap[m.slot];
}

// 昼休憩が休憩を兼ねるので、昼休憩の直前・直後にできた空き枠は詰める
export function dropRestAroundLunch(cfg, matches) {
  for (let guard = 0; guard < 4; guard++) {
    const n = matches.reduce((mx, m) => Math.max(mx, m.slot), -1) + 1;
    const times = slotTimes(cfg, n);
    const used = new Set(matches.map((m) => m.slot));
    const firstPm = times.findIndex((t) => t.session === 'pm');
    if (firstPm <= 0) return;
    const empty = [firstPm - 1, firstPm].find((i) => i >= 0 && i < n && !used.has(i));
    if (empty == null) return;
    for (const m of matches) if (m.slot > empty) m.slot--;
  }
}

export function applyTimes(cfg, matches) {
  const n = matches.reduce((mx, m) => Math.max(mx, m.slot), -1) + 1;
  const times = slotTimes(cfg, n);
  for (const m of matches) {
    m.start_min = times[m.slot].start;
    m.session = times[m.slot].session;
  }
}

// 同じチームの同時刻・連戦・時間の重なりを検出
export function scheduleWarnings(cfg, matches, teamName = (id) => id) {
  const len = matchLength(cfg);
  const byTeam = {};
  for (const m of matches) {
    for (const id of [m.home_team_id, m.away_team_id]) if (id) (byTeam[id] ||= []).push(m);
  }
  const out = [];
  for (const [id, list] of Object.entries(byTeam)) {
    list.sort((a, b) => a.start_min - b.start_min);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].start_min - (list[i - 1].start_min + len);
      const ids = [list[i - 1].id, list[i].id];
      if (gap < 0) out.push({ level: 'error', ids, text: `${teamName(id)} の試合が時間的に重なっています（${list[i - 1].label} と ${list[i].label}）` });
      else if (cfg.minRestSlots > 0 && gap < len) out.push({ level: 'warn', ids, text: `${teamName(id)} が休憩なしで連戦になります（${list[i - 1].label} → ${list[i].label}）` });
    }
  }
  return out;
}

/**
 * 当日の遅延調整（コート単位）
 * matches: カテゴリ内の全試合、target: 起点の試合
 * lunchMode: undefined のとき昼休憩にかかるなら選択肢を返す
 * 戻り値: { needsLunchChoice, options, changes: [{id, start_min}], warnings }
 */
export function planDelay(cfg, matches, target, minutes, lunchMode, teamName = (id) => id) {
  const len = matchLength(cfg);
  const affected = matches
    .filter((m) => m.court === target.court && m.start_min >= target.start_min && m.status === 'none')
    .sort((a, b) => a.start_min - b.start_min);
  const am = affected.filter((m) => m.session === 'am');
  const pm = affected.filter((m) => m.session === 'pm');

  let shiftAm = minutes;
  let shiftPm = minutes;
  let result = null;

  if (minutes > 0 && cfg.lunchEnabled && am.length && pm.length) {
    const lastAmEnd = Math.max(...am.map((m) => m.start_min)) + len;
    const firstPm = Math.min(...pm.map((m) => m.start_min));
    const gapNow = firstPm - lastAmEnd;
    const minLunch = Math.min(cfg.minLunchMinutes || 0, gapNow);
    const absorb = Math.max(0, Math.min(minutes, gapNow - minLunch));
    const options = {
      shorten: { lunch: gapNow - absorb, pmShift: minutes - absorb, pmStart: firstPm + (minutes - absorb), lunchBefore: gapNow },
      shift: { lunch: gapNow, pmShift: minutes, pmStart: firstPm + minutes, lunchBefore: gapNow },
    };
    if (!lunchMode) result = { needsLunchChoice: true, options };
    else shiftPm = lunchMode === 'shorten' ? options.shorten.pmShift : minutes;
    if (result) {
      // 選択肢ごとの警告も事前に出しておく
      for (const key of ['shorten', 'shift']) {
        const ch = affected.map((m) => ({ id: m.id, start_min: m.start_min + (m.session === 'am' ? shiftAm : options[key].pmShift) }));
        options[key].warnings = delayWarnings(cfg, matches, ch, teamName);
      }
      return result;
    }
  }

  const changes = affected.map((m) => ({ id: m.id, start_min: m.start_min + (m.session === 'am' ? shiftAm : shiftPm) }));
  return { needsLunchChoice: false, changes, warnings: delayWarnings(cfg, matches, changes, teamName) };
}

// 変更した試合が関わる警告だけを返す
function delayWarnings(cfg, matches, changes, teamName) {
  const map = Object.fromEntries(changes.map((c) => [c.id, c.start_min]));
  const sim = matches.map((m) => ({ ...m, start_min: map[m.id] ?? m.start_min }));
  const changed = new Set(changes.map((c) => c.id));
  const before = new Set(scheduleWarnings(cfg, matches, teamName).map((w) => w.text));
  return scheduleWarnings(cfg, sim, teamName).filter((w) => w.ids.some((id) => changed.has(id)) && !before.has(w.text));
}
