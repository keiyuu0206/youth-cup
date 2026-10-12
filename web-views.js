import { h, toHHMM, todayStr, nowMin } from './web-ui.js';

export const matchLength = (cfg) => cfg.halfMinutes * 2 + cfg.halftimeMinutes;
export const courtName = (cfg, i) => (cfg.courtNames && cfg.courtNames[i]) || `${String.fromCharCode(65 + i)}コート`;

export const teamMap = (cat) => Object.fromEntries(cat.teams.map((t) => [t.id, t]));
export const codeMap = (cat) => Object.fromEntries(cat.matches.filter((m) => m.code).map((m) => [m.code, m]));

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

// 試合の状態（表示用）
export function statusOf(m, cat, tournament) {
  if (m.status === 'confirmed') return { key: 'confirmed', label: '確定', cls: 'done' };
  if (m.status === 'provisional') return { key: 'provisional', label: '結果確認中', cls: 'wait' };
  const today = todayStr();
  const end = m.start_min + matchLength(cat.config);
  if (tournament.date && tournament.date < today) return { key: 'waiting', label: '結果確認中', cls: 'wait' };
  if (tournament.date === today && tournament.status === 'live') {
    const n = nowMin();
    if (n >= m.start_min && n < end) return { key: 'playing', label: '試合中', cls: 'live' };
    if (n >= end) return { key: 'waiting', label: '結果確認中', cls: 'wait' };
  }
  return { key: 'upcoming', label: '試合前', cls: '' };
}

function teamEl(info, side, win, cat) {
  const logo = info.team && info.team.logo ? h('img', { src: info.team.logo, alt: '' }) : null;
  return h('div', { class: `team ${side}${info.placeholder ? ' placeholder' : ''}${win ? ' win' : ''}` },
    side === 'away' ? logo : null, h('span', null, info.text), side === 'home' ? logo : null);
}

export function scoreEl(m, { showProvisional = false } = {}) {
  const visible = m.status === 'confirmed' || (showProvisional && m.status === 'provisional');
  if (!visible || m.home_score == null) return h('div', { class: 'score pending' }, 'vs');
  const pk = m.home_pk != null && m.away_pk != null ? h('span', { class: 'pk' }, `PK ${m.home_pk}-${m.away_pk}`) : null;
  const ff = m.forfeit ? h('span', { class: 'pk' }, '不戦勝') : null;
  return h('div', { class: 'score', 'aria-label': `${m.home_score}対${m.away_score}` }, `${m.home_score} - ${m.away_score}`, pk, ff);
}

export function matchCard(m, cat, ctx) {
  const cache = ctx.cache || {};
  const home = sideInfo(m, 'home', cat, cache);
  const away = sideInfo(m, 'away', cat, cache);
  const st = statusOf(m, cat, ctx.tournament);
  const mine = ctx.myTeam && (m.home_team_id === ctx.myTeam || m.away_team_id === ctx.myTeam);
  const showScore = m.status === 'confirmed' || (ctx.showProvisional && m.status === 'provisional');
  const w = showScore ? winnerSide(m) : null;
  return h('article', { class: `match${mine ? ' mine' : ''}${m.status === 'confirmed' ? ' confirmed' : ''}` },
    h('div', { class: 'meta' },
      h('span', { class: 'tag' }, courtName(cat.config, m.court)),
      h('span', null, m.label),
      st.key !== 'confirmed' ? h('span', { class: `tag ${st.cls}` }, st.label) : null,
      m.time_changed ? h('span', { class: 'tag changed' }, '時間変更') : null,
      m.corrected && m.status === 'confirmed' ? h('span', { class: 'tag' }, '修正済み') : null),
    teamEl(home, 'home', w === 'home', cat),
    scoreEl(m, { showProvisional: ctx.showProvisional }),
    teamEl(away, 'away', w === 'away', cat));
}

export function scheduleView(cat, ctx, filter = () => true) {
  const list = cat.matches.filter(filter).sort((a, b) => a.start_min - b.start_min || a.court - b.court);
  if (!list.length) return h('p', { class: 'empty' }, ctx.emptyText || '表示できる試合がありません');
  const blocks = [];
  let cur = null;
  let prevSession = null;
  for (const m of list) {
    if (prevSession === 'am' && m.session === 'pm') blocks.push(h('p', { class: 'muted small', style: { textAlign: 'center', margin: '16px 0 0' } }, '昼休憩'));
    prevSession = m.session;
    if (!cur || cur.t !== m.start_min) {
      cur = { t: m.start_min, el: h('section', { class: 'time-block' }, h('div', { class: 'time-label' }, toHHMM(m.start_min))) };
      blocks.push(cur.el);
    }
    cur.el.append(matchCard(m, cat, ctx));
  }
  return h('div', null, blocks);
}

