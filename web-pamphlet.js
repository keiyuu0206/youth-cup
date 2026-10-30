// パンフレット（A4横）の出力
//  ・大会概要　・コート別タイムスケジュール（1ページに2コート）
//  ・予選リーグ星取表（1ページに3組。自チームどうしのマスに大会ロゴ）
//  ・決勝トーナメントのまとめ（トーナメント表・グループ一覧・試合番号・タイムテーブルを1枚に）
import { h, toHHMM, formatDate } from './web-ui.js';
import { teamMap, codeMap, sideInfo, courtName, dayOf, dayTotal, dayLabel, winnerSide, isRankLeague, matchLengthFor, TIEBREAK_LABEL } from './web-views.js';
import { runPrint, periodText, qrBlock } from './web-print.js';
import { defaultOutline, autoInfo, autoSection, richText, plainText } from './web-outline.js';

const PAGE = '@page { size: A4 landscape; margin: 8mm; }';
export const THEMES = { red: '赤×黒', green: '緑', blue: '青', black: '黒' };
// 文字の大きさ：大きくするほど1ページに載せる量を減らす
export const SIZES = { normal: '標準', large: '大きめ', xl: '特大' };
const PER = {
  normal: { courts: 2, groups: 3, brackets: 99, numCols: 3 },
  large: { courts: 2, groups: 2, brackets: 1, numCols: 2 },
  xl: { courts: 1, groups: 1, brackets: 1, numCols: 2 },
};
const per = (opts) => PER[opts.ppSize] || PER.normal;

// ①〜㊿（それより多いときは数字）
const circled = (n) => (n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n)
  : n <= 35 ? String.fromCharCode(0x3250 + n - 20) : n <= 50 ? String.fromCharCode(0x32b0 + n - 35) : `(${n})`);

const sheet = (...kids) => h('section', { class: 'ps-sheet ps-land grow pp-sheet' }, h('div', { class: 'ps-inner pp-inner' }, ...kids));
const head = (t, cat, title, sub) => h('header', { class: 'pp-head' },
  t.logo ? h('img', { src: t.logo, alt: '' }) : null,
  h('div', { class: 'pp-head-t' }, h('div', { class: 'pp-tname' }, t.name),
    h('div', { class: 'pp-tsub' }, [cat ? cat.name : null, periodText(t), t.venue].filter(Boolean).join('　'))),
  h('div', { class: 'pp-title' }, h('span', null, title), sub ? h('small', null, sub) : null));

// ---------- 段（トーナメント・リーグ戦の段）の情報 ----------

const SHORT = (name) => (!name || name === '決勝トーナメント' ? '' : name.replace(/トーナメント$|リーグ$/, '').slice(0, 2));
const roundName = (m) => String(m.label || '').replace(m.group_label || '', '').replace(/\s*\d+$/, '').trim() || m.label;

// トーナメントを木の形に組み立てる（決勝から「勝者」のつながりをたどる）
function buildTree(ko) {
  const byCode = Object.fromEntries(ko.map((m) => [m.code, m]));
  const referenced = new Set();
  ko.forEach((m) => [m.home_ref, m.away_ref].forEach((r) => { if (r && r.t === 'win') referenced.add(r.m); }));
  const roots = ko.filter((m) => !referenced.has(m.code));
  const root = roots.filter((m) => m.place_w != null).sort((a, b) => a.place_w - b.place_w)[0] || roots.sort((a, b) => b.slot - a.slot)[0];
  if (!root) return null;
  const used = new Set();
  const node = (m) => {
    used.add(m.code);
    return { m, kids: ['home', 'away'].map((side) => {
      const r = side === 'home' ? m.home_ref : m.away_ref;
      return r && r.t === 'win' && byCode[r.m] && !used.has(r.m) ? node(byCode[r.m]) : { leaf: true, m, side, ref: r };
    }) };
  };
  return { tree: node(root), used };
}

