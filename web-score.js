// 大会運営者・スコア管理者の画面（主にスマートフォン）
//  スコア管理者：スコア（試合結果）の登録に特化
//  大会運営者　：スコアの登録・修正（確定済みの修正・取り消しを含む）、SNS画像の出力、忘れ物の登録
import { api } from './web-api.js';
import { openMatchPoster, openResultPoster, openStandingsPoster } from './web-poster.js';
import { h, mount, modal, confirmDialog, toast, run, markFetched, refreshButton, toHHMM, formatDate, sheet, store, formatUpdated, MANUALS, resizeImage, resizeBanner, headActions, resizePhoto } from './web-ui.js';
import { teamMap, codeMap, sideInfo, courtName, dayOf, dayTotal, dayLabel, absMin, crest, refBadge, setRefereeMode, isRankLeague, dayDate, matchLengthFor } from './web-views.js';

const STATUS = { published: '公開中', live: '開催中', finished: '終了' };

export async function scoreApp(root, me) {
  const st = { tid: store.get('score:tid'), catId: null, tab: 'all', data: null, rev: null, stop: null, filter: 'all', court: 'all' };
  const isOp = me.role === 'operator'; // 大会運営者

  const header = () => h('header', { class: 'site-head sc-head' }, h('div', { class: 'wrap' },
    h('div', { class: 'sc-who' }, h('strong', null, isOp ? '大会運営' : 'スコア登録'), h('small', null, `${me.name}（${isOp ? '大会運営者' : 'スコア管理者'}・${me.region || me.parentName || ''}）`)),
    h('span', { class: 'spacer' }),
    ...headActions([
      isOp ? { label: 'パソコン表示', cls: 'sc-mini', onClick: () => { store.set('op:mobile', false); location.href = '/admin'; } } : null,
      { label: '使い方', cls: 'sc-mini', href: MANUALS.scorer.href },
      { label: 'パスワード変更', cls: 'sc-mini', onClick: changePassword },
      { label: 'ログアウト', cls: 'sc-mini', onClick: async () => { await api('POST', '/api/admin/logout'); location.href = '/admin'; } },
    ], `ログイン中：${me.name}（${isOp ? '大会運営者' : 'スコア管理者'}）`)));

  // ---------- 大会の一覧 ----------
  async function list() {
    if (st.stop) { st.stop(); st.stop = null; }
    const { tournaments: all } = await api('GET', '/api/score/tournaments');
    const tournaments = all.filter((t) => t.ready !== false);
    const drafts = all.filter((t) => t.ready === false);
    if (tournaments.length === 1 && !drafts.length && !st.listShown) return open(tournaments[0].id);
    mount(root, header(), h('main', { class: 'wrap sc-main' },
      h('h2', { class: 'sc-title' }, '担当する大会'),
      tournaments.length ? tournaments.map((t) => h('button', { class: 'sc-tcard', type: 'button', onclick: () => open(t.id) },
        h('div', null, h('strong', null, t.name), h('small', null, [t.date ? formatDate(t.date) : '', STATUS[t.status]].filter(Boolean).join('　'))),
        t.pending ? h('span', { class: 'sc-badge' }, `承認待ち ${t.pending}`) : h('span', { class: 'sc-badge zero' }, '承認待ちなし')))
        : h('p', { class: 'empty' }, '結果を入力できる大会はまだありません。担当する大会が公開されると、ここから開けます。'),
      drafts.length ? [h('h3', { class: 'sc-title', style: { marginTop: '18px', fontSize: '0.95rem' } }, '準備中の大会'),
        drafts.map((t) => h('div', { class: 'sc-tcard is-draft', 'aria-disabled': 'true' },
          h('div', null, h('strong', null, t.name), h('small', null, [t.date ? formatDate(t.date) : '', '準備中'].filter(Boolean).join('　'))),
          h('span', { class: 'sc-badge zero' }, '公開されると入力できます')))] : null));
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
      setRefereeMode(r.tournament.referee);
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
    const pendN = cat ? cat.matches.filter((m) => m.status === 'provisional').length : 0;
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
        [pendN ? ['pending', `承認待ち（${pendN}）`] : null, ['all', '試合一覧'],
          isOp ? ['lost', `忘れ物（${(t.lost || []).length}）`] : null, isOp ? ['sns', 'SNS画像'] : null].filter(Boolean).map(([k, l]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tab === k), onclick: () => { st.tab = k; draw(); } }, l))),
      !cat ? h('p', { class: 'empty' }, 'カテゴリがありません')
        : st.tab === 'pending' && pendN ? pendingView(t, cat) : st.tab === 'lost' && isOp ? lostView(t) : st.tab === 'sns' && isOp ? snsView(t, cat) : allView(t, cat),
      h('p', { class: 'sc-foot muted small' }, pendAll ? `この大会の承認待ち：全${pendAll}件` : '最新の情報は、右下の「更新」を押すと表示されます'),
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
          h('button', { class: 'btn btn-primary sc-ok', type: 'button', onclick: async (e) => {
            const btn = e.currentTarget; if (btn.disabled) return; btn.disabled = true; // 二度押しを防ぐ
            const r = await run(() => api('POST', `/api/admin/matches/${m.id}/result`, { home_score: m.home_score, away_score: m.away_score, home_pk: m.home_pk, away_pk: m.away_pk, confirm: true }), '承認しました');
            if (r) reload(); else btn.disabled = false;
          } }, '承認'),
          h('button', { class: 'btn', type: 'button', onclick: () => editor(t, cat, m) }, '修正して承認'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
            if (!(await confirmDialog('差し戻します', '仮登録の結果を取り消して「未登録」に戻します。関係者に入力し直してもらってください。', '差し戻す', true))) return;
            if (await run(() => api('POST', `/api/admin/matches/${m.id}/clear`), '差し戻しました')) reload();
          } }, '差し戻し')))));
  }

  // 試合一覧（試合の結果の入力にも使う）。一番上に「次に入力する試合」、状態とコートで絞り込み、時刻ごとにまとめる
  function allView(t, cat) {
    const cache = cacheOf(cat);
    const all = [...cat.matches].sort((a, b) => absMin(cat.config, a) - absMin(cat.config, b) || a.court - b.court);
    if (!all.length) return h('p', { class: 'empty' }, '日程はまだありません');
    // 絞り込みは覚えておく（大会ごとのコート、状態）
    if (st.prefFor !== st.tid) {
      st.prefFor = st.tid;
      const c0 = store.get(`score:court:${st.tid}`, 'all');
      st.court = c0 === 'all' || all.some((m) => m.court === c0) ? c0 : 'all';
      st.filter = store.get('score:filter', 'none');
    }
    const LBL = { none: '未登録', provisional: '承認待ち', confirmed: '確定' };
    const courts = [...new Set(all.map((m) => m.court))].sort((a, b) => a - b);
    const inCourt = (m) => st.court === 'all' || m.court === st.court;
    const ready = (m) => m.home_team_id && m.away_team_id;
    if (st.filter === 'none' && !all.some((m) => m.status === 'none' && inCourt(m))) st.filter = 'all';
    // 入力待ち：終わる時刻を過ぎたのに結果が入っていない試合
    const d0 = new Date(); const today = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const nowM = d0.getHours() * 60 + d0.getMinutes();
    const late = (m) => m.status === 'none' && ready(m) && (() => { const date = dayDate(cat, dayOf(cat.config, m.slot), t); return date && (date < today || (date === today && nowM >= m.start_min + matchLengthFor(cat.config, m))); })();
    const next = all.find((m) => m.status === 'none' && ready(m) && inCourt(m));
    const count = (k) => all.filter((m) => (k === 'all' || m.status === k) && inCourt(m)).length;
    const list = all.filter((m) => (st.filter === 'all' || m.status === st.filter) && inCourt(m));
    const groups = [];
    for (const m of list) {
      const key = `${dayOf(cat.config, m.slot)}-${m.start_min}`;
      const g = groups[groups.length - 1];
      if (g && g.key === key) g.items.push(m); else groups.push({ key, m, items: [m] });
    }
    const name = (m, side) => sideInfo(m, side, cat, cache).text;
    return h('div', null,
      next ? h('button', { class: `sc-next${late(next) ? ' late' : ''}`, type: 'button', onclick: () => editor(t, cat, next) },
        h('span', { class: 'sc-next-k' }, late(next) ? '入力待ちの試合' : '次に入力する試合'),
        h('span', { class: 'sc-next-t' }, h('b', null, toHHMM(next.start_min)), `${courtName(cat.config, next.court)}　${next.label}`),
        h('span', { class: 'sc-next-teams' }, h('span', null, name(next, 'home')), h('i', null, 'vs'), h('span', null, name(next, 'away'))),
        h('span', { class: 'sc-next-cta' }, '結果を入力する'))
        : h('p', { class: 'sc-alldone' }, st.court === 'all' ? '未登録の試合はありません' : `${courtName(cat.config, st.court)}の未登録の試合はありません`),
      h('div', { class: 'sc-filterbar' },
        h('div', { class: 'chips sc-filter' }, [['none', '未登録'], ['confirmed', '確定'], ['provisional', '承認待ち'], ['all', 'すべて']].filter(([k]) => k !== 'provisional' || count('provisional') > 0).map(([k, l]) =>
          h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.filter === k), onclick: () => { st.filter = k; store.set('score:filter', k); draw(); } }, `${l} ${count(k)}`))),
        courts.length > 1 ? h('div', { class: 'chips sc-filter' }, [['all', '全コート'], ...courts.map((c) => [c, courtName(cat.config, c)])].map(([k, l]) =>
          h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.court === k), onclick: () => { st.court = k; store.set(`score:court:${st.tid}`, k); draw(); } }, l))) : null),
      !list.length ? h('p', { class: 'empty' }, '該当する試合はありません')
        : h('div', { class: 'sc-all' }, groups.map((g) => [
          h('div', { class: 'sc-time-h' }, `${dayTotal(cat.config) > 1 ? `${dayLabel(cat, dayOf(cat.config, g.m.slot), t, true)} ` : ''}${toHHMM(g.m.start_min)}`),
          g.items.map((m) => {
            const can = ready(m) && (m.status !== 'confirmed' || isOp);
            const isLate = late(m);
            return h('button', { class: `sc-row ${m.status}${isLate ? ' late' : ''}`, type: 'button', disabled: !can, onclick: () => editor(t, cat, m) },
              h('span', { class: 'sc-rtime' }, courtName(cat.config, m.court), h('small', null, m.stage === 'league' ? `${m.group_label}組` : '')),
              h('span', { class: 'sc-rteams' },
                h('span', null, name(m, 'home'), refBadge(cat, m, 'home')), h('span', null, name(m, 'away'), refBadge(cat, m, 'away'))),
              m.home_score != null ? h('span', { class: 'sc-rscore' }, `${m.home_score} - ${m.away_score}`) : null,
              !ready(m) ? h('span', { class: 'sc-rstat none' }, '対戦未定')
                : m.status === 'none' ? h('span', { class: `sc-rcta${isLate ? ' late' : ''}` }, isLate ? '入力待ち' : '入力')
                  : h('span', { class: `sc-rstat ${m.status}` }, LBL[m.status]));
          })])));
  }

  // SNS画像（大会運営者）：試合結果・結果一覧の画像を出力する
  function snsView(t, cat) {
    const cats = st.data.categories;
    return h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-block sc-ok', type: 'button', onclick: () => openMatchPoster(t, cats, cat.id, { canPhoto: false }) }, '試合結果（組ごと・回戦ごと）'),
      h('p', { class: 'muted small', style: { margin: 0 } }, '組ごと（予選リーグ）や、決勝トーナメントの回戦ごとの試合結果を、SNSに投稿しやすい画像にします。'),
      h('button', { class: 'btn btn-block sc-ok', type: 'button', onclick: () => openStandingsPoster(t, cats, cat.id) }, '予選リーグの順位表'),
      h('button', { class: 'btn btn-block sc-ok', type: 'button', onclick: () => openResultPoster(t, cats, cat.id, { kind: 'ranking' }) }, '最終結果（順位の一覧）'),
      h('button', { class: 'btn btn-block sc-ok', type: 'button', onclick: () => openResultPoster(t, cats, cat.id, { kind: 'teams' }) }, '参加チーム一覧'),
      h('p', { class: 'muted small', style: { margin: 0 } }, '最終順位や参加チームの一覧を、画像やPDFにします。'));
  }

  // 忘れ物（大会運営者）：写真と内容を登録し、持ち主が見つかったら返却済みにする
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
      h('label', { class: 'field' }, h('span', null, '写真（任意・その場で撮影、または撮っておいた写真を選べます）'),
        h('input', { type: 'file', accept: 'image/*', onchange: async (e) => {
          const file = e.target.files && e.target.files[0]; if (!file) return;
          const v = await run(() => resizePhoto(file)); if (v) { f.image = v; draw3(); }
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

  // スコアの入力・修正（大きな＋−で数える）して確定。確定したら、そのまま次の試合へ進める
  function editor(t, cat, m) {
    const cache = cacheOf(cat);
    const v = { h: m.home_score ?? 0, a: m.away_score ?? 0, hp: m.home_pk ?? 0, ap: m.away_pk ?? 0 };
    const ko = m.stage === 'knockout' && !isRankLeague(m); // 決勝の段のリーグ戦は引き分けあり（PK戦なし）
    const body = h('div');
    const tieNow = () => ko && v.h === v.a;
    const fixing = m.status === 'confirmed';
    const okLabel = () => `${v.h} - ${v.a}${tieNow() ? `（PK ${v.hp} - ${v.ap}）` : ''} で${fixing ? '修正する' : '確定する'}`;
    const step = (key, info, label, small) => {
      const out = h('output', null, v[key]);
      const bump = (d) => {
        const before = tieNow();
        v[key] = Math.max(0, Math.min(99, v[key] + d));
        out.textContent = v[key];
        if (before !== tieNow()) draw2(); // PK戦の欄の出し入れだけ描き直す
        else { const btn = body.querySelector('.sc-ok'); if (btn) btn.textContent = okLabel(); }
      };
      return h('div', { class: `sc-step${small ? ' small' : ''}` },
        h('span', { class: 'sc-step-name' }, info && info.team && !small ? crest(info.team, 30) : null, h('b', null, label)),
        h('span', { class: 'sc-step-ctl' },
          h('button', { type: 'button', class: 'sc-pm', 'aria-label': `${label}を1減らす`, onclick: () => bump(-1) }, '−'),
          out,
          h('button', { type: 'button', class: 'sc-pm plus', 'aria-label': `${label}を1増やす`, onclick: () => bump(1) }, '＋')));
    };
    const hi = sideInfo(m, 'home', cat, cache), ai = sideInfo(m, 'away', cat, cache);
    const close = () => document.querySelector('.sheet-back')?.remove();
    // 確定した後：そのまま次の試合へ
    const done = async () => {
      await reload();
      const cat2 = (st.data.categories || []).find((c) => c.id === cat.id) || cat;
      const t2 = st.data.tournament || t;
      const next = [...cat2.matches].sort((a, b) => absMin(cat2.config, a) - absMin(cat2.config, b) || a.court - b.court)
        .find((x) => x.status === 'none' && x.home_team_id && x.away_team_id && x.id !== m.id && (st.court === 'all' || x.court === st.court));
      if (!document.body.contains(body)) return;
      const c2 = cacheOf(cat2);
      mount(body, h('div', { class: 'sc-done' },
        h('div', { class: 'sc-done-mark', 'aria-hidden': 'true' }, '✓'),
        h('strong', null, fixing ? '結果を修正しました' : '確定しました'),
        h('p', null, `${hi.text}  ${v.h} - ${v.a}  ${ai.text}`),
        next ? h('button', { class: 'btn btn-primary btn-block sc-ok', type: 'button', onclick: () => { close(); editor(t2, cat2, next); } },
          h('span', null, '次の試合を入力'), h('small', null, `${toHHMM(next.start_min)} ${courtName(cat2.config, next.court)}　${sideInfo(next, 'home', cat2, c2).text} vs ${sideInfo(next, 'away', cat2, c2).text}`))
          : h('p', { class: 'muted small' }, '未登録の試合はありません。おつかれさまでした。'),
        h('button', { class: 'btn btn-block', type: 'button', onclick: close }, '一覧に戻る')));
    };
    const draw2 = () => mount(body, h('div', { class: 'stack' },
      h('div', { class: 'sc-meta' }, h('span', null, when(t, cat, m)), h('span', null, m.label)),
      step('h', hi, hi.text),
      step('a', ai, ai.text),
      tieNow() ? h('div', { class: 'sc-pk' }, h('div', { class: 'small', style: { fontWeight: 700 } }, '同点のため、PK戦の結果を入力'),
        step('hp', hi, `${hi.text}（PK）`, true), step('ap', ai, `${ai.text}（PK）`, true)) : null,
      fixing ? h('p', { class: 'notice', style: { margin: 0 } }, `確定済みの結果（${m.home_score} - ${m.away_score}）を修正します。順位やトーナメントの組み合わせも自動で計算し直されます。`) : null,
      h('button', { class: 'btn btn-primary btn-block sc-ok', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget; if (btn.disabled) return; // 二度押しを防ぐ
        const tie = tieNow();
        if (tie && v.hp === v.ap) return toast('PK戦の結果で勝敗が決まるように入力してください', true);
        if (fixing && !(await confirmDialog('確定済みの結果を修正します', `${m.home_score} - ${m.away_score} → ${v.h} - ${v.a}${tie ? `（PK ${v.hp} - ${v.ap}）` : ''} に修正します。`, '修正する'))) return;
        btn.disabled = true;
        const r = await run(() => api('POST', `/api/admin/matches/${m.id}/result`, { home_score: v.h, away_score: v.a, home_pk: tie ? v.hp : null, away_pk: tie ? v.ap : null, confirm: true }));
        btn.disabled = false;
        if (!r) return;
        if (r.unchanged) { toast('同じ結果のため、変更はありません'); close(); return; }
        await done();
      } }, okLabel()),
      isOp && m.status !== 'none' ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: async () => {
        if (!(await confirmDialog('結果を取り消します', 'この試合の結果を取り消して「未登録」に戻します。', '未登録に戻す', true))) return;
        if (await run(() => api('POST', `/api/admin/matches/${m.id}/clear`), '未登録に戻しました')) { close(); reload(); }
      } }, '結果を取り消して未登録に戻す') : null));
    draw2();
    sheet({ title: fixing ? '確定済みの結果を修正' : m.status === 'provisional' ? '修正して承認' : '結果を入力', content: body });
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
