import { api, ApiError } from './web-api.js';
import { h, mount, modal, confirmDialog, toast, store, poller, run, copyText, resizeImage, toHHMM, fromHHMM, formatDate, todayStr, nowMin, formatUpdated, icon } from './web-ui.js';
import { teamMap, codeMap, sideInfo, courtName, matchLength, standingsView, bracketView, TIEBREAK_LABEL, dayOf, dayTotal, dayLabel, dayDate, absMin } from './web-views.js';

const STATUS = {
  draft: { label: '準備中', note: '閲覧ページは非公開です。自由に編集できます。' },
  published: { label: '公開中', note: '閲覧ページを公開しています。組み合わせの編集もできます。' },
  live: { label: '開催中', note: '組み合わせは固定され、結果の確定とコートごとの時間調整ができます。' },
  finished: { label: '終了', note: '結果の閲覧のみです。' },
};
const CATEGORY_NAMES = ['U7', 'U8', 'U9', 'U10', 'U11', 'U12'];
const FORMAT_LABEL = { league: 'リーグ戦', knockout: 'トーナメント', league_knockout: 'リーグ戦＋トーナメント' };
const RANK_LABEL = { top3: '1〜3位を決める（3位決定戦あり）', top3_shared: '1〜3位を決める（3位は2チーム）', all: '全順位を決める（順位決定戦）' };

const PLAN_LABEL = { top: '上位チームだけでトーナメント', all: '全チームで1つのトーナメント', split: '上位トーナメントと下位トーナメント', byrank: '同じ順位どうしでトーナメント', custom: '自由に設定する' };

// 管理画面での見積もり（実際の組み分け前でも、チーム数と組数から人数を推定する）
function estimateGroupSizes(f, cat) {
  const labels = Array.from({ length: Math.max(1, f.groups) }, (_, i) => String.fromCharCode(65 + i));
  const assigned = cat.teams.filter((t) => t.group_label);
  if (assigned.length === cat.teams.length && assigned.length) {
    const sizes = {};
    for (const t of assigned) sizes[t.group_label] = (sizes[t.group_label] || 0) + 1;
    if (Object.keys(sizes).length === labels.length) return sizes;
  }
  const n = Math.max(cat.teams.length, labels.length * 2);
  return Object.fromEntries(labels.map((l, i) => [l, Math.floor(n / labels.length) + (i < n % labels.length ? 1 : 0)]));
}

function expandPlanPreview(plan, maxRank) {
  const k = Math.max(1, Math.min(maxRank, Number(plan.k) || 2));
  if (plan.type === 'all') return [{ name: '決勝トーナメント', from: 1, to: maxRank }];
  if (plan.type === 'split') return [{ name: '上位トーナメント', from: 1, to: k }, { name: '下位トーナメント', from: k + 1, to: maxRank }].filter((b) => b.from <= b.to);
  if (plan.type === 'byrank') return Array.from({ length: maxRank }, (_, i) => ({ name: `${i + 1}位トーナメント`, from: i + 1, to: i + 1 }));
  if (plan.type === 'custom') return (plan.brackets || []).map((b) => ({ ...b, from: Number(b.from) || 1, to: Math.min(Number(b.to) || 1, maxRank) })).filter((b) => b.from <= b.to);
  return [{ name: '決勝トーナメント', from: 1, to: k }];
}

function knockoutPlanPanel(f, cat, redraw) {
  const plan = f.knockoutPlan || (f.knockoutPlan = { type: 'top', k: f.advance || 2, mode: f.rankMode || 'top3', brackets: [] });
  const sizes = estimateGroupSizes(f, cat);
  const maxRank = Math.max(...Object.values(sizes));
  const preview = expandPlanPreview(plan, maxRank).map((b) => {
    let n = 0;
    for (let r = b.from; r <= b.to; r++) for (const v of Object.values(sizes)) if (v >= r) n++;
    const range = b.from === b.to ? `各組${b.from}位` : `各組${b.from}〜${b.to}位`;
    const pow2 = n >= 2 && (n & (n - 1)) === 0;
    const mode = b.mode || plan.mode;
    return { text: `${b.name}：${range}（${n}チーム）`, warn: n < 2 ? '2チーム未満のため作られません' : mode === 'all' && !pow2 ? '2・4・8・16チームでないため全順位決定にできません' : null };
  });
  const set = (patch) => { Object.assign(plan, patch); redraw(); };

  const custom = plan.type === 'custom' ? h('div', { class: 'stack', style: { marginTop: '12px' } },
    (plan.brackets || []).map((b, i) => h('div', { class: 'grid-form', style: { padding: '12px', background: 'var(--surface-2)', borderRadius: '14px' } },
      h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', null, '名前'), h('input', { type: 'text', value: b.name || '', oninput: (e) => { b.name = e.target.value; } })),
      h('label', { class: 'field' }, h('span', null, '各組の何位から'), h('input', { type: 'number', min: 1, max: 16, value: b.from, oninput: (e) => { b.from = Number(e.target.value); }, onchange: redraw })),
      h('label', { class: 'field' }, h('span', null, '何位まで'), h('input', { type: 'number', min: 1, max: 16, value: b.to, oninput: (e) => { b.to = Number(e.target.value); }, onchange: redraw })),
      h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', null, '順位の決め方'), h('select', { onchange: (e) => { b.mode = e.target.value; redraw(); } },
        Object.entries(RANK_LABEL).map(([v, l]) => h('option', { value: v, selected: (b.mode || plan.mode) === v }, l)))),
      h('div', { style: { gridColumn: '1 / -1' } }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { plan.brackets.splice(i, 1); redraw(); } }, 'このトーナメントを削除')))),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
      const last = (plan.brackets || []).at(-1);
      const from = last ? Number(last.to) + 1 : 1;
      plan.brackets = [...(plan.brackets || []), { name: `トーナメント${(plan.brackets || []).length + 1}`, from, to: from, mode: plan.mode }];
      redraw();
    } }, '＋ トーナメントを追加')) : null;

  return h('div', { style: { marginTop: '16px' } },
    h('h3', { style: { marginBottom: '8px' } }, '決勝トーナメント'),
    h('div', { class: 'grid-form' },
      h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', null, '進み方'), h('select', { onchange: (e) => {
        const type = e.target.value;
        if (type === 'custom' && !(plan.brackets || []).length) plan.brackets = expandPlanPreview(plan, maxRank).map((b) => ({ ...b, mode: plan.mode }));
        set({ type });
      } }, Object.entries(PLAN_LABEL).map(([v, l]) => h('option', { value: v, selected: plan.type === v }, l)))),
      plan.type === 'top' || plan.type === 'split' ? h('label', { class: 'field' }, h('span', null, plan.type === 'top' ? '各組から進む数' : '上位に進む数（各組）'),
        h('input', { type: 'number', min: 1, max: 16, value: plan.k, inputmode: 'numeric', oninput: (e) => { plan.k = Number(e.target.value); }, onchange: redraw })) : null,
      plan.type !== 'custom' ? h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', null, '順位の決め方'), h('select', { onchange: (e) => set({ mode: e.target.value }) },
        Object.entries(RANK_LABEL).map(([v, l]) => h('option', { value: v, selected: plan.mode === v }, l)))) : null),
    custom,
    h('div', { class: 'notice', style: { marginTop: '12px' } },
      h('div', { style: { fontWeight: 700, marginBottom: '4px' } }, cat.teams.length ? `いまの${cat.teams.length}チーム・${f.groups}組の場合` : `${f.groups}組の場合（チーム登録後に人数が正確になります）`),
      preview.map((p) => h('div', null, p.text, p.warn ? h('span', { style: { color: 'var(--live)', fontWeight: 700 } }, `　${p.warn}`) : null))),
    h('p', { class: 'muted small' }, '同じ組のチームができるだけ後で当たるように、組み合わせを自動で決めます。各組の上位1〜2チームが2・4・8組から進む場合は、クロス方式（A組1位 対 B組2位 など）になります。'));
}

// ---------- 複数日の設定 ----------

// 「◯日目はどこまで」の選択肢（形式とチーム数から作る）
function dayBreakOptions(f, cat) {
  const hasLeague = f.format !== 'knockout';
  const hasKo = f.format !== 'league';
  const sizes = estimateGroupSizes(f, cat);
  const mx = Math.max(...Object.values(sizes));
  const R = hasLeague ? (mx % 2 ? mx : mx - 1) : 0;
  let T = 0;
  if (hasKo) {
    let N;
    if (f.format === 'knockout') N = Math.max(2, cat.teams.length);
    else {
      const plan = f.knockoutPlan || { type: 'top', k: 2 };
      N = Math.max(2, ...expandPlanPreview(plan, mx).map((b) => {
        let n = 0;
        for (let r = b.from; r <= b.to; r++) for (const v of Object.values(sizes)) if (v >= r) n++;
        return n;
      }));
    }
    T = Math.ceil(Math.log2(N));
  }
  const opts = [];
  for (let r = 1; r <= R; r++) {
    if (r === R && !hasKo) break;
    opts.push([`L${r}`, r === R ? `リーグ戦の最後（第${r}節）まで` : `リーグ第${r}節まで`]);
  }
  for (let i = 0; i < T - 1; i++) {
    const d = T - 1 - i;
    opts.push([`K${i}`, `トーナメントの${d === 1 ? '準決勝' : d === 2 ? '準々決勝' : `${i + 1}回戦`}まで`]);
  }
  return opts;
}

