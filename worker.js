// 画面のファイル（HTML・CSS・JavaScript）はWorkerに同梱して配信する。
// これにより、すべてのファイルを1つのフォルダに並べたまま動かせる。
import INDEX_HTML from './index.html';
import APP_CSS from './app.css';
import MANIFEST from './manifest.webmanifest';
import WEB_APP from './web-app.js';
import WEB_API from './web-api.js';
import WEB_UI from './web-ui.js';
import WEB_VIEWS from './web-views.js';
import WEB_VIEWER from './web-viewer.js';
import WEB_RELATIVE from './web-relative.js';
import WEB_ADMIN from './web-admin.js';
import WEB_PRINT from './web-print.js';
import { normalizeConfig, matchLength } from './time.js';
import { assignGroups, shuffle } from './grouping.js';
import { generateCategory, applyTimes, planDelay, scheduleWarnings } from './schedule.js';
import { evaluateCategory } from './standings.js';
import { issueAdmin, isAdmin, issueRelative, isRelative, rateLimit, clearRateLimit, safeEqual, cookie } from './auth.js';

// ---------- 共通 ----------

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const randomSlug = (n = 10) => {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};
const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

const MAX_LOGO = 300_000;
function checkLogo(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(v)) fail(400, 'ロゴは PNG・JPEG・WebP・SVG の画像を選んでください');
  if (v.length > MAX_LOGO) fail(400, 'ロゴの画像が大きすぎます（300KBまで）');
  return v;
}

// 名前などの長さを制限する（表示崩れや極端に大きなデータを防ぐ）
const clip = (v, max = 100) => String(v ?? '').trim().slice(0, max);

const intOrNull = (v) => (v === '' || v == null ? null : Math.max(0, Math.min(99, Math.trunc(Number(v)))));

// ---------- データベースの項目の自動追加 ----------
// 新しい版で増えた項目を、初回アクセス時に自動で追加する（コンソールでの作業を不要にするため）
let schemaChecked = false;
async function ensureSchema(db) {
  if (schemaChecked) return;
  const cols = (await db.prepare('PRAGMA table_info(tournaments)').all()).results.map((c) => c.name);
  if (!cols.includes('end_date')) {
    try { await db.prepare('ALTER TABLE tournaments ADD COLUMN end_date TEXT').run(); }
    catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
  }
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map((r) => r.name);
  if (!tables.includes('sponsors') || !tables.includes('sponsor_clicks')) {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS sponsors (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
        image TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sponsors_tournament ON sponsors(tournament_id)'),
      db.prepare('CREATE TABLE IF NOT EXISTS sponsor_clicks (sponsor_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sponsor_id, day))'),
    ]);
  }
  schemaChecked = true;
}

// 開催期間（開始日〜終了日、最大4日）
const MAX_DAYS = 4;
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function tournamentDates(t) {
  if (!t.date) return [];
  const out = [t.date];
  if (t.end_date && t.end_date > t.date) {
    for (let i = 1; i < MAX_DAYS; i++) {
      const d = addDays(t.date, i);
      if (d > t.end_date) break;
      out.push(d);
    }
  }
  return out;
}
function checkRange(date, end) {
  if (!date) return null;
  if (!end || end === date) return null;
  if (end < date) fail(400, '終了日は開始日より後の日付にしてください');
  if (end > addDays(date, MAX_DAYS - 1)) fail(400, `開催期間は最大${MAX_DAYS}日までです`);
  return end;
}

// ---------- 書き込み ----------
// 大きな大会（300試合など）でも確実に保存できるよう、100件ずつに分けて実行する
async function batchAll(db, stmts, size = 100) {
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}

// ---------- 読み込み ----------

function parseMatch(r) {
  return { ...r, home_ref: r.home_ref ? JSON.parse(r.home_ref) : null, away_ref: r.away_ref ? JSON.parse(r.away_ref) : null };
}

async function getTournament(db, id) {
  const t = await db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first();
  if (!t) fail(404, '大会が見つかりません');
  return t;
}

async function getTournamentBySlug(db, slug) {
  const t = await db.prepare('SELECT * FROM tournaments WHERE slug = ?').bind(slug).first();
  if (!t) fail(404, '大会が見つかりません');
  return t;
}

// 20秒ごとの更新確認用。ロゴなどの大きな列を読まない
async function getTournamentHead(db, slug) {
  const t = await db.prepare('SELECT id, slug, status, rev, pin_version FROM tournaments WHERE slug = ?').bind(slug).first();
  if (!t) fail(404, '大会が見つかりません');
  return t;
}

async function getCategory(db, id) {
  const c = await db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
  if (!c) fail(404, 'カテゴリが見つかりません');
  c.config = normalizeConfig(JSON.parse(c.config));
  return c;
}

async function loadCategoryData(db, cid) {
  const [teams, matches] = await Promise.all([
    db.prepare('SELECT * FROM teams WHERE category_id = ? ORDER BY sort, name').bind(cid).all(),
    db.prepare('SELECT * FROM matches WHERE category_id = ? ORDER BY start_min, court').bind(cid).all(),
  ]);
  return { teams: teams.results, matches: matches.results.map(parseMatch) };
}

async function loadFull(db, t) {
  const cats = (await db.prepare('SELECT * FROM categories WHERE tournament_id = ? ORDER BY sort, created_at').bind(t.id).all()).results;
  const out = [];
  for (const c of cats) {
    c.config = normalizeConfig(JSON.parse(c.config));
    const { teams, matches } = await loadCategoryData(db, c.id);
    const ev = evaluateCategory(c.config, teams, matches);
    out.push({ id: c.id, name: c.name, sort: c.sort, config: c.config, teams, matches, standings: ev.standings, finalRanking: ev.finalRanking });
  }
  return out;
}

async function bump(db, tid) {
  await db.prepare('UPDATE tournaments SET rev = rev + 1, updated_at = ? WHERE id = ?').bind(now(), tid).run();
}

