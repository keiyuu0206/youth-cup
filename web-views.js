import { h, toHHMM, todayStr, nowMin, icon } from './web-ui.js';

export const matchLength = (cfg) => cfg.halfMinutes * 2 + cfg.halftimeMinutes;
export const courtName = (cfg, i) => (cfg.courtNames && cfg.courtNames[i]) || `${String.fromCharCode(65 + i)}コート`;

export const teamMap = (cat) => Object.fromEntries(cat.teams.map((t) => [t.id, t]));
export const codeMap = (cat) => Object.fromEntries(cat.matches.filter((m) => m.code).map((m) => [m.code, m]));

export const TIEBREAK_LABEL = { points: '勝点', gd: '得失点差', gf: '総得点', h2h: '当該チーム間の対戦成績', lottery: '抽選' };

export function refText(ref, byCode) {
  if (!ref) return '未定';
  if (ref.t === 'grp') return `${ref.g}組${ref.r}位`;
  if (ref.t === 'win' || ref.t === 'lose') {
    const m = byCode[ref.m];
    return `${m ? m.label : ref.m}の${ref.t === 'win' ? '勝者' : '敗者'}`;
  }
  return '未定';
}

export function sideInfo(m, side, cat, cache = {}) {
  const tm = cache.teams || teamMap(cat);
  const id = side === 'home' ? m.home_team_id : m.away_team_id;
  if (id && tm[id]) return { team: tm[id], text: tm[id].name, placeholder: false };
  const ref = side === 'home' ? m.home_ref : m.away_ref;
  return { team: null, text: refText(ref, cache.codes || codeMap(cat)), placeholder: true };
}

export function winnerSide(m) {
  if (m.home_score == null || m.away_score == null) return null;
  if (m.forfeit) return m.forfeit;
  if (m.home_score !== m.away_score) return m.home_score > m.away_score ? 'home' : 'away';
  if (m.home_pk != null && m.away_pk != null && m.home_pk !== m.away_pk) return m.home_pk > m.away_pk ? 'home' : 'away';
  return null;
}

export function statusOf(m, cat, tournament) {
  if (m.status === 'confirmed') return { key: 'confirmed', label: '終了', cls: 'done' };
  if (m.status === 'provisional') return { key: 'provisional', label: '結果待ち', cls: 'wait' };
  const today = todayStr();
  const end = m.start_min + matchLength(cat.config);
  if (tournament.date && tournament.date < today) return { key: 'waiting', label: '結果待ち', cls: 'wait' };
  if (tournament.date === today && tournament.status === 'live') {
    const n = nowMin();
    if (n >= m.start_min && n < end) return { key: 'playing', label: '試合中', cls: 'live' };
    if (n >= end) return { key: 'waiting', label: '結果待ち', cls: 'wait' };
  }
  return { key: 'upcoming', label: toHHMM(m.start_min), cls: '' };
}

// エンブレム。ロゴが無ければチーム名の頭文字と、名前から決まる色で丸いマークを作る
function hue(s) {
  let x = 0;
  for (const ch of s) x = (x * 31 + ch.codePointAt(0)) % 3600;
  return x % 360;
}
export function crest(team, size = 28) {
  const box = `width:${size}px;height:${size}px;`;
  if (team && team.logo) return h('img', { class: 'crest', src: team.logo, alt: '', width: size, height: size, style: box });
  if (!team) return h('span', { class: 'crest crest-ph', 'aria-hidden': 'true', style: `${box}font-size:${Math.round(size * 0.4)}px` }, '?');
  const ch = [...team.name.replace(/^(FC|SC|JFC|SSS|SSC)\s*/i, '').trim()][0] || [...team.name][0];
  return h('span', { class: 'crest', 'aria-hidden': 'true', style: `${box}font-size:${Math.round(size * 0.42)}px;--h:${hue(team.name)}` }, ch);
}

// 旧呼び出し互換（管理画面などで使う場合のため）
export function scoreEl(m, { showProvisional = false } = {}) {
  const visible = m.status === 'confirmed' || (showProvisional && m.status === 'provisional');
  if (!visible || m.home_score == null) return h('span', { class: 'mc-score' }, '-');
  return h('span', { class: 'mc-score' }, `${m.home_score} - ${m.away_score}`);
}

