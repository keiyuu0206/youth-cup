import { api } from './web-api.js';
import { h, mount, store, poller, formatDate, toHHMM } from './web-ui.js';
import { scheduleView, standingsView, bracketView, teamsView, teamMap, sideInfo, codeMap, winnerSide } from './web-views.js';

export async function viewer(root, slug) {
  let data = null;
  const st = {
    catId: store.get(`v:${slug}:cat`),
    tab: 'schedule',
    query: '',
    onlyMine: store.get(`v:${slug}:only`, false),
  };

  const myKey = () => `v:${slug}:my:${st.catId}`;
  const myTeam = () => store.get(myKey());

  async function load(initial = false) {
    const res = await api('GET', `/api/public/${encodeURIComponent(slug)}${data ? `?rev=${data.tournament.rev}` : ''}`);
    if (res.unchanged) return;
    data = res;
    if (!data.categories.find((c) => c.id === st.catId)) st.catId = data.categories[0]?.id;
    if (!initial) render();
  }

  try {
    await load(true);
  } catch (e) {
    mount(root, h('div', { class: 'wrap' }, h('p', { class: 'empty' }, e.message)));
    return;
  }
  document.title = `${data.tournament.name} | 試合結果`;
  render();
  poller(() => load(), 20000);

  function render() {
    const t = data.tournament;
    const cat = data.categories.find((c) => c.id === st.catId);
    const hasLeague = cat && cat.config.format !== 'knockout' && cat.config.showStandings;
    const hasKo = cat && cat.config.format !== 'league';
    if (st.tab === 'standings' && !hasLeague) st.tab = 'schedule';
    if (st.tab === 'bracket' && !hasKo) st.tab = 'schedule';
    document.body.classList.add('has-bottom-nav');

    const header = h('header', { class: 'site-head' }, h('div', { class: 'wrap' },
      t.logo ? h('img', { class: 'logo', src: t.logo, alt: '' }) : null,
      h('div', null, h('h1', null, t.name), h('div', { class: 'meta' }, [formatDate(t.date), t.venue].filter(Boolean).join('　')))));

    if (!cat) {
      mount(root, header, h('div', { class: 'wrap' }, h('p', { class: 'empty' }, '試合日程はまだ公開されていません')));
      return;
    }

    const ctx = { tournament: t, myTeam: myTeam(), cache: { teams: teamMap(cat), codes: codeMap(cat) } };

    const catChips = data.categories.length > 1 ? h('div', { class: 'chips', role: 'tablist', 'aria-label': 'カテゴリ' },
      data.categories.map((c) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(c.id === st.catId), onclick: () => { st.catId = c.id; store.set(`v:${slug}:cat`, c.id); render(); } }, c.name))) : null;

    const teamSelect = h('select', { 'aria-label': '自チーム', onchange: (e) => { store.set(myKey(), e.target.value || null); render(); } },
      h('option', { value: '' }, '自チームを選ぶ'),
      cat.teams.map((x) => h('option', { value: x.id, selected: x.id === ctx.myTeam }, x.name)));

    const search = h('input', { type: 'text', placeholder: 'チーム名で検索', value: st.query, 'aria-label': 'チーム名で検索',
      oninput: (e) => { st.query = e.target.value; renderBody(); } });

    const filters = h('div', { class: 'stack', style: { marginTop: '12px' } },
      h('div', { class: 'row' }, h('div', { style: { flex: '1 1 180px' } }, teamSelect),
        ctx.myTeam ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.onlyMine, onchange: (e) => { st.onlyMine = e.target.checked; store.set(`v:${slug}:only`, st.onlyMine); renderBody(); } }), '自チームだけ') : null),
      st.tab === 'schedule' || st.tab === 'teams' ? search : null);

    const body = h('main', null);
    const bodyWrap = h('div', { class: 'wrap' }, catChips, filters, body,
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '24px' } },
        h('button', { class: 'btn', type: 'button', onclick: () => snsMode(t, cat, ctx) }, 'SNS用の画像を表示')));

    function renderBody() {
      const q = st.query.trim();
      const mineOnly = st.onlyMine && ctx.myTeam;
      const filter = (m) => {
        if (mineOnly && m.home_team_id !== ctx.myTeam && m.away_team_id !== ctx.myTeam) return false;
        if (!q) return true;
        const a = sideInfo(m, 'home', cat, ctx.cache).text;
        const b = sideInfo(m, 'away', cat, ctx.cache).text;
        return a.includes(q) || b.includes(q);
      };
      let view;
      if (st.tab === 'schedule') view = scheduleView(cat, { ...ctx, emptyText: q ? `「${q}」の試合は見つかりません` : '試合はまだありません' }, filter);
      else if (st.tab === 'standings') view = standingsView(cat, ctx);
      else if (st.tab === 'bracket') view = bracketView(cat, ctx);
      else view = teamsView(cat, { ...ctx, onPickTeam: (id) => { store.set(myKey(), id); st.onlyMine = true; store.set(`v:${slug}:only`, true); st.tab = 'schedule'; st.query = ''; render(); } }, q);
      mount(body, view);
    }

    const tabs = [
      ['schedule', '日程・結果', '⏱'],
      hasLeague ? ['standings', '順位表', '≡'] : null,
      hasKo ? ['bracket', 'トーナメント', '⌸'] : null,
      ['teams', 'チーム', '◎'],
    ].filter(Boolean);
    const nav = h('nav', { class: 'bottom-nav', 'aria-label': '表示切り替え' }, h('div', { class: 'wrap' },
      tabs.map(([k, label, ico]) => h('button', { type: 'button', 'aria-current': st.tab === k ? 'page' : null, onclick: () => { st.tab = k; render(); window.scrollTo(0, 0); } },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), label))));

    mount(root, header, bodyWrap, nav);
    renderBody();
  }
}