// 予選・トーナメントの結果から、まだ始まっていない試合のチームを差し替える
async function syncKnockout(db, cat) {
  const { teams, matches } = await loadCategoryData(db, cat.id);
  const ev = evaluateCategory(cat.config, teams, matches);
  const stmts = ev.updates.map((u) =>
    db.prepare('UPDATE matches SET home_team_id = ?, away_team_id = ? WHERE id = ?').bind(u.home_team_id, u.away_team_id, u.id));
  const conflict = new Set(ev.conflicts);
  for (const m of matches.filter((x) => x.stage === 'knockout')) {
    const flag = conflict.has(m.id) ? 1 : 0;
    if (flag !== m.ref_conflict) stmts.push(db.prepare('UPDATE matches SET ref_conflict = ? WHERE id = ?').bind(flag, m.id));
  }
  if (stmts.length) await batchAll(db, stmts);
}

// ---------- スポンサー ----------

const MAX_BANNER = 700_000;
function checkBanner(v) {
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(v)) fail(400, 'バナーは PNG・JPEG・WebP の画像を選んでください');
  if (v.length > MAX_BANNER) fail(400, 'バナーの画像が大きすぎます');
  return v;
}
function checkUrl(v) {
  const u = String(v || '').trim();
  if (u.length > 500) fail(400, 'リンク先のURLが長すぎます');
  if (!/^https?:\/\/[^\s]+$/i.test(u)) fail(400, 'リンク先は https:// から始まるURLを入力してください');
  return u;
}
const jstDay = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const sponsorImg = (sp) => `/img/s/${sp.id}?v=${encodeURIComponent(sp.updated_at)}`;

async function listSponsors(db, tid, withStats = false) {
  const rows = (await db.prepare('SELECT id, tournament_id, name, url, sort, active, created_at, updated_at FROM sponsors WHERE tournament_id = ? ORDER BY sort, created_at').bind(tid).all()).results;
  if (!withStats || !rows.length) return rows.map((r) => ({ ...r, img: sponsorImg(r) }));
  const today = jstDay();
  const stats = (await db.prepare(`SELECT sponsor_id, SUM(count) AS total, SUM(CASE WHEN day = ? THEN count ELSE 0 END) AS today
      FROM sponsor_clicks WHERE sponsor_id IN (SELECT id FROM sponsors WHERE tournament_id = ?) GROUP BY sponsor_id`).bind(today, tid).all()).results;
  const by = Object.fromEntries(stats.map((x) => [x.sponsor_id, x]));
  return rows.map((r) => ({ ...r, img: sponsorImg(r), clicks: by[r.id] ? by[r.id].total : 0, clicksToday: by[r.id] ? by[r.id].today : 0 }));
}
const publicSponsors = (list) => list.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, img: x.img }));

// /go/:id … クリック数を数えてからスポンサーのサイトへ移動する
async function sponsorRedirect(req, db, id) {
  const sp = await db.prepare('SELECT id, url FROM sponsors WHERE id = ?').bind(id).first();
  if (!sp) return new Response('見つかりません', { status: 404 });
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  // 同じ人の短時間の連打は1回に数える
  const rl = await rateLimit(db, `click:${id}:${ip}`, 1, 30);
  if (rl.ok) {
    await db.prepare('INSERT INTO sponsor_clicks (sponsor_id, day, count) VALUES (?, ?, 1) ON CONFLICT(sponsor_id, day) DO UPDATE SET count = count + 1').bind(id, jstDay()).run();
  }
  return new Response(null, { status: 302, headers: { Location: sp.url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'origin' } });
}