// カテゴリの決勝の段ごとに、木・番号・そのほかの試合（3位決定戦など）を用意する
function koSections(cat) {
  const ko = cat.matches.filter((m) => m.stage === 'knockout' && !isRankLeague(m));
  // 段の順番：決まる順位が上の段から（上位 → 中位 → 下位）
  const minPlace = (name) => Math.min(...ko.filter((m) => (m.group_label || null) === name).map((m) => m.place_w ?? 999));
  const names = [...new Set(ko.map((m) => m.group_label || null))].sort((a, b) => minPlace(a) - minPlace(b));
  const disp = {}; // 試合コード → 表示（上⑬ など）
  const secs = names.map((name, si) => {
    const list = ko.filter((m) => (m.group_label || null) === name);
    const built = buildTree(list);
    // 段が複数ある大会で、段の名前が「決勝トーナメント」のときは「上位①」のように（1つだけの大会は「①」）
    const multi = names.length > 1 || cat.matches.some(isRankLeague);
    const prefix = !name || name === '決勝トーナメント' ? (multi ? '上位' : '') : SHORT(name);
    let n = 0;
    const matchNodes = [];
    if (built) {
      // 葉の並び順で y を決め、回戦（高さ）の順に番号を振る
      let leafIdx = 0;
      const lay = (nd) => {
        if (nd.leaf) { nd.y = leafIdx++; nd.h = 0; return; }
        nd.kids.forEach(lay);
        nd.h = 1 + Math.max(...nd.kids.map((k) => k.h));
        nd.y = (nd.kids[0].y + nd.kids[1].y) / 2;
        matchNodes.push(nd);
      };
      lay(built.tree);
      built.leaves = leafIdx;
      matchNodes.sort((a, b) => a.h - b.h || a.y - b.y).forEach((nd) => { disp[nd.m.code] = `${prefix}${circled(++n)}`; });
    }
    const others = list.filter((m) => !built || !built.used.has(m.code)).sort((a, b) => a.slot - b.slot || a.court - b.court);
    others.forEach((m) => { disp[m.code] = `${prefix}${circled(++n)}`; });
    return { name, prefix, idx: si, built, others, list };
  });
  // リーグ戦の段（下位リーグなど）
  const leagues = [...new Set(cat.matches.filter(isRankLeague).map((m) => m.group_label))];
  leagues.forEach((name, i) => {
    const pre = SHORT(name);
    cat.matches.filter((m) => isRankLeague(m) && m.group_label === name).sort((a, b) => a.slot - b.slot || a.court - b.court)
      .forEach((m, j) => { disp[m.code] = `${pre}L${j + 1}`; });
    secs.push({ name, prefix: pre, idx: secs.length + i, league: true, list: cat.matches.filter((m) => isRankLeague(m) && m.group_label === name) });
  });
  return { secs, disp };
}

const refLabel = (ref, disp) => (!ref ? '' : ref.t === 'grp' ? `${ref.g}${ref.r}` : ref.t === 'win' ? `${disp[ref.m] || ref.m}勝者` : ref.t === 'lose' ? `${disp[ref.m] || ref.m}敗者` : '');

// ---------- トーナメント表（SVG） ----------