export function matchCard(m, cat, ctx) {
  const cache = ctx.cache || {};
  const st = statusOf(m, cat, ctx.tournament);
  const mineMatch = ctx.myTeam && (m.home_team_id === ctx.myTeam || m.away_team_id === ctx.myTeam);
  const showScore = m.status === 'confirmed' || (ctx.showProvisional && m.status === 'provisional');
  const w = showScore ? winnerSide(m) : null;

  const row = (side) => {
    const info = sideInfo(m, side, cat, cache);
    const id = side === 'home' ? m.home_team_id : m.away_team_id;
    const score = showScore ? (side === 'home' ? m.home_score : m.away_score) : null;
    const pk = showScore && m.home_pk != null ? (side === 'home' ? m.home_pk : m.away_pk) : null;
    const cls = w ? (w === side ? 'win' : 'lose') : '';
    return h('div', { class: `mc-row ${cls}` },
      crest(info.team, 28),
      h('span', { class: `mc-name${info.placeholder ? ' ph' : ''}` }, info.text, id && id === ctx.myTeam ? icon('star') : null),
      h('span', { class: 'mc-score' }, score ?? '', pk != null ? h('small', null, `PK${pk}`) : null));
  };

  const status = st.key === 'playing'
    ? h('span', { class: 'mc-st live' }, h('i', { class: 'dot pulse' }), '試合中')
    : h('span', { class: `mc-st ${st.cls}` }, st.label);

  return h('article', { class: `mc${mineMatch ? ' is-mine' : ''}`, 'aria-label': `${m.label} ${sideInfo(m, 'home', cat, cache).text} 対 ${sideInfo(m, 'away', cat, cache).text}` },
    h('div', { class: 'mc-meta' },
      h('span', { class: 'mc-court' }, courtName(cat.config, m.court)),
      h('span', null, m.label),
      m.forfeit && showScore ? h('span', { class: 'flag' }, '不戦勝') : null,
      m.time_changed ? h('span', { class: 'flag changed' }, '時間変更') : null,
      m.corrected && m.status === 'confirmed' ? h('span', { class: 'flag' }, '修正あり') : null,
      status),
    row('home'), row('away'));
}

export function scheduleView(cat, ctx, filter = () => true) {
  const list = cat.matches.filter(filter).sort((a, b) => a.start_min - b.start_min || a.court - b.court);
  if (!list.length) return h('p', { class: 'empty' }, ctx.emptyText || '表示できる試合がありません');
  const out = [];
  let cur = null;
  let prevSession = null;
  for (const m of list) {
    if (prevSession === 'am' && m.session === 'pm') out.push(h('div', { class: 'break' }, '昼休憩'));
    prevSession = m.session;
    if (!cur || cur.t !== m.start_min) {
      const listEl = h('div', { class: 'slot-list' });
      const head = h('div', { class: 'slot-head' }, h('span', { class: 't' }, toHHMM(m.start_min)));
      cur = { t: m.start_min, list: listEl, head, live: false };
      out.push(h('section', { class: 'slot', 'data-t': m.start_min }, head, listEl));
    }
    if (!cur.live && statusOf(m, cat, ctx.tournament).key === 'playing') {
      cur.live = true;
      cur.head.append(h('span', { class: 'live-label' }, h('i', { class: 'dot pulse' }), '試合中'));
    }
    cur.list.append(matchCard(m, cat, ctx));
  }
  return h('div', null, out);
}

export function standingsView(cat, ctx) {
  const groups = Object.keys(cat.standings || {}).sort();
  if (!groups.length) return h('p', { class: 'empty' }, '順位表はまだありません');
  const tm = teamMap(cat);
  const plan = cat.config.knockoutPlan || { type: 'top', k: cat.config.advance };
  const lk = cat.config.format === 'league_knockout';
  const advance = lk && (plan.type === 'top' || plan.type === 'split') ? plan.k : 0;
  const note = !lk ? null
    : plan.type === 'top' ? `上位${plan.k}チームが決勝トーナメントへ`
      : plan.type === 'split' ? `${plan.k}位までが上位トーナメント、それより下は下位トーナメントへ`
        : plan.type === 'all' ? '全チームが決勝トーナメントへ'
          : plan.type === 'byrank' ? '同じ順位のチームどうしでトーナメント' : null;
  return h('div', null, groups.map((g) => {
    const st = cat.standings[g];
    const badge = st.complete
      ? (st.needsLottery ? h('span', { class: 'st-badge alert' }, '抽選待ち') : h('span', { class: 'st-badge ok' }, '確定'))
      : h('span', { class: 'st-badge' }, '途中経過');
    return h('section', { class: 'st-card' },
      h('div', { class: 'st-head' }, h('h2', null, `${g}組`), badge),
      h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, '順位')),
          h('th', { scope: 'col', style: { textAlign: 'left' } }, 'チーム'),
          ['試', '勝', '分', '敗', '得', '失', '差', '点'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, st.rows.map((r) => h('tr', { class: `${r.teamId === ctx.myTeam ? 'mine' : ''} ${r.rank <= advance ? 'advance' : ''}` },
          h('td', { class: 'rank' }, h('span', { class: 'rank-no' }, r.rank)),
          h('td', { class: 'team' }, h('div', { class: 'st-team' }, crest(tm[r.teamId], 22), h('span', null, tm[r.teamId] ? (tm[r.teamId].short_name || tm[r.teamId].name) : '-'),
            r.tied && st.complete ? h('span', { class: 'tie-mark' }, '抽選待ち') : null,
            r.lottery ? h('span', { class: 'tie-mark' }, '抽選') : null)),
          h('td', null, r.p), h('td', null, r.w), h('td', null, r.d), h('td', null, r.l),
          h('td', null, r.gf), h('td', null, r.ga), h('td', null, r.gd > 0 ? `+${r.gd}` : r.gd),
          h('td', { class: 'pts' }, r.pts)))))),
      note ? h('div', { class: 'st-note' }, h('span', null, advance ? h('i') : null, note)) : null);
  }), h('p', { class: 'muted small', style: { margin: '14px 4px 0' } }, `勝点が並んだときは ${(cat.config.tiebreak || []).map((k) => TIEBREAK_LABEL[k]).join('、')} の順で決めます。`));
}

