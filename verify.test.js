import { test } from 'node:test';
import assert from 'node:assert/strict';
// 順位表の独立検算：アプリの computeStandings と、別に書いた計算をランダムなリーグで突き合わせる
import { computeStandings } from './standings.js';
import { DEFAULT_TIEBREAK } from './time.js';
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pad = (v) => String(100000 + v).padStart(7, '0');
const ri = (n) => Math.floor(rnd() * n);
// ---- 別実装：素朴な集計 ----
function stats(ids, ms) {
  const s = {}; for (const id of ids) s[id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  for (const m of ms) {
    if (m.status !== 'confirmed' || m.home_score == null || m.away_score == null) continue;
    if (!(m.home_team_id in s) || !(m.away_team_id in s)) continue;
    const H = s[m.home_team_id], A = s[m.away_team_id];
    H.p += 1; A.p += 1; H.gf += m.home_score; H.ga += m.away_score; A.gf += m.away_score; A.ga += m.home_score;
    if (m.home_score === m.away_score) { H.d++; A.d++; } else if (m.home_score > m.away_score) { H.w++; A.l++; } else { A.w++; H.l++; }
  }
  for (const id of ids) { const x = s[id]; x.pts = x.w * 3 + x.d; x.gd = x.gf - x.ga; }
  return s;
}
// 並びの決め方：基準を順に当て、同じ値のかたまりごとに次の基準へ（当該チーム間は、そのかたまりの中の試合だけで 勝点→得失点差→総得点）
function refRank(ids, ms, crit, lottery) {
  const all = stats(ids, ms);
  const out = []; // [[id...], ...] 同順位のかたまり
  const go = (group, ci) => {
    if (group.length === 1) return out.push(group);
    const c = crit[ci];
    if (c === undefined || c === 'lottery' || c === 'janken') {
      if (lottery.length && group.every((x) => lottery.includes(x))) { [...group].sort((a, b) => lottery.indexOf(a) - lottery.indexOf(b)).forEach((x) => out.push([x])); }
      else out.push(group);
      return;
    }
    let val;
    if (c === 'h2h') { const sub = stats(group, ms.filter((m) => group.includes(m.home_team_id) && group.includes(m.away_team_id))); val = (x) => `${pad(sub[x].pts)}|${pad(sub[x].gd)}|${pad(sub[x].gf)}`; }
    else val = (x) => pad(all[x][c === 'points' ? 'pts' : c]);
    const vals = [...new Set(group.map(val))].sort().reverse(); // 大きい順（固定幅にしたので文字列比較でよい）
    for (const v of vals) go(group.filter((x) => val(x) === v), ci + 1);
  };
  go([...ids], 0);
  return { all, out };
}
const CRITS = ['points', 'gd', 'gf', 'h2h', 'lottery', 'janken'];
test('順位表の独立検算：別に書いた計算とランダムな2万リーグで一致する', () => {
let cases = 0, bad = 0, ties = 0, lots = 0;
for (let k = 0; k < 20000; k++) {
  const n = 2 + ri(6); // 2〜7チーム
  const ids = Array.from({ length: n }, (_, i) => `T${i}`);
  const ms = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const st = rnd() < 0.15 ? (rnd() < 0.5 ? 'none' : 'provisional') : 'confirmed';
    const lowScoring = rnd() < 0.5; // 同点が起きやすいように
    const g = () => (lowScoring ? ri(3) : ri(7));
    const forfeit = rnd() < 0.05;
    const [hs, as] = forfeit ? (rnd() < 0.5 ? [3, 0] : [0, 3]) : [g(), g()];
    ms.push({ id: `${i}-${j}`, home_team_id: rnd() < 0.5 ? ids[i] : ids[j], away_team_id: null, status: st, home_score: st === 'none' ? null : hs, away_score: st === 'none' ? null : as, forfeit: forfeit ? 'home' : null });
    const m = ms[ms.length - 1]; m.away_team_id = m.home_team_id === ids[i] ? ids[j] : ids[i];
  }
  let crit = k % 3 === 0 ? [...DEFAULT_TIEBREAK] : (() => { const c = ['points']; const rest = CRITS.filter((x) => x !== 'points').sort(() => rnd() - 0.5); return c.concat(rest.slice(0, ri(rest.length + 1))); })();
  const lottery = rnd() < 0.3 ? [...ids].sort(() => rnd() - 0.5) : [];
  const app = computeStandings(ids, ms, crit, lottery);
  const ref = refRank(ids, ms, crit, lottery);
  cases++;
  const fail = (why) => { bad++; if (bad <= 5) console.log('NG', why, JSON.stringify({ crit, ms: ms.map((m) => [m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.status]) }).slice(0, 600)); };
  // 1) 数字：試合・勝分負・得失点・勝点
  for (const r of app.rows) {
    const x = ref.all[r.teamId];
    for (const key of ['p', 'w', 'd', 'l', 'gf', 'ga', 'gd', 'pts']) if (r[key] !== x[key]) fail(`${key} ${r.teamId} app=${r[key]} ref=${x[key]}`);
    if (r.pts !== r.w * 3 + r.d || r.p !== r.w + r.d + r.l || r.gd !== r.gf - r.ga) fail('内訳の不一致');
  }
  const sum = (f) => app.rows.reduce((a, r) => a + f(r), 0);
  if (sum((r) => r.gf) !== sum((r) => r.ga) || sum((r) => r.w) !== sum((r) => r.l) || sum((r) => r.d) % 2) fail('全体の合計の不一致');
  if (sum((r) => r.p) !== 2 * ms.filter((m) => m.status === 'confirmed').length) fail('試合数の合計');
  // 2) 並びと順位：同じかたまりは同順位、順位はそれより上のチーム数＋1
  if (app.rows.length !== n || new Set(app.rows.map((r) => r.teamId)).size !== n) fail('チームの欠け・重複');
  let pos = 1, idx = 0;
  for (const grp of ref.out) {
    const got = app.rows.slice(idx, idx + grp.length);
    if (got.map((r) => r.teamId).sort().join() !== [...grp].sort().join()) { fail(`並び ${JSON.stringify(ref.out)} vs ${app.rows.map((r) => r.teamId + ':' + r.rank)}`); break; }
    for (const r of got) { if (r.rank !== pos) fail(`順位 ${r.teamId} ${r.rank} != ${pos}`); if (r.tied !== grp.length > 1) fail('同順位の印'); }
    if (grp.length > 1) ties++;
    pos += grp.length; idx += grp.length;
  }
  if (app.rows.some((r) => r.lottery)) lots++;
  // 3) 完了と抽選待ち
  const complete = ms.every((m) => m.status === 'confirmed');
  if (app.complete !== complete) fail('完了の判定');
  if (app.needsLottery !== (complete && app.hasTie)) fail('抽選待ちの判定');
}
console.log(`検算 ${cases}通り（同順位が残った組 ${ties}・抽選で決めた組 ${lots}）／不一致 ${bad}件`);
assert.equal(bad, 0);
});