function bracketSvg(cat, sec, disp, opts) {
  const { tree, leaves } = sec.built;
  const tm = teamMap(cat);
  const H = tree.h;
  const rowH = leaves > 12 ? 7.4 : 9, leafW = 44, colW = H >= 5 ? 13 : 17, champW = 26, pad = 2;
  const W = leafW + H * colW + champW;
  const Ht = leaves * rowH + pad * 2;
  const yOf = (nd) => pad + nd.y * rowH + rowH / 2;
  const xOf = (nd) => leafW + (nd.h - 1) * colW + colW * 0.55;
  const els = [];
  const line = (x1, y1, x2, y2, win) => els.push(`<path d="M${x1} ${y1}H${x2}" class="pl${win ? ' win' : ''}"/>`) && (y1 !== y2 ? els.push(`<path d="M${x2} ${y1}V${y2}" class="pl${win ? ' win' : ''}"/>`) : 0);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const walk = (nd) => {
    if (nd.leaf) {
      const y = yOf(nd);
      const id = nd.side === 'home' ? nd.m.home_team_id : nd.m.away_team_id;
      const lab = refLabel(nd.ref, disp);
      const name = id && tm[id] && !opts.blank ? tm[id].short_name || tm[id].name : '';
      els.push(`<rect x="0" y="${y - 3.3}" width="9" height="6.6" rx="1" class="pk"/>`);
      els.push(`<text x="4.5" y="${y + 1.25}" class="pkt" text-anchor="middle">${esc(lab.length > 3 ? lab.slice(0, 3) : lab)}</text>`);
      // 長い名前は途中で切らず、枠の幅（約32）に収まるよう詰めて表示する
      const fit = name && [...name].reduce((a, ch) => a + (/[\x20-\x7e]/.test(ch) ? 0.55 : 1), 0) * 3.4 > leafW - 12;
      els.push(`<text x="11" y="${y + 1.2}" class="pn"${fit ? ` textLength="${leafW - 12}" lengthAdjust="spacingAndGlyphs"` : ''}>${esc(name)}</text>`);
      els.push(`<path d="M10.5 ${y + 3}H${leafW}" class="pu"/>`);
      return { x: leafW, y };
    }
    const x = xOf(nd), y = yOf(nd);
    const done = nd.m.status === 'confirmed' && !opts.blank;
    const w = done ? winnerSide(nd.m) : null;
    nd.kids.forEach((k, i) => {
      const end = walk(k);
      const win = w && ((i === 0 && w === 'home') || (i === 1 && w === 'away'));
      els.push(`<path d="M${end.x} ${end.y}H${x}V${y}" class="pl${win ? ' win' : ''}"/>`);
    });
    els.push(`<rect x="${x - 5}" y="${y - 2.8}" width="10" height="5.6" rx="1.2" class="pb"/>`);
    els.push(`<text x="${x}" y="${y + 1.05}" class="pbt" text-anchor="middle">${esc(disp[nd.m.code])}</text>`);
    if (done && nd.m.home_score != null) {
      const pk = nd.m.home_pk != null ? `(${nd.m.home_pk}-${nd.m.away_pk})` : '';
      els.push(`<text x="${x}" y="${y + 6}" class="ps" text-anchor="middle">${nd.m.home_score}-${nd.m.away_score}${pk}</text>`);
    }
    return { x: x + 5, y };
  };
  const end = walk(tree);
  // 優勝
  const cx = end.x + 4;
  const fw = tree.m.status === 'confirmed' && !opts.blank ? winnerSide(tree.m) : null;
  const champId = fw ? (fw === 'home' ? tree.m.home_team_id : tree.m.away_team_id) : null;
  els.push(`<path d="M${end.x} ${end.y}H${cx}" class="pl${fw ? ' win' : ''}"/>`);
  els.push(`<rect x="${cx}" y="${end.y - 6}" width="${champW - 5}" height="12" rx="1.5" class="pc"/>`);
  els.push(`<text x="${cx + (champW - 5) / 2}" y="${end.y - (champId ? 0.6 : -1.4)}" class="pct" text-anchor="middle">優勝</text>`);
  if (champId && tm[champId]) els.push(`<text x="${cx + (champW - 5) / 2}" y="${end.y + 4}" class="pcn" text-anchor="middle">${esc((tm[champId].short_name || tm[champId].name).slice(0, 8))}</text>`);
  return h('div', { class: 'pp-svg', html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" style="width:${W}mm;height:${Ht}mm">${els.join('')}</svg>` });
}

// ---------- 各ページ ----------

// その日の試合の内容：予選リーグ、上位・中位・下位トーナメント、下位リーグ など
function stageText(ms) {
  const parts = [];
  if (ms.some((m) => m.stage === 'league')) parts.push('予選リーグ');
  const ko = ms.filter((m) => m.stage === 'knockout');
  const minPlace = (name) => Math.min(...ko.filter((m) => (m.group_label || null) === name).map((m) => m.place_w ?? 999));
  const names = [...new Set(ko.map((m) => m.group_label || null))].sort((a, b) => minPlace(a) - minPlace(b));
  const tour = names.filter((n) => !n || /トーナメント$/.test(n));
  const others = names.filter((n) => n && !/トーナメント$/.test(n));
  if (tour.length) parts.push(tour.every(Boolean) && tour.length > 1 ? `${tour.map((n) => n.replace(/トーナメント$/, '')).join('・')}トーナメント` : tour.map((n) => n || '決勝トーナメント').join('・'));
  parts.push(...others);
  return parts.join('・');
}

function overviewSheet(t, cats, opts) {
  const o = (t.settings && t.settings.outline) || defaultOutline(t);
  const info = (o.info || []).map((r) => ({ label: r.label, value: (r.value || '').trim() || (r.auto ? autoInfo(r.auto, t, cats) : '') })).filter((r) => r.label && r.value).slice(0, 8);
  // 日ごとの内容（予選リーグ・決勝トーナメントなど）
  const days = Math.max(...cats.map((c) => dayTotal(c.config)));
  const dayCards = Array.from({ length: days }, (_, d) => {
    const parts = cats.map((c) => {
      const ms = c.matches.filter((m) => dayOf(c.config, m.slot) === d);
      if (!ms.length) return null;
      const st = stageText(ms);
      const first = Math.min(...ms.map((m) => m.start_min));
      return `${c.name}：${st}（${toHHMM(first)}〜）`;
    }).filter(Boolean);
    const date = cats.map((c) => (c.config.dayDates || [])[d]).find(Boolean);
    return h('div', { class: 'pp-day' }, h('div', { class: 'pp-day-n' }, h('b', null, `${d + 1}日目`), date ? h('span', null, formatDate(date)) : null),
      h('div', { class: 'pp-day-b' }, parts.map((p) => h('div', null, p))));
  });
  const lenText = (x) => (x.periods === 1 ? `${x.halfMinutes}分` : x.periods === 3 ? `${x.halfMinutes}分×3（休憩${x.halftimeMinutes}分）` : `${x.halfMinutes}分ハーフ（${x.halfMinutes}-${x.halftimeMinutes}-${x.halfMinutes}）`);
  const rules = cats.map((c) => {
    const cfg = c.config;
    const tb = (cfg.tiebreak || []).map((k) => TIEBREAK_LABEL[k]).filter(Boolean).join(' → ');
    // 決勝トーナメントだけ試合時間を変えているときは、両方を書く
    const ko = cfg.format === 'league_knockout' && cfg.koTiming && cfg.koTiming.enabled ? { ...cfg, ...cfg.koTiming } : null;
    const timeLines = ko ? [`予選リーグ ${lenText(cfg)}`, `決勝トーナメント ${lenText(ko)}`] : [`試合時間 ${lenText(cfg)}`];
    return h('tr', null, h('th', null, c.name), h('td', null, timeLines.map((l) => [l, h('br')]),
      cfg.format !== 'knockout' ? `勝点（勝3・分1・負0）が並んだ場合：${tb}` : null));
  });
  const secs = (o.sections || []).filter((s) => !['schedule', 'ranking'].includes(s.auto)).map((s) => ({ title: s.title, text: [s.auto ? autoSection(s.auto, t, cats) : '', s.body || ''].filter((x) => x.trim()).join('\n') }))
    .filter((s) => s.text.trim()).slice(0, 4);
  return sheet(
    h('header', { class: 'pp-hero' },
      t.logo ? h('img', { src: t.logo, alt: '' }) : null,
      h('div', null, h('div', { class: 'pp-hero-k' }, 'TOURNAMENT GUIDE'), h('h1', null, plainText(o.title) || t.name),
        o.catch || o.subtitle ? h('p', null, plainText(o.catch || o.subtitle)) : null),
      opts.qr ? qrBlock(t, '結果・速報はこちら', 'pp-qr') : null),
    h('div', { class: 'pp-ov' },
      h('div', { class: 'pp-col' },
        h('h2', { class: 'pp-band' }, '大会概要', h('small', null, 'OVERVIEW')),
        h('table', { class: 'pp-tbl' }, h('tbody', null, info.map((r) => h('tr', null, h('th', null, r.label), h('td', null, r.value.split('\n').map((v, i) => [i ? h('br') : null, ...richText(v)])))))),
        h('h2', { class: 'pp-band' }, '大会日程', h('small', null, 'SCHEDULE')),
        h('div', { class: 'pp-days' }, dayCards)),
      h('div', { class: 'pp-col' },
        h('h2', { class: 'pp-band' }, '試合ルール', h('small', null, 'MATCH RULES')),
        h('table', { class: 'pp-tbl' }, h('tbody', null, rules)),
        secs.map((s) => [h('h2', { class: 'pp-band' }, s.title), h('div', { class: 'pp-text' }, s.text.split('\n').slice(0, 6).map((l) => h('div', null, richText(l))))]),
        opts.sponsors && (t.sponsors || []).length ? h('div', { class: 'pp-sponsors' }, h('span', null, 'ご協賛'), t.sponsors.map((sp) => h('img', { src: sp.img, alt: sp.name }))) : null)));
}

function courtSheets(t, cat, opts, disp) {
  const cfg = cat.config;
  const cache = { teams: teamMap(cat), codes: codeMap(cat) };
  const days = dayTotal(cfg);
  const out = [];
  for (let d = 0; d < days; d++) {
    const slots = [...new Set(cat.matches.filter((m) => dayOf(cfg, m.slot) === d).map((m) => m.slot))].sort((a, b) => a - b);
    if (!slots.length) continue;
    const startOf = (s) => cat.matches.find((m) => m.slot === s).start_min;
    const usedCourts = [...new Set(cat.matches.filter((m) => dayOf(cfg, m.slot) === d).map((m) => m.court))].sort((a, b) => a - b);
    const table = (c) => h('div', { class: 'pp-court' },
      h('div', { class: 'pp-court-h' }, h('b', null, courtName(cfg, c)), h('span', null, 'タイムスケジュール')),
      h('table', { class: 'pp-tbl pp-ct' },
        h('thead', null, h('tr', null, h('th', null, '試合'), h('th', null, '開始'), h('th', { colspan: 3 }, '対戦カード'), h('th', null, '結果'))),
        h('tbody', null, slots.map((s, i) => {
          const m = cat.matches.find((x) => x.slot === s && x.court === c);
          if (!m) return h('tr', { class: 'free' }, h('td', null, `第${i + 1}試合`), h('td', { class: 'pp-tm' }, toHHMM(startOf(s))), h('td', { colspan: 4, class: 'c muted' }, '—'));
          const done = !opts.blank && m.status === 'confirmed' && m.home_score != null;
          const w = done ? winnerSide(m) : null;
          const nm = (side) => sideInfo(m, side, cat, cache).text;
          const tag = m.stage === 'league' ? `${m.group_label}組` : disp[m.code] || '';
          return h('tr', null, h('td', null, `第${i + 1}試合`, h('small', null, tag)), h('td', { class: 'pp-tm' }, toHHMM(m.start_min)),
            h('td', { class: `r${w === 'home' ? ' b' : ''}` }, nm('home')), h('td', { class: 'vs' }, 'vs'), h('td', { class: w === 'away' ? 'b' : '' }, nm('away')),
            h('td', { class: 'c res' }, done ? `${m.home_score}-${m.away_score}${m.home_pk != null ? `（PK${m.home_pk}-${m.away_pk}）` : ''}` : ''));
        }))));
    const n = per(opts).courts;
    for (let i = 0; i < usedCourts.length; i += n) {
      const list = usedCourts.slice(i, i + n);
      out.push(sheet(head(t, cat, '試合スケジュール', dayLabel(cat, d, t, true)),
        h('div', { class: `pp-courts n${n}` }, list.map(table), n === 2 && list.length === 1 ? h('div', { class: 'pp-court empty' }) : null)));
    }
  }
  return out;
}

function starSheets(t, cat, opts) {
  const groups = [...new Set(cat.teams.map((x) => x.group_label).filter(Boolean))].sort();
  if (!groups.length) return [];
  const league = cat.matches.filter((m) => m.stage === 'league');
  // 通し番号（組の順）
  const num = {};
  let k = 0;
  groups.forEach((g) => cat.teams.filter((x) => x.group_label === g).forEach((x) => { num[x.id] = ++k; }));
  const card = (g) => {
    const order = cat.teams.filter((x) => x.group_label === g);
    const st = (cat.standings || {})[g];
    const row = Object.fromEntries((st ? st.rows : []).map((r) => [r.teamId, r]));
    const cell = (a, b) => {
      if (a.id === b.id) return h('td', { class: 'diag' }, t.logo ? h('img', { src: t.logo, alt: '' }) : null);
      if (opts.blank) return h('td');
      const m = league.find((x) => x.status === 'confirmed' && ((x.home_team_id === a.id && x.away_team_id === b.id) || (x.home_team_id === b.id && x.away_team_id === a.id)));
      if (!m) return h('td');
      const mine = m.home_team_id === a.id ? m.home_score : m.away_score;
      const theirs = m.home_team_id === a.id ? m.away_score : m.home_score;
      return h('td', { class: 'res' }, h('b', null, mine > theirs ? '○' : mine < theirs ? '●' : '△'), `${mine}-${theirs}`);
    };
    const v = (r, key) => (opts.blank || !r ? '' : key === 'gd' ? (r.gd > 0 ? `+${r.gd}` : r.gd) : r[key]);
    return h('div', { class: 'pp-star' },
      h('div', { class: 'pp-star-h' }, h('b', null, `${g}グループ`), st && st.complete && !opts.blank ? h('span', null, '確定') : null),
      h('table', { class: 'pp-tbl pp-st' },
        h('thead', null, h('tr', null, h('th', { class: 'tn' }, ''), order.map((b) => h('th', { class: 'op' }, circled(num[b.id]))),
          ['勝', '負', '分', '得点', '失点', '得失点', '勝点', '順位'].map((x) => h('th', { class: 'sm' }, x)))),
        h('tbody', null, order.map((a) => {
          const r = row[a.id];
          return h('tr', null, h('td', { class: 'tn' }, h('span', { class: 'no' }, circled(num[a.id])), opts.logos && a.logo ? h('img', { class: 'tl', src: a.logo, alt: '' }) : null, a.short_name || a.name),
            order.map((b) => cell(a, b)),
            h('td', { class: 'c' }, v(r, 'w')), h('td', { class: 'c' }, v(r, 'l')), h('td', { class: 'c' }, v(r, 'd')),
            h('td', { class: 'c' }, v(r, 'gf')), h('td', { class: 'c' }, v(r, 'ga')), h('td', { class: 'c' }, v(r, 'gd')),
            h('td', { class: 'c b' }, v(r, 'pts')), h('td', { class: 'c b' }, opts.blank || !r || !st.complete ? '' : r.rank));
        }))));
  };
  const out = [];
  const gn = per(opts).groups;
  for (let i = 0; i < groups.length; i += gn) {
    out.push(sheet(head(t, cat, '予選リーグ 星取表', groups.slice(i, i + gn).map((g) => `${g}グループ`).join('・')),
      h('div', { class: 'pp-stars' }, groups.slice(i, i + gn).map(card)),
      h('p', { class: 'pp-note' }, `○勝ち　●負け　△引き分け（勝ち3点・引き分け1点・負け0点）。勝点が並んだ場合：${(cat.config.tiebreak || []).map((x) => TIEBREAK_LABEL[x]).filter(Boolean).join(' → ')}`)));
  }
  return out;
}

// タイムテーブル（時間×コート）：日ごとに1ページ。予選リーグの日も決勝の日も同じ形
function timetableSheets(t, cat, opts) {
  const cfg = cat.config;
  const { secs, disp } = koSections(cat);
  const cache = { teams: teamMap(cat), codes: codeMap(cat) };
  const secIdx = (m) => { const s2 = secs.find((x) => (x.name || null) === (m.group_label || null) && (!!x.league === isRankLeague(m))); return s2 ? s2.idx : 0; };
  const nm = (m, side) => { const info = sideInfo(m, side, cat, cache); return info.placeholder ? '' : info.team.short_name || info.team.name; };
  const out = [];
  for (let d = 0; d < dayTotal(cfg); d++) {
    const dayM = cat.matches.filter((m) => dayOf(cfg, m.slot) === d);
    if (!dayM.length) continue;
    const slots = [...new Set(dayM.map((m) => m.slot))].sort((a, b) => a - b);
    const courts = [...new Set(dayM.map((m) => m.court))].sort((a, b) => a - b);
    out.push(sheet(head(t, cat, 'タイムテーブル', dayLabel(cat, d, t, true)),
      h('table', { class: `pp-tbl pp-grid big c${Math.min(courts.length, 12)}` },
        h('thead', null, h('tr', null, h('th', { class: 'pp-tm' }, '時間'), courts.map((c) => h('th', null, courtName(cfg, c))))),
        h('tbody', null, slots.map((s2) => {
          const ms = dayM.filter((m) => m.slot === s2);
          const st = Math.min(...ms.map((m) => m.start_min));
          const en = Math.max(...ms.map((m) => m.start_min + matchLengthFor(cfg, m)));
          return h('tr', null, h('td', { class: 'pp-tm' }, toHHMM(st), h('small', null, `〜${toHHMM(en)}`)),
            courts.map((c) => {
              const m = ms.find((x) => x.court === c);
              if (!m) return h('td', { class: 'none' }, '—');
              const league = m.stage === 'league';
              const tag = league ? `${m.group_label}組` : disp[m.code] || m.label;
              const a = nm(m, 'home'), b = nm(m, 'away');
              const done = !opts.blank && m.status === 'confirmed' && m.home_score != null;
              return h('td', { class: `cl s${league ? 'L' : secIdx(m) % 4}` }, h('b', null, tag),
                a || b ? h('span', { class: 'vs2' }, h('span', null, a || refLabel(m.home_ref, disp)), h('i', null, done ? `${m.home_score}-${m.away_score}` : 'vs'), h('span', null, b || refLabel(m.away_ref, disp)))
                  : h('span', { class: 'vs2 ref' }, `${refLabel(m.home_ref, disp)} vs ${refLabel(m.away_ref, disp)}`));
            }));
        })))));
  }
  return out;
}

// 決勝トーナメント：トーナメント表と試合番号の対応表だけ（タイムテーブルは別ページ）
function koSheets(t, cat, opts) {
  const cfg = cat.config;
  const { secs, disp } = koSections(cat);
  const trees = secs.filter((s2) => !s2.league && s2.built);
  if (!trees.length) return [];
  const cache = { teams: teamMap(cat), codes: codeMap(cat) };
  const where = (m) => `${dayTotal(cfg) > 1 ? `${dayOf(cfg, m.slot) + 1}日目 ` : ''}${toHHMM(m.start_min)} ${courtName(cfg, m.court)}`;
  const numTable = (list) => h('div', { class: `pp-nums c${per(opts).numCols}` }, list.flatMap((s2) => s2.list.slice().sort((a, b) => a.slot - b.slot || a.court - b.court).map((m) => h('div', { class: `s${s2.idx % 4}` },
    h('b', null, disp[m.code] || ''), h('span', { class: 'rn' }, roundName(m)),
    m.home_ref && m.home_ref.t === 'lose' ? h('small', null, `${refLabel(m.home_ref, disp)}・${refLabel(m.away_ref, disp)}`) : null,
    h('span', { class: 'wh' }, where(m))))));
  const bracketEl = (s2) => h('div', { class: `pp-br s${s2.idx % 4}` },
    h('div', { class: 'pp-br-h' }, h('b', null, s2.name || '決勝トーナメント'), h('span', null, `${s2.built.leaves}チーム`)),
    bracketSvg(cat, s2, disp, opts),
    s2.others.length ? h('div', { class: 'pp-others' }, s2.others.map((m) => h('div', null, h('b', null, disp[m.code]), ` ${roundName(m)}：`,
      `${sideInfo(m, 'home', cat, cache).placeholder ? refLabel(m.home_ref, disp) : sideInfo(m, 'home', cat, cache).text} vs ${sideInfo(m, 'away', cat, cache).placeholder ? refLabel(m.away_ref, disp) : sideInfo(m, 'away', cat, cache).text}`))) : null);
  // 1ページに載せるトーナメントの数（17チーム以上のトーナメントは、標準でも2つまで）
  let n = per(opts).brackets;
  if (trees.some((s2) => s2.built.leaves > 16)) n = Math.min(n, 2);
  const out = [];
  for (let i = 0; i < trees.length; i += n) {
    const list = trees.slice(i, i + n);
    const wrap = list.length >= 4 && list.every((s2) => s2.built.leaves <= 8);
    out.push(sheet(head(t, cat, '決勝トーナメント', list.map((s2) => s2.name).filter(Boolean).join('・')),
      h('div', { class: `pp-ko${wrap ? ' wrap' : ''}` }, list.map(bracketEl)),
      h('div', { class: 'pp-ko-num' }, h('h3', { class: 'pp-sub' }, '試合番号 対応表'), numTable(list)),
      opts.qr && i + n >= trees.length ? h('div', { class: 'pp-ko-qr' }, qrBlock(t, '結果・速報はこちら', 'pp-qr')) : null));
  }
  return out;
}

export function printPamphlet(t, cats, opts) {
  const p = opts.pp || {};
  const sheets = [];
  if (p.overview) sheets.push(overviewSheet(t, cats, opts));
  for (const cat of cats) {
    if (!cat.matches.length) continue;
    const { disp } = koSections(cat);
    if (p.courts) sheets.push(...courtSheets(t, cat, opts, disp));
    if (p.tt) sheets.push(...timetableSheets(t, cat, opts));
    if (p.star && cat.config.format !== 'knockout') sheets.push(...starSheets(t, cat, opts));
    if (p.ko && cat.config.format !== 'league') sheets.push(...koSheets(t, cat, opts));
  }
  if (!sheets.length) return false;
  sheets[sheets.length - 1].classList.add('last');
  const doc = h('div', { class: `pd ps pp theme-${opts.theme || 'red'} pp-size-${opts.ppSize || 'normal'}${opts.logos ? ' pd-logos' : ''}` }, sheets);
  runPrint(doc, `${t.name}_パンフレット`, PAGE);
  return true;
}
