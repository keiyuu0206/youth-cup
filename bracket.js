import { groupLabel } from './grouping.js';

// 参照(ref)の形式
//   {t:'team', id}          確定したチーム
//   {t:'grp', g:'A', r:1}   A組1位
//   {t:'win', m:'K3'}       試合K3の勝者
//   {t:'lose', m:'K3'}      試合K3の敗者

const isPow2 = (n) => n >= 2 && (n & (n - 1)) === 0;
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

const mainName = (size) => (size === 2 ? '決勝' : size === 4 ? '準決勝' : size === 8 ? '準々決勝' : null);

/**
 * クロス方式の1回戦の並び。隣り合う2つが対戦し、勝者同士も隣から当たる。
 * k=2: [A1,B2, C1,D2, | B1,A2, D1,C2] → 同組の1位と2位は決勝まで当たらない
 * k=1: [A1,B1, C1,D1]
 */
export function crossEntrants(G, k, rankOffset = 0) {
  const L = Array.from({ length: G }, (_, i) => groupLabel(i));
  const r1 = rankOffset + 1;
  const r2 = rankOffset + 2;
  const out = [];
  if (k === 1) {
    for (const g of L) out.push({ t: 'grp', g, r: r1 });
    return out;
  }
  for (let i = 0; i < G / 2; i++) out.push({ t: 'grp', g: L[2 * i], r: r1 }, { t: 'grp', g: L[2 * i + 1], r: r2 });
  for (let i = 0; i < G / 2; i++) out.push({ t: 'grp', g: L[2 * i + 1], r: r1 }, { t: 'grp', g: L[2 * i], r: r2 });
  return out;
}

class Builder {
  constructor() { this.matches = []; this.n = 0; }
  add(m) {
    const code = `K${++this.n}`;
    this.matches.push({ code, seq: this.n, ...m });
    return code;
  }

  // 勝ち上がり方式（1〜3位）。entrants には不戦（null）を含められる
  single(entrants, mode) {
    let cur = entrants;
    let level = 0;
    let roundIdx = 1;
    let semis = [];
    while (cur.length > 1) {
      const size = cur.length;
      const name = mainName(size) || `${roundIdx}回戦`;
      const next = [];
      const codes = [];
      for (let i = 0; i < size; i += 2) {
        const a = cur[i];
        const b = cur[i + 1];
        if (!a && !b) next.push(null);
        else if (!a) next.push(b);
        else if (!b) next.push(a);
        else {
          const final = size === 2;
          const code = this.add({ home: a, away: b, label: name, level, base: 1, place_w: final ? 1 : null, place_l: final ? 2 : null });
          codes.push(code);
          next.push({ t: 'win', m: code });
        }
      }
      if (size === 4) semis = codes;
      cur = next;
      level++;
      roundIdx++;
    }
    const byCode = (c) => this.matches.find((m) => m.code === c);
    if (mode === 'top3' && semis.length === 2) {
      this.add({ home: { t: 'lose', m: semis[0] }, away: { t: 'lose', m: semis[1] }, label: '3位決定戦', level: level - 1, base: 3, place_w: 3, place_l: 4 });
    } else if (semis.length) {
      for (const c of semis) byCode(c).place_l = 3;
    }
  }

  // 全順位決定（2のべき乗のみ）
  placement(entrants, base, level) {
    const size = entrants.length;
    if (size === 2) {
      this.add({ home: entrants[0], away: entrants[1], label: base === 1 ? '決勝' : `${base}位決定戦`, level, base, place_w: base, place_l: base + 1 });
      return;
    }
    const round = mainName(size) || '1回戦';
    const label = base === 1 ? round : `${base}〜${base + size - 1}位 ${round}`;
    const winners = [];
    const losers = [];
    for (let i = 0; i < size; i += 2) {
      const code = this.add({ home: entrants[i], away: entrants[i + 1], label, level, base });
      winners.push({ t: 'win', m: code });
      losers.push({ t: 'lose', m: code });
    }
    this.placement(winners, base, level + 1);
    this.placement(losers, base + size / 2, level + 1);
  }

  finish() {
    // 同じ名前の試合が複数あれば番号を付ける
    const count = {};
    for (const m of this.matches) count[m.label] = (count[m.label] || 0) + 1;
    const seen = {};
    for (const m of this.matches) {
      if (count[m.label] > 1) {
        seen[m.label] = (seen[m.label] || 0) + 1;
        m.label = `${m.label} ${seen[m.label]}`;
      }
    }
    // 消化順: 段階が浅い順、同じ段階では下位の順位決定から（決勝を最後に）
    return this.matches.sort((a, b) => a.level - b.level || b.base - a.base || a.seq - b.seq);
  }
}

/**
 * ctx.format = 'knockout' のとき ctx.teamIds（抽選済みの並び）
 * ctx.format = 'league_knockout' のとき ctx.groupSizes（{A:4, B:4,...}）
 */
export function buildKnockout(cfg, ctx) {
  const b = new Builder();
  const mode = cfg.rankMode;

  if (ctx.format === 'knockout') {
    const n = ctx.teamIds.length;
    if (n < 2) return { matches: [], error: 'トーナメントには2チーム以上が必要です' };
    const size = nextPow2(n);
    if (mode === 'all' && !isPow2(n)) return { matches: [], error: `全順位決定は 2・4・8・16 チームのときに使えます（現在 ${n} チーム）` };
    const order = seedOrder(size);
    const entrants = order.map((seed) => (seed <= n ? { t: 'team', id: ctx.teamIds[seed - 1] } : null));
    if (mode === 'all') b.placement(entrants, 1, 0);
    else b.single(entrants, mode);
    return { matches: b.finish() };
  }

  const sizes = Object.values(ctx.groupSizes);
  const G = sizes.length;
  const k = cfg.advance;
  if (![2, 4, 8].includes(G)) return { matches: [], error: 'リーグ＋トーナメントは 2・4・8 組のときに使えます' };
  const minSize = Math.min(...sizes);
  if (minSize < k) return { matches: [], error: `各組に${k}チーム以上が必要です` };

  if (mode === 'all') {
    const tiers = Math.floor(minSize / k);
    for (let t = 0; t < tiers; t++) b.placement(crossEntrants(G, k, t * k), t * k * G + 1, 0);
  } else {
    b.single(crossEntrants(G, k, 0), mode);
  }
  return { matches: b.finish() };
}

export function refText(ref, byCode) {
  if (!ref) return '未定';
  if (ref.t === 'grp') return `${ref.g}組${ref.r}位`;
  if (ref.t === 'win' || ref.t === 'lose') {
    const m = byCode && byCode[ref.m];
    return `${m ? m.label : ref.m}の${ref.t === 'win' ? '勝者' : '敗者'}`;
  }
  return '未定';
}
