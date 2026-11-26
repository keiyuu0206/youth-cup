import { api } from './web-api.js';
import { printParking } from './web-print.js';
import { outlineWeb } from './web-outline.js';
import { drawPoster, drawStandingsImage } from './web-poster.js';
import { h, mount, store, poller, formatDate, toHHMM, icon, sheet, todayStr, nowMin, manualLink, markFetched, refreshButton, saveImages, mapUrl } from './web-ui.js';
import { scheduleView, standingsView, bracketView, teamsView, teamMap, sideInfo, codeMap, winnerSide, crest, courtName, matchLength, matchLengthFor, statusOf, dayOf, dayTotal, dayLabel, dayDate, todayIndex, absMin, setRefereeMode, refereeMode } from './web-views.js';

// 一般公開のページで、クラブのサイト（Wix）から届くチームの写真（チームマスタの番号・チーム名 → 写真のURL）
const PHOTOS = { byId: {}, byName: {} };
const photoKey = (s) => String(s || '').normalize('NFKC').replace(/[（(][^）)]*[）)]/g, '').replace(/\s/g, '').toLowerCase();
export const photoOf = (team) => (team ? PHOTOS.byId[team.master_id] || PHOTOS.byName[photoKey(team.base_name || team.name)] || null : null);
const okPhoto = (u) => typeof u === 'string' && /^https:\/\/static\.wixstatic\.com\/media\/[\w~.%,\-/]+$/.test(u) && u.length < 400;
// 画面を切り替えても受け取り口は1つだけ（最後に開いた大会の画面を描き直す）
let photoHandler = null, photoListening = false;
function listenPhotos(onChange) {
  photoHandler = onChange;
  if (photoListening) { if (window.parent !== window) window.parent.postMessage({ type: 'infinex:ready' }, '*'); return; }
  photoListening = true;
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type !== 'infinex:photos' || e.source !== window.parent) return;
    const pick = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 2000).filter(([, u]) => okPhoto(u)));
    PHOTOS.byId = pick(d.photos);
    PHOTOS.byName = Object.fromEntries(Object.entries(pick(d.byName)).map(([k, u]) => [photoKey(k), u]));
    if (photoHandler) photoHandler();
  });
  // 埋め込まれているときは、親（Wixのページ）に「写真を送ってください」と知らせる
  if (window.parent !== window) window.parent.postMessage({ type: 'infinex:ready' }, '*');
}