export function standingsView(cat, ctx) {
  const groups = Object.keys(cat.standings || {}).sort();
  if (!groups.length) return h('p', { class: 'empty' }, '順位表はまだありません');
  const tm = teamMap(cat);
  const advance = cat.config.format === 'league_knockout' ? cat.config.advance : 0;
  return h('div', null, groups.map((g) => {
    const st = cat.standings[g];
    return h('section', { class: 'panel', style: { padding: '12px 0 4px', marginTop: '12px' } },
      h('div', { class: 'panel-head', style: { padding: '0 12px', marginBottom: '6px' } },
        h('h2', null, `${g}組`),
        h('span', { class: 'spacer' }),
        st.complete ? (st.needsLottery ? h('span', { class: 'tag alert' }, '抽選待ち') : h('span', { class: 'tag done' }, '確定')) : h('span', { class: 'tag' }, '暫定順位')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
        h('thead', null, h('tr', null, ['順位', 'チーム', '試', '勝', '分', '敗', '得', '失', '差', '点'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, st.rows.map((r) => h('tr', { class: `${r.teamId === ctx.myTeam ? 'mine' : ''} ${st.complete && r.rank <= advance ? 'advance' : ''}` },
          h('td', { class: 'rank' }, r.tied ? `${r.rank}=` : r.rank),
          h('td', { class: 'team' }, tm[r.teamId] ? tm[r.teamId].name : '-', r.lottery ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, '抽選') : null),
          h('td', null, r.p), h('td', null, r.w), h('td', null, r.d), h('td', null, r.l),
          h('td', null, r.gf), h('td', null, r.ga), h('td', null, r.gd > 0 ? `+${r.gd}` : r.gd),
          h('td', { class: 'pts' }, r.pts)))))));
  }), h('p', { class: 'muted small', style: { marginTop: '10px' } }, `順位の決め方: ${(cat.config.tiebreak || []).map((k) => TIEBREAK_LABEL[k]).join(' → ')}`));
}

export const TIEBREAK_LABEL = { points: '勝点', gd: '得失点差', gf: '総得点', h2h: '当該チーム間の対戦成績', lottery: '抽選' };

export function bracketView(cat, ctx) {
  const ko = cat.matches.filter((m) => m.stage === 'knockout');
  if (!ko.length) return h('p', { class: 'empty' }, 'トーナメントはありません');
  const cache = { teams: teamMap(cat), codes: codeMap(cat) };
  const rounds = {};
  for (const m of ko) (rounds[m.round] ||= []).push(m);
  const cols = Object.keys(rounds).map(Number).sort((a, b) => a - b).map((r) =>
    h('div', { class: 'round' }, rounds[r].sort((a, b) => a.start_min - b.start_min || a.court - b.court).map((m) => {
      const showScore = m.status === 'confirmed' || (ctx.showProvisional && m.status === 'provisional');
      const w = showScore ? winnerSide(m) : null;
      const line = (side) => {
        const info = sideInfo(m, side, cat, cache);
        const s = showScore ? (side === 'home' ? m.home_score : m.away_score) : '';
        const pk = showScore && m.home_pk != null ? `(${side === 'home' ? m.home_pk : m.away_pk})` : '';
        const id = side === 'home' ? m.home_team_id : m.away_team_id;
        return h('div', { class: `bt${w === side ? ' win' : ''}${info.placeholder ? ' ph' : ''}${id && id === ctx.myTeam ? ' mine' : ''}` },
          h('span', null, info.text), h('span', { class: 's' }, `${s ?? ''}${pk}`));
      };
      return h('div', { class: 'bm' }, line('home'), line('away'),
        h('div', { class: 'bl' }, `${m.label}　${toHHMM(m.start_min)} ${courtName(cat.config, m.court)}`));
    })));
  return h('div', null,
    finalRankingView(cat, ctx),
    h('div', { class: 'bracket', style: { marginTop: '12px' } }, cols));
}

export function finalRankingView(cat, ctx) {
  if (!cat.finalRanking || !cat.finalRanking.length) return null;
  const tm = teamMap(cat);
  return h('section', null, h('h2', { style: { margin: '12px 0 8px' } }, '最終順位'),
    h('div', { class: 'podium' }, cat.finalRanking.map((r) => h('div', { class: `p${r.teamId === ctx.myTeam ? ' mine' : ''}` },
      h('span', { class: 'r' }, `${r.rank}位`), h('strong', null, tm[r.teamId] ? tm[r.teamId].name : '-')))));
}

export function teamsView(cat, ctx, query = '') {
  const q = query.trim();
  const list = cat.teams.filter((t) => !q || t.name.includes(q) || (t.short_name || '').includes(q));
  if (!list.length) return h('p', { class: 'empty' }, q ? `「${q}」に一致するチームはありません` : 'チームはまだ登録されていません');
  const groups = {};
  for (const t of list) (groups[t.group_label || ''] ||= []).push(t);
  return h('div', null, Object.keys(groups).sort().map((g) => h('section', { class: 'panel', style: { marginTop: '12px' } },
    g ? h('h2', { style: { marginBottom: '8px' } }, `${g}組`) : null,
    groups[g].map((t) => h('div', { class: 'row', style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
      t.logo ? h('img', { src: t.logo, alt: '', width: 28, height: 28, style: { borderRadius: '50%', objectFit: 'contain' } }) : null,
      h('strong', null, t.name),
      t.id === ctx.myTeam ? h('span', { class: 'tag changed' }, '自チーム') : null,
      h('span', { class: 'spacer' }),
      ctx.onPickTeam ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => ctx.onPickTeam(t.id) }, '試合を見る') : null)))));
}
