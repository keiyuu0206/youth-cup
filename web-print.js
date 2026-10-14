// 組合せ・結果を A4 縦で出力する（ブラウザの印刷から「PDFとして保存」）
import { h, mount, modal, toast, formatDate, toHHMM } from './web-ui.js';
import { teamMap, codeMap, sideInfo, courtName, dayOf, dayTotal, dayLabel, absMin, winnerSide, bracketView, TIEBREAK_LABEL } from './web-views.js';

const FORMAT_LABEL = { league: 'リーグ戦', knockout: 'トーナメント', league_knockout: 'リーグ戦＋トーナメント' };

function periodText(t) {
  if (t.end_date && t.end_date > t.date) return `${formatDate(t.date)} 〜 ${formatDate(t.end_date).replace(/^\d+年/, '')}`;
  return formatDate(t.date);
}

export function openPrintDialog(tournament, categories, currentCatId) {
  if (!categories.length) return toast('カテゴリがありません', true);
  const st = {
    cat: currentCatId || categories[0].id,
    sections: { groups: true, schedule: true, league: true, bracket: true },
    blank: false,
    day: 'all',
  };
  const content = h('div');
  const draw = () => {
    const cats = st.cat === 'all' ? categories : categories.filter((c) => c.id === st.cat);
    const hasLeague = cats.some((c) => c.config.format !== 'knockout');
    const hasKo = cats.some((c) => c.config.format !== 'league');
    const maxDays = Math.max(...cats.map((c) => dayTotal(c.config)));
    const check = (key, label, show = true) => (show ? h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: st.sections[key], onchange: (e) => { st.sections[key] = e.target.checked; } }), label) : null);
    mount(content,
      h('div', { class: 'stack' },
        categories.length > 1 ? h('label', { class: 'field' }, h('span', null, 'カテゴリ'), h('select', { onchange: (e) => { st.cat = e.target.value; draw(); } },
          categories.map((c) => h('option', { value: c.id, selected: st.cat === c.id }, c.name)),
          h('option', { value: 'all', selected: st.cat === 'all' }, 'すべてのカテゴリ'))) : null,
        h('div', null,
          h('div', { class: 'small', style: { fontWeight: 700, color: 'var(--ink-2)' } }, '出力する内容'),
          check('groups', '組分け', hasLeague),
          check('schedule', '組合せ・日程'),
          check('league', '星取表・順位', hasLeague),
          check('bracket', 'トーナメント表', hasKo)),
        maxDays > 1 ? h('label', { class: 'field' }, h('span', null, '組合せ・日程の日'), h('select', { onchange: (e) => { st.day = e.target.value; } },
          h('option', { value: 'all', selected: st.day === 'all' }, 'すべての日'),
          Array.from({ length: maxDays }, (_, d) => h('option', { value: String(d), selected: st.day === String(d) }, `${d + 1}日目のみ`)))) : null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.blank, onchange: (e) => { st.blank = e.target.checked; } }),
          'スコア欄を空欄にする（記入用・貼り出し用）'),
        h('p', { class: 'muted small', style: { margin: 0 } }, '用紙はA4縦です。印刷の画面が開いたら、送信先で「PDFとして保存」を選んでください（iPhoneは印刷画面の右上の共有ボタン →「"ファイル"に保存」）。')));
  };
  draw();
  modal({
    title: 'PDFで出力',
    content,
    actions: [
      { label: 'キャンセル', kind: 'btn-ghost' },
      { label: 'PDFを作成', kind: 'btn-primary', onClick: () => {
        if (!Object.values(st.sections).some(Boolean)) { toast('出力する内容を選んでください', true); return true; }
        const cats = st.cat === 'all' ? categories : categories.filter((c) => c.id === st.cat);
        setTimeout(() => printDocument(tournament, cats, st), 50);
      } },
    ],
  });
}

// ---------- 文書の組み立て ----------

