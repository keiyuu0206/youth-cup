import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, slotTimes, toHHMM } from './time.js';
import { assignGroups, roundRobin } from './grouping.js';
import { buildKnockout, crossEntrants } from './bracket.js';
import { generateCategory, planDelay, scheduleWarnings } from './schedule.js';
import { computeStandings, evaluateCategory } from './standings.js';

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `チーム${i + 1}`, club: '' }));

test('総当たり: 4チームで6試合、全組み合わせが1回ずつ', () => {
  const r = roundRobin(['a', 'b', 'c', 'd']).flat();
  assert.equal(r.length, 6);
  assert.equal(new Set(r.map((p) => [...p].sort().join())).size, 6);
});

test('時間枠: 昼休憩をまたぐ試合は休憩後に回る', () => {
  const c = normalizeConfig({ startTime: 540, halfMinutes: 20, halftimeMinutes: 5, intervalMinutes: 5, lunchStart: 720, lunchMinutes: 45 });
  const t = slotTimes(c, 6);
  // 9:00, 9:50, 10:40, 11:30(→12:15終了で昼をまたぐので休憩後)
  assert.deepEqual(t.slice(0, 3).map((x) => toHHMM(x.start)), ['09:00', '09:50', '10:40']);
  assert.equal(toHHMM(t[3].start), '12:10'); // 10:40開始の試合が11:25に終わり、45分の昼休憩
  assert.equal(t[3].session, 'pm');
});

test('組み分け: 同じクラブ・同組NG・主催者固定を守る', () => {
  const ts = teams(16);
  ts[0].club = 'FC東'; ts[1].club = 'FC東';
  const res = assignGroups(ts, { groups: 4, fixed: { t5: 'A' }, separate: [['t3', 't4']] }, seeded(7));
  assert.equal(res.warnings.length, 0);
  assert.equal(res.assignment.t5, 'A');
  assert.notEqual(res.assignment.t1, res.assignment.t2);
  assert.notEqual(res.assignment.t3, res.assignment.t4);
  const sizes = Object.values(res.assignment).reduce((a, g) => ({ ...a, [g]: (a[g] || 0) + 1 }), {});
  assert.deepEqual(Object.values(sizes), [4, 4, 4, 4]);
});

test('クロス方式: 4組上位2チームの並び', () => {
  const e = crossEntrants(4, 2).map((r) => `${r.g}${r.r}`);
  assert.deepEqual(e, ['A1', 'B2', 'C1', 'D2', 'B1', 'A2', 'D1', 'C2']);
});