export async function viewer(root, slug, opts = {}) {
  const open = !!opts.open; // 一般公開のページ（忘れ物・要項・駐車券は出さない）
  let data = null;
  let lastLoaded = null;
  let scrolledOnce = false;
  const st = {
    catId: store.get(`${open ? 'o' : 'v'}:${slug}:cat`),
    tab: 'schedule',
    query: '',
    filter: store.get(`${open ? 'o' : 'v'}:${slug}:filter`, 'all'),
    searchOpen: false,
    day: null, // 表示する日（null はすべて）
    dayPicked: false,
  };
  const myKey = () => `${open ? 'o' : 'v'}:${slug}:my:${st.catId}`;
  const myTeam = () => store.get(myKey());

  mount(root, skeleton());

  async function load(initial = false) {
    const res = await api('GET', `/api/${open ? 'open/t' : 'public'}/${encodeURIComponent(slug)}${data ? `?rev=${data.tournament.rev}` : ''}`);
    lastLoaded = new Date();
    markFetched();
    if (res.unchanged) { updateStamp(); return false; }
    data = res;
    setRefereeMode(data.tournament.referee);
    if (!data.categories.find((c) => c.id === st.catId)) st.catId = data.categories[0]?.id;
    if (!initial) render();
    return true;
  }

  try {
    await load(true);
  } catch (e) {
    mount(root, h('div', { class: 'wrap' }, h('p', { class: 'empty' }, e.message)));
    return;
  }
  document.title = `${data.tournament.name} | 試合結果`;
  render();
  if (open) listenPhotos(() => render());
  // 自動更新はしない。最新の情報は「更新」ボタン（取得した時刻つき）で読み込む

  // 大会要項（Webで表示）
  function openOutlineWeb(t) {
    sheet({ title: '大会要項', content: outlineWeb(t, data.categories, t.outline) });
  }

  function updateStamp() {
    const el = document.getElementById('stamp');
    if (el && lastLoaded) el.textContent = `${toHHMM(lastLoaded.getHours() * 60 + lastLoaded.getMinutes())} 時点の情報です。最新の結果は右下の「更新」を押してください`;
  }

  function render() {
    const t = data.tournament;
    const cat = data.categories.find((c) => c.id === st.catId);
    const hasLeague = cat && cat.config.format !== 'knockout' && cat.config.showStandings;
    const hasKo = cat && cat.config.format !== 'league';
    if (st.tab === 'standings' && !hasLeague) st.tab = 'schedule';
    if (st.tab === 'bracket' && !hasKo) st.tab = 'schedule';
    document.body.classList.add('has-bottom-nav');

    const statePill = t.status === 'live'
      ? h('span', { class: 'state-pill live' }, h('i', { class: 'dot pulse' }), '開催中')
      : t.status === 'finished' ? h('span', { class: 'state-pill' }, '終了しました') : null;

    const hero = h('header', { class: 'hero' }, h('div', { class: 'wrap' },
      h('div', { class: 'hero-top' },
        t.logo ? h('img', { class: 'hero-logo', src: t.logo, alt: '' }) : null,
        h('div', null, h('h1', null, t.name))),
      h('div', { class: 'hero-meta' },
        t.date ? h('span', null, icon('calendar'), dateRange(t, data.categories)) : null,
        t.venue ? (mapUrl(t) ? h('a', { class: 'venue-link', href: mapUrl(t), target: '_blank', rel: 'noopener', title: 'Googleマップで開く' }, icon('pin'), t.venue, h('span', { class: 'map-pill' }, '地図'))
          : h('span', null, icon('pin'), t.venue)) : null,
        statePill,
        (t.lost || []).length ? h('button', { class: 'state-pill lost-pill', type: 'button', onclick: () => openLost(t) }, icon('bag'), `忘れ物 ${t.lost.length}件`) : null),
      open ? h('div', { class: 'hero-actions' }, h('a', { class: 'outline-btn', href: '/open' }, '← 大会の一覧へ'))
        : h('div', { class: 'hero-actions' }, h('button', { class: 'outline-btn', type: 'button', onclick: () => openOutlineWeb(t) }, icon('list'), '大会要項を見る'),
          t.openChat ? h('a', { class: 'outline-btn openchat-btn', href: t.openChat, target: '_blank', rel: 'noopener' }, 'オープンチャット') : null)));

    if (!cat) {
      mount(root, hero, h('div', { class: 'wrap' }, h('p', { class: 'empty' }, '試合日程はまだ公開されていません')));
      return;
    }

    const ctx = { tournament: t, myTeam: myTeam(), cache: { teams: teamMap(cat), codes: codeMap(cat) }, photoOf: open ? photoOf : null };
    const days = dayTotal(cat.config);
    if (days > 1 && !st.dayPicked) {
      const ti = todayIndex(cat, t);
      st.day = ti >= 0 ? ti : null;
      st.dayPicked = true;
    }
    if (days <= 1 || (st.day != null && st.day >= days)) st.day = null;

    const seg = data.categories.length > 1 ? h('div', { class: 'seg', role: 'tablist', 'aria-label': 'カテゴリ' },
      data.categories.map((c) => h('button', { type: 'button', 'aria-pressed': String(c.id === st.catId),
        onclick: () => { st.catId = c.id; store.set(`${open ? 'o' : 'v'}:${slug}:cat`, c.id); scrolledOnce = false; st.dayPicked = false; render(); } }, c.name))) : null;

    const body = h('main');
    const sponsors = t.sponsors || [];
    const content = h('div', { class: `wrap${st.tab === 'bracket' ? ' wrap-bracket' : ''}` }, seg, lostBar(t), sponsorTop(sponsors), body,
      sponsorAll(sponsors),
      h('div', { class: 'share-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => snsMode(t, cat, ctx) }, icon('share'), 'SNSに投稿する画像'),
        t.parking ? h('button', { class: 'btn', type: 'button', onclick: () => {
          const team = ctx.cache.teams[ctx.myTeam];
          if (team) return printParking(t, cat, team);
          openTeamPicker(cat, null, (tid) => { if (!tid) return; store.set(myKey(), tid); render(); printParking(t, cat, cat.teams.find((x) => x.id === tid)); });
        } }, icon('car'), '駐車券を出力') : null),
      h('p', { class: 'updated' }, h('i', { class: 'dot' }), h('span', { id: 'stamp' })),
      refreshButton(() => load(), { withNav: true }),
      open ? null : h('p', { class: 'manual-row' }, manualLink('parents', '使い方（保護者マニュアル）')));

    const pickTeam = () => openTeamPicker(cat, ctx.myTeam, (id) => {
      store.set(myKey(), id);
      if (id && st.filter === 'all') { st.filter = 'mine'; store.set(`${open ? 'o' : 'v'}:${slug}:filter`, 'mine'); }
      if (!id && st.filter === 'mine') st.filter = 'all';
      render();
    });

    function renderBody() {
      const blocks = [];
      if (st.tab === 'schedule') {
        blocks.push(myTeamCard(cat, ctx, pickTeam));
        blocks.push(toolbar());
        if (st.searchOpen) blocks.push(searchBox());
        const q = st.query.trim();
        if (days > 1) blocks.splice(1, 0, dayChips());
        const filter = (m) => {
          if (st.day != null && dayOf(cat.config, m.slot) !== st.day) return false;
          if (st.filter === 'mine' && ctx.myTeam && m.home_team_id !== ctx.myTeam && m.away_team_id !== ctx.myTeam) return false;
          if (st.filter === 'upcoming' && m.status === 'confirmed') return false;
          if (st.filter === 'done' && m.status !== 'confirmed') return false;
          if (!q) return true;
          return sideInfo(m, 'home', cat, ctx.cache).text.includes(q) || sideInfo(m, 'away', cat, ctx.cache).text.includes(q);
        };
        blocks.push(scheduleView(cat, { ...ctx, emptyText: q ? `「${q}」の試合は見つかりません` : st.filter === 'done' ? '終わった試合はまだありません' : '該当する試合はありません' }, filter));
      } else if (st.tab === 'standings') {
        blocks.push(standingsView(cat, ctx));
      } else if (st.tab === 'bracket') {
        blocks.push(bracketView(cat, { ...ctx, jumpNav: true }));
      } else {
        blocks.push(h('div', { style: { marginTop: '18px' } }, h('p', { class: 'muted small', style: { margin: '0 4px' } }, 'チームを選ぶと、そのチームの試合だけを表示します。')));
        blocks.push(teamsView(cat, { ...ctx, onPickTeam: (id) => { store.set(myKey(), id); st.filter = 'mine'; store.set(`${open ? 'o' : 'v'}:${slug}:filter`, 'mine'); st.tab = 'schedule'; render(); window.scrollTo(0, 0); } }));
      }
      mount(body, blocks);
    }

    function dayChips() {
      const opts = [[null, 'すべての日'], ...Array.from({ length: days }, (_, d) => [d, dayLabel(cat, d, t, true)])];
      return h('div', { class: 'chips day-chips', style: { marginTop: '16px' }, role: 'tablist', 'aria-label': '開催日' },
        opts.map(([d, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.day === d),
          onclick: () => { st.day = d; renderBody(); } }, label)));
    }

    function toolbar() {
      const opts = [['all', 'すべて'], ctx.myTeam ? ['mine', '自チーム'] : null, ['upcoming', 'これから'], ['done', '終了']].filter(Boolean);
      if (st.filter === 'mine' && !ctx.myTeam) st.filter = 'all';
      return h('div', { class: 'toolbar' },
        h('div', { class: 'chips', style: { flex: 1 } }, opts.map(([k, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.filter === k),
          onclick: () => { st.filter = k; store.set(`${open ? 'o' : 'v'}:${slug}:filter`, k); renderBody(); } }, label))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'チーム名で検索', 'aria-pressed': String(st.searchOpen),
          onclick: () => { st.searchOpen = !st.searchOpen; if (!st.searchOpen) st.query = ''; renderBody(); if (st.searchOpen) body.querySelector('.search input')?.focus(); } }, icon('search')),
        refereeLegend());
    }

    function searchBox() {
      return h('div', { class: 'search' }, icon('search'),
        h('input', { type: 'search', placeholder: 'チーム名で探す', value: st.query, 'aria-label': 'チーム名で探す',
          oninput: (e) => { st.query = e.target.value; const pos = e.target.selectionStart; renderBody(); const inp = body.querySelector('.search input'); inp.focus(); inp.setSelectionRange(pos, pos); } }));
    }

    const tabs = [
      ['schedule', '試合', 'ball'],
      hasLeague ? ['standings', '順位表', 'list'] : null,
      hasKo ? ['bracket', 'トーナメント', 'trophy'] : null,
      ['teams', 'チーム', 'shield'],
    ].filter(Boolean);
    const nav = h('nav', { class: 'bottom-nav', 'aria-label': '表示の切り替え' }, h('div', { class: 'wrap' },
      tabs.map(([k, label, ic]) => h('button', { type: 'button', 'aria-current': st.tab === k ? 'page' : null,
        onclick: () => { st.tab = k; render(); window.scrollTo(0, 0); } }, icon(ic), label))));

    mount(root, hero, content, nav);
    renderBody();
    updateStamp();

    // 当日は、いま行われている時間帯までスクロールする（最初の1回だけ）
    const ti = todayIndex(cat, t);
    if (!scrolledOnce && st.tab === 'schedule' && t.status === 'live' && ti >= 0) {
      scrolledOnce = true;
      const len = Math.max(matchLength(cat.config), matchLengthFor(cat.config, { stage: 'knockout' }));
      const n = nowMin();
      const target = [...body.querySelectorAll('.slot')].find((s) => Number(s.dataset.d || 0) === ti && Number(s.dataset.t) + len > n);
      if (target && target !== body.querySelector('.slot')) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    }
  }
}