function printDocument(t, cats, opts) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = h('div', { id: 'print-root' });
    document.body.append(root);
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${toHHMM(now.getHours() * 60 + now.getMinutes())}`;
  const doc = h('div', { class: 'pd' },
    h('header', { class: 'pd-head' },
      t.logo ? h('img', { src: t.logo, alt: '' }) : null,
      h('div', { class: 'pd-title' },
        h('h1', null, t.name),
        h('div', { class: 'pd-sub' }, t.date ? h('span', null, `開催日　${periodText(t)}`) : null, t.venue ? h('span', null, `会場　${t.venue}`) : null)),
      h('div', { class: 'pd-out' }, `${stamp} 時点`, h('br'), opts.blank ? '記入用' : '確定した結果のみ掲載')),
    cats.map((cat, i) => categoryBlock(t, cat, opts, i === 0)));
  mount(root, doc);

  // 各ページの上部に大会名、下部にページ番号（対応するブラウザのみ）
  let pageStyle = document.getElementById('print-page-style');
  if (!pageStyle) { pageStyle = h('style', { id: 'print-page-style' }); document.head.append(pageStyle); }
  const esc = (x) => String(x || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  pageStyle.textContent = `@page { @top-left { content: "${esc(t.name)}"; font-size: 7.5pt; color: #777; } @top-right { content: "${esc(t.venue)}"; font-size: 7.5pt; color: #777; } @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #555; } }`;

  // トーナメント表を用紙の幅に収める（測るために一時的に画面外で表示する）
  Object.assign(root.style, { display: 'block', position: 'absolute', left: '-10000px', top: '0', width: '188mm' });
  for (const el of root.querySelectorAll('.pd-fit')) {
    el.style.zoom = '';
    const inner = el.firstElementChild;
    const need = inner ? inner.scrollWidth : el.scrollWidth;
    const scale = Math.min(1, (el.clientWidth - 2) / need);
    if (scale < 1) el.style.zoom = String(Math.max(0.45, scale));
  }
  root.removeAttribute('style');

  const title = document.title;
  document.title = `${t.name}_${cats.length === 1 ? cats[0].name : '全カテゴリ'}_${opts.blank ? '組合せ' : '結果'}`;
  document.body.classList.add('printing');
  const done = () => { document.title = title; };
  window.addEventListener('afterprint', done, { once: true });
  setTimeout(() => window.print(), 120);
}

function categoryBlock(t, catIn, opts, first) {
  // 記入用は結果を消したコピーで描く
  const cat = opts.blank
    ? { ...catIn, finalRanking: [], matches: catIn.matches.map((m) => ({ ...m, status: 'none', home_score: null, away_score: null, home_pk: null, away_pk: null })) }
    : catIn;
  const cfg = cat.config;
  const groups = [...new Set(cat.teams.map((x) => x.group_label).filter(Boolean))].sort();
  const summary = [FORMAT_LABEL[cfg.format], `${cat.teams.length}チーム`, groups.length > 1 ? `${groups.length}組` : null, `${cfg.courts}面`].filter(Boolean).join('　');
  const s = opts.sections;
  return h('section', { class: `pd-cat${first ? ' first' : ''}` },
    h('div', { class: 'pd-cat-title' }, h('strong', null, cat.name), h('span', null, summary)),
    s.groups && cfg.format !== 'knockout' && groups.length ? groupsSection(cat, groups) : null,
    s.schedule ? scheduleSection(t, cat, opts) : null,
    s.league && cfg.format !== 'knockout' && groups.length ? leagueSection(cat, groups, opts) : null,
    s.bracket && cfg.format !== 'league' && cat.matches.some((m) => m.stage === 'knockout') ? bracketSection(t, cat) : null,
    !cat.matches.length && (s.schedule || s.league || s.bracket) ? h('p', { class: 'pd-note' }, '日程はまだ作成されていません。') : null);
}

function groupsSection(cat, groups) {
  return h('div', { class: 'pd-sec' }, h('h2', null, '組分け'),
    h('div', { class: 'pd-groups', style: { gridTemplateColumns: `repeat(${Math.min(4, groups.length)}, 1fr)` } }, groups.map((g) => h('div', { class: 'pd-group' },
      h('strong', null, `${g}組`),
      cat.teams.filter((x) => x.group_label === g).map((x) => h('div', null, x.name))))));
}

function scoreCells(m, side, blank) {
  if (blank || m.status !== 'confirmed' || m.home_score == null) return h('span', { class: 's' }, '');
  const sc = side === 'home' ? m.home_score : m.away_score;
  const pk = m.home_pk != null ? (side === 'home' ? m.home_pk : m.away_pk) : null;
  return h('span', { class: 's' }, sc, pk != null ? h('small', null, `(${pk})`) : null);
}

function matchCell(cat, m, cache, opts, rowTime) {
  const blank = opts.blank;
  const w = !blank && m.status === 'confirmed' ? winnerSide(m) : null;
  const line = (side) => {
    const info = sideInfo(m, side, cat, cache);
    return h('div', { class: `tr${w ? (w === side ? ' w' : ' l') : ''}` },
      h('span', { class: `n${info.placeholder ? ' ph' : ''}` }, info.text), scoreCells(m, side, blank));
  };
  return h('td', { class: `pd-cell${blank ? ' pd-blank' : ''}` },
    h('div', { class: 'lb' }, h('span', null, m.label), m.start_min !== rowTime ? h('span', null, toHHMM(m.start_min)) : (m.forfeit && !blank ? h('span', null, '不戦勝') : null)),
    line('home'), line('away'));
}

function scheduleSection(t, cat, opts) {
  const cfg = cat.config;
  const cache = { teams: teamMap(cat), codes: codeMap(cat) };
  const days = dayTotal(cfg);
  const dayFilter = opts.day === 'all' ? null : Number(opts.day);
  const list = cat.matches.filter((m) => dayFilter == null || dayOf(cfg, m.slot) === dayFilter)
    .sort((a, b) => absMin(cfg, a) - absMin(cfg, b) || a.court - b.court);
  if (!list.length) return h('div', { class: 'pd-sec' }, h('h2', null, '組合せ・日程'), h('p', { class: 'pd-note' }, '該当する試合はありません。'));
  const byDay = {};
  for (const m of list) (byDay[dayOf(cfg, m.slot)] ||= []).push(m);

  const gridTable = (ms) => {
    const slots = [...new Set(ms.map((m) => m.slot))].sort((a, b) => a - b);
    const rows = [];
    let prevSession = null;
    for (const sl of slots) {
      const inSlot = ms.filter((m) => m.slot === sl);
      const session = inSlot[0].session;
      if (prevSession === 'am' && session === 'pm') rows.push(h('tr', { class: 'pd-lunch' }, h('td', { colspan: cfg.courts + 1 }, '昼休憩')));
      prevSession = session;
      const rowTime = Math.min(...inSlot.map((m) => m.start_min));
      rows.push(h('tr', null, h('td', { class: 'pd-time' }, toHHMM(rowTime)),
        Array.from({ length: cfg.courts }, (_, c) => {
          const m = inSlot.find((x) => x.court === c);
          return m ? matchCell(cat, m, cache, opts, rowTime) : h('td', { class: 'pd-empty' }, '');
        })));
    }
    return h('table', { class: 'pd-t pd-grid' },
      h('colgroup', null, h('col', { style: { width: '13mm' } }), Array.from({ length: cfg.courts }, () => h('col'))),
      h('thead', null, h('tr', null, h('th', null, '時刻'), Array.from({ length: cfg.courts }, (_, c) => h('th', null, courtName(cfg, c))))),
      h('tbody', null, rows));
  };

  // コートが多いときは1試合1行の一覧にする
  const listTable = (ms) => h('table', { class: 'pd-t pd-list' },
    h('colgroup', null, ['8mm', '13mm', '16mm', '26mm', null, '18mm', null].map((w) => h('col', { style: w ? { width: w } : null }))),
    h('thead', null, h('tr', null, ['No', '時刻', 'コート', '試合', 'チーム', '結果', 'チーム'].map((x) => h('th', null, x)))),
    h('tbody', null, ms.map((m, i) => {
      const w = !opts.blank && m.status === 'confirmed' ? winnerSide(m) : null;
      const sc = !opts.blank && m.status === 'confirmed' && m.home_score != null
        ? `${m.home_score} - ${m.away_score}${m.home_pk != null ? `（PK ${m.home_pk}-${m.away_pk}）` : ''}` : '';
      return h('tr', null,
        h('td', { class: 'c' }, i + 1), h('td', { class: 'pd-time' }, toHHMM(m.start_min)), h('td', { class: 'c' }, courtName(cfg, m.court)),
        h('td', { class: 'sm' }, m.label),
        h('td', { class: `r${w === 'home' ? ' b' : ''}` }, sideInfo(m, 'home', cat, cache).text),
        h('td', { class: `c res${opts.blank ? ' pd-blank-res' : ''}` }, sc),
        h('td', { class: w === 'away' ? 'b' : '' }, sideInfo(m, 'away', cat, cache).text));
    })));

  const table = cfg.courts <= 4 ? gridTable : listTable;
  return h('div', { class: 'pd-sec' }, h('h2', null, '組合せ・日程'),
    Object.keys(byDay).sort((a, b) => a - b).map((d) => h('div', { class: 'pd-day' },
      days > 1 ? h('h3', null, dayLabel(cat, Number(d), t)) : null,
      table(byDay[d]))));
}

function leagueSection(cat, groups, opts) {
  const tm = teamMap(cat);
  const league = cat.matches.filter((m) => m.stage === 'league');
  return h('div', { class: 'pd-sec' }, h('h2', null, '星取表・順位'),
    groups.map((g) => {
      const st = (cat.standings || {})[g];
      const rows = st ? st.rows : [];
      const order = cat.teams.filter((x) => x.group_label === g);
      const rowOf = Object.fromEntries(rows.map((r) => [r.teamId, r]));
      const cell = (a, b) => {
        if (a.id === b.id) return h('td', { class: 'diag' });
        const m = league.find((x) => (x.home_team_id === a.id && x.away_team_id === b.id) || (x.home_team_id === b.id && x.away_team_id === a.id));
        if (!m || opts.blank || m.status !== 'confirmed' || m.home_score == null) return h('td', { class: 'pd-blank-res' });
        const mine = m.home_team_id === a.id ? m.home_score : m.away_score;
        const opp = m.home_team_id === a.id ? m.away_score : m.home_score;
        const mark = mine > opp ? '○' : mine < opp ? '●' : '△';
        return h('td', null, h('span', { class: 'mk' }, mark), `${mine}-${opp}`);
      };
      const n = order.length;
      const show = !opts.blank;
      return h('div', { class: 'pd-star-wrap' },
        h('h3', null, `${g}組${st && st.complete && show ? '' : show ? '（途中経過）' : ''}`),
        h('table', { class: 'pd-t pd-star' },
          h('colgroup', null, h('col', { style: { width: n > 6 ? '30mm' : '36mm' } }), order.map(() => h('col')), ['10mm', '10mm', '10mm', '10mm'].map((w) => h('col', { style: { width: w } }))),
          h('thead', null, h('tr', null, h('th', null, ''), order.map((x) => h('th', { class: 'tn-h' }, x.short_name || x.name)), ['勝点', '得失', '総得', '順位'].map((x) => h('th', null, x)))),
          h('tbody', null, order.map((a) => {
            const r = rowOf[a.id];
            return h('tr', null, h('td', { class: 'tn' }, a.name), order.map((b) => cell(a, b)),
              h('td', { class: 'b' }, show && r ? r.pts : ''), h('td', null, show && r ? (r.gd > 0 ? `+${r.gd}` : r.gd) : ''), h('td', null, show && r ? r.gf : ''),
              h('td', { class: 'b' }, show && r && r.p ? `${r.rank}${r.tied ? '=' : ''}` : ''));
          }))));
    }),
    h('p', { class: 'pd-note' }, `○勝ち　●負け　△引き分け（勝ち3点・引き分け1点・負け0点）。勝点が並んだときは ${(cat.config.tiebreak || []).map((k) => TIEBREAK_LABEL[k]).join('、')} の順で決めます。`));
}

function bracketSection(t, cat) {
  const view = bracketView(cat, { tournament: t, myTeam: null });
  // 図ごとに幅を合わせて縮小できるよう包む
  for (const sc of view.querySelectorAll('.tree-scroll')) {
    const wrap = h('div', { class: 'pd-fit' });
    sc.replaceWith(wrap);
    wrap.append(sc);
  }
  return h('div', { class: 'pd-sec pd-bracket' }, h('h2', null, 'トーナメント表'), view);
}