// SNS投稿用：枠の比率を固定したカードを表示し、端末のスクリーンショットで保存してもらう
function snsMode(t, cat, ctx) {
  const st = { kind: ctx.myTeam ? 'mine' : 'standings', shape: 'sq' };
  const back = h('div', { class: 'sns-back', role: 'dialog', 'aria-label': 'SNS用の画像' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const draw = () => {
    const kinds = [
      cat.config.format !== 'knockout' ? ['standings', '順位表'] : null,
      ctx.myTeam ? ['mine', '自チームの結果'] : null,
      ['results', '最新の結果'],
      cat.finalRanking && cat.finalRanking.length ? ['final', '最終順位'] : null,
    ].filter(Boolean);
    if (!kinds.find(([k]) => k === st.kind)) st.kind = kinds[0][0];

    const content = h('div', { class: 'sb' });
    const tm = teamMap(cat);
    const confirmed = cat.matches.filter((m) => m.status === 'confirmed');
    const line = (m) => {
      const w = winnerSide(m);
      return h('div', { class: 'sm' }, h('span', { class: 't' }, toHHMM(m.start_min)),
        h('span', { class: 'h', style: { textDecoration: w === 'home' ? 'underline' : 'none' } }, sideInfo(m, 'home', cat, ctx.cache).text),
        h('span', { class: 's' }, `${m.home_score}-${m.away_score}${m.home_pk != null ? ` (${m.home_pk}-${m.away_pk})` : ''}`),
        h('span', { class: 'a', style: { textDecoration: w === 'away' ? 'underline' : 'none' } }, sideInfo(m, 'away', cat, ctx.cache).text));
    };
    if (st.kind === 'standings') {
      for (const [g, s] of Object.entries(cat.standings).sort()) {
        content.append(h('div', { style: { fontWeight: 700, margin: '4px 0' } }, `${g}組${s.complete ? '' : '（暫定）'}`),
          h('table', { class: 'standings' }, h('tbody', null, s.rows.map((r) => h('tr', { class: r.teamId === ctx.myTeam ? 'mine' : '' },
            h('td', { class: 'rank' }, r.rank), h('td', { class: 'team' }, tm[r.teamId]?.name || '-'),
            h('td', null, `${r.w}勝${r.d}分${r.l}敗`), h('td', null, r.gd > 0 ? `+${r.gd}` : r.gd), h('td', { class: 'pts' }, `${r.pts}点`))))));
      }
    } else if (st.kind === 'mine') {
      const list = confirmed.filter((m) => m.home_team_id === ctx.myTeam || m.away_team_id === ctx.myTeam).sort((a, b) => a.start_min - b.start_min);
      content.append(h('div', { style: { fontWeight: 700, fontSize: '1.1rem', marginBottom: '6px' } }, tm[ctx.myTeam]?.name || ''));
      content.append(...(list.length ? list.map(line) : [h('p', null, '確定した試合はまだありません')]));
    } else if (st.kind === 'results') {
      const list = confirmed.sort((a, b) => b.start_min - a.start_min).slice(0, st.shape === 'story' ? 14 : 8).reverse();
      content.append(...(list.length ? list.map(line) : [h('p', null, '確定した試合はまだありません')]));
    } else {
      content.append(h('div', { class: 'podium' }, cat.finalRanking.map((r) => h('div', { class: 'sm', style: { gridTemplateColumns: '60px 1fr' } },
        h('span', { class: 's' }, `${r.rank}位`), h('span', { class: 'a' }, tm[r.teamId]?.name || '-')))));
    }

    const now = new Date();
    const card = h('div', { class: `sns-card ${st.shape}` },
      h('div', { class: 'sh' }, t.logo ? h('img', { src: t.logo, alt: '' }) : null,
        h('div', null, h('div', { class: 'tt' }, t.name), h('div', { class: 'st' }, `${cat.name}　${formatDate(t.date)}`))),
      content,
      h('div', { class: 'sf' }, `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} 時点`));

    mount(back,
      h('div', { class: 'sns-bar' }, kinds.map(([k, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.kind === k), onclick: () => { st.kind = k; draw(); } }, label))),
      h('div', { class: 'sns-bar' },
        [['sq', '正方形'], ['story', 'ストーリー']].map(([k, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.shape === k), onclick: () => { st.shape = k; draw(); } }, label)),
        h('button', { class: 'chip-btn', type: 'button', onclick: close }, '閉じる')),
      card,
      h('p', { class: 'sns-hint' }, 'この画面をスクリーンショットして投稿してください'));
  };
  draw();
  document.body.append(back);
}