// 複数日なら「10月18日（土）〜10月19日（日）」
function dateRange(t, categories) {
  if (t.end_date && t.end_date > t.date) return `${formatDate(t.date)} 〜 ${formatDate(t.end_date).replace(/^\d+年/, '')}`;
  const dates = new Set([t.date]);
  for (const c of categories) {
    const n = dayTotal(c.config);
    for (let d = 1; d < n; d++) { const x = dayDate(c, d, t); if (x) dates.add(x); }
  }
  const list = [...dates].filter(Boolean).sort();
  if (list.length <= 1) return formatDate(t.date);
  return `${formatDate(list[0])} 〜 ${formatDate(list[list.length - 1]).replace(/^\d+年/, '')}`;
}

// ---------- 忘れ物 ----------
// お知らせの帯（申し送り事項が右から左へ流れる）。押すと写真付きの一覧
function lostBar(t) {
  const list = t.lost || [];
  if (!list.length) return null;
  const text = list.map((x) => x.note.replace(/\s+/g, ' ')).join('　／　');
  return h('button', { class: 'lost-bar', type: 'button', onclick: () => openLost(t), 'aria-label': `忘れ物のお知らせ ${list.length}件。押すと詳しく見られます` },
    h('span', { class: 'lost-bar-label' }, icon('bell'), '忘れ物'),
    h('span', { class: 'lost-bar-track' }, h('span', { class: 'lost-bar-text' }, `${text}　　　${text}`)),
    h('span', { class: 'lost-bar-more' }, '見る'));
}