// /img/s/:id … バナー画像、/img/t/:id … 大会ロゴ、/img/team/:id … チームロゴ（ページのデータとは別に配信し、長くキャッシュする）
async function sponsorImage(db, id, kind = 's') {
  const q = kind === 's' ? 'SELECT image FROM sponsors WHERE id = ?'
    : kind === 't' ? 'SELECT logo AS image FROM tournaments WHERE id = ? AND show_logo = 1 AND status != \'draft\''
      : 'SELECT t.logo AS image FROM teams t JOIN categories c ON c.id = t.category_id JOIN tournaments x ON x.id = c.tournament_id WHERE t.id = ? AND x.show_logo = 1 AND x.status != \'draft\'';
  const sp = await db.prepare(q).bind(id).first();
  if (!sp || !sp.image) return new Response('見つかりません', { status: 404 });
  const m = sp.image.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return new Response('画像が正しくありません', { status: 500 });
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // SVG は画像としてのみ表示させ、直接開いてもスクリプトが動かないようにする
  return new Response(bytes, { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
}

// ---------- 公開用の整形 ----------

// 画像の内容が変わったら URL も変わるよう、短い目印を付ける（全体を計算すると重いので長さと末尾から作る）
function imgVersion(dataUrl) {
  let x = dataUrl.length;
  const tail = dataUrl.slice(-64);
  for (let i = 0; i < tail.length; i++) x = (x * 31 + tail.charCodeAt(i)) >>> 0;
  return x.toString(36);
}
const logoUrl = (kind, id, dataUrl) => (dataUrl ? `/img/${kind}/${id}?v=${imgVersion(dataUrl)}` : null);

function publicTournament(t, withPin = false) {
  const o = { id: t.id, slug: t.slug, name: t.name, date: t.date, end_date: t.end_date || null, venue: t.venue, logo: t.show_logo ? logoUrl('t', t.id, t.logo) : null, show_logo: t.show_logo, status: t.status, rev: t.rev };
  if (withPin) Object.assign(o, { logo: t.logo, pin: t.pin });
  return o;
}

function maskMatch(m, level) {
  // level: 'public' は確定のみスコアを出す、'relative' は仮登録も出す
  const base = {
    id: m.id, stage: m.stage, group_label: m.group_label, round: m.round, code: m.code, label: m.label,
    slot: m.slot, court: m.court, start_min: m.start_min, session: m.session,
    home_team_id: m.home_team_id, away_team_id: m.away_team_id, home_ref: m.home_ref, away_ref: m.away_ref,
    place_w: m.place_w, place_l: m.place_l, status: m.status, time_changed: m.time_changed, corrected: m.corrected,
  };
  const showScore = m.status === 'confirmed' || (level === 'relative' && m.status === 'provisional');
  if (showScore) Object.assign(base, { home_score: m.home_score, away_score: m.away_score, home_pk: m.home_pk, away_pk: m.away_pk, forfeit: m.forfeit });
  if (level === 'relative') Object.assign(base, { updated_by: m.updated_by, updated_at: m.updated_at, version: m.version });
  return base;
}

function stripConfig(cfg) {
  const { grouping, lottery, ...rest } = cfg;
  return rest;
}

async function publicPayload(db, t, level) {
  const cats = await loadFull(db, t);
  const sponsors = publicSponsors(await listSponsors(db, t.id));
  return {
    tournament: { ...publicTournament(t), sponsors },
    categories: cats.map((c) => ({
      ...c,
      config: stripConfig(c.config),
      teams: c.teams.map(({ id, name, short_name, logo, group_label }) => ({ id, name, short_name, logo: t.show_logo ? logoUrl('team', id, logo) : null, group_label })),
      matches: c.matches.map((m) => maskMatch(m, level)),
    })),
  };
}

// ---------- 画面ファイルの配信 ----------

const JS = 'text/javascript; charset=utf-8';
const STATIC = {
  '/app.css': [APP_CSS, 'text/css; charset=utf-8'],
  '/manifest.webmanifest': [MANIFEST, 'application/manifest+json; charset=utf-8'],
  '/web-app.js': [WEB_APP, JS],
  '/web-api.js': [WEB_API, JS],
  '/web-ui.js': [WEB_UI, JS],
  '/web-views.js': [WEB_VIEWS, JS],
  '/web-viewer.js': [WEB_VIEWER, JS],
  '/web-relative.js': [WEB_RELATIVE, JS],
  '/web-admin.js': [WEB_ADMIN, JS],
  '/web-print.js': [WEB_PRINT, JS],
};
// 外部のスクリプトや埋め込みを許さない（画面はすべて自前のファイルで動く）
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': CSP, 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// 画面のファイルは毎回サーバーに確認させる（ETag が同じなら 304 で本体は送らない）。
// 更新直後に新旧のファイルが混ざって画面が壊れるのを防ぐため。
const etags = {};
async function etagOf(path, body) {
  if (!etags[path]) {
    const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body));
    etags[path] = `"${[...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
  }
  return etags[path];
}

async function serveStatic(req, url) {
  const file = STATIC[url.pathname];
  const [body, type] = file || [INDEX_HTML, 'text/html; charset=utf-8'];
  const key = file ? url.pathname : '/index.html';
  const etag = await etagOf(key, body);
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag, ...SECURITY_HEADERS };
  if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  // それ以外の画面のURL（/admin, /t/..., /r/...）はすべて index.html を返し、画面側で振り分ける
  return new Response(body, { headers });
}

// ---------- ルーティング ----------

const routes = [];
const route = (method, pattern, handler, auth = null) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const go = url.pathname.match(/^\/go\/([\w-]+)$/);
    const img = url.pathname.match(/^\/img\/(s|t|team)\/([\w-]+)$/);
    if (go || img) {
      try {
        await ensureSchema(env.DB);
        return go ? await sponsorRedirect(req, env.DB, go[1]) : await sponsorImage(env.DB, img[2], img[1]);
      } catch (e) {
        console.error(e);
        return new Response('エラーが発生しました', { status: 500 });
      }
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, url);
    try {
      if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD) fail(500, 'サーバーの初期設定が完了していません（ADMIN_PASSWORD と SESSION_SECRET を設定してください）');
      await ensureSchema(env.DB);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.get('Origin');
        if (origin && origin !== url.origin) fail(403, '別のサイトからの操作は受け付けません');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        if (r.auth === 'admin' && !(await isAdmin(req, env))) fail(401, 'ログインしてください');
        return await r.handler({ req, env, db: env.DB, url, params });
      }
      fail(404, 'APIが見つかりません');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(e);
      return json({ error: 'サーバーでエラーが発生しました。時間をおいてもう一度お試しください' }, 500);
    }
  },
};

// ---------- 管理者: 認証 ----------

route('POST', '/api/admin/login', async ({ req, env, db }) => {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const rl = await rateLimit(db, `admin:${ip}`, 10);
  if (!rl.ok) fail(429, `試行回数が上限に達しました。${Math.ceil(rl.retryAfter / 60)}分後にもう一度お試しください`);
  const { password } = await body(req);
  if (!(await safeEqual(env.SESSION_SECRET, String(password || ''), env.ADMIN_PASSWORD))) fail(401, 'パスワードが違います');
  await clearRateLimit(db, `admin:${ip}`);
  return json({ ok: true }, 200, { 'Set-Cookie': await issueAdmin(env) });
});

route('POST', '/api/admin/logout', async () => json({ ok: true }, 200, { 'Set-Cookie': cookie('adm', '', 0) }));

route('GET', '/api/admin/me', async ({ req, env }) => json({ admin: await isAdmin(req, env) }));

// ---------- 管理者: 大会 ----------

route('GET', '/api/admin/tournaments', async ({ db }) => {
  const [r, c] = await Promise.all([
    db.prepare('SELECT id, slug, name, date, end_date, venue, status, logo, show_logo FROM tournaments ORDER BY date DESC, created_at DESC').all(),
    db.prepare(`SELECT c.id, c.tournament_id, c.name, c.config,
        (SELECT COUNT(*) FROM teams t WHERE t.category_id = c.id) AS team_count,
        (SELECT COUNT(*) FROM matches m WHERE m.category_id = c.id) AS match_count,
        (SELECT COUNT(*) FROM matches m WHERE m.category_id = c.id AND m.status = 'confirmed') AS done_count,
        (SELECT COUNT(*) FROM matches m WHERE m.category_id = c.id AND m.status = 'provisional') AS pending_count
      FROM categories c ORDER BY c.sort, c.created_at`).all(),
  ]);
  const cats = {};
  for (const x of c.results) {
    const cfg = normalizeConfig(JSON.parse(x.config));
    (cats[x.tournament_id] ||= []).push({ id: x.id, name: x.name, format: cfg.format, groups: cfg.groups, courts: cfg.courts,
      team_count: x.team_count, match_count: x.match_count, done_count: x.done_count, pending_count: x.pending_count });
  }
  return json({ tournaments: r.results.map((t) => ({ ...t, logo: t.show_logo ? t.logo : null, categories: cats[t.id] || [] })) });
}, 'admin');

route('POST', '/api/admin/tournaments', async ({ req, db }) => {
  const b = await body(req);
  if (!b.name || !String(b.name).trim()) fail(400, '大会名を入力してください');
  b.name = clip(b.name, 80); b.venue = b.venue ? clip(b.venue, 80) : b.venue;
  const id = uid();
  const end = checkRange(b.date || null, b.end_date || null);
  await db.prepare('INSERT INTO tournaments (id, slug, name, date, end_date, venue, pin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, randomSlug(), String(b.name).trim(), b.date || null, end, b.venue || null, randomPin(), now(), now()).run();
  return json({ id });
}, 'admin');

route('GET', '/api/admin/tournaments/:id', async ({ db, params, url }) => {
  const t = await getTournament(db, params.id);
  if (url.searchParams.get('rev') === String(t.rev)) return json({ unchanged: true, rev: t.rev });
  const cats = await loadFull(db, t);
  const out = cats.map((c) => {
    const len = matchLength(c.config);
    const names = Object.fromEntries(c.teams.map((x) => [x.id, x.name]));
    return { ...c, warnings: scheduleWarnings(c.config, c.matches, (id) => names[id] || '未定'), matchLength: len };
  });
  const sponsors = await listSponsors(db, t.id, true);
  return json({ tournament: { ...publicTournament(t, true), sponsors: publicSponsors(sponsors) }, categories: out, sponsors });
}, 'admin');

const STATUSES = ['draft', 'published', 'live', 'finished'];

route('PATCH', '/api/admin/tournaments/:id', async ({ req, db, params }) => {
  const t = await getTournament(db, params.id);
  const b = await body(req);
  const next = {
    name: b.name !== undefined ? clip(b.name, 80) || t.name : t.name,
    date: b.date !== undefined ? b.date || null : t.date,
    venue: b.venue !== undefined ? clip(b.venue, 80) || null : t.venue,
    logo: b.logo !== undefined ? checkLogo(b.logo) : t.logo,
    show_logo: b.show_logo !== undefined ? (b.show_logo ? 1 : 0) : t.show_logo,
    status: b.status !== undefined ? b.status : t.status,
  };
  if (!STATUSES.includes(next.status)) fail(400, '大会の状態が正しくありません');
  next.end_date = checkRange(next.date, b.end_date !== undefined ? b.end_date || null : t.end_date);
  await db.prepare('UPDATE tournaments SET name = ?, date = ?, end_date = ?, venue = ?, logo = ?, show_logo = ?, status = ? WHERE id = ?')
    .bind(next.name, next.date, next.end_date, next.venue, next.logo, next.show_logo, next.status, t.id).run();
  const oldDates = tournamentDates(t);
  const newDates = tournamentDates({ date: next.date, end_date: next.end_date });
  if (JSON.stringify(oldDates) !== JSON.stringify(newDates)) {
    const cats = (await db.prepare('SELECT * FROM categories WHERE tournament_id = ?').bind(t.id).all()).results;
    const stmts = [];
    for (const c of cats) {
      const cfg = normalizeConfig(JSON.parse(c.config));
      const had = cfg.dayDates.length ? cfg.dayDates : oldDates.slice(0, cfg.dayCount);
      // 全日程に出ていたカテゴリは新しい全日程に、それ以外は期間内の日だけ残す（ずれた分は同じ日目に置き換える）
      let dates = JSON.stringify(had) === JSON.stringify(oldDates) ? newDates
        : had.map((d) => (newDates.includes(d) ? d : newDates[oldDates.indexOf(d)])).filter(Boolean);
      dates = [...new Set(dates)].sort();
      if (!dates.length && newDates.length) dates = [newDates[0]];
      stmts.push(db.prepare('UPDATE categories SET config = ? WHERE id = ?').bind(JSON.stringify({ ...cfg, dayDates: dates, dayCount: Math.max(1, dates.length) }), c.id));
    }
    if (stmts.length) await batchAll(db, stmts);
  }
  await bump(db, t.id);
  return json({ ok: true });
}, 'admin');

route('POST', '/api/admin/tournaments/:id/pin', async ({ db, params }) => {
  const t = await getTournament(db, params.id);
  const pin = randomPin();
  await db.prepare('UPDATE tournaments SET pin = ?, pin_version = pin_version + 1 WHERE id = ?').bind(pin, t.id).run();
  return json({ pin });
}, 'admin');

route('DELETE', '/api/admin/tournaments/:id', async ({ db, params }) => {
  const t = await getTournament(db, params.id);
  const cats = (await db.prepare('SELECT id FROM categories WHERE tournament_id = ?').bind(t.id).all()).results;
  const stmts = [];
  for (const c of cats) {
    stmts.push(db.prepare('DELETE FROM match_officials WHERE match_id IN (SELECT id FROM matches WHERE category_id = ?)').bind(c.id));
    stmts.push(db.prepare('DELETE FROM matches WHERE category_id = ?').bind(c.id));
    stmts.push(db.prepare('DELETE FROM teams WHERE category_id = ?').bind(c.id));
  }
  stmts.push(db.prepare('DELETE FROM sponsor_clicks WHERE sponsor_id IN (SELECT id FROM sponsors WHERE tournament_id = ?)').bind(t.id));
  stmts.push(db.prepare('DELETE FROM sponsors WHERE tournament_id = ?').bind(t.id));
  stmts.push(db.prepare('DELETE FROM categories WHERE tournament_id = ?').bind(t.id));
  stmts.push(db.prepare('DELETE FROM tournaments WHERE id = ?').bind(t.id));
  await batchAll(db, stmts);
  return json({ ok: true });
}, 'admin');

// ---------- 管理者: カテゴリ ----------

const editable = (t) => t.status === 'draft' || t.status === 'published';
const mustBeEditable = (t) => { if (!editable(t)) fail(409, '開催中・終了した大会では組み合わせを変更できません。大会の状態を「準備中」に戻してください'); };

route('POST', '/api/admin/tournaments/:id/categories', async ({ req, db, params }) => {
  const t = await getTournament(db, params.id);
  const b = await body(req);
  const dates = tournamentDates(t);
  const given = b.config || {};
  const cfg = normalizeConfig({ ...given, dayDates: Array.isArray(given.dayDates) && given.dayDates.length ? given.dayDates : Number(given.dayCount) > 1 ? [] : dates });
  const count = await db.prepare('SELECT COUNT(*) AS n FROM categories WHERE tournament_id = ?').bind(t.id).first();
  const id = uid();
  await db.prepare('INSERT INTO categories (id, tournament_id, name, sort, config, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, t.id, String(b.name || 'U12'), count.n, JSON.stringify(cfg), now()).run();
  await bump(db, t.id);
  return json({ id });
}, 'admin');

const TIMING_KEYS = ['startTime', 'periods', 'halfMinutes', 'halftimeMinutes', 'intervalMinutes', 'lunchEnabled', 'lunchStart', 'lunchMinutes', 'extraDays', 'koTiming'];

route('PATCH', '/api/admin/categories/:cid', async ({ req, db, params }) => {
  const c = await getCategory(db, params.cid);
  const t = await getTournament(db, c.tournament_id);
  const b = await body(req);
  const cfg = normalizeConfig({ ...c.config, ...(b.config || {}) });
  if (cfg.courts < c.config.courts) {
    const used = await db.prepare('SELECT MAX(court) AS mx FROM matches WHERE category_id = ?').bind(c.id).first();
    if (used && used.mx != null && used.mx >= cfg.courts) {
      fail(409, `日程で${used.mx + 1}面目のコートを使っているため、コート数を${cfg.courts}面に減らせません。「組み分け・日程」で日程を作り直すか、試合を移動してから変更してください`);
    }
  }
  await db.prepare('UPDATE categories SET name = ?, config = ? WHERE id = ?').bind(b.name ? clip(b.name, 20) : c.name, JSON.stringify(cfg), c.id).run();
  // 準備中なら、開始時刻などの変更を全コートの全試合へ一括反映
  const timingChanged = TIMING_KEYS.some((k) => JSON.stringify(cfg[k]) !== JSON.stringify(c.config[k]));
  if (timingChanged && editable(t)) {
    const { matches } = await loadCategoryData(db, c.id);
    applyTimes(cfg, matches);
    await batchAll(db, matches.map((m) => db.prepare('UPDATE matches SET start_min = ?, session = ?, time_changed = 0 WHERE id = ?').bind(m.start_min, m.session, m.id)));
  }
  await syncKnockout(db, { ...c, config: cfg });
  await bump(db, t.id);
  return json({ ok: true, retimed: timingChanged && editable(t) });
}, 'admin');

route('DELETE', '/api/admin/categories/:cid', async ({ db, params }) => {
  const c = await getCategory(db, params.cid);
  await batchAll(db, [
    db.prepare('DELETE FROM matches WHERE category_id = ?').bind(c.id),
    db.prepare('DELETE FROM teams WHERE category_id = ?').bind(c.id),
    db.prepare('DELETE FROM categories WHERE id = ?').bind(c.id),
  ]);
  await bump(db, c.tournament_id);
  return json({ ok: true });
}, 'admin');

// ---------- 管理者: チーム ----------

route('POST', '/api/admin/categories/:cid/teams', async ({ req, db, params }) => {
  const c = await getCategory(db, params.cid);
  const b = await body(req);
  const list = Array.isArray(b.teams) ? b.teams : [b];
  const count = await db.prepare('SELECT COUNT(*) AS n FROM teams WHERE category_id = ?').bind(c.id).first();
  const stmts = [];
  list.forEach((x, i) => {
    const name = clip(x.name, 60);
    if (!name) return;
    x.short_name = x.short_name ? clip(x.short_name, 20) : null;
    x.club = x.club ? clip(x.club, 60) : null;
    stmts.push(db.prepare('INSERT INTO teams (id, category_id, name, short_name, club, logo, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(uid(), c.id, name, x.short_name || null, x.club || null, checkLogo(x.logo), count.n + i));
  });
  if (!stmts.length) fail(400, 'チーム名を入力してください');
  await batchAll(db, stmts);
  await bump(db, c.tournament_id);
  return json({ ok: true, added: stmts.length });
}, 'admin');

route('PATCH', '/api/admin/teams/:id', async ({ req, db, params }) => {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(params.id).first();
  if (!team) fail(404, 'チームが見つかりません');
  const b = await body(req);
  await db.prepare('UPDATE teams SET name = ?, short_name = ?, club = ?, logo = ? WHERE id = ?').bind(
    b.name !== undefined ? clip(b.name, 60) || team.name : team.name,
    b.short_name !== undefined ? clip(b.short_name, 20) || null : team.short_name,
    b.club !== undefined ? clip(b.club, 60) || null : team.club,
    b.logo !== undefined ? checkLogo(b.logo) : team.logo,
    team.id,
  ).run();
  const c = await getCategory(db, team.category_id);
  await bump(db, c.tournament_id);
  return json({ ok: true });
}, 'admin');

route('DELETE', '/api/admin/teams/:id', async ({ db, params }) => {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(params.id).first();
  if (!team) fail(404, 'チームが見つかりません');
  const c = await getCategory(db, team.category_id);
  const t = await getTournament(db, c.tournament_id);
  const used = await db.prepare('SELECT COUNT(*) AS n FROM matches WHERE category_id = ? AND (home_team_id = ? OR away_team_id = ?)').bind(c.id, team.id, team.id).first();
  if (used.n && !editable(t)) fail(409, '試合が組まれているチームは開催中に削除できません');
  await db.prepare('DELETE FROM teams WHERE id = ?').bind(team.id).run();
  if (used.n) await db.prepare('DELETE FROM matches WHERE category_id = ?').bind(c.id).run();
  await bump(db, t.id);
  return json({ ok: true, scheduleCleared: !!used.n });
}, 'admin');

// ---------- 管理者: 組み分け・日程 ----------

route('POST', '/api/admin/categories/:cid/grouping', async ({ db, params }) => {
  const c = await getCategory(db, params.cid);
  const { teams } = await loadCategoryData(db, c.id);
  if (c.config.format === 'knockout') {
    return json({ order: shuffle(teams.map((x) => x.id)), warnings: [] });
  }
  if (teams.length < c.config.groups * 2) fail(400, `${c.config.groups}組に分けるには ${c.config.groups * 2} チーム以上が必要です`);
  return json(assignGroups(teams, { groups: c.config.groups, ...c.config.grouping }));
}, 'admin');

route('POST', '/api/admin/categories/:cid/generate', async ({ req, db, params }) => {
  const c = await getCategory(db, params.cid);
  const t = await getTournament(db, c.tournament_id);
  mustBeEditable(t);
  const b = await body(req);
  const { teams } = await loadCategoryData(db, c.id);
  const assign = b.assignment || {};
  const ts = teams.map((x) => ({ ...x, group_label: c.config.format === 'knockout' ? null : assign[x.id] || x.group_label }));
  const res = generateCategory(c.config, ts, b.order);
  if (res.error) fail(400, res.error);
  const names = Object.fromEntries(teams.map((x) => [x.id, x.name]));
  const matches = res.matches.map((m) => ({ ...m, id: uid(), status: 'none' }));
  const dayBreakSlots = res.dayBreakSlots || [];
  const warnings = [...(res.warnings || []), ...scheduleWarnings({ ...c.config, dayBreakSlots }, matches, (id) => names[id] || '未定')];
  if (b.dryRun) return json({ matches, warnings, dayBreakSlots });

  const stmts = [db.prepare('DELETE FROM matches WHERE category_id = ?').bind(c.id)];
  for (const x of ts) stmts.push(db.prepare('UPDATE teams SET group_label = ? WHERE id = ?').bind(x.group_label, x.id));
  for (const m of matches) {
    stmts.push(db.prepare(`INSERT INTO matches (id, category_id, stage, group_label, round, code, label, slot, court, start_min, session,
      home_team_id, away_team_id, home_ref, away_ref, place_w, place_l, status, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 1)`)
      .bind(m.id, c.id, m.stage, m.group_label ?? null, m.round ?? null, m.code ?? null, m.label, m.slot, m.court, m.start_min, m.session,
        m.home_team_id ?? null, m.away_team_id ?? null, m.home_ref ? JSON.stringify(m.home_ref) : null, m.away_ref ? JSON.stringify(m.away_ref) : null,
        m.place_w ?? null, m.place_l ?? null));
  }
  // 組み分けが変わったら抽選結果はリセット
  const cfg = { ...c.config, lottery: {}, dayBreakSlots };
  stmts.push(db.prepare('UPDATE categories SET config = ? WHERE id = ?').bind(JSON.stringify(cfg), c.id));
  await batchAll(db, stmts);
  await bump(db, t.id);
  return json({ ok: true, warnings });
}, 'admin');

// 試合を別の枠・コートへ移動（移動先に試合があれば入れ替え）
route('POST', '/api/admin/categories/:cid/move', async ({ req, db, params }) => {
  const c = await getCategory(db, params.cid);
  const t = await getTournament(db, c.tournament_id);
  mustBeEditable(t);
  const b = await body(req);
  const { matches } = await loadCategoryData(db, c.id);
  const m = matches.find((x) => x.id === b.matchId);
  if (!m) fail(404, '試合が見つかりません');
  const slot = Math.max(0, Math.trunc(Number(b.slot)));
  const court = Math.trunc(Number(b.court));
  if (court < 0 || court >= c.config.courts) fail(400, 'コートの指定が正しくありません');
  const other = matches.find((x) => x.slot === slot && x.court === court && x.id !== m.id);
  if (other) { other.slot = m.slot; other.court = m.court; }
  m.slot = slot; m.court = court;
  applyTimes(c.config, matches);
  await batchAll(db, matches.map((x) => db.prepare('UPDATE matches SET slot = ?, court = ?, start_min = ?, session = ? WHERE id = ?').bind(x.slot, x.court, x.start_min, x.session, x.id)));
  await bump(db, t.id);
  return json({ ok: true });
}, 'admin');

// 当日の遅延調整（コート単位）
route('POST', '/api/admin/categories/:cid/delay', async ({ req, db, params }) => {
  const c = await getCategory(db, params.cid);
  const t = await getTournament(db, c.tournament_id);
  if (t.status !== 'live') fail(409, '遅延調整は「開催中」の大会で使えます。準備中は開始時刻の設定から全体を調整してください');
  const b = await body(req);
  const minutes = Math.trunc(Number(b.minutes));
  if (!minutes || Math.abs(minutes) > 240) fail(400, 'ずらす時間を分で入力してください（-240〜240）');
  const { teams, matches } = await loadCategoryData(db, c.id);
  const target = matches.find((x) => x.id === b.matchId);
  if (!target) fail(404, '試合が見つかりません');
  if (target.status !== 'none') fail(409, '結果が登録された試合は動かせません');
  const names = Object.fromEntries(teams.map((x) => [x.id, x.name]));
  const plan = planDelay(c.config, matches, target, minutes, b.lunchMode, (id) => names[id] || '未定');
  if (plan.needsLunchChoice || b.dryRun) return json(plan);
  await batchAll(db, plan.changes.map((ch) => db.prepare('UPDATE matches SET start_min = ?, time_changed = 1 WHERE id = ?').bind(ch.start_min, ch.id)));
  await bump(db, t.id);
  return json({ ok: true, changed: plan.changes.length, warnings: plan.warnings });
}, 'admin');

// ---------- 管理者: 結果 ----------

function validateScore(m, b, cfg) {
  if (b.forfeit === 'home' || b.forfeit === 'away') {
    const [w, l] = cfg.forfeitScore || [3, 0];
    return { home: b.forfeit === 'home' ? w : l, away: b.forfeit === 'home' ? l : w, hpk: null, apk: null, forfeit: b.forfeit };
  }
  const home = intOrNull(b.home_score);
  const away = intOrNull(b.away_score);
  if (home == null || away == null) fail(400, '両チームの得点を入力してください');
  let hpk = intOrNull(b.home_pk);
  let apk = intOrNull(b.away_pk);
  if (m.stage === 'league' || home !== away) { hpk = null; apk = null; }
  return { home, away, hpk, apk, forfeit: null };
}

function requirePkIfNeeded(m, s) {
  if (m.stage === 'knockout' && !s.forfeit && s.home === s.away && (s.hpk == null || s.apk == null || s.hpk === s.apk)) {
    fail(400, '同点のためPK戦の結果を入力してください（PKも同点では確定できません）');
  }
}

async function getMatchCtx(db, id) {
  const m = await db.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first();
  if (!m) fail(404, '試合が見つかりません');
  const c = await getCategory(db, m.category_id);
  const t = await getTournament(db, c.tournament_id);
  return { m: parseMatch(m), c, t };
}

route('POST', '/api/admin/matches/:id/result', async ({ req, db, params }) => {
  const { m, c, t } = await getMatchCtx(db, params.id);
  if (!m.home_team_id || !m.away_team_id) fail(409, '対戦チームが決まっていません');
  const b = await body(req);
  const s = validateScore(m, b, c.config);
  const confirm = !!b.confirm;
  if (confirm) requirePkIfNeeded(m, s);
  const status = confirm ? 'confirmed' : (m.status === 'confirmed' ? 'confirmed' : 'provisional');
  const corrected = m.status === 'confirmed' ? 1 : m.corrected;
  await db.prepare(`UPDATE matches SET home_score = ?, away_score = ?, home_pk = ?, away_pk = ?, forfeit = ?, status = ?, corrected = ?,
    updated_by = '本部', updated_at = ?, version = version + 1 WHERE id = ?`)
    .bind(s.home, s.away, s.hpk, s.apk, s.forfeit, status, corrected, now(), m.id).run();
  await syncKnockout(db, c);
  await bump(db, t.id);
  return json({ ok: true });
}, 'admin');

route('POST', '/api/admin/categories/:cid/confirm', async ({ req, db, params }) => {
  const c = await getCategory(db, params.cid);
  const b = await body(req);
  const ids = Array.isArray(b.matchIds) ? b.matchIds : [];
  const { matches } = await loadCategoryData(db, c.id);
  const needsPk = (m) => m.stage === 'knockout' && !m.forfeit && m.home_score === m.away_score && (m.home_pk == null || m.away_pk == null || m.home_pk === m.away_pk);
  const picked = matches.filter((m) => ids.includes(m.id) && m.status === 'provisional');
  const targets = picked.filter((m) => !needsPk(m));
  const skipped = picked.length - targets.length;
  if (targets.length) {
    await batchAll(db, targets.map((m) => db.prepare("UPDATE matches SET status = 'confirmed', version = version + 1 WHERE id = ? AND status = 'provisional'").bind(m.id)));
    await syncKnockout(db, c);
    await bump(db, c.tournament_id);
  }
  return json({ ok: true, confirmed: targets.length, skipped });
}, 'admin');

// 確定を取り消して仮登録に戻す
route('POST', '/api/admin/matches/:id/reopen', async ({ db, params }) => {
  const { m, c, t } = await getMatchCtx(db, params.id);
  if (m.status !== 'confirmed') fail(409, 'この試合は確定していません');
  await db.prepare("UPDATE matches SET status = 'provisional', corrected = 1, version = version + 1 WHERE id = ?").bind(m.id).run();
  await syncKnockout(db, c);
  await bump(db, t.id);
  return json({ ok: true });
}, 'admin');

route('POST', '/api/admin/matches/:id/clear', async ({ db, params }) => {
  const { m, c, t } = await getMatchCtx(db, params.id);
  await db.prepare(`UPDATE matches SET home_score = NULL, away_score = NULL, home_pk = NULL, away_pk = NULL, forfeit = NULL,
    status = 'none', updated_by = NULL, updated_at = NULL, version = version + 1 WHERE id = ?`).bind(m.id).run();
  await syncKnockout(db, c);
  await bump(db, t.id);
  return json({ ok: true });
}, 'admin');

route('POST', '/api/admin/categories/:cid/lottery', async ({ req, db, params }) => {
  const c = await getCategory(db, params.cid);
  const b = await body(req);
  const cfg = { ...c.config, lottery: { ...c.config.lottery, [b.group]: Array.isArray(b.order) ? b.order : [] } };
  await db.prepare('UPDATE categories SET config = ? WHERE id = ?').bind(JSON.stringify(cfg), c.id).run();
  await syncKnockout(db, { ...c, config: cfg });
  await bump(db, c.tournament_id);
  return json({ ok: true });
}, 'admin');

// ---------- 管理者: スポンサー ----------

route('POST', '/api/admin/tournaments/:id/sponsors', async ({ req, db, params }) => {
  const t = await getTournament(db, params.id);
  const b = await body(req);
  const name = clip(b.name, 60);
  if (!name) fail(400, 'スポンサー名を入力してください');
  const count = await db.prepare('SELECT COUNT(*) AS n FROM sponsors WHERE tournament_id = ?').bind(t.id).first();
  if (count.n >= 30) fail(400, 'スポンサーは30件まで登録できます');
  await db.prepare('INSERT INTO sponsors (id, tournament_id, name, url, image, sort, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(uid(), t.id, name, checkUrl(b.url), checkBanner(b.image), count.n, now(), now()).run();
  await bump(db, t.id);
  return json({ ok: true });
}, 'admin');

route('PATCH', '/api/admin/sponsors/:sid', async ({ req, db, params }) => {
  const sp = await db.prepare('SELECT * FROM sponsors WHERE id = ?').bind(params.sid).first();
  if (!sp) fail(404, 'スポンサーが見つかりません');
  const b = await body(req);
  await db.prepare('UPDATE sponsors SET name = ?, url = ?, image = ?, active = ?, updated_at = ? WHERE id = ?').bind(
    b.name !== undefined ? clip(b.name, 60) || sp.name : sp.name,
    b.url !== undefined ? checkUrl(b.url) : sp.url,
    b.image ? checkBanner(b.image) : sp.image,
    b.active !== undefined ? (b.active ? 1 : 0) : sp.active,
    now(), sp.id).run();
  await bump(db, sp.tournament_id);
  return json({ ok: true });
}, 'admin');

route('DELETE', '/api/admin/sponsors/:sid', async ({ db, params }) => {
  const sp = await db.prepare('SELECT * FROM sponsors WHERE id = ?').bind(params.sid).first();
  if (!sp) fail(404, 'スポンサーが見つかりません');
  await db.batch([
    db.prepare('DELETE FROM sponsor_clicks WHERE sponsor_id = ?').bind(sp.id),
    db.prepare('DELETE FROM sponsors WHERE id = ?').bind(sp.id),
  ]);
  await bump(db, sp.tournament_id);
  return json({ ok: true });
}, 'admin');

route('POST', '/api/admin/tournaments/:id/sponsors/order', async ({ req, db, params }) => {
  const t = await getTournament(db, params.id);
  const b = await body(req);
  const ids = Array.isArray(b.ids) ? b.ids : [];
  await batchAll(db, ids.map((id, i) => db.prepare('UPDATE sponsors SET sort = ? WHERE id = ? AND tournament_id = ?').bind(i, id, t.id)));
  await bump(db, t.id);
  return json({ ok: true });
}, 'admin');

// 日ごとのクリック数
route('GET', '/api/admin/sponsors/:sid/clicks', async ({ db, params }) => {
  const r = await db.prepare('SELECT day, count FROM sponsor_clicks WHERE sponsor_id = ? ORDER BY day DESC LIMIT 60').bind(params.sid).all();
  return json({ days: r.results });
}, 'admin');

// ---------- 管理者: テンプレート ----------

const TEMPLATE_KEYS = ['dayBreaks', 'koTiming', 'periods', 'halfMinutes', 'halftimeMinutes', 'intervalMinutes', 'lunchEnabled', 'lunchStart', 'lunchMinutes', 'minLunchMinutes',
  'startTime', 'courts', 'courtNames', 'format', 'groups', 'advance', 'rankMode', 'knockoutPlan', 'tiebreak', 'forfeitScore', 'showStandings', 'minRestSlots'];

route('GET', '/api/admin/templates', async ({ db }) => {
  const r = await db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
  return json({ templates: r.results.map((x) => ({ ...x, config: JSON.parse(x.config) })) });
}, 'admin');

route('POST', '/api/admin/templates', async ({ req, db }) => {
  const b = await body(req);
  if (!b.name) fail(400, 'テンプレート名を入力してください');
  const cfg = Object.fromEntries(TEMPLATE_KEYS.filter((k) => b.config && k in b.config).map((k) => [k, b.config[k]]));
  await db.prepare('INSERT INTO templates (id, name, config, created_at) VALUES (?, ?, ?, ?)').bind(uid(), String(b.name), JSON.stringify(cfg), now()).run();
  return json({ ok: true });
}, 'admin');

route('DELETE', '/api/admin/templates/:id', async ({ db, params }) => {
  await db.prepare('DELETE FROM templates WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}, 'admin');

// ---------- 閲覧者 ----------

route('GET', '/api/public/:slug', async ({ db, params, url }) => {
  const head = await getTournamentHead(db, params.slug);
  if (head.status === 'draft') fail(404, 'この大会はまだ公開されていません');
  if (url.searchParams.get('rev') === String(head.rev)) return json({ unchanged: true, rev: head.rev });
  const t = await getTournamentBySlug(db, params.slug);
  return json(await publicPayload(db, t, 'public'));
});

// ---------- 関係者 ----------

route('POST', '/api/rel/:slug/login', async ({ req, env, db, params }) => {
  const t = await getTournamentBySlug(db, params.slug);
  if (t.status === 'draft') fail(404, 'この大会はまだ公開されていません');
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const key = `pin:${t.id}:${ip}`;
  const rl = await rateLimit(db, key, 5);
  if (!rl.ok) fail(429, `PINの入力回数が上限に達しました。${Math.ceil(rl.retryAfter / 60)}分後にもう一度お試しください`);
  const { pin } = await body(req);
  if (String(pin || '') !== t.pin) fail(401, 'PINが違います。大会本部から届いたPINを確認してください');
  await clearRateLimit(db, key);
  return json({ ok: true }, 200, { 'Set-Cookie': await issueRelative(env, t) });
});

route('GET', '/api/rel/:slug', async ({ req, env, db, params, url }) => {
  const head = await getTournamentHead(db, params.slug);
  if (!(await isRelative(req, env, head))) fail(401, 'PINを入力してください');
  if (url.searchParams.get('rev') === String(head.rev)) return json({ unchanged: true, rev: head.rev });
  const t = await getTournamentBySlug(db, params.slug);
  return json(await publicPayload(db, t, 'relative'));
});

route('POST', '/api/rel/:slug/matches/:id', async ({ req, env, db, params }) => {
  const t = await getTournamentBySlug(db, params.slug);
  if (!(await isRelative(req, env, t))) fail(401, 'PINを入力してください');
  if (t.status !== 'published' && t.status !== 'live') fail(409, '現在は結果を登録できません');
  const { m, c } = await getMatchCtx(db, params.id);
  if (c.tournament_id !== t.id) fail(404, '試合が見つかりません');
  const b = await body(req);
  const team = await db.prepare('SELECT * FROM teams WHERE id = ? AND category_id = ?').bind(b.teamId, c.id).first();
  if (!team || (team.id !== m.home_team_id && team.id !== m.away_team_id)) fail(403, '自チームの試合だけ登録できます');
  if (m.status === 'confirmed') fail(409, 'この試合は本部で確定済みです。変更は本部に連絡してください');
  const s = validateScore(m, { ...b, forfeit: null }, c.config);
  const r = await db.prepare(`UPDATE matches SET home_score = ?, away_score = ?, home_pk = ?, away_pk = ?, forfeit = NULL, status = 'provisional',
    updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status != 'confirmed'`)
    .bind(s.home, s.away, s.hpk, s.apk, team.short_name || team.name, now(), m.id, Number(b.version)).run();
  if (!r.meta.changes) {
    const cur = parseMatch(await db.prepare('SELECT * FROM matches WHERE id = ?').bind(m.id).first());
    fail(409, '他の人が先に更新しました。最新の内容を確認してください', { match: maskMatch(cur, 'relative') });
  }
  await bump(db, t.id);
  return json({ ok: true });
});
