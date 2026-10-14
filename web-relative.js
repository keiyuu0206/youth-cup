import { api, ApiError } from './web-api.js';
import { h, mount, store, poller, toast, toHHMM, formatUpdated, formatDate } from './web-ui.js';
import { teamMap, codeMap, sideInfo, courtName, statusOf, crest, absMin, dayOf, dayTotal, dayLabel } from './web-views.js';

export async function relative(root, slug) {
  let data = null;
  const drafts = {}; // 試合ID → 入力中のスコア
  const key = `r:${slug}:team`;

  async function load() {
    const res = await api('GET', `/api/rel/${encodeURIComponent(slug)}${data ? `?rev=${data.tournament.rev}` : ''}`);
    if (res.unchanged) return false;
    data = res;
    return true;
  }

  try {
    await load();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return pinScreen();
    mount(root, h('div', { class: 'wrap' }, h('p', { class: 'empty' }, e.message)));
    return;
  }
  start();

  function pinScreen() {
    const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, placeholder: '4桁の数字', 'aria-label': 'PIN',
      style: { fontFamily: 'var(--num)', fontSize: '2rem', textAlign: 'center', letterSpacing: '0.3em' } });
    const err = h('p', { class: 'notice error', hidden: true });
    const submit = async (e) => {
      e.preventDefault();
      try {
        await api('POST', `/api/rel/${encodeURIComponent(slug)}/login`, { pin: input.value.trim() });
        await load();
        start();
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
      }
    };
    mount(root,
      h('header', { class: 'site-head' }, h('div', { class: 'wrap' }, h('h1', null, '結果の登録'))),
      h('form', { class: 'wrap stack', style: { marginTop: '24px', maxWidth: '420px' }, onsubmit: submit },
        h('p', null, '大会本部から届いたPINを入力してください。'),
        input, err,
        h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '入る')));
    input.focus();
  }

  function start() {
    render();
    poller(async () => { if (await load()) render(); }, 10000);
  }

  function selected() {
    const s = store.get(key);
    if (!s) return null;
    const cat = data.categories.find((c) => c.id === s.catId);
    const team = cat && cat.teams.find((t) => t.id === s.teamId);
    return team ? { cat, team } : null;
  }

  function render() {
    const t = data.tournament;
    const header = h('header', { class: 'site-head' }, h('div', { class: 'wrap' },
      t.logo ? h('img', { class: 'logo', src: t.logo, alt: '' }) : null,
      h('div', null, h('h1', null, t.name), h('div', { class: 'meta' }, `結果の登録　${formatDate(t.date)}`))));
    const sel = selected();
    if (!sel) return mount(root, header, teamPicker());
    mount(root, header, matchesView(sel.cat, sel.team));
  }

  function teamPicker() {
    return h('div', { class: 'wrap', style: { marginTop: '16px' } },
      h('h2', null, '自チームを選んでください'),
      data.categories.map((c) => h('section', { class: 'panel', style: { marginTop: '12px' } },
        data.categories.length > 1 ? h('h3', { style: { marginBottom: '8px' } }, c.name) : null,
        h('div', { class: 'stack' }, c.teams.map((tm) => h('button', { class: 'btn btn-block', type: 'button', style: { justifyContent: 'flex-start' },
          onclick: () => { store.set(key, { catId: c.id, teamId: tm.id }); render(); window.scrollTo(0, 0); } }, tm.name))))),
      data.categories.every((c) => !c.teams.length) ? h('p', { class: 'empty' }, 'チームはまだ登録されていません') : null);
  }

  function matchesView(cat, team) {
    const cache = { teams: teamMap(cat), codes: codeMap(cat) };
    const mine = cat.matches.filter((m) => m.home_team_id === team.id || m.away_team_id === team.id)
      .sort((a, b) => absMin(cat.config, a) - absMin(cat.config, b));
    const nextIdx = mine.findIndex((m) => m.status !== 'confirmed');
    return h('div', { class: 'wrap', style: { marginTop: '12px' } },
      h('div', { class: 'row' },
        h('div', null, h('div', { class: 'muted small' }, `${cat.name}　登録するチーム`), h('strong', { style: { fontSize: '1.15rem' } }, team.name)),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { store.del(key); render(); } }, 'チームを変更')),
      h('p', { class: 'muted small' }, '入力した結果は「仮登録」として相手チームと本部に表示されます。本部が確定すると、閲覧ページに公開されます。'),
      mine.length ? mine.map((m, i) => scoreCard(m, cat, team, cache, i === nextIdx)) : h('p', { class: 'empty' }, '試合はまだ組まれていません'),
      h('p', { style: { textAlign: 'center', marginTop: '24px' } }, h('a', { href: `/t/${slug}` }, '閲覧ページを開く')));
  }

  function scoreCard(m, cat, team, cache, isNext) {
    const home = sideInfo(m, 'home', cat, cache);
    const away = sideInfo(m, 'away', cat, cache);
    const ready = !home.placeholder && !away.placeholder;
    const locked = m.status === 'confirmed';
    const st = statusOf(m, cat, data.tournament);
    const d = drafts[m.id] || (drafts[m.id] = fromMatch(m));
    // 他の人が更新したら、入力していない場合は最新に合わせる
    if (!d.dirty && d.version !== m.version) Object.assign(d, fromMatch(m));
    const stale = d.dirty && d.version !== m.version;

    const card = h('article', { class: `score-card${isNext && !locked ? ' next' : ''}` });
    const draw = () => {
      const isKo = m.stage === 'knockout';
      const tie = d.home === d.away;
      const step = (side, small = false) => h('div', { class: `stepper${small ? ' small' : ''}` },
        h('button', { type: 'button', 'aria-label': '1点減らす', disabled: locked || !ready, onclick: () => change(side, -1) }, '−'),
        h('output', null, d[side]),
        h('button', { class: 'plus', type: 'button', 'aria-label': '1点増やす', disabled: locked || !ready, onclick: () => change(side, 1) }, '＋'));
      const statusLine = h('div', { class: 'status-line' },
        h('span', { class: `tag ${locked ? 'done' : m.status === 'provisional' ? 'wait' : st.cls}` }, locked ? '確定' : m.status === 'provisional' ? '仮登録' : st.key === 'upcoming' ? '未登録' : st.label),
        m.status === 'provisional' && m.updated_by ? h('span', { class: 'muted' }, `最終更新：${m.updated_by} ${formatUpdated(m.updated_at)}`) : null,
        m.time_changed ? h('span', { class: 'tag changed' }, '時間変更') : null);

      mount(card,
        h('div', { class: 'row' },
          h('span', { class: 'num', style: { fontSize: '1.4rem' } }, toHHMM(m.start_min)),
          dayTotal(cat.config) > 1 ? h('span', { class: 'tag' }, dayLabel(cat, dayOf(cat.config, m.slot), data.tournament, true)) : null,
          h('span', { class: 'tag' }, courtName(cat.config, m.court)),
          h('span', { class: 'muted small' }, m.label),
          isNext && !locked ? h('span', { class: 'tag live' }, '次の試合') : null),
        statusLine,
        h('div', { class: 'sc-teams' },
          h('div', { class: 'side' }, h('div', { class: 'nm' }, crest(home.team, 36), home.text), step('home')),
          h('div', { class: 'side' }, h('div', { class: 'nm' }, crest(away.team, 36), away.text), step('away'))),
        isKo && tie && ready && !locked ? h('div', null,
          h('p', { class: 'small muted', style: { textAlign: 'center', margin: '12px 0 0' } }, '同点のときはPK戦の結果'),
          h('div', { class: 'sc-teams' }, h('div', { class: 'side' }, step('hpk', true)), h('div', { class: 'side' }, step('apk', true)))) : null,
        stale ? h('p', { class: 'notice', style: { marginTop: '10px' } }, '入力中に相手チームか本部が結果を更新しました。',
          h('button', { class: 'btn btn-sm', type: 'button', style: { marginLeft: '8px' }, onclick: () => { Object.assign(d, fromMatch(m)); draw(); } }, '最新の内容に戻す')) : null,
        !ready ? h('p', { class: 'muted small', style: { marginTop: '10px' } }, '対戦相手が決まると入力できます') : null,
        locked ? h('p', { class: 'muted small', style: { marginTop: '10px' } }, '本部で確定済みです。変更が必要な場合は本部に連絡してください。') :
          ready ? h('button', { class: 'btn btn-primary btn-block', type: 'button', style: { marginTop: '14px' }, disabled: m.status === 'provisional' && !d.dirty, onclick: save },
            m.status === 'provisional' ? (d.dirty ? '変更を保存' : '仮登録済み') : 'この結果で仮登録') : null);
    };

    const change = (side, delta) => {
      d[side] = Math.max(0, Math.min(99, d[side] + delta));
      d.dirty = true;
      draw();
    };

    const save = async () => {
      const isKo = m.stage === 'knockout';
      const payload = { teamId: team.id, home_score: d.home, away_score: d.away, version: d.version };
      if (isKo && d.home === d.away) { payload.home_pk = d.hpk; payload.away_pk = d.apk; }
      try {
        await api('POST', `/api/rel/${encodeURIComponent(slug)}/matches/${m.id}`, payload);
        toast('仮登録しました');
        d.dirty = false;
        if (await load()) render();
      } catch (e) {
        toast(e.message, true);
        if (e.data && e.data.match) {
          Object.assign(m, e.data.match);
          draw();
        }
      }
    };

    draw();
    return card;
  }
}

function fromMatch(m) {
  return { home: m.home_score ?? 0, away: m.away_score ?? 0, hpk: m.home_pk ?? 0, apk: m.away_pk ?? 0, version: m.version, dirty: false };
}