function openLost(t) {
  const list = t.lost || [];
  const fmt = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  sheet({
    title: `忘れ物のお知らせ（${list.length}件）`,
    content: [
      h('div', { class: 'lost-list' }, list.map((it) => h('article', { class: 'lost-item' },
        it.img ? h('img', { src: it.img, alt: '忘れ物の写真', loading: 'lazy' }) : null,
        h('p', null, it.note),
        h('div', { class: 'muted small' }, `${fmt(it.created_at)} 掲載`)))),
      h('p', { class: 'lost-foot' }, '心当たりのある方は、大会本部までお越しください。'),
    ],
  });
}

// ---------- スポンサー ----------
// リンクはアプリのサーバー（/go/…）を経由し、クリック数を数えてから新しいタブで開く
const sponsorLink = (sp, cls, child) => h('a', { class: cls, href: `/go/${sp.id}`, target: '_blank', rel: 'noopener sponsored', 'aria-label': `${sp.name}（新しいタブで開きます）` }, child);

// 上部：自動で切り替わるバナー枠
function sponsorTop(list) {
  if (!list.length) return null;
  const track = h('div', { class: 'sp-track' }, list.map((sp) => sponsorLink(sp, 'sp-slide', h('img', { src: sp.img, alt: sp.name }))));
  const dots = list.length > 1 ? h('div', { class: 'sp-dots', 'aria-hidden': 'true' }, list.map((_, i) => h('i', { class: i === 0 ? 'on' : '' }))) : null;
  const box = h('div', { class: 'sp-top' }, h('span', { class: 'sp-label' }, '協賛'), track, dots);
  if (list.length > 1) {
    const sync = () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    };
    track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    let paused = false;
    track.addEventListener('pointerdown', () => { paused = true; setTimeout(() => { paused = false; }, 8000); });
    const timer = setInterval(() => {
      if (!document.body.contains(track)) return clearInterval(timer);
      if (paused || document.visibilityState !== 'visible') return;
      const i = (Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) + 1) % list.length;
      track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
    }, 5000);
  }
  return box;
}