function addDays(date, n) {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayPanel(f, cat, t, redraw) {
  const opts = dayBreakOptions(f, cat);
  const keys = opts.map(([k]) => k);
  const n = f.dayCount || 1;
  // 足りない項目を既定値で埋める
  f.extraDays = Array.from({ length: n - 1 }, (_, i) => ({
    date: (f.extraDays && f.extraDays[i] && f.extraDays[i].date) || addDays(t.date, i + 1),
    startTime: f.extraDays && f.extraDays[i] && f.extraDays[i].startTime != null ? f.extraDays[i].startTime : f.startTime,
  }));
  f.dayBreaks = Array.from({ length: n - 1 }, (_, i) => {
    const cur = f.dayBreaks && f.dayBreaks[i];
    if (cur && keys.includes(cur)) return cur;
    // 既定: 2日ならリーグ戦とトーナメントで分ける。それ以外は均等に
    const leagueEnd = keys.filter((k) => k[0] === 'L').at(-1);
    if (n === 2 && f.format === 'league_knockout' && leagueEnd) return leagueEnd;
    return keys[Math.min(keys.length - 1, Math.max(0, Math.round(((i + 1) * keys.length) / n) - 1))] || '';
  });
  // 新しく増えた区切りは、前の日の区切りより後ろを選んでおく
  for (let i = 1; i < f.dayBreaks.length; i++) {
    const prev = keys.indexOf(f.dayBreaks[i - 1]);
    if (keys.indexOf(f.dayBreaks[i]) <= prev && keys[prev + 1] && !(f._touched || {})[i]) f.dayBreaks[i] = keys[prev + 1];
  }
  const order = f.dayBreaks.map((k) => keys.indexOf(k));
  const bad = order.some((x, i) => x < 0 || (i > 0 && x <= order[i - 1]));
  const tooFew = keys.length < n - 1;

  const breakSelect = (i) => h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', null, `${i + 1}日目はどこまで`),
    h('select', { onchange: (e) => { f.dayBreaks[i] = e.target.value; f._touched = { ...(f._touched || {}), [i]: true }; redraw(); } }, opts.map(([k, l]) => h('option', { value: k, selected: f.dayBreaks[i] === k }, l))));

  return h('section', { class: 'panel' },
    h('h2', { style: { marginBottom: '12px' } }, '開催日'),
    h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, '開催日数'), h('select', { onchange: (e) => { f.dayCount = Number(e.target.value); redraw(); } },
        [1, 2, 3, 4].map((v) => h('option', { value: v, selected: n === v }, `${v}日`))))),
    n > 1 ? h('div', { class: 'stack', style: { marginTop: '14px' } }, Array.from({ length: n }, (_, d) => h('div', { class: 'day-box' },
      h('div', { class: 'day-box-head' }, h('strong', null, `${d + 1}日目`),
        d === 0 ? h('span', { class: 'muted small' }, `${formatDate(t.date) || '大会情報の開催日'}　開始は「基本」の第1試合の開始`) : null),
      d > 0 ? h('div', { class: 'grid-form' },
        h('label', { class: 'field' }, h('span', null, '日付'), h('input', { type: 'date', value: f.extraDays[d - 1].date, oninput: (e) => { f.extraDays[d - 1].date = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '第1試合の開始'), h('input', { type: 'time', value: toHHMM(f.extraDays[d - 1].startTime), oninput: (e) => { if (e.target.value) f.extraDays[d - 1].startTime = fromHHMM(e.target.value); } }))) : null,
      d < n - 1 && opts.length ? h('div', { class: 'grid-form', style: { marginTop: d > 0 ? '10px' : '6px' } }, breakSelect(d)) : null))) : null,
    tooFew && n > 1 ? h('p', { class: 'notice error', style: { marginTop: '12px' } }, `いまの形式とチーム数では、${n}日に分けるだけの区切りがありません。日数を減らしてください。`) : null,
    bad && !tooFew && n > 1 ? h('p', { class: 'notice error', style: { marginTop: '12px' } }, '区切りは、1日目 → 2日目 … の順に後ろの段階になるように選んでください。') : null,
    n > 1 ? h('p', { class: 'muted small' }, '開催日数や区切りを変えたときは「組み分け・日程」で日程を作り直してください。各日の昼休憩は「昼休憩」の設定を使います。') : null);
}

export async function admin(root, path, navigate) {
  let me;
  try { me = await api('GET', '/api/admin/me'); } catch (e) { return mount(root, h('p', { class: 'empty' }, e.message)); }
  if (!me.admin) return loginView(root, () => admin(root, path, navigate));
  const m = path.match(/^\/admin\/t\/([^/]+)/);
  if (m) return tournamentView(root, m[1], navigate);
  return listView(root, navigate);
}

function adminHeader(title, navigate, back) {
  return h('header', { class: 'site-head no-print' }, h('div', { class: 'wrap wide' },
    back ? h('a', { href: '/admin', onclick: (e) => { e.preventDefault(); navigate('/admin'); } }, '← 大会一覧') : null,
    h('h1', { style: { marginLeft: back ? '8px' : 0 } }, title),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-sm', type: 'button', style: { background: 'transparent', color: '#fff', borderColor: '#fff' },
      onclick: async () => { await api('POST', '/api/admin/logout'); location.href = '/admin'; } }, 'ログアウト')));
}

// ---------- ログイン ----------

function loginView(root, onDone) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': '管理者パスワード' });
  const err = h('p', { class: 'notice error', hidden: true });
  mount(root,
    h('header', { class: 'site-head' }, h('div', { class: 'wrap' }, h('h1', null, '大会運営'))),
    h('form', { class: 'wrap stack', style: { marginTop: '32px', maxWidth: '420px' }, onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/admin/login', { password: pw.value }); onDone(); }
      catch (ex) { err.hidden = false; err.textContent = ex.message; }
    } },
    h('label', { class: 'field' }, h('span', null, '管理者パスワード'), pw), err,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'ログイン')));
  pw.focus();
}

// ---------- 大会一覧 ----------