export function finalRankingView(cat, ctx) {
  if (!cat.finalRanking || !cat.finalRanking.length) return null;
  const tm = teamMap(cat);
  return h('section', null,
    h('div', { class: 'section-title' }, icon('trophy'), h('h2', null, '最終順位')),
    h('div', { class: 'podium' }, cat.finalRanking.map((r) => h('div', { class: `p r${r.rank}${r.teamId === ctx.myTeam ? ' mine' : ''}` },
      h('span', { class: 'r' }, `${r.rank}位`), crest(tm[r.teamId], 32), h('strong', null, tm[r.teamId] ? tm[r.teamId].name : '-')))));
}

export function bracketView(cat, ctx) {
  const ko = cat.matches.filter((m) => m.stage === 'knockout');
  if (!ko.length) return h('p', { class: 'empty' }, 'トーナメントはありません');
  const cache = { teams: teamMap(cat), codes: codeMap(cat) };
  // 複数のトーナメント（上位・下位など）は分けて表示する
  const sections = [];
  for (const m of ko) {
    const name = m.group_label || '';
    let sec = sections.find((x) => x.name === name);
    if (!sec) sections.push((sec = { name, list: [] }));
    sec.list.push(m);
  }
  // 上位のトーナメントから順に表示する
  const topRank = (sec) => Math.min(...sec.list.map((m) => m.place_w ?? m.place_l ?? Infinity));
  sections.sort((a, b) => topRank(a) - topRank(b));
  const strip = (label, name) => (name ? label.split(`${name} `).join('') : label);
  const bracketOf = (sec) => {
    const rounds = {};
    for (const m of sec.list) (rounds[m.round] ||= []).push(m);
    const cols = Object.keys(rounds).map(Number).sort((a, b) => a - b).map((r) => {
      const list = rounds[r].sort((a, b) => a.start_min - b.start_min || a.court - b.court);
      const title = [...new Set(list.map((m) => strip(m.label, sec.name).replace(/\s\d+$/, '')))].join('・');
      return h('div', { class: 'round' }, h('h3', null, title), h('div', { class: 'col' }, list.map((m) => {
        const showScore = m.status === 'confirmed' || (ctx.showProvisional && m.status === 'provisional');
        const w = showScore ? winnerSide(m) : null;
        const line = (side) => {
          const info = sideInfo(m, side, cat, cache);
          const sc = showScore ? (side === 'home' ? m.home_score : m.away_score) : '';
          const pk = showScore && m.home_pk != null ? ` (${side === 'home' ? m.home_pk : m.away_pk})` : '';
          const id = side === 'home' ? m.home_team_id : m.away_team_id;
          return h('div', { class: `bt${w ? (w === side ? ' win' : ' lose') : ''}${info.placeholder ? ' ph' : ''}${id && id === ctx.myTeam ? ' mine' : ''}` },
            crest(info.team, 22), h('span', { class: 'nm' }, info.placeholder ? strip(info.text, sec.name) : info.text), h('span', { class: 's' }, `${sc ?? ''}${pk}`));
        };
        return h('div', { class: 'bm' }, line('home'), line('away'),
          h('div', { class: 'bl' }, `${toHHMM(m.start_min)}  ${courtName(cat.config, m.court)}  ${strip(m.label, sec.name)}`));
      })));
    });
    return h('div', { class: 'bracket' }, cols);
  };
  return h('div', null,
    finalRankingView(cat, ctx),
    sections.map((sec) => h('section', null,
      h('div', { class: 'section-title' }, icon(sections.length > 1 ? 'trophy' : 'list'), h('h2', null, sec.name || 'トーナメント表')),
      bracketOf(sec))));
}

export function teamsView(cat, ctx, query = '') {
  const q = query.trim();
  const list = cat.teams.filter((t) => !q || t.name.includes(q) || (t.short_name || '').includes(q));
  if (!list.length) return h('p', { class: 'empty' }, q ? `「${q}」に一致するチームはありません` : 'チームはまだ登録されていません');
  const groups = {};
  for (const t of list) (groups[t.group_label || ''] ||= []).push(t);
  return h('div', null, Object.keys(groups).sort().map((g) => h('section', null,
    g ? h('h2', { class: 'group-title' }, `${g}組`) : null,
    h('div', { class: 'team-grid' }, groups[g].map((t) => h('button', { class: `tm${t.id === ctx.myTeam ? ' mine' : ''}`, type: 'button',
      onclick: () => ctx.onPickTeam && ctx.onPickTeam(t.id), 'aria-label': `${t.name}の試合を見る` },
      crest(t, 40), h('strong', null, t.name), t.group_label ? h('span', { class: 'tm-g' }, `${t.group_label}組`) : null,
      t.id === ctx.myTeam ? h('span', { class: 'star' }, icon('star')) : null))))));
}