// 下部：全スポンサーの一覧
function sponsorAll(list) {
  if (!list.length) return null;
  return h('section', { class: 'sp-all', 'aria-label': '協賛' },
    h('h2', { class: 'group-title' }, 'ご協賛'),
    h('div', { class: 'sp-grid' }, list.map((sp) => sponsorLink(sp, 'sp-banner', h('img', { src: sp.img, alt: sp.name, loading: 'lazy' })))));
}

function skeleton() {
  return h('div', null,
    h('div', { class: 'hero' }, h('div', { class: 'wrap' }, h('div', { class: 'skel', style: { height: '28px', width: '70%', opacity: 0.4 } }), h('div', { class: 'skel', style: { height: '16px', width: '45%', marginTop: '14px', opacity: 0.4 } }))),
    h('div', { class: 'wrap' }, [0, 1, 2].map(() => h('div', { class: 'skel', style: { height: '120px', marginTop: '18px', borderRadius: '20px' } }))));
}

// 審判マークの凡例
function refereeLegend() {
  const mode = refereeMode();
  if (mode === 'none') return null;
  return h('p', { class: 'ref-legend' }, mode !== 'halves'
    ? [h('span', { class: 'ref-mark' }, '審'), '＝審判を担当するチーム']
    : [h('span', { class: 'ref-mark half' }, '前審'), '前半の審判　', h('span', { class: 'ref-mark half' }, '後審'), '後半の審判']);
}

