// スコア管理者・運営管理者の画面（主にスマートフォン）
//  スコア管理者：仮登録の結果の承認・修正・差し戻しと、結果の入力
//  運営管理者　：上に加えて、確定済みの結果の修正・取り消しと、忘れ物の登録・返却済みの処理
import { api } from './web-api.js';
import { h, mount, modal, confirmDialog, toast, run, markFetched, refreshButton, toHHMM, formatDate, sheet, store, formatUpdated, MANUALS, resizeImage } from './web-ui.js';
import { teamMap, codeMap, sideInfo, courtName, dayOf, dayTotal, dayLabel, absMin, crest } from './web-views.js';

const STATUS = { published: '公開中', live: '開催中', finished: '終了' };

export async function scoreApp(root, me) {
  const st = { tid: store.get('score:tid'), catId: null, tab: 'pending', data: null, rev: null, stop: null, filter: 'all', court: 'all' };
  const isOp = me.role === 'operator'; // 運営管理者

  const header = () => h('header', { class: 'site-head sc-head' }, h('div', { class: 'wrap' },
    h('div', { class: 'sc-who' }, h('strong', null, isOp ? '運営（結果・忘れ物）' : '結果の承認'), h('small', null, `${me.name}（${isOp ? '運営管理者・' : ''}${me.region || me.parentName || ''}）`)),
    h('span', { class: 'spacer' }),
    h('a', { class: 'sc-mini', href: MANUALS.scorer.href, target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, '使い方'),
    h('button', { class: 'sc-mini', type: 'button', onclick: changePassword }, 'パスワード変更'),
    h('button', { class: 'sc-mini', type: 'button', onclick: async () => { await api('POST', '/api/admin/logout'); location.href = '/admin'; } }, 'ログアウト')));

  // ---------- 大会の一覧 ----------
  async function list() {
    if (st.stop) { st.stop(); st.stop = null; }
    const { tournaments } = await api('GET', '/api/score/tournaments');
    if (tournaments.length === 1 && !st.listShown) return open(tournaments[0].id);
    mount(root, header(), h('main', { class: 'wrap sc-main' },
      h('h2', { class: 'sc-title' }, '担当する大会'),
      tournaments.length ? tournaments.map((t) => h('button', { class: 'sc-tcard', type: 'button', onclick: () => open(t.id) },
        h('div', null, h('strong', null, t.name), h('small', null, [t.date ? formatDate(t.date) : '', STATUS[t.status]].filter(Boolean).join('　'))),
        t.pending ? h('span', { class: 'sc-badge' }, `承認待ち ${t.pending}`) : h('span', { class: 'sc-badge zero' }, '承認待ちなし')))
        : h('p', { class: 'empty' }, '担当する大会はまだ公開されていません。公開されると、ここに表示されます。')));
  }

  // ---------- 大会の画面 ----------
  async function open(tid) {
    st.tid = tid; store.set('score:tid', tid); st.rev = null;
    if (!(await load())) return;
    draw();
    // 自動更新はしない。最新の情報は「更新」ボタン（取得した時刻つき）で読み込む
  }

  // 新しい仮登録を読み込む（ボタン・画面に戻ってきたとき）
  async function refresh(fromButton = true) {
    if (document.querySelector('.modal-back, .sheet-back')) return false;
    const before = pendingCount();
    const changed = await load();
    if (changed) {
      draw();
      const after = pendingCount();
      if (after > before) { toast(`新しい仮登録が${after - before}件あります`); return fromButton ? 'quiet' : true; }
    }
    return changed;
  }

  async function load() {
    try {
      const r = await api('GET', `/api/score/tournaments/${st.tid}${st.rev != null ? `?rev=${st.rev}` : ''}`);
      markFetched();
      if (r.unchanged) return false;
      st.data = r; st.rev = r.rev;
      if (!st.catId || !r.categories.some((c) => c.id === st.catId)) st.catId = r.categories[0] && r.categories[0].id;
      return true;
    } catch (e) {
      toast(e.message, true);
      st.listShown = true; store.set('score:tid', null);
      list();
      return false;
    }
  }

  const pendingCount = () => (st.data ? st.data.categories.reduce((a, c) => a + c.matches.filter((m) => m.status === 'provisional').length, 0) : 0);
  const reload = async () => { st.rev = null; if (await load()) draw(); };

  function draw() {
    const { tournament: t, categories } = st.data;
    const cat = categories.find((c) => c.id === st.catId);
    const pendAll = pendingCount();
    mount(root, header(), h('main', { class: 'wrap sc-main' },
      h('div', { class: 'sc-thead' },
        h('div', null, h('strong', null, t.name), h('small', null, STATUS[t.status] || '')),
        h('button', { class: 'sc-mini dark', type: 'button', onclick: () => { st.listShown = true; list(); } }, '大会を選ぶ')),
      categories.length > 1 ? h('div', { class: 'chips' }, categories.map((c) => {
        const n = c.matches.filter((m) => m.status === 'provisional').length;
        return h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(c.id === st.catId), onclick: () => { st.catId = c.id; draw(); } },
          c.name, n ? h('span', { class: 'tag alert', style: { marginLeft: '6px' } }, n) : null);
      })) : null,
      h('div', { class: 'sc-tabs', role: 'tablist' },
        [['pending', `承認待ち（${cat ? cat.matches.filter((m) => m.status === 'provisional').length : 0}）`], ['all', '試合一覧'],
          isOp ? ['lost', `忘れ物（${(t.lost || []).length}）`] : null].filter(Boolean).map(([k, l]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === k), onclick: () => { st.tab = k; draw(); } }, l))),
      !cat ? h('p', { class: 'empty' }, 'カテゴリがありません')
        : st.tab === 'pending' ? pendingView(t, cat) : st.tab === 'lost' && isOp ? lostView(t) : allView(t, cat),
      h('p', { class: 'sc-foot muted small' }, `この大会の承認待ち：全${pendAll}件　新しい仮登録は「更新」を押すと表示されます`),
      refreshButton(async () => { const r = await refresh(); return r === 'quiet' ? true : r; })));
  }

  const cacheOf = (cat) => ({ teams: teamMap(cat), codes: codeMap(cat) });
  const when = (t, cat, m) => `${dayTotal(cat.config) > 1 ? `${dayLabel(cat, dayOf(cat.config, m.slot), t, true)} ` : ''}${toHHMM(m.start_min)}　${courtName(cat.config, m.court)}`;
  const teamLine = (cat, cache, m, side, score, pk) => {
    const info = sideInfo(m, side, cat, cache);
    return h('div', { class: 'sc-team' }, crest(info.team, 26), h('span', { class: 'sc-tname' }, info.text),
      h('span', { class: 'sc-score' }, score ?? '–', pk != null ? h('small', null, `PK ${pk}`) : null));
  };

  // 承認待ち
  function pendingView(t, cat) {
    const cache = cacheOf(cat);
    const list = cat.matches.filter((m) => m.status === 'provisional').sort((a, b) => absMin(cat.config, a) - absMin(cat.config, b));
    if (!list.length) return h('p', { class: 'empty' }, '承認待ちの結果はありません。関係者が仮登録すると、ここに表示されます。');
    return h('div', null,
      list.length > 1 ? h('button', { class: 'btn btn-block sc-bulk', type: 'button', onclick: async () => {
        if (!(await confirmDialog(`${list.length}試合をまとめて承認します`, '表示中の仮登録の結果を、そのまま確定します。PK戦の結果が必要な試合は承認されません。', 'まとめて承認'))) return;
        const r = await run(() => api('POST', `/api/admin/categories/${cat.id}/confirm`, { matchIds: list.map((m) => m.id) }));
        if (r) { toast(`${r.confirmed}試合を承認しました${r.skipped ? `（PKの結果が必要な${r.skipped}試合を除く）` : ''}`); reload(); }
      } }, `表示中の${list.length}試合をまとめて承認`) : null,
      list.map((m) => h('article', { class: 'sc-card' },
        h('div', { class: 'sc-meta' }, h('span', null, when(t, cat, m)), h('span', null, m.label)),
        teamLine(cat, cache, m, 'home', m.home_score, m.home_pk),
        teamLine(cat, cache, m, 'away', m.away_score, m.away_pk),
        m.updated_by ? h('div', { class: 'sc-by' }, `仮登録：${m.updated_by}${m.updated_at ? `（${formatUpdated(m.updated_at)}）` : ''}`) : null,
        h('div', { class: 'sc-actions' },
          h('button', { class: 'btn btn-primary sc-ok', type: 'button', onclick: async () => {
            const r = await run(() => api('POST', `/api/admin/matches/${m.id}/result`, { home_score: m.home_score, away_score: m.away_score, home_pk: m.home_pk, away_pk: m.away_pk, confirm: true }), '承認しました');
            if (r) reload();
          } }, '承認'),
          h('button', { class: 'btn', type: 'button', onclick: () => editor(t, cat, m) }, '修正して承認'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
            if (!(await confirmDialog('差し戻します', '仮登録の結果を取り消して「未登録」に戻します。関係者に入力し直してもらってください。', '差し戻す', true))) return;
            if (await run(() => api('POST', `/api/admin/matches/${m.id}/clear`), '差し戻しました')) reload();
          } }, '差し戻し')))));
  }

  // 試合一覧（未登録の試合の入力にも使う）。状態とコートで絞り込み、時刻ごとにまとめる
  function allView(t, cat) {
    const cache = cacheOf(cat);
    const all = [...cat.matches].sort((a, b) => absMin(cat.config, a) - absMin(cat.config, b) || a.court - b.court);
    if (!all.length) return h('p', { class: 'empty' }, '日程はまだありません');
    const LBL = { none: '未登録', provisional: '承認待ち', confirmed: '確定' };
    const courts = [...new Set(all.map((m) => m.court))].sort((a, b) => a - b);
    const count = (k) => all.filter((m) => (k === 'all' || m.status === k) && (st.court === 'all' || m.court === st.court)).length;
    const list = all.filter((m) => (st.filter === 'all' || m.status === st.filter) && (st.court === 'all' || m.court === st.court));
    const groups = [];
    for (const m of list) {
      const key = `${dayOf(cat.config, m.slot)}-${m.start_min}`;
      const g = groups[groups.length - 1];
      if (g && g.key === key) g.items.push(m); else groups.push({ key, m, items: [m] });
    }
    return h('div', null,
      h('div', { class: 'chips sc-filter' }, [['all', 'すべて'], ['none', '未登録'], ['provisional', '承認待ち'], ['confirmed', '確定']].map(([k, l]) =>
        h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.filter === k), onclick: () => { st.filter = k; draw(); } }, `${l}（${count(k)}）`))),
      courts.length > 1 ? h('div', { class: 'chips sc-filter' }, [['all', '全コート'], ...courts.map((c) => [c, courtName(cat.config, c)])].map(([k, l]) =>
        h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.court === k), onclick: () => { st.court = k; draw(); } }, l))) : null,
      !list.length ? h('p', { class: 'empty' }, '該当する試合はありません')
        : h('div', { class: 'sc-all' }, groups.map((g) => [
          h('div', { class: 'sc-time-h' }, `${dayTotal(cat.config) > 1 ? `${dayLabel(cat, dayOf(cat.config, g.m.slot), t, true)} ` : ''}${toHHMM(g.m.start_min)}`),
          g.items.map((m) => {
            const ready = m.home_team_id && m.away_team_id;
            const can = ready && (m.status !== 'confirmed' || isOp);
            return h('button', { class: `sc-row ${m.status}`, type: 'button', disabled: !can, onclick: () => editor(t, cat, m) },
              h('span', { class: 'sc-rtime' }, courtName(cat.config, m.court), h('small', null, m.stage === 'league' ? `${m.group_label}組` : '')),
              h('span', { class: 'sc-rteams' },
                h('span', null, sideInfo(m, 'home', cat, cache).text), h('span', null, sideInfo(m, 'away', cat, cache).text)),
              h('span', { class: 'sc-rscore' }, m.home_score != null ? `${m.home_score} - ${m.away_score}` : ''),
              h('span', { class: `sc-rstat ${m.status}` }, ready ? LBL[m.status] : '対戦未定'));
          })])));
  }

  // 忘れ物（運営管理者）：写真と内容を登録し、持ち主が見つかったら返却済みにする
  function lostView(t) {
    const items = t.lost || [];
    return h('div', null,
      h('button', { class: 'btn btn-primary btn-block sc-bulk', type: 'button', onclick: () => addLost(t) }, '＋ 忘れ物を登録'),
      !items.length ? h('p', { class: 'empty' }, 'お知らせ中の忘れ物はありません。登録すると、保護者の閲覧ページに表示されます。')
        : items.map((it) => h('article', { class: 'sc-card sc-lost' },
          it.img ? h('img', { src: it.img, alt: '', loading: 'lazy' }) : null,
          h('div', { class: 'sc-lost-b' }, h('p', null, it.note), h('small', { class: 'muted' }, `登録：${formatUpdated(it.created_at)}`),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
              if (!(await confirmDialog('返却済みにします', `「${it.note}」を返却済みにして、閲覧ページのお知らせから外します。`, '返却済みにする'))) return;
              if (await run(() => api('PATCH', `/api/admin/lost/${it.id}`, { status: 'returned' }), '返却済みにしました')) reload();
            } }, '返却済みにする')))),
      h('p', { class: 'muted small' }, '登録した忘れ物は、保護者の閲覧ページの上部にお知らせとして表示されます。'));
  }

  function addLost(t) {
    const f = { note: '', image: null };
    const body = h('div');
    const draw3 = () => mount(body, h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', null, '写真（任意）'),
        h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: async (e) => {
          const file = e.target.files && e.target.files[0]; if (!file) return;
          const v = await run(() => resizeImage(file, 800)); if (v) { f.image = v; draw3(); }
        } })),
      f.image ? h('img', { src: f.image, alt: '', style: { maxWidth: '100%', borderRadius: '10px' } }) : null,
      h('label', { class: 'field' }, h('span', null, '内容・見つかった場所'),
        h('textarea', { rows: 3, placeholder: '例：青い水筒（名前なし） Aコート ゴール裏', oninput: (e) => { f.note = e.target.value; } }, f.note)),
      h('button', { class: 'btn btn-primary btn-block sc-ok', type: 'button', onclick: async () => {
        if (!f.note.trim()) return toast('内容を入力してください', true);
        if (await run(() => api('POST', `/api/admin/tournaments/${t.id}/lost`, { note: f.note.trim(), image: f.image }), '忘れ物を登録しました')) {
          document.querySelector('.sheet-back')?.remove(); reload();
        }
      } }, 'この内容で登録')));
    draw3();
    sheet({ title: '忘れ物を登録', content: body });
  }

  // スコアの入力・修正（＋−で数える）して承認
  function editor(t, cat, m) {
    const cache = cacheOf(cat);
    const v = { h: m.home_score ?? 0, a: m.away_score ?? 0, hp: m.home_pk ?? 0, ap: m.away_pk ?? 0 };
    const ko = m.stage === 'knockout';
    const body = h('div');
    const step = (key, label) => h('div', { class: 'sc-step' },
      h('span', { class: 'sc-step-name' }, label),
      h('button', { type: 'button', class: 'sc-pm', 'aria-label': `${label}を1減らす`, onclick: () => { v[key] = Math.max(0, v[key] - 1); draw2(); } }, '−'),
      h('output', null, v[key]),
      h('button', { type: 'button', class: 'sc-pm plus', 'aria-label': `${label}を1増やす`, onclick: () => { v[key] = Math.min(99, v[key] + 1); draw2(); } }, '＋'));
    const draw2 = () => mount(body, h('div', { class: 'stack' },
      h('div', { class: 'sc-meta' }, h('span', null, when(t, cat, m)), h('span', null, m.label)),
      step('h', sideInfo(m, 'home', cat, cache).text),
      step('a', sideInfo(m, 'away', cat, cache).text),
      ko && v.h === v.a ? h('div', { class: 'sc-pk' }, h('div', { class: 'small', style: { fontWeight: 700 } }, '同点のときはPK戦の結果'),
        step('hp', `${sideInfo(m, 'home', cat, cache).text}（PK）`), step('ap', `${sideInfo(m, 'away', cat, cache).text}（PK）`)) : null,
      m.status === 'confirmed' ? h('p', { class: 'notice', style: { margin: 0 } }, `確定済みの結果（${m.home_score} - ${m.away_score}）を修正します。順位やトーナメントの組み合わせも自動で計算し直されます。`) : null,
      h('button', { class: 'btn btn-primary btn-block sc-ok', type: 'button', onclick: async () => {
        const tie = ko && v.h === v.a;
        if (tie && v.hp === v.ap) return toast('PK戦の結果で勝敗が決まるように入力してください', true);
        if (m.status === 'confirmed' && !(await confirmDialog('確定済みの結果を修正します', `${m.home_score} - ${m.away_score} → ${v.h} - ${v.a}${tie ? `（PK ${v.hp} - ${v.ap}）` : ''} に修正します。`, '修正する'))) return;
        const r = await run(() => api('POST', `/api/admin/matches/${m.id}/result`, { home_score: v.h, away_score: v.a, home_pk: tie ? v.hp : null, away_pk: tie ? v.ap : null, confirm: true }), 'この結果で承認しました');
        if (r) { document.querySelector('.sheet-back')?.remove(); reload(); }
      } }, m.status === 'confirmed' ? 'この結果に修正（確定）' : 'この結果で承認（確定）'),
      isOp && m.status !== 'none' ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: async () => {
        if (!(await confirmDialog('結果を取り消します', 'この試合の結果を取り消して「未登録」に戻します。', '未登録に戻す', true))) return;
        if (await run(() => api('POST', `/api/admin/matches/${m.id}/clear`), '未登録に戻しました')) { document.querySelector('.sheet-back')?.remove(); reload(); }
      } }, '結果を取り消して未登録に戻す') : null));
    draw2();
    sheet({ title: m.status === 'confirmed' ? '確定済みの結果を修正' : m.status === 'provisional' ? '修正して承認' : '結果を入力して確定', content: body });
  }

  function changePassword() {
    const f = { current: '', next: '', again: '' };
    const inp = (k, label, ac) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'password', autocomplete: ac, oninput: (e) => { f[k] = e.target.value; } }));
    modal({
      title: 'パスワードを変更',
      content: h('div', { class: 'stack' }, inp('current', '今のパスワード', 'current-password'), inp('next', '新しいパスワード（10文字以上）', 'new-password'), inp('again', '新しいパスワード（確認）', 'new-password')),
      actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '変更する', kind: 'btn-primary', onClick: async () => {
        if (f.next !== f.again) { toast('新しいパスワードが一致しません', true); return true; }
        return (await run(() => api('POST', '/api/admin/password', { current: f.current, next: f.next }), 'パスワードを変更しました')) ? undefined : true;
      } }],
    });
  }

  if (st.tid) await open(st.tid); else await list();
}