test('トーナメント: 6チームは不戦あり、3位決定戦あり', () => {
  const cfg = normalizeConfig({ format: 'knockout', rankMode: 'top3' });
  const { matches } = buildKnockout(cfg, { format: 'knockout', teamIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.equal(matches.filter((m) => m.label.startsWith('準々決勝')).length, 2);
  assert.ok(matches.some((m) => m.label === '3位決定戦'));
  assert.equal(matches[matches.length - 1].label, '決勝');
});

test('全順位決定: 8チームで12試合、1〜8位が決まる', () => {
  const cfg = normalizeConfig({ format: 'knockout', rankMode: 'all' });
  const { matches } = buildKnockout(cfg, { format: 'knockout', teamIds: 'abcdefgh'.split('') });
  assert.equal(matches.length, 12);
  const places = matches.flatMap((m) => [m.place_w, m.place_l]).filter(Boolean).sort((a, b) => a - b);
  assert.deepEqual(places, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('日程: 16チーム4組2コートでチームの重複がない', () => {
  const cfg = normalizeConfig({ format: 'league_knockout', groups: 4, courts: 2, advance: 2 });
  const ts = teams(16).map((t, i) => ({ ...t, group_label: 'ABCD'[i % 4] }));
  const { matches, error } = generateCategory(cfg, ts);
  assert.equal(error, undefined);
  assert.equal(matches.filter((m) => m.stage === 'league').length, 24);
  assert.equal(matches.filter((m) => m.stage === 'knockout').length, 8); // QF4 + SF2 + 3決 + 決勝
  const ids = matches.map((m, i) => ({ ...m, id: `m${i}` }));
  assert.equal(scheduleWarnings(cfg, ids).filter((w) => w.level === 'error').length, 0);
  // 同じ枠・同じコートに2試合入らない
  assert.equal(new Set(matches.map((m) => `${m.slot}-${m.court}`)).size, matches.length);
});

test('順位: 総合成績優先と当該対戦優先で結果が変わる', () => {
  // A,B が勝点6で並ぶ。得失点差はAが上、当該対戦はBの勝ち
  const m = (h, a, hs, as) => ({ home_team_id: h, away_team_id: a, home_score: hs, away_score: as, status: 'confirmed', stage: 'league' });
  const ms = [m('A', 'C', 9, 0), m('B', 'A', 1, 0), m('A', 'D', 1, 0), m('C', 'B', 1, 0), m('B', 'D', 1, 0), m('C', 'D', 0, 0)];
  const overall = computeStandings(['A', 'B', 'C', 'D'], ms, ['points', 'gd', 'gf', 'h2h', 'lottery']);
  assert.equal(overall.rows[0].teamId, 'A');
  const h2h = computeStandings(['A', 'B', 'C', 'D'], ms, ['points', 'h2h', 'gd', 'gf', 'lottery']);
  assert.equal(h2h.rows[0].teamId, 'B');
});

test('順位: 抽選待ちと抽選入力', () => {
  const m = (h, a, hs, as) => ({ home_team_id: h, away_team_id: a, home_score: hs, away_score: as, status: 'confirmed', stage: 'league' });
  const ms = [m('A', 'B', 1, 1)];
  const s1 = computeStandings(['A', 'B'], ms, ['points', 'gd', 'gf', 'h2h', 'lottery']);
  assert.equal(s1.needsLottery, true);
  const s2 = computeStandings(['A', 'B'], ms, ['points', 'gd', 'gf', 'h2h', 'lottery'], ['B', 'A']);
  assert.equal(s2.rows[0].teamId, 'B');
  assert.equal(s2.rows[0].lottery, true);
});

test('参照解決: 予選が確定すると決勝トーナメントにチームが入る', () => {
  const cfg = normalizeConfig({ format: 'league_knockout', groups: 2, courts: 2, advance: 2 });
  const ts = teams(8).map((t, i) => ({ ...t, group_label: 'AB'[i % 2] }));
  const { matches } = generateCategory(cfg, ts);
  const ms = matches.map((m, i) => ({ ...m, id: `m${i}`, status: 'none' }));
  for (const m of ms.filter((x) => x.stage === 'league')) {
    // 番号の若いチームが勝つ
    const hn = Number(m.home_team_id.slice(1));
    const an = Number(m.away_team_id.slice(1));
    Object.assign(m, { status: 'confirmed', home_score: hn < an ? 2 : 0, away_score: hn < an ? 0 : 2 });
  }
  const ev = evaluateCategory(cfg, ts, ms);
  assert.equal(ev.standings.A.rows[0].teamId, 't1');
  assert.equal(ev.standings.B.rows[0].teamId, 't2');
  const sf = ev.updates; // 準決勝2試合が埋まる
  assert.equal(sf.length, 2);
  assert.ok(sf.some((u) => u.home_team_id === 't1' && u.away_team_id === 't4')); // A1 vs B2
});

test('遅延調整: 昼休憩にかかる場合は選択肢を返す', () => {
  const cfg = normalizeConfig({ format: 'league', groups: 1, courts: 1, halfMinutes: 10, halftimeMinutes: 5, intervalMinutes: 5, lunchStart: 660, lunchMinutes: 40 });
  const ts = teams(4).map((t) => ({ ...t, group_label: 'A' }));
  const { matches } = generateCategory(cfg, ts);
  const ms = matches.map((m, i) => ({ ...m, id: `m${i}`, status: 'none' })).sort((a, b) => a.start_min - b.start_min);
  const plan = planDelay(cfg, ms, ms[0], 10);
  if (ms.some((m) => m.session === 'pm')) {
    assert.equal(plan.needsLunchChoice, true);
    assert.equal(plan.options.shorten.lunch, 30);
    assert.equal(plan.options.shorten.pmShift, 0);
    const applied = planDelay(cfg, ms, ms[0], 10, 'shorten');
    const pm = ms.filter((m) => m.session === 'pm');
    assert.equal(applied.changes.find((c) => c.id === pm[0].id).start_min, pm[0].start_min);
  } else {
    assert.equal(plan.needsLunchChoice, false);
  }
});

test('日程: 昼休憩の前後に空き枠を残さない', () => {
  const cfg = normalizeConfig({ format: 'league_knockout', groups: 2, courts: 2, advance: 2, halfMinutes: 12, halftimeMinutes: 3, intervalMinutes: 5, startTime: 420, lunchStart: 610, lunchMinutes: 45 });
  const ts = teams(8).map((t, i) => ({ ...t, group_label: 'AB'[i % 2] }));
  const { matches } = generateCategory(cfg, ts);
  const am = matches.filter((m) => m.session === 'am');
  const pm = matches.filter((m) => m.session === 'pm');
  const lastAmEnd = Math.max(...am.map((m) => m.start_min)) + 27;
  const firstPm = Math.min(...pm.map((m) => m.start_min));
  assert.equal(firstPm - lastAmEnd, 45);
});