function myTeamCard(cat, ctx, onPick) {
  const team = ctx.cache.teams[ctx.myTeam];
  if (!team) {
    return h('button', { class: 'myteam-cta', type: 'button', onclick: onPick }, icon('star'),
      h('span', null, h('strong', null, '自チームを選ぶ'), h('small', null, '次の試合と結果がすぐに見られます')));
  }
  const mine = cat.matches.filter((m) => m.home_team_id === team.id || m.away_team_id === team.id).sort((a, b) => absMin(cat.config, a) - absMin(cat.config, b));
  const next = mine.find((m) => ['upcoming', 'playing'].includes(statusOf(m, cat, ctx.tournament).key));
  const pending = mine.some((m) => m.status !== 'confirmed');
  const done = mine.filter((m) => m.status === 'confirmed');
  const record = done.reduce((r, m) => {
    const w = winnerSide(m);
    const side = m.home_team_id === team.id ? 'home' : 'away';
    if (!w) r.d++; else if (w === side) r.w++; else r.l++;
    return r;
  }, { w: 0, d: 0, l: 0 });
  let nextEl;
  if (next) {
    const opp = sideInfo(next, next.home_team_id === team.id ? 'away' : 'home', cat, ctx.cache);
    const st = statusOf(next, cat, ctx.tournament);
    nextEl = h('div', { class: 'myteam-next' },
      h('span', { class: 't' }, toHHMM(next.start_min)),
      h('span', null, h('span', { class: 'muted small' }, `${dayTotal(cat.config) > 1 ? `${dayLabel(cat, dayOf(cat.config, next.slot), ctx.tournament, true)}  ` : ''}${courtName(cat.config, next.court)}  ${next.label}`), h('br'), `対 ${opp.text}`),
      st.key === 'playing' ? h('span', { class: 'mc-st live' }, h('i', { class: 'dot pulse' }), '試合中') : null);
  } else if (pending) {
    nextEl = h('div', { class: 'myteam-next' }, h('span', { class: 'mc-st wait', style: { marginLeft: 0 } }, '結果待ち'), h('span', { class: 'muted small' }, '本部が結果を確定するとここに表示されます'));
  } else if (mine.length) {
    nextEl = h('div', { class: 'myteam-next' }, h('span', null, '全試合が終わりました'));
  }
  return h('section', { class: 'myteam', 'aria-label': '自チーム' },
    h('div', { class: 'myteam-head' }, crest(team, 36),
      h('div', null, h('strong', null, team.name), h('div', { class: 'muted small' },
        [team.group_label ? `${team.group_label}組` : null, done.length ? `${record.w}勝 ${record.d}分 ${record.l}敗` : null].filter(Boolean).join('  '))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'link-btn', type: 'button', onclick: onPick }, '変更')),
    nextEl);
}

function openTeamPicker(cat, current, onDone) {
  let query = '';
  sheet({
    title: '自チームを選ぶ',
    content: (close) => {
      const list = h('div');
      const draw = () => mount(list,
        cat.teams.filter((t) => !query || t.name.includes(query)).map((t) => h('button', { class: 'pick', type: 'button', 'aria-current': String(t.id === current),
          onclick: () => { close(); onDone(t.id); } }, crest(t, 32), t.name, t.group_label ? h('span', { class: 'g' }, `${t.group_label}組`) : null)),
        current ? h('button', { class: 'pick', type: 'button', style: { color: 'var(--ink-2)' }, onclick: () => { close(); onDone(null); } }, '選択を解除する') : null);
      draw();
      return [
        cat.teams.length > 10 ? h('div', { class: 'search', style: { marginTop: 0, marginBottom: '6px' } }, icon('search'),
          h('input', { type: 'search', placeholder: 'チーム名で探す', 'aria-label': 'チーム名で探す', oninput: (e) => { query = e.target.value.trim(); draw(); } })) : null,
        list,
      ];
    },
  });
}

