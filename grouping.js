export const groupLabel = (i) => String.fromCharCode(65 + i); // A, B, C...

export function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 円環方式の総当たり。戻り値は節（ラウンド）ごとの対戦ペア配列
export function roundRobin(ids) {
  const t = [...ids];
  if (t.length % 2) t.push(null);
  const n = t.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i];
      const b = t[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop());
  }
  return rounds;
}

import { normKey, stripSuffix, splitPref } from './teamnorm.js';

// 同じクラブかを見分ける目印：チームマスタ → クラブ名 → 名前（最後のA・B・①などと都道府県のかっこ書きを除く）
export function clubKey(t) {
  if (t.master_id) return `m:${t.master_id}`;
  if (t.club && String(t.club).trim()) return `c:${normKey(t.club)}`;
  const nm = splitPref(t.name).name;
  const base = stripSuffix(nm);
  return base ? `n:${normKey(base)}` : null;
}
// 都道府県：登録された都道府県 → 名前のかっこ書き（例：さくらFC（静岡））
export function prefOf(t) {
  return t.prefecture || splitPref(t.name).pref || null;
}

/**
 * 制約付きランダム組み分け
 * teams: [{id, name, club, master_id, prefecture}]
 * opts: { groups, fixed: {teamId: 'A'}, separate: [[id, id], ...] }
 * ・同じクラブのチーム（A・Bチームなど）は、できるだけ別の組にする
 * ・都道府県が分かるときは、同じ都道府県のチームがなるべく1つの組に偏らないようにする
 */
export function assignGroups(teams, { groups, fixed = {}, separate = [] }, rnd = Math.random) {
  const G = Math.max(1, groups);
  const labels = Array.from({ length: G }, (_, i) => groupLabel(i));
  const base = Math.floor(teams.length / G);
  const extra = teams.length % G;
  const key = new Map(teams.map((t) => [t.id, clubKey(t)]));
  const pref = new Map(teams.map((t) => [t.id, prefOf(t)]));

  const conflicts = (a, b) => {
    const ka = key.get(a.id);
    if (ka && ka === key.get(b.id)) return true;
    return separate.some(([x, y]) => (x === a.id && y === b.id) || (x === b.id && y === a.id));
  };
  // 都道府県ごとの理想の人数（組の数で割った数）。これを超えた分だけ減点する
  const prefTotal = {};
  for (const t of teams) { const p = pref.get(t.id); if (p) prefTotal[p] = (prefTotal[p] || 0) + 1; }
  const prefLimit = (p) => Math.ceil(prefTotal[p] / G);

  let best = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    // 人数の多い組をランダムに決める
    const capOrder = shuffle(labels, rnd);
    const cap = Object.fromEntries(labels.map((l) => [l, base + (capOrder.indexOf(l) < extra ? 1 : 0)]));
    const members = Object.fromEntries(labels.map((l) => [l, []]));
    let clubPenalty = 0;
    let prefPenalty = 0;

    const fixedTeams = teams.filter((t) => fixed[t.id] && labels.includes(fixed[t.id]));
    for (const t of fixedTeams) {
      const g = fixed[t.id];
      if (members[g].length >= cap[g]) {
        // 固定先が満員なら枠を融通する
        const donor = labels.find((l) => l !== g && cap[l] > members[l].length && cap[l] > base);
        if (donor) { cap[donor]--; cap[g]++; }
      }
      members[g].push(t);
    }

    const rest = shuffle(teams.filter((t) => !fixedTeams.includes(t)), rnd);
    // 制約の多いチームから先に置く（同じクラブ・分けたいチーム → 同じ都道府県が多いチーム）
    const sib = (t) => teams.filter((o) => o !== t && key.get(t.id) && key.get(o.id) === key.get(t.id)).length;
    const weight = (t) => (separate.filter((p) => p.includes(t.id)).length + sib(t)) * 100 + (pref.get(t.id) ? prefTotal[pref.get(t.id)] : 0);
    rest.sort((a, b) => weight(b) - weight(a));

    for (const t of rest) {
      const open = labels.filter((l) => members[l].length < cap[l]);
      const p = pref.get(t.id);
      // 点数が小さい組に入れる：同じクラブ（大きな減点）＋同じ都道府県の人数＋組の人数（少ない組を優先）
      const score = (l) => members[l].filter((m) => conflicts(m, t)).length * 1000
        + (p ? members[l].filter((m) => pref.get(m.id) === p).length * 10 : 0)
        + members[l].length;
      const min = Math.min(...open.map(score));
      const cands = open.filter((l) => score(l) === min);
      const g = cands[Math.floor(rnd() * cands.length)];
      clubPenalty += members[g].filter((m) => conflicts(m, t)).length;
      members[g].push(t);
    }
    for (const l of labels) {
      const cnt = {};
      for (const m of members[l]) { const p = pref.get(m.id); if (p) cnt[p] = (cnt[p] || 0) + 1; }
      for (const [p, n] of Object.entries(cnt)) prefPenalty += Math.max(0, n - prefLimit(p));
    }
    const penalty = clubPenalty * 1000 + prefPenalty;
    if (!best || penalty < best.penalty) best = { penalty, members };
    if (penalty === 0) break;
  }

  const assignment = {};
  for (const [g, list] of Object.entries(best.members)) for (const t of list) assignment[t.id] = g;

  const warnings = [];
  for (const [g, list] of Object.entries(best.members)) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (conflicts(list[i], list[j])) warnings.push(`${list[i].name} と ${list[j].name} が同じ${g}組になりました`);
      }
    }
  }
  return { assignment, warnings };
}