async function listView(root, navigate) {
  const { tournaments } = await api('GET', '/api/admin/tournaments');

  const createDialog = () => {
    const name = h('input', { type: 'text', placeholder: '例: 第5回 さくらカップ' });
    const date = h('input', { type: 'date', value: todayStr() });
    const venue = h('input', { type: 'text', placeholder: '例: 市民グラウンド' });
    modal({
      title: '大会を作成',
      content: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', null, '大会名'), name),
        h('div', { class: 'grid-form' },
          h('label', { class: 'field' }, h('span', null, '開催日'), date),
          h('label', { class: 'field' }, h('span', null, '会場'), venue))),
      actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '作成してカテゴリを追加', kind: 'btn-primary', onClick: async () => {
        const r = await run(() => api('POST', '/api/admin/tournaments', { name: name.value, date: date.value, venue: venue.value }));
        if (!r) return true;
        navigate(`/admin/t/${r.id}?add=1`);
      } }],
    });
  };

  // カテゴリを開いたとき、いま必要な作業のタブを選んでおく
  const openCategory = (t, c) => {
    store.set(`a:${t.id}:cat`, c.id);
    store.set(`a:${t.id}:sub`, !c.team_count ? 'teams' : !c.match_count ? 'schedule' : 'results');
    navigate(`/admin/t/${t.id}`);
  };

  const catCard = (t, c) => {
    const pct = c.match_count ? Math.round((c.done_count / c.match_count) * 100) : 0;
    const step = !c.team_count ? 'チームを登録しましょう' : !c.match_count ? '組み分けと日程を作りましょう' : c.done_count === c.match_count ? 'すべての試合が確定' : `確定 ${c.done_count} / ${c.match_count} 試合`;
    return h('button', { class: 'cat-card', type: 'button', onclick: () => openCategory(t, c) },
      h('div', { class: 'cat-top' }, h('strong', null, c.name),
        c.pending_count ? h('span', { class: 'tag alert' }, `仮登録 ${c.pending_count}`) : null),
      h('div', { class: 'cat-meta' }, `${c.team_count}チーム`, h('span', null, FORMAT_LABEL[c.format] || '')),
      c.match_count ? h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${pct}%` } })) : null,
      h('div', { class: `cat-step${!c.team_count || !c.match_count ? ' todo' : ''}` }, step));
  };

  const tCard = (t) => h('article', { class: 't-card' },
    h('a', { class: 't-head', href: `/admin/t/${t.id}`, onclick: (e) => { e.preventDefault(); navigate(`/admin/t/${t.id}`); } },
      t.logo ? h('img', { class: 't-logo', src: t.logo, alt: '' }) : h('span', { class: 't-logo ph' }, icon('ball')),
      h('div', { class: 't-title' },
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: `tag ${t.status === 'live' ? 'live' : t.status === 'published' ? 'done' : ''}` }, STATUS[t.status].label)),
        h('h2', null, t.name),
        h('div', { class: 't-meta' },
          t.date ? h('span', null, icon('calendar'), formatDate(t.date)) : null,
          t.venue ? h('span', null, icon('pin'), t.venue) : null)),
      icon('chevron', 't-go')),
    h('div', { class: 'cat-grid' },
      t.categories.map((c) => catCard(t, c)),
      h('button', { class: 'cat-card cat-add', type: 'button', onclick: () => navigate(`/admin/t/${t.id}?add=1`) }, '＋ カテゴリを追加')));

  const live = tournaments.filter((t) => t.status !== 'finished');
  const done = tournaments.filter((t) => t.status === 'finished');
  mount(root,
    adminHeader('大会運営', navigate, false),
    h('main', { class: 'wrap wide', style: { marginTop: '20px' } },
      h('div', { class: 'row' }, h('h2', { style: { fontSize: '1.3rem' } }, '大会一覧'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: createDialog }, '＋ 大会を作成')),
      tournaments.length ? null : h('div', { class: 'panel empty', style: { marginTop: '16px' } },
        h('p', { style: { marginTop: 0 } }, '大会はまだありません。'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: createDialog }, '最初の大会を作成')),
      live.length ? h('div', { class: 't-grid' }, live.map(tCard)) : null,
      done.length ? h('section', null, h('h3', { class: 'group-title' }, '終了した大会'), h('div', { class: 't-grid' }, done.map(tCard))) : null));
}

// ---------- 大会画面 ----------

async function tournamentView(root, id, navigate) {
  let data = null;
  let templates = null;
  const st = {
    catId: store.get(`a:${id}:cat`),
    sub: store.get(`a:${id}:sub`, 'settings'),
    moveSel: null,
    drafts: {}, // カテゴリID → {assignment, order, warnings}
    preview: {}, // カテゴリID → {matches, warnings}
    resultFilter: 'pending',
  };

  async function load() {
    const res = await api('GET', `/api/admin/tournaments/${id}${data ? `?rev=${data.tournament.rev}` : ''}`);
    if (res.unchanged) return false;
    data = res;
    if (!data.categories.find((c) => c.id === st.catId)) st.catId = data.categories[0]?.id || null;
    return true;
  }
  const reload = async () => { data = null; await load(); render(); };

  try { await load(); } catch (e) {
    if (e instanceof ApiError && e.status === 401) return loginView(root, () => tournamentView(root, id, navigate));
    return mount(root, adminHeader('大会運営', navigate, true), h('p', { class: 'empty' }, e.message));
  }
  render();
  if (new URLSearchParams(location.search).get('add')) {
    history.replaceState(null, '', location.pathname);
    addCategory();
  }

  // 関係者の仮登録を拾うため、入力中でなければ定期的に更新する
  const stopPoll = poller(async () => {
    if (!document.body.contains(root.firstChild)) return stopPoll();
    const a = document.activeElement;
    if (document.querySelector('.modal-back') || st.moveSel || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) return;
    if (await load()) render();
  }, 15000);

  function render() {
    const t = data.tournament;
    document.title = `${t.name} | 大会運営`;
    const cat = data.categories.find((c) => c.id === st.catId);
    const editable = t.status === 'draft' || t.status === 'published';
    mount(root,
      adminHeader(t.name, navigate, true),
      h('main', { class: 'wrap wide', style: { marginTop: '16px' } },
        h('div', { class: 'admin-layout split' },
          h('aside', { class: 'no-print' }, statusPanel(t), sharePanel(t), infoPanel(t)),
          h('div', null,
            h('div', { class: 'row no-print' },
              h('div', { class: 'chips', style: { flex: 1 } },
                data.categories.map((c) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(c.id === st.catId),
                  onclick: () => { st.catId = c.id; store.set(`a:${id}:cat`, c.id); st.moveSel = null; render(); } }, c.name))),
              h('button', { class: 'btn btn-sm', type: 'button', onclick: addCategory }, '＋ カテゴリを追加')),
            cat ? categoryView(t, cat, editable) : h('div', { class: 'panel empty', style: { marginTop: '12px' } }, 'カテゴリ（U7〜U12）を追加すると、チーム登録と日程作成ができます。')))));
  }

  // ----- 左側: 状態・共有・大会情報 -----

  function statusPanel(t) {
    const order = ['draft', 'published', 'live', 'finished'];
    const set = async (s) => {
      if (s === t.status) return;
      const back = order.indexOf(s) < order.indexOf(t.status);
      if (s === 'live' && !(await confirmDialog('大会を開催中にします', '組み合わせと日程が固定されます。以降はコートごとの時間調整と結果の確定ができます。', '開催中にする'))) return;
      if (back && (t.status === 'live' || t.status === 'finished') && !(await confirmDialog(`「${STATUS[s].label}」に戻します`, '組み合わせを編集できるようになります。日程を作り直すと、登録済みの結果は消えます。', '戻す', true))) return;
      if (await run(() => api('PATCH', `/api/admin/tournaments/${id}`, { status: s }), `「${STATUS[s].label}」にしました`)) await reload();
    };
    return h('section', { class: 'panel' },
      h('h2', { style: { marginBottom: '8px' } }, '大会の状態'),
      h('div', { class: 'chips', style: { flexWrap: 'wrap', paddingTop: 0 } }, order.map((s) =>
        h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(s === t.status), onclick: () => set(s) }, STATUS[s].label))),
      h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, STATUS[t.status].note));
  }

  function sharePanel(t) {
    const viewUrl = `${location.origin}/t/${t.slug}`;
    const relUrl = `${location.origin}/r/${t.slug}`;
    const lineText = `【${t.name}】\n結果の登録ページ\n${relUrl}\nPIN：${t.pin}\n\n試合結果（閲覧用）\n${viewUrl}`;
    return h('section', { class: 'panel' },
      h('h2', { style: { marginBottom: '8px' } }, '共有'),
      h('div', { class: 'stack small' },
        h('div', null, h('strong', null, '閲覧ページ（保護者向け）'),
          t.status === 'draft' ? h('p', { class: 'muted', style: { margin: 0 } }, '「公開中」にすると見られるようになります') : null,
          h('div', { class: 'row' }, h('a', { href: viewUrl, target: '_blank', rel: 'noopener', style: { overflowWrap: 'anywhere' } }, viewUrl),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(viewUrl) }, 'コピー'))),
        h('div', null, h('strong', null, '結果の登録ページ（チーム関係者向け）'),
          h('div', { class: 'row' }, h('span', { style: { overflowWrap: 'anywhere' } }, relUrl), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(relUrl) }, 'コピー'))),
        h('div', { class: 'row' }, h('strong', null, 'PIN'), h('span', { class: 'num', style: { fontSize: '1.8rem', fontWeight: 700, letterSpacing: '0.15em' } }, t.pin),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
            if (!(await confirmDialog('PINを再発行します', '今のPINでログインしている関係者は、新しいPINで入り直す必要があります。', '再発行する', true))) return;
            if (await run(() => api('POST', `/api/admin/tournaments/${id}/pin`), 'PINを再発行しました')) await reload();
          } }, '再発行')),
        h('button', { class: 'btn btn-block', type: 'button', onclick: () => copyText(lineText) }, 'LINE用の案内文をコピー')));
  }

  function infoPanel(t) {
    const f = { name: t.name, date: t.date || '', venue: t.venue || '', logo: t.logo, show_logo: !!t.show_logo };
    const preview = h('div');
    const drawLogo = () => mount(preview, f.logo ? h('div', { class: 'row' }, h('img', { src: f.logo, alt: '大会ロゴ', width: 56, height: 56, style: { objectFit: 'contain', background: '#fff', borderRadius: '50%' } }),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { f.logo = null; drawLogo(); } }, 'ロゴを外す')) : h('span', { class: 'muted small' }, 'ロゴは未設定です'));
    drawLogo();
    return h('details', { class: 'panel' },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, '大会情報を編集'),
      h('div', { class: 'stack', style: { marginTop: '12px' } },
        h('label', { class: 'field' }, h('span', null, '大会名'), h('input', { type: 'text', value: f.name, oninput: (e) => { f.name = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '開催日'), h('input', { type: 'date', value: f.date, oninput: (e) => { f.date = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '会場'), h('input', { type: 'text', value: f.venue, oninput: (e) => { f.venue = e.target.value; } })),
        h('div', null, h('span', { class: 'small', style: { fontWeight: 700 } }, '大会ロゴ'), preview,
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', 'aria-label': '大会ロゴの画像', onchange: async (e) => {
            const v = await run(() => resizeImage(e.target.files[0], 320));
            if (v) { f.logo = v; drawLogo(); }
          } })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.show_logo, onchange: (e) => { f.show_logo = e.target.checked; } }), 'ロゴを表示する（大会・チームとも）'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          if (await run(() => api('PATCH', `/api/admin/tournaments/${id}`, f), '保存しました')) await reload();
        } }, '大会情報を保存'),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => {
          if (!(await confirmDialog('大会を削除します', `「${t.name}」のチーム・日程・結果がすべて消えます。元に戻せません。`, '削除する', true))) return;
          if (await run(() => api('DELETE', `/api/admin/tournaments/${id}`), '削除しました')) navigate('/admin');
        } }, 'この大会を削除')));
  }

  async function getTemplates() {
    if (!templates) templates = (await api('GET', '/api/admin/templates')).templates;
    return templates;
  }

  async function addCategory() {
    const tpls = await run(getTemplates) || [];
    const used = new Set(data.categories.map((c) => c.name));
    const name = h('select', null, CATEGORY_NAMES.map((n) => h('option', { value: n, selected: !used.has(n) && n === CATEGORY_NAMES.find((x) => !used.has(x)) }, n)));
    const tpl = h('select', null, h('option', { value: '' }, '使わない'), tpls.map((x) => h('option', { value: x.id }, x.name)));
    modal({
      title: 'カテゴリを追加',
      content: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', null, 'カテゴリ'), name),
        h('label', { class: 'field' }, h('span', null, '形式テンプレート'), tpl)),
      actions: [
        { label: 'キャンセル', kind: 'btn-ghost' },
        { label: '追加', kind: 'btn-primary', onClick: async () => {
          const config = tpl.value ? tpls.find((x) => x.id === tpl.value).config : {};
          const r = await run(() => api('POST', `/api/admin/tournaments/${id}/categories`, { name: name.value, config }), 'カテゴリを追加しました');
          if (r) { st.catId = r.id; store.set(`a:${id}:cat`, r.id); st.sub = 'settings'; await reload(); }
        } },
      ],
    });
  }

  // ----- カテゴリ -----

  function categoryView(t, cat, editable) {
    const subs = [['settings', '設定'], ['teams', `チーム（${cat.teams.length}）`], ['schedule', '組み分け・日程'], ['results', '結果'], ['standings', '順位']];
    const pending = cat.matches.filter((m) => m.status === 'provisional').length;
    return h('div', null,
      h('div', { class: 'chips no-print', style: { paddingTop: '4px' } }, subs.map(([k, label]) =>
        h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.sub === k), onclick: () => { st.sub = k; store.set(`a:${id}:sub`, k); st.moveSel = null; render(); } },
          label, k === 'results' && pending ? h('span', { class: 'tag alert', style: { marginLeft: '6px' } }, pending) : null))),
      h('div', { style: { marginTop: '8px' } },
        st.sub === 'settings' ? settingsView(t, cat, editable)
          : st.sub === 'teams' ? teamsView(t, cat, editable)
            : st.sub === 'schedule' ? scheduleTab(t, cat, editable)
              : st.sub === 'results' ? resultsTab(t, cat)
                : standingsTab(t, cat)));
  }

  // ----- 設定 -----

  function settingsView(t, cat, editable) {
    const f = JSON.parse(JSON.stringify(cat.config));
    let name = cat.name;
    const box = h('div');
    const num = (key, label, opts = {}) => h('label', { class: 'field' }, h('span', null, label),
      h('input', { type: 'number', min: opts.min ?? 0, max: opts.max ?? 240, inputmode: 'numeric', value: f[key], oninput: (e) => { f[key] = Number(e.target.value); drawSummary(); } }));
    const time = (key, label) => h('label', { class: 'field' }, h('span', null, label),
      h('input', { type: 'time', value: toHHMM(f[key]), oninput: (e) => { if (e.target.value) { f[key] = fromHHMM(e.target.value); drawSummary(); } } }));
    const summary = h('p', { class: 'notice' });
    const drawSummary = () => {
      const n = f.periods || 2;
      const len = f.halfMinutes * n + (n > 1 ? f.halftimeMinutes * (n - 1) : 0);
      const body = n === 1 ? `試合${f.halfMinutes}分`
        : n === 2 ? `前半${f.halfMinutes}分＋ハーフタイム${f.halftimeMinutes}分＋後半${f.halfMinutes}分`
          : `${f.halfMinutes}分×${n}ピリオド＋休憩${f.halftimeMinutes}分×${n - 1}`;
      summary.textContent = `1試合の枠：${body}＋試合間隔${f.intervalMinutes}分＝${len + f.intervalMinutes}分`;
    };
    drawSummary();

    const draw = () => mount(box,
      h('section', { class: 'panel' },
        h('h2', { style: { marginBottom: '12px' } }, '基本'),
        h('div', { class: 'grid-form' },
          h('label', { class: 'field' }, h('span', null, 'カテゴリ'), h('select', { onchange: (e) => { name = e.target.value; } },
            CATEGORY_NAMES.map((n) => h('option', { value: n, selected: n === name }, n)))),
          time('startTime', '第1試合の開始'),
          h('label', { class: 'field' }, h('span', null, '試合の形'), h('select', { onchange: (e) => { f.periods = Number(e.target.value); draw(); } },
            [[2, '前後半'], [1, 'ハーフなし'], [3, '3ピリオド']].map(([v, l]) => h('option', { value: v, selected: (f.periods || 2) === v }, l)))),
          num('halfMinutes', (f.periods || 2) === 1 ? '試合時間（分）' : (f.periods || 2) === 2 ? '前後半（各・分）' : '1ピリオド（分）', { min: 1, max: 90 }),
          (f.periods || 2) > 1 ? num('halftimeMinutes', (f.periods || 2) === 2 ? 'ハーフタイム（分）' : 'ピリオド間の休憩（分）', { max: 30 }) : null,
          num('intervalMinutes', '試合間隔（分）', { max: 60 }),
          num('courts', 'コート数', { min: 1, max: 12 }),
          h('label', { class: 'field' }, h('span', null, '連戦を避ける'), h('select', { onchange: (e) => { f.minRestSlots = Number(e.target.value); } },
            [[0, '避けない'], [1, '1試合分は休む'], [2, '2試合分は休む']].map(([v, l]) => h('option', { value: v, selected: f.minRestSlots === v }, l))))),
        h('label', { class: 'field', style: { marginTop: '12px' } }, h('span', null, 'コート名（カンマ区切り・空欄なら Aコート, Bコート…）'),
          h('input', { type: 'text', value: (f.courtNames || []).join(', '), placeholder: '例: 第1コート, 第2コート', oninput: (e) => { f.courtNames = e.target.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean); } })),
        h('div', { style: { marginTop: '12px' } }, summary)),
      h('section', { class: 'panel' },
        h('h2', { style: { marginBottom: '8px' } }, '昼休憩'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.lunchEnabled, onchange: (e) => { f.lunchEnabled = e.target.checked; draw(); } }), '昼休憩をとる'),
        f.lunchEnabled ? h('div', { class: 'grid-form' },
          time('lunchStart', '昼休憩の開始めやす'),
          num('lunchMinutes', '昼休憩（分）', { max: 180 }),
          num('minLunchMinutes', '短縮時の最低（分）', { max: 180 })) : null,
        f.lunchEnabled ? h('p', { class: 'muted small', style: { marginBottom: 0 } }, '開始めやすの時刻をまたぐ試合は、昼休憩の後に回します。当日の遅れで昼休憩を短くするときも、最低の時間は残します。') : null),
      h('section', { class: 'panel' },
        h('h2', { style: { marginBottom: '12px' } }, '形式'),
        h('div', { class: 'grid-form' },
          h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', null, '形式'), h('select', { onchange: (e) => { f.format = e.target.value; draw(); } },
            Object.entries(FORMAT_LABEL).map(([v, l]) => h('option', { value: v, selected: f.format === v }, l)))),
          f.format !== 'knockout' ? num('groups', '組の数', { min: 1, max: 16 }) : null,
          f.format === 'knockout' ? h('label', { class: 'field', style: { gridColumn: 'span 2' } }, h('span', null, '順位の決め方'), h('select', { onchange: (e) => { f.rankMode = e.target.value; } },
            Object.entries(RANK_LABEL).map(([v, l]) => h('option', { value: v, selected: f.rankMode === v }, l)))) : null),
        f.format === 'league_knockout' ? knockoutPlanPanel(f, cat, draw) : null,
        f.format !== 'knockout' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.showStandings, onchange: (e) => { f.showStandings = e.target.checked; } }), '閲覧ページに順位表を表示する') : null,
        h('p', { class: 'muted small' }, '形式・組の数・コート数を変えた場合は「組み分け・日程」で日程を作り直してください。')),
      dayPanel(f, cat, t, draw),
      f.format !== 'knockout' ? h('section', { class: 'panel' },
        h('h2', { style: { marginBottom: '4px' } }, '勝点が並んだときの判定順'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, '勝点は 勝ち3・引き分け1・負け0 です。上から順に比べます。'),
        h('div', { class: 'stack' }, f.tiebreak.map((k, i) => h('div', { class: 'row', style: { padding: '4px 0', borderBottom: '1px solid var(--line)' } },
          h('span', { class: 'num', style: { width: '24px', fontWeight: 700 } }, i + 1), h('span', null, TIEBREAK_LABEL[k]), h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': '上へ', disabled: i === 0, onclick: () => { [f.tiebreak[i - 1], f.tiebreak[i]] = [f.tiebreak[i], f.tiebreak[i - 1]]; draw(); } }, '↑'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': '下へ', disabled: i === f.tiebreak.length - 1, onclick: () => { [f.tiebreak[i + 1], f.tiebreak[i]] = [f.tiebreak[i], f.tiebreak[i + 1]]; draw(); } }, '↓')))),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { f.tiebreak = ['points', 'gd', 'gf', 'h2h', 'lottery']; draw(); } }, '総合成績優先に戻す'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { f.tiebreak = ['points', 'h2h', 'gd', 'gf', 'lottery']; draw(); } }, '当該対戦優先にする')),
        h('div', { class: 'grid-form', style: { marginTop: '12px' } },
          h('label', { class: 'field' }, h('span', null, '不戦勝のスコア（勝ち）'), h('input', { type: 'number', min: 0, max: 20, value: f.forfeitScore[0], oninput: (e) => { f.forfeitScore[0] = Number(e.target.value); } })),
          h('label', { class: 'field' }, h('span', null, '不戦勝のスコア（負け）'), h('input', { type: 'number', min: 0, max: 20, value: f.forfeitScore[1], oninput: (e) => { f.forfeitScore[1] = Number(e.target.value); } })))) : null,
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          const r = await run(() => api('PATCH', `/api/admin/categories/${cat.id}`, { name, config: { ...f, _touched: undefined } }));
          if (r) { toast(r.retimed ? '保存し、全試合の開始時刻を再計算しました' : '保存しました'); await reload(); }
        } }, '設定を保存'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => saveTemplate(f) }, 'テンプレートとして保存'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => applyTemplate(f, draw) }, 'テンプレートを読み込む'),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
          if (!(await confirmDialog(`${cat.name}を削除します`, 'このカテゴリのチーム・日程・結果がすべて消えます。', '削除する', true))) return;
          if (await run(() => api('DELETE', `/api/admin/categories/${cat.id}`), '削除しました')) { st.catId = null; await reload(); }
        } }, 'カテゴリを削除')),
      !editable ? h('p', { class: 'notice', style: { marginTop: '12px' } }, '開催中は、試合時間などを変えても組み合わせ済みの開始時刻は変わりません。当日の時間調整は「結果」または「組み分け・日程」から行ってください。') : null);
    draw();
    return box;
  }

  function saveTemplate(f) {
    const nm = h('input', { type: 'text', placeholder: '例: U10 4組リーグ＋クロス' });
    modal({ title: 'テンプレートとして保存', content: h('label', { class: 'field' }, h('span', null, 'テンプレート名'), nm),
      actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '保存', kind: 'btn-primary', onClick: async () => {
        const r = await run(() => api('POST', '/api/admin/templates', { name: nm.value, config: f }), 'テンプレートを保存しました');
        templates = null;
        return r ? undefined : true;
      } }] });
  }

  async function applyTemplate(f, redraw) {
    const tpls = await run(getTemplates);
    if (!tpls) return;
    if (!tpls.length) return toast('保存されたテンプレートはありません', true);
    const list = h('div', null, tpls.map((x) => h('div', { class: 'row', style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
      h('div', null, h('strong', null, x.name), h('div', { class: 'muted small' }, `${FORMAT_LABEL[x.config.format] || ''}　${(x.config.periods || 2) === 1 ? `1本${x.config.halfMinutes}分` : (x.config.periods || 2) === 2 ? `前後半${x.config.halfMinutes}分` : `${x.config.halfMinutes}分×3ピリオド`}`)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { Object.assign(f, JSON.parse(JSON.stringify(x.config))); dlg.close(); redraw(); toast('読み込みました。「設定を保存」で反映されます'); } }, '読み込む'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => {
        if (await run(() => api('DELETE', `/api/admin/templates/${x.id}`), '削除しました')) { templates = null; dlg.close(); }
      } }, '削除'))));
    const dlg = modal({ title: 'テンプレートを読み込む', content: list, actions: [{ label: '閉じる', kind: 'btn-ghost' }] });
  }

  // ----- チーム -----

  function teamsView(t, cat, editable) {
    const bulk = h('textarea', { placeholder: '1行に1チーム\n例:\nさくらFC A, さくらFC\nさくらFC B, さくらFC\n青空SC' });
    return h('div', null,
      h('section', { class: 'panel' },
        h('h2', { style: { marginBottom: '8px' } }, 'チームを追加'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, '「チーム名, クラブ名」と書くとクラブも登録できます。同じクラブのチームは組み分けで別の組になります。'),
        bulk,
        h('button', { class: 'btn btn-primary', type: 'button', style: { marginTop: '8px' }, onclick: async () => {
          const teams = bulk.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const [name, club] = l.split(/[,、\t]/).map((s) => s.trim());
            return { name, club: club || null };
          });
          if (await run(() => api('POST', `/api/admin/categories/${cat.id}/teams`, { teams }), `${teams.length}チームを追加しました`)) await reload();
        } }, 'チームを追加')),
      h('section', { class: 'panel' },
        h('h2', { style: { marginBottom: '8px' } }, `登録チーム（${cat.teams.length}）`),
        cat.teams.length ? cat.teams.map((tm) => h('div', { class: 'row', style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
          tm.logo ? h('img', { src: tm.logo, alt: '', width: 28, height: 28, style: { objectFit: 'contain', borderRadius: '50%' } }) : null,
          h('strong', null, tm.name),
          tm.club ? h('span', { class: 'muted small' }, tm.club) : null,
          tm.group_label ? h('span', { class: 'tag' }, `${tm.group_label}組`) : null,
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editTeam(tm) }, '編集'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => {
            const scheduled = cat.matches.length > 0;
            if (!editable && scheduled) return toast('開催中は日程に入っているチームを削除できません', true);
            if (!(await confirmDialog(`${tm.name}を削除します`, scheduled ? 'このカテゴリの日程は作り直しが必要になります（今の日程は消えます）。' : '削除してよろしいですか。', '削除する', true))) return;
            if (await run(() => api('DELETE', `/api/admin/teams/${tm.id}`), '削除しました')) await reload();
          } }, '削除')))
          : h('p', { class: 'empty' }, 'まだチームがありません')));
  }

  function editTeam(tm) {
    const f = { name: tm.name, short_name: tm.short_name || '', club: tm.club || '', logo: tm.logo };
    const img = h('div');
    const drawImg = () => mount(img, f.logo ? h('div', { class: 'row' }, h('img', { src: f.logo, alt: '', width: 48, height: 48, style: { objectFit: 'contain' } }),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { f.logo = null; drawImg(); } }, 'ロゴを外す')) : null);
    drawImg();
    modal({
      title: 'チームを編集',
      content: h('div', { class: 'stack' },
        h('label', { class: 'field' }, h('span', null, 'チーム名'), h('input', { type: 'text', value: f.name, oninput: (e) => { f.name = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '略称（関係者の更新表示などに使用）'), h('input', { type: 'text', value: f.short_name, oninput: (e) => { f.short_name = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, 'クラブ名'), h('input', { type: 'text', value: f.club, oninput: (e) => { f.club = e.target.value; } })),
        h('div', null, h('span', { class: 'small', style: { fontWeight: 700 } }, 'ロゴ'), img,
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', 'aria-label': 'チームロゴの画像', onchange: async (e) => {
            const v = await run(() => resizeImage(e.target.files[0], 160));
            if (v) { f.logo = v; drawImg(); }
          } }))),
      actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '保存', kind: 'btn-primary', onClick: async () => {
        if (await run(() => api('PATCH', `/api/admin/teams/${tm.id}`, f), '保存しました')) await reload();
      } }],
    });
  }

  // ----- 組み分け・日程 -----

  function scheduleTab(t, cat, editable) {
    const box = h('div');
    if (!editable) {
      box.append(h('p', { class: 'notice' }, t.status === 'live'
        ? '開催中は組み合わせを変更できません。遅れが出たら、遅らせたい試合をタップすると、そのコートの以降の試合をまとめてずらせます。'
        : '終了した大会は変更できません。'));
    } else {
      if (cat.config.format !== 'knockout') box.append(constraintsPanel(cat));
      box.append(groupingPanel(cat));
    }
    if (cat.matches.length) {
      const names = teamMap(cat);
      box.append(h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, '現在の日程'), h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm no-print', type: 'button', onclick: () => window.print() }, '印刷する')),
        editable ? h('p', { class: 'muted small no-print', style: { marginTop: 0 } }, '試合をタップして選び、移動先の枠をタップすると入れ替わります。開始時刻を全体でずらすときは「設定」の第1試合の開始を変更してください。') : null,
        warningsList(cat.warnings),
        h('div', { class: 'table-wrap' }, scheduleGrid(cat, cat.matches, {
          editable,
          live: t.status === 'live',
          onPick: async (m, slot, court) => {
            if (t.status === 'live') { if (m && m.status === 'none') openDelay(cat, m); return; }
            if (!editable) return;
            if (!st.moveSel) { if (m) { st.moveSel = m.id; render(); } return; }
            if (m && m.id === st.moveSel) { st.moveSel = null; render(); return; }
            const matchId = st.moveSel;
            st.moveSel = null;
            if (await run(() => api('POST', `/api/admin/categories/${cat.id}/move`, { matchId, slot, court }), '移動しました')) await reload();
            else render();
          },
          names,
        }))));
    }
    return box;
  }

  function warningsList(ws) {
    if (!ws || !ws.length) return null;
    return h('div', { class: 'stack', style: { marginBottom: '10px' } }, ws.map((w) => h('p', { class: `notice${w.level === 'error' ? ' error' : ''}`, style: { margin: 0 } }, w.text)));
  }

  function constraintsPanel(cat) {
    const g = cat.config.grouping || { fixed: {}, separate: [] };
    const labels = Array.from({ length: cat.config.groups }, (_, i) => String.fromCharCode(65 + i));
    const tm = teamMap(cat);
    const save = async (grouping) => {
      if (await run(() => api('PATCH', `/api/admin/categories/${cat.id}`, { config: { grouping } }), '保存しました')) await reload();
    };
    const fixTeam = h('select', null, h('option', { value: '' }, 'チームを選ぶ'), cat.teams.map((x) => h('option', { value: x.id }, x.name)));
    const fixGroup = h('select', null, labels.map((l) => h('option', { value: l }, `${l}組`)));
    const sepA = h('select', null, h('option', { value: '' }, 'チームを選ぶ'), cat.teams.map((x) => h('option', { value: x.id }, x.name)));
    const sepB = h('select', null, h('option', { value: '' }, 'チームを選ぶ'), cat.teams.map((x) => h('option', { value: x.id }, x.name)));
    return h('details', { class: 'panel', open: Object.keys(g.fixed || {}).length || (g.separate || []).length ? true : null },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, '組み分けの条件（主催チームの固定・同組NG）'),
      h('div', { class: 'stack', style: { marginTop: '12px' } },
        h('p', { class: 'muted small', style: { margin: 0 } }, '同じクラブ名のチームは自動的に別の組になります。'),
        h('h3', null, '組を固定するチーム'),
        Object.entries(g.fixed || {}).map(([tid, gl]) => h('div', { class: 'row' }, h('span', null, `${tm[tid]?.name || '（削除済み）'} → ${gl}組`), h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { const fixed = { ...g.fixed }; delete fixed[tid]; save({ ...g, fixed }); } }, '外す'))),
        h('div', { class: 'row' }, h('div', { style: { flex: '2 1 160px' } }, fixTeam), h('div', { style: { flex: '1 1 80px' } }, fixGroup),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { if (fixTeam.value) save({ ...g, fixed: { ...g.fixed, [fixTeam.value]: fixGroup.value } }); } }, '追加')),
        h('h3', null, '同じ組にしない組み合わせ'),
        (g.separate || []).map(([a, b], i) => h('div', { class: 'row' }, h('span', null, `${tm[a]?.name || '-'} と ${tm[b]?.name || '-'}`), h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => save({ ...g, separate: g.separate.filter((_, j) => j !== i) }) }, '外す'))),
        h('div', { class: 'row' }, h('div', { style: { flex: '1 1 140px' } }, sepA), h('div', { style: { flex: '1 1 140px' } }, sepB),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { if (sepA.value && sepB.value && sepA.value !== sepB.value) save({ ...g, separate: [...(g.separate || []), [sepA.value, sepB.value]] }); } }, '追加'))));
  }

  function groupingPanel(cat) {
    const ko = cat.config.format === 'knockout';
    const tm = teamMap(cat);
    const labels = Array.from({ length: cat.config.groups }, (_, i) => String.fromCharCode(65 + i));
    let d = st.drafts[cat.id];
    if (!d) {
      if (ko) {
        const order = cat.teams.map((x) => x.id);
        d = { order, warnings: [] };
      } else if (cat.teams.some((x) => x.group_label)) {
        d = { assignment: Object.fromEntries(cat.teams.map((x) => [x.id, x.group_label || labels[0]])), warnings: [] };
      }
    }
    const preview = st.preview[cat.id];
    const panel = h('section', { class: 'panel' });

    const randomize = async () => {
      const r = await run(() => api('POST', `/api/admin/categories/${cat.id}/grouping`));
      if (!r) return;
      st.drafts[cat.id] = ko ? { order: r.order, warnings: [] } : { assignment: r.assignment, warnings: r.warnings };
      delete st.preview[cat.id];
      render();
    };
    const makePreview = async () => {
      const body = ko ? { order: d.order, dryRun: true } : { assignment: d.assignment, dryRun: true };
      const r = await run(() => api('POST', `/api/admin/categories/${cat.id}/generate`, body));
      if (r) { st.drafts[cat.id] = d; st.preview[cat.id] = r; render(); }
    };
    const apply = async () => {
      if (cat.matches.some((m) => m.status !== 'none') && !(await confirmDialog('日程を作り直します', '登録済みの結果はすべて消えます。', '作り直す', true))) return;
      const body = ko ? { order: d.order } : { assignment: d.assignment };
      const r = await run(() => api('POST', `/api/admin/categories/${cat.id}/generate`, body), '日程を反映しました');
      if (r) { delete st.preview[cat.id]; delete st.drafts[cat.id]; await reload(); }
    };

    const groupsView = () => {
      if (ko) {
        return h('div', null,
          h('p', { class: 'muted small' }, '上から順にトーナメントの枠に入ります（1番と最後が逆の山）。チーム数が2・4・8・16でない場合は上位に不戦（シード）が入ります。'),
          d.order.map((tid, i) => h('div', { class: 'row', style: { padding: '4px 0', borderBottom: '1px solid var(--line)' } },
            h('span', { class: 'num', style: { width: '28px', fontWeight: 700 } }, i + 1), h('span', null, tm[tid]?.name), h('span', { class: 'spacer' }),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': '上へ', disabled: i === 0, onclick: () => { [d.order[i - 1], d.order[i]] = [d.order[i], d.order[i - 1]]; st.drafts[cat.id] = d; delete st.preview[cat.id]; render(); } }, '↑'),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': '下へ', disabled: i === d.order.length - 1, onclick: () => { [d.order[i + 1], d.order[i]] = [d.order[i], d.order[i + 1]]; st.drafts[cat.id] = d; delete st.preview[cat.id]; render(); } }, '↓'))));
      }
      const by = Object.fromEntries(labels.map((l) => [l, []]));
      for (const x of cat.teams) (by[d.assignment[x.id]] ||= []).push(x);
      return h('div', { class: 'grid-form', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } },
        Object.keys(by).sort().map((l) => h('div', { class: 'panel', style: { padding: '10px' } },
          h('h3', { style: { marginBottom: '6px' } }, `${l}組（${by[l].length}）`),
          by[l].map((x) => h('div', { class: 'row', style: { padding: '2px 0' } }, h('span', { style: { flex: 1 } }, x.name),
            h('select', { style: { width: '76px', minHeight: '34px', padding: '2px' }, 'aria-label': `${x.name}の組`, onchange: (e) => { d.assignment[x.id] = e.target.value; st.drafts[cat.id] = d; delete st.preview[cat.id]; render(); } },
              labels.map((o) => h('option', { value: o, selected: o === l }, `${o}組`))))))));
    };

    mount(panel,
      h('div', { class: 'panel-head' }, h('h2', null, ko ? 'トーナメントの組み合わせ' : '組み分け'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: randomize, disabled: cat.teams.length < 2 }, ko ? 'ランダムに抽選' : 'ランダムに組み分け')),
      cat.teams.length < 2 ? h('p', { class: 'empty' }, '先に「チーム」でチームを登録してください') : null,
      d ? warningsList((d.warnings || []).map((text) => ({ level: 'warn', text }))) : null,
      d ? groupsView() : cat.teams.length >= 2 ? h('p', { class: 'muted' }, '「ランダムに組み分け」を押すと、条件を守って組を決めます。決まった後で手動でも変更できます。') : null,
      d ? h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primary', type: 'button', onclick: makePreview }, '日程を作成して確認')) : null,
      preview ? h('div', { style: { marginTop: '16px' } },
        h('h3', { style: { marginBottom: '6px' } }, '日程の確認（まだ反映されていません）'),
        warningsList(preview.warnings),
        h('div', { class: 'table-wrap' }, scheduleGrid(cat, preview.matches, { names: tm, editable: false, breaks: preview.dayBreakSlots })),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: apply }, 'この内容で反映'),
          h('button', { class: 'btn', type: 'button', onclick: () => { delete st.preview[cat.id]; render(); } }, 'やり直す'))) : null);
    return panel;
  }

  function scheduleGrid(cat, matches, opts) {
    const cfg = opts.breaks ? { ...cat.config, dayBreakSlots: opts.breaks } : cat.config;
    const multi = dayTotal(cfg) > 1;
    let prevDay = -1;
    const cache = { teams: opts.names || teamMap(cat), codes: Object.fromEntries(matches.filter((m) => m.code).map((m) => [m.code, m])) };
    const fakeCat = { ...cat, matches };
    const slots = [...new Set(matches.map((m) => m.slot))].sort((a, b) => a - b);
    if (opts.editable && st.moveSel) slots.push((slots[slots.length - 1] ?? -1) + 1);
    const warnIds = new Set((cat.warnings || []).flatMap((w) => w.ids || []));
    const rows = [];
    let prevSession = null;
    for (const s of slots) {
      const inSlot = matches.filter((m) => m.slot === s);
      const d = dayOf(cfg, s);
      if (multi && d !== prevDay) {
        rows.push(h('tr', { class: 'day-row' }, h('td', { colspan: cfg.courts + 1 }, dayLabel({ ...cat, config: cfg }, d, data.tournament))));
        prevSession = null;
      }
      prevDay = d;
      const session = inSlot[0]?.session || prevSession;
      if (prevSession === 'am' && session === 'pm') rows.push(h('tr', { class: 'lunch' }, h('td', { colspan: cfg.courts + 1 }, '昼休憩')));
      prevSession = session;
      const rowTime = inSlot.length ? Math.min(...inSlot.map((m) => m.start_min)) : null;
      rows.push(h('tr', null,
        h('td', { class: 't' }, rowTime != null ? toHHMM(rowTime) : '追加'),
        Array.from({ length: cfg.courts }, (_, c) => {
          const m = inSlot.find((x) => x.court === c);
          if (!m) {
            return h('td', null, opts.editable && st.moveSel
              ? h('button', { class: 'cell empty-cell', type: 'button', onclick: () => opts.onPick(null, s, c) }, 'ここへ移動')
              : h('div', { class: 'cell empty-cell', style: { cursor: 'default' } }, '－'));
          }
          const home = sideInfo(m, 'home', fakeCat, cache).text;
          const away = sideInfo(m, 'away', fakeCat, cache).text;
          const sc = m.status !== 'none' && m.home_score != null ? `　${m.home_score}-${m.away_score}` : '';
          const clickable = opts.onPick && (opts.editable || (opts.live && m.status === 'none'));
          return h('td', null, h(clickable ? 'button' : 'div', {
            class: `cell${st.moveSel === m.id ? ' selected' : ''}${warnIds.has(m.id) ? ' warn' : ''}`,
            type: clickable ? 'button' : null,
            onclick: clickable ? () => opts.onPick(m, s, c) : null,
            'aria-pressed': clickable && opts.editable ? String(st.moveSel === m.id) : null,
          },
          h('span', { class: 'cl' }, `${m.label}${m.start_min !== rowTime || m.time_changed ? `　${toHHMM(m.start_min)}` : ''}${m.status === 'confirmed' ? '　確定' : m.status === 'provisional' ? '　仮登録' : ''}`),
          `${home} - ${away}${sc}`));
        })));
    }
    return h('table', { class: 'sched' },
      h('thead', null, h('tr', null, h('th', null, '時刻'), Array.from({ length: cfg.courts }, (_, c) => h('th', null, courtName(cfg, c))))),
      h('tbody', null, rows));
  }

  // ----- 当日の遅延調整 -----

  function openDelay(cat, m) {
    const content = h('div');
    let minutes = 10;
    const names = teamMap(cat);
    const step1 = () => mount(content,
      h('p', { style: { marginTop: 0 } }, `${courtName(cat.config, m.court)}の ${toHHMM(m.start_min)}「${sideInfo(m, 'home', cat, { teams: names, codes: codeMap(cat) }).text} - ${sideInfo(m, 'away', cat, { teams: names, codes: codeMap(cat) }).text}」以降の試合をまとめてずらします。`),
      h('div', { class: 'row' }, [-10, -5, 5, 10, 15, 20, 30].map((v) => h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': String(v === minutes), onclick: () => { minutes = v; step1(); } }, v > 0 ? `+${v}分` : `${v}分`))),
      h('label', { class: 'field', style: { marginTop: '12px' } }, h('span', null, 'ずらす時間（分・マイナスで前倒し）'),
        h('input', { type: 'number', value: minutes, min: -240, max: 240, oninput: (e) => { minutes = Number(e.target.value); } })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, 'キャンセル'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: check }, '確認する')));

    const check = async () => {
      const r = await run(() => api('POST', `/api/admin/categories/${cat.id}/delay`, { matchId: m.id, minutes, dryRun: true }));
      if (!r) return;
      if (r.needsLunchChoice) return lunchChoice(r.options);
      mount(content,
        h('p', { style: { marginTop: 0 } }, `${r.changes.length}試合の開始時刻を${minutes > 0 ? `${minutes}分遅らせます` : `${-minutes}分早めます`}。`),
        warningsList(r.warnings),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: step1 }, '戻る'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => applyDelay() }, 'ずらす')));
    };

    const lunchChoice = (o) => mount(content,
      h('p', { style: { marginTop: 0 } }, 'この変更は昼休憩にかかります。どちらにしますか。'),
      h('button', { class: 'choice', type: 'button', onclick: () => applyDelay('shorten') },
        h('strong', null, '昼休憩を短くする'),
        h('span', null, `昼休憩 ${o.shorten.lunchBefore}分 → ${o.shorten.lunch}分、午後の開始 ${toHHMM(o.shorten.pmStart)}${o.shorten.pmShift ? `（${o.shorten.pmShift}分遅れ）` : '（定刻）'}`),
        warningsList(o.shorten.warnings)),
      h('button', { class: 'choice', type: 'button', onclick: () => applyDelay('shift') },
        h('strong', null, '午後の試合もずらす'),
        h('span', null, `昼休憩 ${o.shift.lunch}分のまま、午後の開始 ${toHHMM(o.shift.pmStart - o.shift.pmShift)} → ${toHHMM(o.shift.pmStart)}`),
        warningsList(o.shift.warnings)),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: step1 }, '戻る')));

    const applyDelay = async (lunchMode) => {
      const r = await run(() => api('POST', `/api/admin/categories/${cat.id}/delay`, { matchId: m.id, minutes, lunchMode }));
      if (r) { toast(`${r.changed}試合の時刻を変更しました`); dlg.close(); await reload(); }
    };

    const dlg = modal({ title: '試合の時間をずらす', content });
    step1();
  }

  // ----- 結果 -----

  function resultsTab(t, cat) {
    const cache = { teams: teamMap(cat), codes: codeMap(cat) };
    const len = matchLength(cat.config);
    const today = todayStr();
    const filters = [['pending', '要対応'], ['provisional', '仮登録'], ['all', 'すべて'], ['confirmed', '確定済み']];
    const overdue = (m) => t.status === 'live' && m.status !== 'confirmed' && (() => {
      const date = dayDate(cat, dayOf(cat.config, m.slot), t);
      return date && (date < today || (date === today && nowMin() >= m.start_min + len));
    })();
    const list = [...cat.matches].sort((a, b) => absMin(cat.config, a) - absMin(cat.config, b) || a.court - b.court).filter((m) => {
      if (st.resultFilter === 'pending') return m.status !== 'confirmed';
      if (st.resultFilter === 'provisional') return m.status === 'provisional';
      if (st.resultFilter === 'confirmed') return m.status === 'confirmed';
      return true;
    });
    const provisional = cat.matches.filter((m) => m.status === 'provisional');
    const picked = new Set(provisional.map((m) => m.id));

    return h('div', null,
      t.status !== 'live' && t.status !== 'finished' ? h('p', { class: 'notice' }, '大会当日は「大会の状態」を「開催中」にしてください。確定待ちの強調表示と時間調整が使えるようになります。') : null,
      h('div', { class: 'chips' }, filters.map(([k, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.resultFilter === k), onclick: () => { st.resultFilter = k; render(); } }, label))),
      provisional.length ? h('section', { class: 'panel', style: { marginTop: '8px' } },
        h('div', { class: 'row' },
          h('strong', null, `仮登録が ${provisional.length} 試合あります`),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
            const r = await run(() => api('POST', `/api/admin/categories/${cat.id}/confirm`, { matchIds: [...picked] }));
            if (r) { toast(r.skipped ? `${r.confirmed}試合を確定しました（PK未入力の${r.skipped}試合は確定していません）` : `${r.confirmed}試合を確定しました`); await reload(); }
          } }, 'チェックした試合をまとめて確定')),
        h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, '下の一覧のチェックを外した試合は確定されません。')) : null,
      h('div', { style: { marginTop: '10px' } }, list.length ? list.map((m) => resultRow(t, cat, m, cache, overdue(m), picked))
        : h('p', { class: 'empty' }, st.resultFilter === 'pending' ? 'すべての試合が確定しています' : '該当する試合はありません')));
  }

  function resultRow(t, cat, m, cache, isOverdue, picked) {
    const home = sideInfo(m, 'home', cat, cache);
    const away = sideInfo(m, 'away', cat, cache);
    const ready = !home.placeholder && !away.placeholder;
    const locked = m.status === 'confirmed';
    let editing = !locked;
    const f = { home_score: m.home_score ?? '', away_score: m.away_score ?? '', home_pk: m.home_pk ?? '', away_pk: m.away_pk ?? '', forfeit: m.forfeit || '' };
    const row = h('div', { class: `result-row${isOverdue ? ' overdue' : ''}${m.status === 'provisional' ? ' provisional' : ''}${m.ref_conflict ? ' conflict' : ''}` });

    const draw = () => {
      const isKo = m.stage === 'knockout';
      const tie = f.home_score !== '' && String(f.home_score) === String(f.away_score);
      const numIn = (key, cls, label) => h('input', { type: 'number', min: 0, max: 99, inputmode: 'numeric', class: cls, value: f[key], disabled: !editing || !ready || !!f.forfeit, 'aria-label': label,
        oninput: (e) => { f[key] = e.target.value; if (key === 'home_score' || key === 'away_score') { const pkNow = f.home_score !== '' && String(f.home_score) === String(f.away_score); if (pkNow !== tie) draw(); } } });
      const save = async (confirm) => {
        const r = await run(() => api('POST', `/api/admin/matches/${m.id}/result`, { ...f, forfeit: f.forfeit || null, confirm }), confirm ? '確定しました' : '保存しました');
        if (r) await reload();
      };
      mount(row,
        h('div', { class: 'rl' },
          m.status === 'provisional' ? h('input', { type: 'checkbox', checked: picked.has(m.id), 'aria-label': 'まとめて確定の対象', style: { width: '20px', height: '20px', accentColor: 'var(--pitch)' },
            onchange: (e) => { if (e.target.checked) picked.add(m.id); else picked.delete(m.id); } }) : null,
          h('div', { class: 'rt' }, toHHMM(m.start_min)),
          h('div', { class: 'muted small' }, courtName(cat.config, m.court))),
        h('div', { class: 'ri' },
          h('div', { class: 'row small' },
            dayTotal(cat.config) > 1 ? h('span', { class: 'tag' }, dayLabel(cat, dayOf(cat.config, m.slot), t, true)) : null,
            h('span', null, m.label),
            locked ? h('span', { class: 'tag done' }, '確定') : m.status === 'provisional' ? h('span', { class: 'tag wait' }, `仮登録：${m.updated_by || ''} ${formatUpdated(m.updated_at)}`) : h('span', { class: 'tag' }, '未登録'),
            isOverdue ? h('span', { class: 'tag alert' }, '確定待ち') : null,
            m.time_changed ? h('span', { class: 'tag changed' }, '時間変更') : null,
            m.corrected ? h('span', { class: 'tag' }, '修正済み') : null,
            m.ref_conflict ? h('span', { class: 'tag alert' }, '予選結果の変更で対戦チームが変わっています。結果を見直してください') : null),
          h('div', { class: 'rs' },
            h('strong', { class: 'rn', style: { textAlign: 'right', color: home.placeholder ? 'var(--ink-2)' : null } }, home.text),
            numIn('home_score', '', `${home.text}の得点`), h('span', null, '-'), numIn('away_score', '', `${away.text}の得点`),
            h('strong', { class: 'rn', style: { color: away.placeholder ? 'var(--ink-2)' : null } }, away.text)),
          isKo && tie && ready && !f.forfeit ? h('div', { class: 'rs small' }, h('span', null, 'PK'), numIn('home_pk', 'pk', 'PK（左）'), h('span', null, '-'), numIn('away_pk', 'pk', 'PK（右）')) : null,
          ready ? h('div', { class: 'rs' },
            editing ? h('select', { style: { width: 'auto', minHeight: '36px' }, 'aria-label': '不戦勝', onchange: (e) => { f.forfeit = e.target.value; draw(); } },
              h('option', { value: '' }, '通常の試合'),
              h('option', { value: 'home', selected: f.forfeit === 'home' }, `${home.text} の不戦勝`),
              h('option', { value: 'away', selected: f.forfeit === 'away' }, `${away.text} の不戦勝`)) : null,
            h('span', { class: 'spacer' }),
            editing ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => save(true) }, locked ? '修正を確定' : 'この結果で確定') : null,
            !locked && editing && m.status === 'none' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => save(false) }, '仮で保存') : null,
            locked && !editing ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { editing = true; draw(); } }, '修正する') : null,
            locked ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => {
              if (!(await confirmDialog('確定を取り消します', '閲覧ページから結果が消え、仮登録に戻ります。', '取り消す', true))) return;
              if (await run(() => api('POST', `/api/admin/matches/${m.id}/reopen`), '仮登録に戻しました')) await reload();
            } }, '確定を取り消す') : null,
            m.status === 'provisional' ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => {
              if (await run(() => api('POST', `/api/admin/matches/${m.id}/clear`), '未登録に戻しました')) await reload();
            } }, '入力を消す') : null,
            t.status === 'live' && m.status === 'none' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openDelay(cat, m) }, '時間をずらす') : null)
            : h('p', { class: 'muted small', style: { margin: 0 } }, '対戦チームが決まると入力できます')));
    };
    draw();
    return row;
  }

  // ----- 順位 -----

  function standingsTab(t, cat) {
    const tm = teamMap(cat);
    const lotteryPanels = Object.entries(cat.standings || {}).filter(([, s]) => s.needsLottery || s.rows.some((r) => r.lottery)).map(([g, s]) => {
      const order = s.rows.filter((r) => r.tied || r.lottery).map((r) => r.teamId);
      const list = h('div', { class: 'stack' });
      const drawList = () => mount(list, order.map((tid, i) => h('div', { class: 'row' },
        h('span', { class: 'num', style: { width: '28px', fontWeight: 700 } }, i + 1), h('span', null, tm[tid]?.name), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': '上へ', disabled: i === 0, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawList(); } }, '↑'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': '下へ', disabled: i === order.length - 1, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawList(); } }, '↓'))));
      drawList();
      return h('section', { class: 'panel' },
        h('h2', { style: { marginBottom: '6px' } }, `${g}組の抽選結果`),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, '並んだチームを、抽選の結果どおりの順番に並べて保存してください。'),
        list,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
            if (await run(() => api('POST', `/api/admin/categories/${cat.id}/lottery`, { group: g, order }), '抽選結果を保存しました')) await reload();
          } }, '抽選結果を保存'),
          s.rows.some((r) => r.lottery) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => {
            if (await run(() => api('POST', `/api/admin/categories/${cat.id}/lottery`, { group: g, order: [] }), '抽選結果を消しました')) await reload();
          } }, '抽選結果を消す') : null));
    });
    const ctx = { tournament: t, myTeam: null };
    return h('div', null,
      cat.config.format !== 'knockout' ? standingsView(cat, ctx) : null,
      lotteryPanels.length ? h('div', { style: { marginTop: '12px' } }, lotteryPanels) : null,
      cat.config.format !== 'league' ? h('section', { style: { marginTop: '16px' } }, h('h2', null, 'トーナメント'), bracketView(cat, ctx)) : null);
  }
}