// SNS投稿用：比率を固定したカードを表示し、端末のスクリーンショットで保存してもらう
function snsMode(t, cat, ctx) {
  const st = { kind: ctx.myTeam ? 'mine' : cat.config.format !== 'knockout' ? 'standings' : 'results', shape: 'sq' };
  const back = h('div', { class: 'sns-back', role: 'dialog', 'aria-label': 'SNSに投稿する画像' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const tm = teamMap(cat);

  const line = (m) => {
    const w = winnerSide(m);
    return h('div', { class: 'sm' },
      h('span', { class: `h${w === 'away' ? ' lose' : ''}` }, sideInfo(m, 'home', cat, ctx.cache).text),
      h('span', { class: 's' }, `${m.home_score} - ${m.away_score}`, m.home_pk != null ? h('small', null, `PK ${m.home_pk}-${m.away_pk}`) : null),
      h('span', { class: `a${w === 'home' ? ' lose' : ''}` }, sideInfo(m, 'away', cat, ctx.cache).text));
  };

  const draw = () => {
    const kinds = [
      cat.config.format !== 'knockout' ? ['standings', '順位表'] : null,
      ctx.myTeam ? ['mine', '自チームの結果'] : null,
      ['results', '最新の結果'],
      cat.finalRanking && cat.finalRanking.length ? ['final', '最終順位'] : null,
    ].filter(Boolean);
    if (!kinds.find(([k]) => k === st.kind)) st.kind = kinds[0][0];
    const confirmed = cat.matches.filter((m) => m.status === 'confirmed');
    const content = h('div', { class: 'sb' });

    // 順位表・最終順位は、全チームが1枚に収まる画像を作って表示する（チーム名は折り返さない）
    if (st.kind === 'standings' || st.kind === 'final') {
      const img = h('img', { class: 'sns-img', alt: st.kind === 'final' ? '最終順位' : '順位表' });
      const canvas = document.createElement('canvas');
      const size = st.shape === 'story' ? 'story' : 'square';
      const footer = `${formatDate(t.date)}　${t.venue || ''}`;
      const job = st.kind === 'final'
        ? drawPoster(canvas, t, cat, { kind: 'ranking', size, accent: 'lime', title: t.name, subtitle: `${cat.name} 最終結果`, footer, showTeamLogo: true, noWrap: true, myTeam: ctx.myTeam })
        : drawStandingsImage(canvas, t, cat, { size, title: t.name, subtitle: `${cat.name} 順位表`, footer, myTeam: ctx.myTeam });
      job.then(() => { img.src = canvas.toDataURL('image/png'); });
      const save = () => saveImages(canvas, `${t.name}_${cat.name}_${st.kind === 'final' ? '最終結果' : '順位表'}`);
      mount(back,
        h('div', { class: 'sns-bar' }, kinds.map(([k, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.kind === k), onclick: () => { st.kind = k; draw(); } }, label))),
        h('div', { class: 'sns-bar' },
          [['sq', '正方形'], ['story', 'ストーリー']].map(([k, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.shape === k), onclick: () => { st.shape = k; draw(); } }, label)),
          h('button', { class: 'chip-btn', type: 'button', onclick: close }, '閉じる')),
        h('div', { class: `sns-imgwrap ${st.shape}` }, img),
        h('div', { class: 'sns-bar' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, '画像を保存')),
        h('p', { class: 'sns-hint' }, 'スマホでは、画像を長押しして保存することもできます'));
      return;
    }
    if (st.kind === 'standings') {
      for (const [g, s] of Object.entries(cat.standings).sort()) {
        content.append(h('div', { class: 'sg' }, `${g}組${s.complete ? '' : '（途中経過）'}`),
          h('table', { class: 'standings' }, h('tbody', null, s.rows.map((r) => h('tr', { class: r.teamId === ctx.myTeam ? 'mine' : '' },
            h('td', { style: { width: '24px', fontWeight: 800 } }, r.rank), h('td', { style: { textAlign: 'left', fontWeight: 700 } }, tm[r.teamId]?.name || '-'),
            h('td', null, `${r.w}勝${r.d}分${r.l}敗`), h('td', null, r.gd > 0 ? `+${r.gd}` : r.gd), h('td', { style: { fontWeight: 800 } }, `${r.pts}点`))))));
      }
    } else if (st.kind === 'mine') {
      const list = confirmed.filter((m) => m.home_team_id === ctx.myTeam || m.away_team_id === ctx.myTeam).sort((a, b) => absMin(cat.config, a) - absMin(cat.config, b));
      content.append(h('div', { class: 'sbig' }, crest(tm[ctx.myTeam], 30), tm[ctx.myTeam]?.name || ''));
      content.append(...(list.length ? list.map(line) : [h('p', null, '終わった試合はまだありません')]));
    } else if (st.kind === 'results') {
      const list = confirmed.sort((a, b) => absMin(cat.config, b) - absMin(cat.config, a)).slice(0, st.shape === 'story' ? 14 : 7).reverse();
      content.append(...(list.length ? list.map(line) : [h('p', null, '終わった試合はまだありません')]));
    } else {
      content.append(...cat.finalRanking.map((r) => h('div', { class: 'sbig', style: { fontSize: r.rank === 1 ? '1.3rem' : '1rem' } },
        h('span', { style: { width: '44px' } }, `${r.rank}位`), crest(tm[r.teamId], 30), tm[r.teamId]?.name || '-')));
    }

    const now = new Date();
    const card = h('div', { class: `sns-card ${st.shape}` },
      h('div', { class: 'sh' }, t.logo ? h('img', { src: t.logo, alt: '' }) : null,
        h('div', null, h('div', { class: 'tt' }, t.name), h('div', { class: 'st' }, `${cat.name}  ${formatDate(t.date)}`))),
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

// ===== 一般公開：大会の一覧（クラブのサイトに埋め込む）=====
// 開催中 → これから → 過去（年ごと）の順に並べる。各大会は /open/<公開用のID> へ
export async function openList(root) {
  mount(root, skeleton());
  let list;
  try { list = (await api('GET', '/api/open/tournaments')).tournaments || []; }
  catch (e) { mount(root, h('div', { class: 'wrap' }, h('p', { class: 'empty' }, e.message))); return; }
  document.title = '大会結果・速報';
  const today = todayStr();
  const endOf = (t) => t.end_date || t.date || '';
  const live = list.filter((t) => t.status === 'live');
  const soon = list.filter((t) => t.status !== 'live' && t.status !== 'finished' && endOf(t) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const past = list.filter((t) => !live.includes(t) && !soon.includes(t));
  const years = [...new Set(past.map((t) => (t.date || '').slice(0, 4) || '日付未定'))].sort().reverse();
  const period = (t) => (t.date ? (t.end_date && t.end_date !== t.date ? `${formatDate(t.date)} 〜 ${formatDate(t.end_date).replace(/^\d{4}年/, '')}` : formatDate(t.date)) : '日付未定');
  const card = (t) => h('a', { class: `ol-card${t.status === 'live' ? ' is-live' : ''}`, href: `/open/${t.id}` },
    t.logo ? h('img', { class: 'ol-logo', src: t.logo, alt: '' }) : h('span', { class: 'ol-logo ol-nologo', 'aria-hidden': 'true' }, icon('trophy')),
    h('span', { class: 'ol-main' },
      h('strong', null, t.name),
      h('span', { class: 'ol-meta' }, period(t), t.venue ? `　${t.venue}` : ''),
      t.categories.length ? h('span', { class: 'ol-cats' }, t.categories.map((c) => h('span', null, c))) : null),
    t.status === 'live' ? h('span', { class: 'state-pill live' }, h('i', { class: 'dot pulse' }), '開催中') : h('span', { class: 'ol-go', 'aria-hidden': 'true' }, '›'));
  const section = (title, items) => (items.length ? h('section', { class: 'ol-sec' }, h('h2', null, title), h('div', { class: 'ol-list' }, items.map(card))) : null);
  mount(root, h('main', { class: 'wrap open-list' },
    h('h1', { class: 'ol-title' }, '大会結果・速報'),
    !list.length ? h('p', { class: 'empty' }, '公開中の大会はまだありません') : null,
    section('開催中', live),
    section('これからの大会', soon),
    years.map((y) => section(`${y}年の大会`, past.filter((t) => ((t.date || '').slice(0, 4) || '日付未定') === y))),
    h('p', { class: 'ol-foot' }, '結果は大会本部が確定したものを掲載しています。')));
  if (window.parent !== window) window.parent.postMessage({ type: 'infinex:ready' }, '*');
}
