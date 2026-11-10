// 結果一覧（ポスター）：最終順位・参加チームの一覧を、SNS用の画像（PNG）や PDF にする
// ブラウザの Canvas で直接描く（外部のサービスは使わない）
import { h, mount, modal, toast, run, resizeBanner, saveImages } from './web-ui.js';
import { api } from './web-api.js';
import { teamMap, codeMap, sideInfo, courtName, dayOf, dayLabel, isRankLeague, winnerSide } from './web-views.js';
import { runPrint } from './web-print.js';

const SIZES = {
  sns: { label: 'SNS用（縦 4:5）', w: 1080, h: 1350 },
  square: { label: '正方形（1:1）', w: 1080, h: 1080 },
  a4: { label: 'A4縦（印刷用）', w: 1654, h: 2339 },
  story: { label: 'ストーリー（9:16）', w: 1080, h: 1920 },
};
const ACCENTS = { lime: ['ライム', '#c8ff3d'], red: ['赤', '#ff3b45'], gold: ['金', '#f5c542'], white: ['白', '#ffffff'] };
const FONT = "'Noto Sans CJK JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Meiryo', sans-serif";

const loadImg = (src) => new Promise((resolve) => {
  if (!src) return resolve(null);
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => resolve(null);
  im.src = src;
});

// 一覧に載せる行（番号・チーム）
function rowsOf(cat, kind) {
  const tm = teamMap(cat);
  if (kind === 'ranking') return (cat.finalRanking || []).filter((r) => tm[r.teamId]).map((r) => ({ no: r.rank, team: tm[r.teamId] }));
  const groups = [...new Set(cat.teams.map((x) => x.group_label || ''))].sort();
  const list = groups.flatMap((g) => cat.teams.filter((x) => (x.group_label || '') === g));
  return list.map((team, i) => ({ no: i + 1, team }));
}

// 黒い迷彩風の背景（毎回同じ模様になるよう、決まった順番の乱数で描く）
function background(ctx, W, H) {
  ctx.fillStyle = '#0b0c0c'; ctx.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const tones = ['#141616', '#1b1d1d', '#222524', '#101111'];
  for (let i = 0; i < Math.round((W * H) / 9000); i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.beginPath();
    const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 90;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2, rr = r * (0.55 + rnd() * 0.6);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.75;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  // 上下を少し暗く
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.25, 'rgba(0,0,0,0)'); g.addColorStop(0.85, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// 文字が幅に収まるよう、文字の大きさを下げる
// 文字の幅：iPhone・iPad（Safari）では、絵文字（♾️ など）を含む文字列の幅が正しく測れないことがあるため、
// 絵文字を同じくらいの幅の文字に置き換えて測る
const EMOJI = /\p{Extended_Pictographic}/gu;
const measureW = (ctx, text) => ctx.measureText(String(text ?? '').replace(/\uFE0F/g, '').replace(EMOJI, '■')).width;
// 中央そろえで描く：ブラウザの中央そろえに頼らず、自分で測った幅から左端を決めて描く（Safariで右にずれるのを防ぐ）
function fillCenter(ctx, text, cx, y) {
  const w = measureW(ctx, text);
  const a = ctx.textAlign;
  ctx.textAlign = 'left';
  ctx.fillText(String(text ?? ''), cx - w / 2, y);
  ctx.textAlign = a;
}

function fitFont(ctx, text, maxW, size, weight = 900, min = 10) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (measureW(ctx, text) > maxW && s > min) { s -= 1; ctx.font = `${weight} ${s}px ${FONT}`; }
  return s;
}

// 描き直しが重なっても崩れないよう、見えないキャンバスで描き終えてから画面のキャンバスに写す
function latestPainter(canvas) {
  let gen = 0;
  return async (drawFn) => {
    const my = ++gen;
    const off = document.createElement('canvas');
    const r = await drawFn(off);
    if (my !== gen) return null; // もっと新しい描き直しが始まっている
    canvas.width = off.width; canvas.height = off.height;
    canvas.getContext('2d').drawImage(off, 0, 0);
    return r;
  };
}

// ===== Instagram向けのデザイン（共通の部品） =====
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
// 背景：黒地に、右上からのアクセントの光と、薄いピッチのライン
function bgModern(ctx, W, H, accent) {
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.96, H * 0.02, 0, W * 0.96, H * 0.02, W * 0.95);
  g.addColorStop(0, hexA(accent, 0.34)); g.addColorStop(0.42, hexA(accent, 0.08)); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.07; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, W * 0.004);
  ctx.beginPath(); ctx.arc(W * 0.93, W * 0.2, W * 0.34, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W * 0.93, -10); ctx.lineTo(W * 0.93, W * 0.8); ctx.stroke();
  ctx.restore();
  const v = ctx.createLinearGradient(0, H * 0.7, 0, H); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v; ctx.fillRect(0, H * 0.7, W, H * 0.3);
}
// 見出し：大会名を小さく、見出し（「U11 最終結果」など）を大きく左上に。見出しの下の位置を返す
async function headModern(ctx, W, u, t, o, accent, topPad) {
  const pad = 64 * u; let y = topPad; let x = pad;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const logo = o.showLogo && t.logo ? await loadImg(t.logo) : null;
  if (logo) { const s = 54 * u; const k = Math.min(s / logo.width, s / logo.height); ctx.drawImage(logo, x, y - 42 * u, logo.width * k, logo.height * k); x += s + 14 * u; }
  const title = o.title || t.name || '';
  const ts = fitFont(ctx, title, W - pad - x, 30 * u, 700, 16 * u);
  ctx.fillStyle = '#d6d3d1'; ctx.font = `700 ${ts}px ${FONT}`; ctx.fillText(title, x, y);
  y += 24 * u;
  const head = o.subtitle || '';
  const hs = fitFont(ctx, head, W - pad * 2, 98 * u, 900, 34 * u);
  ctx.fillStyle = '#ffffff'; ctx.font = `900 ${hs}px ${FONT}`; ctx.fillText(head, pad, y + hs * 0.94);
  y += hs * 0.94 + 26 * u;
  ctx.fillStyle = accent; ctx.fillRect(pad, y, 132 * u, 10 * u);
  return y + 10 * u + 34 * u;
}
function footModern(ctx, W, H, u, o, accent, lift = 0) {
  const pad = 64 * u; const base = H - lift;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.beginPath(); ctx.moveTo(pad, base - 80 * u); ctx.lineTo(W - pad, base - 80 * u); ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.fillStyle = accent; ctx.font = `900 ${22 * u}px ${FONT}`;
  ctx.fillText('INFINEX', W - pad, base - 44 * u);
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.72)';
  const fs = fitFont(ctx, o.footer || '', W - pad * 2 - 170 * u, 22 * u, 700, 12 * u); ctx.font = `700 ${fs}px ${FONT}`;
  ctx.fillText(o.footer || '', pad, base - 44 * u);
}
// チームのロゴ（無いときは頭文字の丸）
function crestModern(ctx, img, team, cx, cy, size, onLight) {
  if (img) { const k = Math.min(size / img.width, size / img.height); ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k); return; }
  ctx.fillStyle = onLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = onLight ? '#0c0a09' : '#e7e5e4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${size * 0.46}px ${FONT}`;
  ctx.fillText(team ? [...(team.short_name || team.name)][0] || '' : '', cx, cy + size * 0.03); ctx.textAlign = 'left';
}
// 名前を幅に収めて1行で描く（左そろえ）
function nameFit(ctx, text, x, cy, maxW, size, color, weight = 900, min = 10) {
  const s = fitFont(ctx, text, maxW, size, weight, min);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.font = `${weight} ${s}px ${FONT}`; ctx.fillText(text, x, cy + s * 0.04);
}

export async function drawPoster(canvas, t, cat, o) {
  const { w: W, h: H } = SIZES[o.size] || SIZES.sns;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = (ACCENTS[o.accent] || ACCENTS.lime)[1];
  const u = W / 1080; const pad = 64 * u; const story = o.size === 'story';
  bgModern(ctx, W, H, accent);
  let top = await headModern(ctx, W, u, t, o, accent, story ? 270 * u : 104 * u);
  const lift = story ? 210 * u : 0; // ストーリーは下部が操作の表示に隠れるので、少し上げる
  const bottom = H - lift - 104 * u;
  const rows = rowsOf(cat, o.kind); const n = rows.length;
  const logos = await Promise.all(rows.map((r) => (o.showTeamLogo ? loadImg(r.team.logo) : null)));
  let rest = rows.map((r, i) => ({ ...r, i }));
  // 最終順位は表彰台の形：優勝を大きなカード、2位・3位を並べたカード
  const podium = o.kind === 'ranking' && n >= 3 && rows[0].no === 1 && rows[1].no === 2 && rows[2].no === 3;
  if (podium) {
    const k = n - 3 > 30 ? 0.72 : n - 3 > 14 ? 0.86 : 1;
    const h1 = 196 * u * k, h2 = 132 * u * k, gap = 14 * u, cw = W - pad * 2;
    ctx.fillStyle = accent; rr(ctx, pad, top, cw, h1, 28 * u); ctx.fill();
    ctx.fillStyle = '#0c0a09'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `900 ${h1 * 0.66}px ${FONT}`; ctx.fillText('1', pad + 34 * u, top + h1 / 2 + h1 * 0.03);
    const c1 = h1 * 0.6; const lx = pad + 34 * u + h1 * 0.5;
    if (o.showTeamLogo) crestModern(ctx, logos[0], rows[0].team, lx + c1 / 2, top + h1 / 2, c1, true);
    const nx = lx + (o.showTeamLogo ? c1 + 24 * u : 0);
    ctx.fillStyle = '#0c0a09'; rr(ctx, nx, top + h1 * 0.16, 92 * u * k, 34 * u * k, 17 * u); ctx.fill();
    ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.font = `900 ${19 * u * k}px ${FONT}`; ctx.fillText('優勝', nx + 46 * u * k, top + h1 * 0.16 + 18 * u * k);
    nameFit(ctx, rows[0].team.name, nx, top + h1 * 0.62, pad + cw - nx - 28 * u, 58 * u * k, '#0c0a09', 900, 16 * u);
    const w2 = (cw - gap) / 2; const y2 = top + h1 + gap;
    for (let j = 0; j < 2; j++) {
      const x = pad + j * (w2 + gap); const r = rows[j + 1];
      ctx.fillStyle = '#171717'; rr(ctx, x, y2, w2, h2, 22 * u); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = Math.max(1, 1.5 * u); rr(ctx, x, y2, w2, h2, 22 * u); ctx.stroke();
      ctx.fillStyle = accent; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `900 ${h2 * 0.5}px ${FONT}`; ctx.fillText(String(r.no), x + 24 * u, y2 + h2 / 2 + h2 * 0.02);
      const c2 = h2 * 0.54; const l2 = x + 24 * u + h2 * 0.42;
      if (o.showTeamLogo) crestModern(ctx, logos[j + 1], r.team, l2 + c2 / 2, y2 + h2 / 2, c2, false);
      const n2 = l2 + (o.showTeamLogo ? c2 + 16 * u : 0);
      nameFit(ctx, r.team.short_name && [...r.team.name].length > 12 ? r.team.short_name : r.team.name, n2, y2 + h2 / 2, x + w2 - n2 - 18 * u, 34 * u * k, '#ffffff', 900, 12 * u);
    }
    top = y2 + h2 + 26 * u;
    rest = rest.slice(3);
  }
  const m = rest.length;
  let cols = 1;
  if (m) {
    cols = o.cols && o.cols !== 'auto' ? Number(o.cols) : m <= 10 ? 1 : m <= 40 ? 2 : 3;
    const perCol = Math.ceil(m / cols); const colGap = 34 * u;
    const rowH = Math.min((story ? 100 : 78) * u, (bottom - top) / perCol);
    const colW = (W - pad * 2 - colGap * (cols - 1)) / cols;
    const fs = Math.max(12 * u, Math.min(36 * u, rowH * 0.5));
    const noW = fs * 1.7, cs = Math.min(rowH * 0.66, fs * 1.4);
    rest.forEach((r, idx) => {
      const c = Math.floor(idx / perCol), kk = idx % perCol;
      const x = pad + c * (colW + colGap), cy = top + kk * rowH + rowH / 2;
      if (o.myTeam && r.team.id === o.myTeam) { ctx.fillStyle = hexA(accent, 0.2); rr(ctx, x - 8 * u, cy - rowH / 2 + 3, colW + 16 * u, rowH - 6, 12 * u); ctx.fill(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = Math.max(1, 1.2 * u); ctx.beginPath(); ctx.moveTo(x, cy + rowH / 2); ctx.lineTo(x + colW, cy + rowH / 2); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = o.kind === 'ranking' ? '#a8a29e' : accent; ctx.font = `900 ${fs * 0.9}px ${FONT}`; ctx.fillText(String(r.no), x + noW - 6 * u, cy + fs * 0.03);
      let nx = x + noW + 8 * u;
      if (o.showTeamLogo) { crestModern(ctx, logos[r.i], r.team, nx + cs / 2, cy, cs, false); nx += cs + 14 * u; }
      nameFit(ctx, r.team.name, nx, cy, x + colW - nx - 4 * u, fs, '#f5f5f4', 800, 9 * u);
    });
  } else if (!podium) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `700 ${30 * u}px ${FONT}`;
    ctx.fillText(o.kind === 'ranking' ? 'まだ順位が決まっていません' : 'チームがいません', pad, (top + bottom) / 2);
  }
  footModern(ctx, W, H, u, o, accent, lift);
  return { rows: n, cols };
}

// 結果一覧（ポスター）の画面
export function openResultPoster(t, categories, catId, opts = {}) {
  const cat0 = categories.find((c) => c.id === catId) || categories[0];
  const o = {
    catId: cat0.id, kind: opts.kind || ((cat0.finalRanking || []).length ? 'ranking' : 'teams'), size: 'sns', accent: 'lime', cols: 'auto',
    showLogo: false, showTeamLogo: true,
  };
  const defaults = () => {
    const cat = categories.find((c) => c.id === o.catId);
    o.title = t.name;
    o.subtitle = `${cat.name} ${o.kind === 'ranking' ? '最終結果' : '参加チーム'}`;
    o.footer = [t.venue, t.date].filter(Boolean).join('　');
  };
  defaults();
  const canvas = h('canvas', { class: 'poster-canvas' });
  const info = h('p', { class: 'muted small', style: { margin: 0 } });
  const body = h('div', { class: 'poster' });
  const paint = latestPainter(canvas);
  const redraw = async () => {
    const cat = categories.find((c) => c.id === o.catId);
    const r = await paint((c) => drawPoster(c, t, cat, o));
    if (!r) return;
    info.textContent = r.rows ? `${r.rows}チーム・${r.cols}列で表示しています` : o.kind === 'ranking' ? 'まだ順位が決まっていません（試合の結果が確定すると、決まった順位から表示されます）' : 'チームがいません';
  };
  const sel = (label, key, opts, after) => h('label', { class: 'field' }, h('span', null, label), h('select', { onchange: (e) => { o[key] = e.target.value; if (after) after(); draw(); redraw(); } },
    opts.map(([v, l, dis]) => h('option', { value: v, selected: o[key] === v, disabled: !!dis }, l))));
  const txt = (label, key) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'text', value: o[key], oninput: (e) => { o[key] = e.target.value; redraw(); } }));
  const chk = (label, key) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; redraw(); } }), label);
  const draw = () => {
    const cat = categories.find((c) => c.id === o.catId);
    mount(body,
      h('div', { class: 'poster-preview' }, canvas),
      h('div', { class: 'poster-form' },
        categories.length > 1 ? sel('カテゴリ', 'catId', categories.map((c) => [c.id, c.name]), defaults) : null,
        sel('内容', 'kind', [['ranking', `最終順位${(cat.finalRanking || []).length ? '' : '（まだ決まっていません）'}`], ['teams', '参加チーム一覧']], defaults),
        sel('形', 'size', Object.entries(SIZES).map(([k, v]) => [k, v.label])),
        sel('列の数', 'cols', [['auto', '自動'], ['1', '1列'], ['2', '2列'], ['3', '3列']]),
        sel('アクセントの色', 'accent', Object.entries(ACCENTS).map(([k, v]) => [k, v[0]])),
        txt('タイトル', 'title'), txt('サブタイトル（アクセントの色）', 'subtitle'), txt('下部の文字', 'footer'),
        chk('チームのロゴを入れる', 'showTeamLogo'), chk('大会のロゴを入れる', 'showLogo'),
        info));
  };
  draw();
  const fileBase = () => `${t.name}_${categories.find((c) => c.id === o.catId).name}_${o.kind === 'ranking' ? '最終結果' : '参加チーム'}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  modal({
    title: '結果一覧（画像・PDF）',
    content: body,
    actions: [
      { label: '閉じる', kind: 'btn-ghost' },
      { label: 'PDFで保存', kind: '', onClick: async () => {
        const cat = categories.find((c) => c.id === o.catId);
        const c2 = h('canvas');
        await drawPoster(c2, t, cat, { ...o, size: 'a4' });
        const doc = h('div', { class: 'poster-print' }, h('img', { src: c2.toDataURL('image/png'), alt: '' }));
        runPrint(doc, fileBase(), '@page { size: A4 portrait; margin: 0; }');
        return true;
      } },
      { label: '画像を保存', kind: 'btn-primary', onClick: () => { saveImages(canvas, fileBase()); return true; } },
    ],
  });
  redraw();
}


// ======================================================================
// 試合結果（SNS画像）：組ごと・回戦ごとの試合結果を、SNSに投稿しやすい縦長の画像にする
// ======================================================================

const MATCH_ACCENTS = { cyan: ['シアン', '#22d3ee'], magenta: ['マゼンタ', '#e040fb'], lime: ['ライム', '#c8ff3d'], orange: ['オレンジ', '#ff8a1f'], red: ['赤', '#ff3b45'] };
const roundName = (m) => String(m.label || '').replace(m.group_label || '', '').replace(/\s*\d+$/, '').trim() || m.label;

// 出力の範囲：予選リーグの組／リーグ戦の段／決勝の段と回戦
function scopesOf(cat) {
  const out = [];
  const league = cat.matches.filter((m) => m.stage === 'league');
  for (const g of [...new Set(league.map((m) => m.group_label))].sort()) {
    out.push({ key: `L:${g}`, label: `${g}組 予選リーグ`, league: true, filter: (m) => m.stage === 'league' && m.group_label === g });
  }
  const ko = cat.matches.filter((m) => m.stage === 'knockout');
  const minPlace = (name) => Math.min(...ko.filter((m) => (m.group_label || '') === name).map((m) => m.place_w ?? 999));
  const names = [...new Set(ko.map((m) => m.group_label || ''))].sort((a, b) => minPlace(a) - minPlace(b));
  for (const name of names) {
    const list = ko.filter((m) => (m.group_label || '') === name);
    if (list.some(isRankLeague)) { out.push({ key: `R:${name}`, label: name, league: true, filter: (m) => m.stage === 'knockout' && (m.group_label || '') === name }); continue; }
    const rounds = [...new Set([...list].sort((a, b) => a.slot - b.slot).map(roundName))];
    for (const rn of rounds) out.push({ key: `K:${name}:${rn}`, label: `${name || '決勝トーナメント'} ${rn}`, filter: (m) => m.stage === 'knockout' && (m.group_label || '') === name && roundName(m) === rn });
  }
  return out;
}

function matchesOf(cat, o) {
  const sc = scopesOf(cat).find((x) => x.key === o.scope);
  if (!sc) return [];
  return cat.matches.filter(sc.filter).filter((m) => (o.round === 'all' || !sc.league || String(m.round) === String(o.round)) && (!o.onlyDone || m.status === 'confirmed'))
    .sort((a, b) => a.slot - b.slot || a.start_min - b.start_min || a.court - b.court);
}

// 名前を幅に収めて描く（小さくなりすぎるときは2行）
function drawName(ctx, text, x, cy, maxW, fs, align, color, u) {
  ctx.textAlign = align; ctx.fillStyle = color; ctx.textBaseline = 'middle';
  const one = fitFont(ctx, text, maxW, fs, 900, 10 * u);
  if (one >= fs * 0.7 || [...text].length < 6) { ctx.font = `900 ${one}px ${FONT}`; ctx.fillText(text, x, cy); return; }
  const chars = [...text]; const cut = Math.ceil(chars.length / 2);
  const l1 = chars.slice(0, cut).join(''), l2 = chars.slice(cut).join('');
  const s2 = Math.min(fitFont(ctx, l1, maxW, fs * 0.78, 900, 9 * u), fitFont(ctx, l2, maxW, fs * 0.78, 900, 9 * u));
  ctx.font = `900 ${s2}px ${FONT}`; ctx.fillText(l1, x, cy - s2 * 0.55); ctx.fillText(l2, x, cy + s2 * 0.6);
}

function crestAt(ctx, img, team, cx, cy, size, u) {
  if (img) {
    const r = Math.min(size / img.width, size / img.height);
    ctx.drawImage(img, cx - (img.width * r) / 2, cy - (img.height * r) / 2, img.width * r, img.height * r);
    return;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8ecea'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${size * 0.46}px ${FONT}`;
  ctx.fillText(team ? [...(team.short_name || team.name)][0] : '?', cx, cy + 1);
}

// 写真が無いときの上部：ピッチのラインと斜めのストライプ
function designedTop(ctx, W, topH, accent) {
  const g = ctx.createLinearGradient(0, 0, W, topH);
  g.addColorStop(0, '#0e1513'); g.addColorStop(1, '#16221d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, topH);
  ctx.save();
  ctx.globalAlpha = 0.16; ctx.strokeStyle = accent; ctx.lineWidth = 6;
  const cx = W * 0.78, cy = topH * 0.5, r = topH * 0.36;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, -10); ctx.lineTo(cx, topH + 10); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
  ctx.strokeRect(W * 0.98, topH * 0.18, W * 0.2, topH * 0.64);
  ctx.globalAlpha = 0.1; ctx.fillStyle = accent;
  for (let i = 0; i < 7; i++) { const x0 = W * 0.42 + i * 70; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 28, 0); ctx.lineTo(x0 - 140, topH); ctx.lineTo(x0 - 168, topH); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

export async function drawMatchPoster(canvas, t, cat, o, page = 0) {
  const W = 1080, H = 1350, u = 1;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = (MATCH_ACCENTS[o.accent] || MATCH_ACCENTS.cyan)[1];
  const all = matchesOf(cat, o);
  const per = o.perPage === 'all' ? Math.max(3, all.length) : Math.max(3, Math.min(8, Number(o.perPage) || 5));
  const pages = Math.max(1, Math.ceil(all.length / per));
  const list = all.slice(page * per, page * per + per);
  const sponsors = (t.sponsors || []).filter((sp) => sp.img);
  const footH = sponsors.length ? 120 : 70;
  // 試合が多いときは、上部（写真・見出し）を低くして試合のカードに場所を回す
  const topH = per > 6 ? Math.max(420, 600 - (per - 6) * 30) : 600;
  // 全体の背景
  ctx.fillStyle = '#0b0e0d'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.05; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  for (let x = -H; x < W; x += 26) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H * 0.5, topH - 80); ctx.stroke(); }
  ctx.restore();
  // 上部（写真か、デザイン）。下の端は斜めに切る
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, topH - 90); ctx.lineTo(0, topH); ctx.closePath(); ctx.clip();
  const photo = o.photoUrl ? await loadImg(o.photoUrl) : null;
  if (photo) {
    const r = Math.max(W / photo.width, topH / photo.height);
    const pw = photo.width * r, ph = photo.height * r;
    ctx.drawImage(photo, W - pw + (pw - W) * 0.15, (topH - ph) / 2, pw, ph);
    const gl = ctx.createLinearGradient(0, 0, W * 0.75, 0);
    gl.addColorStop(0, 'rgba(6,8,8,0.92)'); gl.addColorStop(0.55, 'rgba(6,8,8,0.55)'); gl.addColorStop(1, 'rgba(6,8,8,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, W, topH);
  } else designedTop(ctx, W, topH, accent);
  ctx.restore();
  // 斜めの縁のアクセントの線
  ctx.strokeStyle = accent; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, topH + 4); ctx.lineTo(W, topH - 86); ctx.stroke();
  // 文字（左上）
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let y = 92;
  const tLogo = o.showLogo && t.logo ? await loadImg(t.logo) : null;
  let tx = 60;
  if (tLogo) { const sz = 72; ctx.drawImage(tLogo, 60, y - 56, sz, sz); tx = 60 + sz + 18; }
  const ts = fitFont(ctx, o.title, W * 0.62 - (tx - 60), 50, 900, 24);
  ctx.fillStyle = '#ffffff'; ctx.font = `900 ${ts}px ${FONT}`; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.fillText(o.title, tx, y); ctx.shadowBlur = 0;
  y += 190;
  // カテゴリ名（大きく、少し斜体）
  const cs = fitFont(ctx, o.big, W * 0.58, 168, 900, 60);
  ctx.save(); ctx.translate(60, y); ctx.transform(1, 0, -0.12, 1, 0, 0);
  ctx.font = `900 ${cs}px ${FONT}`; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(o.big, 0, 0);
  ctx.fillStyle = accent; ctx.fillText(o.big, 0, 0); ctx.restore();
  y += 40;
  // 範囲の帯
  ctx.font = `900 34px ${FONT}`;
  const lw = Math.min(W * 0.62, ctx.measureText(o.scopeText).width + 44);
  ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(60, y, lw, 58, 10); ctx.fill();
  ctx.fillStyle = '#0b0e0d'; ctx.textBaseline = 'middle'; const ps = fitFont(ctx, o.scopeText, lw - 40, 34, 900, 18); ctx.font = `900 ${ps}px ${FONT}`; ctx.fillText(o.scopeText, 82, y + 30);
  y += 94;
  if (o.dateText) { ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = `700 28px ${FONT}`; ctx.fillText(o.dateText, 62, y); }
  // 試合のカード
  const areaTop0 = topH + 20, areaBottom = H - footH - 22;
  // 試合数が少ないときは、カードを少し大きくして全体の中央に置く
  const slots = Math.max(list.length, Math.min(per, 3));
  const rowH = Math.min(list.length < per ? 150 : 132, (areaBottom - areaTop0) / slots);
  const areaTop = list.length && list.length < per ? areaTop0 + ((areaBottom - areaTop0) - rowH * list.length) / 2 : areaTop0;
  const tm = teamMap(cat); const cache = { teams: tm, codes: codeMap(cat) };
  const imgs = await Promise.all(list.flatMap((m) => [m.home_team_id, m.away_team_id]).map((id) => (o.showTeamLogo && tm[id] ? loadImg(tm[id].logo) : null)));
  if (!list.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 34px ${FONT}`;
    fillCenter(ctx, o.onlyDone ? 'まだ確定した試合がありません' : '試合がありません', W / 2, (areaTop0 + areaBottom) / 2);
  }
  list.forEach((m, i) => {
    const top = areaTop + i * rowH + 6, hgt = rowH - 12, cy = top + hgt / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.065)'; ctx.beginPath(); ctx.roundRect(40, top, W - 80, hgt, 18); ctx.fill();
    ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(40, top, 9, hgt, [18, 0, 0, 18]); ctx.fill();
    const done = m.status === 'confirmed' && m.home_score != null;
    const w = done ? winnerSide(m) : null;
    const hi = sideInfo(m, 'home', cat, cache), ai = sideInfo(m, 'away', cat, cache);
    const hName = hi.placeholder ? hi.text : hi.team.short_name || hi.team.name;
    const aName = ai.placeholder ? ai.text : ai.team.short_name || ai.team.name;
    const lg = Math.min(hgt * 0.62, 74);
    if (o.showTeamLogo) { crestAt(ctx, imgs[i * 2], hi.team, 70 + lg / 2 + 10, cy, lg, u); crestAt(ctx, imgs[i * 2 + 1], ai.team, W - 70 - lg / 2 - 10, cy, lg, u); }
    const scoreW = 214, mid = W / 2;
    const nameMax = mid - scoreW / 2 - 24 - (o.showTeamLogo ? 70 + lg + 30 : 80);
    const fs = Math.min(40, hgt * 0.34);
    const dim = 'rgba(255,255,255,0.55)';
    drawName(ctx, hName, mid - scoreW / 2 - 18, cy, nameMax, fs, 'right', w === 'away' ? dim : '#ffffff', u);
    drawName(ctx, aName, mid + scoreW / 2 + 18, cy, nameMax, fs, 'left', w === 'home' ? dim : '#ffffff', u);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.roundRect(mid - scoreW / 2, top + 10, scoreW, hgt - 20, 14); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (done) {
      const pk = m.home_pk != null;
      const sy = pk ? cy - hgt * 0.1 : cy;
      const sz = Math.min(64, hgt * 0.52);
      ctx.font = `900 ${sz}px ${FONT}`;
      ctx.fillStyle = w === 'away' ? dim : '#ffffff'; ctx.fillText(String(m.home_score), mid - 56, sy);
      ctx.fillStyle = w === 'home' ? dim : '#ffffff'; ctx.fillText(String(m.away_score), mid + 56, sy);
      ctx.fillStyle = accent; ctx.font = `900 ${sz * 0.5}px ${FONT}`; ctx.fillText('-', mid, sy);
      if (pk) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `800 ${Math.min(22, hgt * 0.2)}px ${FONT}`; ctx.fillText(`PK ${m.home_pk}-${m.away_pk}`, mid, cy + hgt * 0.29); }
    } else {
      ctx.fillStyle = '#ffffff'; ctx.font = `900 ${Math.min(34, hgt * 0.3)}px ${FONT}`;
      ctx.fillText(`${Math.floor(m.start_min / 60)}:${String(m.start_min % 60).padStart(2, '0')}`, mid, cy - hgt * 0.11);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `700 ${Math.min(20, hgt * 0.18)}px ${FONT}`; ctx.fillText(courtName(cat.config, m.court), mid, cy + hgt * 0.2);
    }
  });
  if (pages > 1) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.font = `800 24px ${FONT}`; ctx.fillText(`${page + 1} / ${pages}`, W - 44, areaTop0 - 2); }
  // 下部：協賛（白い帯）か、大会名
  if (sponsors.length) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, H - footH, W, footH);
    const ims = (await Promise.all(sponsors.slice(0, 6).map((sp) => loadImg(sp.img)))).filter(Boolean);
    const slot = (W - 80) / Math.max(1, ims.length);
    ims.forEach((im, k) => {
      const mw = slot - 30, mh = footH - 44, r = Math.min(mw / im.width, mh / im.height);
      ctx.drawImage(im, 40 + k * slot + (slot - im.width * r) / 2, H - footH + (footH - im.height * r) / 2, im.width * r, im.height * r);
    });
  } else {
    ctx.fillStyle = accent; ctx.fillRect(0, H - footH, W, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 24px ${FONT}`;
    fillCenter(ctx, o.footer || '', W / 2, H - footH / 2 + 3);
  }
  return { count: all.length, pages };
}

// 試合結果（SNS画像）の画面
export function openMatchPoster(t, categories, catId, opts = {}) {
  const canPhoto = opts.canPhoto !== false;
  const cats = categories.filter((c) => c.matches.length);
  if (!cats.length) { toast('日程がまだありません', true); return; }
  const accKeys = Object.keys(MATCH_ACCENTS);
  const o = { catId: (cats.find((c) => c.id === catId) || cats[0]).id, round: 'all', onlyDone: true, perPage: 'all', showTeamLogo: true, showLogo: false, page: 0 };
  const photos = () => ((t.settings || {}).snsPhotos || {});
  const reset = () => {
    const cat = cats.find((c) => c.id === o.catId);
    const sc = scopesOf(cat);
    if (!sc.find((x) => x.key === o.scope)) {
      // まず確定した試合がある最後の範囲を選ぶ
      const withDone = sc.filter((x) => cat.matches.some((m) => x.filter(m) && m.status === 'confirmed'));
      o.scope = (withDone[withDone.length - 1] || sc[0] || {}).key;
    }
    o.accent = o.accent || accKeys[cats.indexOf(cat) % accKeys.length];
    o.title = t.name; o.big = cat.name;
    o.scopeText = (sc.find((x) => x.key === o.scope) || {}).label || '';
    const ms = matchesOf(cat, { ...o, onlyDone: false });
    const days = [...new Set(ms.map((m) => dayOf(cat.config, m.slot)))];
    o.dateText = days.map((d) => dayLabel(cat, d, t, true)).join('・');
    o.footer = [t.venue].filter(Boolean).join('');
    o.photoUrl = photos()[o.catId] ? `/img/a/${photos()[o.catId]}` : null;
    o.page = 0;
  };
  reset();
  const canvas = h('canvas', { class: 'poster-canvas' });
  const info = h('p', { class: 'muted small', style: { margin: 0 } });
  const body = h('div', { class: 'poster' });
  let total = 1;
  const paint = latestPainter(canvas);
  const redraw = async () => {
    const cat = cats.find((c) => c.id === o.catId);
    const r = await paint((c) => drawMatchPoster(c, t, cat, o, o.page));
    if (!r) return;
    total = r.pages;
    info.textContent = o.perPage === 'all' ? `${r.count}試合を1枚にまとめています` : `${r.count}試合・${r.pages}枚（1枚に${o.perPage}試合まで）`;
    draw(true);
  };
  const sel = (label, key, opts, after) => h('label', { class: 'field' }, h('span', null, label), h('select', { onchange: (e) => { o[key] = e.target.value; if (after) after(); draw(); redraw(); } },
    opts.map(([v, l]) => h('option', { value: v, selected: String(o[key]) === String(v) }, l))));
  const txt = (label, key) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'text', value: o[key], oninput: (e) => { o[key] = e.target.value; redraw(); } }));
  const chk = (label, key, after) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; if (after) after(); redraw(); } }), label);
  const pickPhoto = () => {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    input.onchange = async () => {
      const file = input.files && input.files[0]; input.remove(); if (!file) return;
      const img = await run(() => resizeBanner(file, 1600, 1600)); if (!img) return;
      const a = await run(() => api('POST', '/api/admin/assets', { owner: t.id, image: img })); if (!a) return;
      const next = { ...photos(), [o.catId]: a.id };
      if (await run(() => api('PATCH', `/api/admin/tournaments/${t.id}`, { settings: { snsPhotos: next } }), '写真を登録しました')) {
        t.settings = { ...(t.settings || {}), snsPhotos: next }; o.photoUrl = `/img/a/${a.id}`; draw(); redraw();
      }
    };
    document.body.append(input); input.click();
  };
  const removePhoto = async () => {
    const next = { ...photos() }; const old = next[o.catId]; delete next[o.catId];
    if (await run(() => api('PATCH', `/api/admin/tournaments/${t.id}`, { settings: { snsPhotos: next } }), '写真を外しました')) {
      if (old) api('DELETE', `/api/admin/assets/${old}`).catch(() => {});
      t.settings = { ...(t.settings || {}), snsPhotos: next }; o.photoUrl = null; draw(); redraw();
    }
  };
  let formEl = null;
  const draw = (pagerOnly) => {
    const cat = cats.find((c) => c.id === o.catId);
    const sc = scopesOf(cat);
    const cur = sc.find((x) => x.key === o.scope);
    const rounds = cur && cur.league ? [...new Set(cat.matches.filter(cur.filter).map((m) => m.round))].sort((a, b) => a - b) : [];
    const pager = h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
      h('button', { class: 'btn btn-sm', type: 'button', disabled: o.page <= 0, onclick: () => { o.page--; redraw(); } }, '← 前の1枚'),
      h('strong', null, `${o.page + 1} / ${total}`),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: o.page >= total - 1, onclick: () => { o.page++; redraw(); } }, '次の1枚 →'));
    if (pagerOnly && formEl) { formEl.querySelector('.poster-pager').replaceChildren(pager); return; }
    formEl = h('div', { class: 'poster-form' },
      cats.length > 1 ? sel('カテゴリ', 'catId', cats.map((c) => [c.id, c.name]), () => { o.scope = null; o.accent = null; reset(); }) : null,
      sel('出力の範囲', 'scope', sc.map((x) => [x.key, x.label]), () => { o.round = 'all'; o.page = 0; o.scopeText = (sc.find((x) => x.key === o.scope) || {}).label || ''; const ms = matchesOf(cat, { ...o, onlyDone: false }); o.dateText = [...new Set(ms.map((m) => dayOf(cat.config, m.slot)))].map((d) => dayLabel(cat, d, t, true)).join('・'); }),
      rounds.length > 1 ? sel('節', 'round', [['all', 'すべての節'], ...rounds.map((r) => [r, `第${r}節`])], () => { o.page = 0; }) : null,
      chk('確定した試合だけ', 'onlyDone', () => { o.page = 0; }),
      sel('1枚の試合数', 'perPage', [['all', 'すべて（1枚に収める）'], ...[3, 4, 5, 6, 7, 8].map((n) => [n, `${n}試合ずつ（複数枚）`])], () => { o.page = 0; }),
      sel('アクセントの色', 'accent', Object.entries(MATCH_ACCENTS).map(([k, v]) => [k, v[0]])),
      txt('大会名', 'title'), txt('大きな文字（カテゴリ）', 'big'), txt('範囲の文字', 'scopeText'), txt('日付', 'dateText'),
      !canPhoto ? h('p', { class: 'muted small', style: { margin: 0 } }, o.photoUrl ? `写真：大会の管理者が登録した写真を使います（${cat.name}）` : '写真：大会の管理者が登録すると、上部に表示されます') :
      h('div', { class: 'poster-photo' }, h('span', { class: 'small', style: { fontWeight: 700 } }, `写真（${cat.name}）`),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: pickPhoto }, o.photoUrl ? '写真を変更' : '写真を登録'),
          o.photoUrl ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: removePhoto }, '写真を外す') : null),
        h('small', { class: 'muted' }, '登録した写真は、このカテゴリの画像の上部に表示されます。無い場合はデザインの背景になります。')),
      chk('チームのロゴを入れる', 'showTeamLogo'), chk('大会のロゴを入れる', 'showLogo'),
      h('div', { class: 'poster-pager' }, pager), info);
    mount(body, h('div', { class: 'poster-preview' }, canvas), formEl);
  };
  draw();
  const base = () => {
    const cat = cats.find((c) => c.id === o.catId);
    return `${t.name}_${cat.name}_${o.scopeText}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  };
  modal({
    title: '試合結果（SNS画像）',
    content: body,
    actions: [
      { label: '閉じる', kind: 'btn-ghost' },
      { label: 'すべて保存', kind: '', onClick: async () => {
        const cat = cats.find((c) => c.id === o.catId);
        const list = [];
        for (let pg = 0; pg < total; pg++) { const cv = h('canvas'); await drawMatchPoster(cv, t, cat, o, pg); list.push(cv); }
        await saveImages(list, base());
        return true;
      } },
      { label: 'この1枚を保存', kind: 'btn-primary', onClick: () => { saveImages(canvas, `${base()}${total > 1 ? `_${o.page + 1}` : ''}`); return true; } },
    ],
  });
  redraw();
}


// ======================================================================
// 順位表（SNS画像）：すべての組を1枚に収める。チーム名は折り返さず1行（長い名前は小さく）
// ======================================================================
export async function drawStandingsImage(canvas, t, cat, o = {}) {
  const { w: W, h: H } = SIZES[o.size] || SIZES.square;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = (ACCENTS[o.accent] || ACCENTS.lime)[1];
  const u = W / 1080; const pad = 56 * u; const story = o.size === 'story';
  bgModern(ctx, W, H, accent);
  const tm = teamMap(cat);
  const groups = Object.entries(cat.standings || {}).sort(([a], [b]) => a.localeCompare(b));
  const top = await headModern(ctx, W, u, t, { ...o, title: o.title || t.name, subtitle: o.subtitle || `${cat.name} 順位表` }, accent, story ? 270 * u : 104 * u) - 8 * u;
  const lift = story ? 210 * u : 0;
  const bottom = H - lift - 100 * u;
  // 列の数：行の高さとチーム名の幅のつり合いが一番良いものを選ぶ（組ごとに角丸のカード）
  const HEAD = 1.35, GAP = 0.45;
  let best = null;
  for (let cols = 1; cols <= Math.min(4, Math.max(1, groups.length)); cols++) {
    const per = Math.ceil(groups.length / cols);
    const units = Math.max(...Array.from({ length: cols }, (_, c) => groups.slice(c * per, c * per + per).reduce((a, [, g]) => a + g.rows.length + HEAD + GAP + 0.5, 0)));
    const rowH = Math.min(66 * u, (bottom - top) / units);
    const colW = (W - pad * 2 - 22 * u * (cols - 1)) / cols;
    const score = Math.min(rowH, colW / 10.5);
    if (!best || score > best.score) best = { cols, per, rowH, colW, score };
  }
  const { cols, per, rowH, colW } = best;
  const fs = Math.max(10 * u, Math.min(30 * u, rowH * 0.48));
  const cs = Math.min(rowH * 0.62, fs * 1.35);
  const logos = {};
  if (o.showTeamLogo !== false) await Promise.all(Object.values(tm).map(async (x) => { logos[x.id] = await loadImg(x.logo); }));
  for (let c = 0; c < cols; c++) {
    let y = top;
    const x = pad + c * (colW + 22 * u);
    for (const [gname, g] of groups.slice(c * per, c * per + per)) {
      const cardH = rowH * (HEAD + g.rows.length + 0.25);
      ctx.fillStyle = '#151515'; rr(ctx, x, y, colW, cardH, 18 * u); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = Math.max(1, 1.2 * u); rr(ctx, x, y, colW, cardH, 18 * u); ctx.stroke();
      const inX = x + fs * 0.7, inW = colW - fs * 1.4;
      const hy = y + rowH * HEAD / 2;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = accent; ctx.font = `900 ${fs * 1.08}px ${FONT}`;
      const gl = /リーグ|トーナメント/.test(gname) ? gname : `${gname}組`;
      ctx.fillText(gl, inX, hy);
      if (!g.complete) { const gw = ctx.measureText(gl).width; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `700 ${fs * 0.58}px ${FONT}`; ctx.fillText('途中経過', inX + gw + fs * 0.5, hy + fs * 0.06); }
      // 列が狭いときは「勝-分-敗」を省いて、チーム名に幅を回す
      const wide = colW > 620 * u;
      const cPts = inX + inW, cGd = cPts - fs * 2.1, cW = cGd - fs * 2.0;
      const nameEnd = wide ? cW - fs * 2.9 : cGd - fs * 1.7;
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `700 ${fs * 0.56}px ${FONT}`;
      ctx.fillText('勝点', cPts, hy); ctx.fillText('得失', cGd, hy); if (wide) ctx.fillText('勝-分-敗', cW, hy);
      y += rowH * HEAD;
      g.rows.forEach((r, ri) => {
        const cy = y + rowH / 2;
        const mine = o.myTeam && r.teamId === o.myTeam;
        if (mine) { ctx.fillStyle = hexA(accent, 0.22); rr(ctx, x + 4 * u, y + 1, colW - 8 * u, rowH - 2, 10 * u); ctx.fill(); }
        if (ri) { ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = Math.max(1, u); ctx.beginPath(); ctx.moveTo(inX, y); ctx.lineTo(inX + inW, y); ctx.stroke(); }
        // 順位：1位はアクセントの丸
        const bw = fs * 1.25;
        if (r.rank === 1) { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(inX + bw / 2, cy, bw / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.textAlign = 'center'; ctx.fillStyle = r.rank === 1 ? '#0c0a09' : '#d6d3d1'; ctx.font = `900 ${fs * 0.82}px ${FONT}`; ctx.fillText(String(r.rank), inX + bw / 2, cy + fs * 0.04);
        let nx = inX + bw + fs * 0.45;
        const team = tm[r.teamId];
        if (o.showTeamLogo !== false) { crestModern(ctx, team && logos[team.id], team, nx + cs / 2, cy, cs, false); nx += cs + fs * 0.4; }
        nameFit(ctx, team ? team.name : '-', nx, cy, nameEnd - nx, fs, '#f5f5f4', 800, 8 * u);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.font = `700 ${fs * 0.7}px ${FONT}`;
        if (wide) ctx.fillText(`${r.w}-${r.d}-${r.l}`, cW, cy + 1);
        ctx.fillText(r.gd > 0 ? `+${r.gd}` : String(r.gd), cGd, cy + 1);
        ctx.fillStyle = '#ffffff'; ctx.font = `900 ${fs}px ${FONT}`; ctx.fillText(String(r.pts), cPts, cy + 1);
        y += rowH;
      });
      y += rowH * (0.25 + GAP);
    }
  }
  footModern(ctx, W, H, u, o, accent, lift);
  return { cols };
}

// 管理画面・大会運営者の［SNS画像］：出力するものを選ぶ
export function openSnsChooser(t, categories, catId, opts = {}) {
  const pick = (fn) => () => { document.querySelector('.modal-back')?.remove(); fn(); };
  modal({
    title: 'SNS画像',
    content: h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: pick(() => openMatchPoster(t, categories, catId, opts)) }, '試合結果（組ごと・回戦ごと）'),
      h('p', { class: 'muted small', style: { margin: 0 } }, '予選リーグの組ごと、決勝トーナメントの1回戦・準決勝などの回戦ごとに、試合結果の画像を作ります。'),
      h('button', { class: 'btn btn-block', type: 'button', onclick: pick(() => openStandingsPoster(t, categories, catId)) }, '予選リーグの順位表'),
      h('button', { class: 'btn btn-block', type: 'button', onclick: pick(() => openResultPoster(t, categories, catId, { kind: 'ranking' })) }, '最終結果（順位の一覧）'),
      h('button', { class: 'btn btn-block', type: 'button', onclick: pick(() => openResultPoster(t, categories, catId, { kind: 'teams' })) }, '参加チーム一覧'),
      h('p', { class: 'muted small', style: { margin: 0 } }, '最終順位や参加チームを一覧にした画像（PDFも可）を作ります。')),
    actions: [{ label: '閉じる', kind: 'btn-ghost' }],
  });
}


// 予選リーグの順位表（SNS画像）：すべての組を1枚に。管理画面・大会運営者の［SNS画像］から
export function openStandingsPoster(t, categories, catId) {
  const cats = categories.filter((c) => Object.keys(c.standings || {}).length);
  if (!cats.length) { toast('予選リーグの順位表がありません', true); return; }
  const o = { catId: (cats.find((c) => c.id === catId) || cats[0]).id, size: 'sns', accent: 'lime' };
  const defaults = () => { const cat = cats.find((c) => c.id === o.catId); o.title = t.name; o.subtitle = `${cat.name} 予選リーグ 順位表`; o.footer = [t.venue, t.date].filter(Boolean).join('　'); };
  defaults();
  const canvas = h('canvas', { class: 'poster-canvas' });
  const paint = latestPainter(canvas);
  const body = h('div', { class: 'poster' });
  const redraw = () => { const cat = cats.find((c) => c.id === o.catId); paint((c) => drawStandingsImage(c, t, cat, o)); };
  const sel = (label, key, opts, after) => h('label', { class: 'field' }, h('span', null, label), h('select', { onchange: (e) => { o[key] = e.target.value; if (after) after(); draw(); redraw(); } },
    opts.map(([v, l]) => h('option', { value: v, selected: o[key] === v }, l))));
  const txt = (label, key) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'text', value: o[key], oninput: (e) => { o[key] = e.target.value; redraw(); } }));
  const draw = () => mount(body, h('div', { class: 'poster-preview' }, canvas), h('div', { class: 'poster-form' },
    cats.length > 1 ? sel('カテゴリ', 'catId', cats.map((c) => [c.id, c.name]), defaults) : null,
    sel('形', 'size', [['sns', 'SNS用（縦 4:5）'], ['square', '正方形（1:1）'], ['story', 'ストーリー（9:16）']]),
    sel('アクセントの色', 'accent', Object.entries(ACCENTS).map(([k, v]) => [k, v[0]])),
    txt('タイトル', 'title'), txt('サブタイトル', 'subtitle'), txt('下部の文字', 'footer'),
    h('p', { class: 'muted small', style: { margin: 0 } }, 'すべての組が1枚に収まるよう、列の数と文字の大きさを自動で調整します。')));
  draw();
  modal({ title: '予選リーグの順位表（SNS画像）', content: body, actions: [
    { label: '閉じる', kind: 'btn-ghost' },
    { label: '画像を保存', kind: 'btn-primary', onClick: () => { const cat = cats.find((c) => c.id === o.catId); saveImages(canvas, `${t.name}_${cat.name}_予選順位表`); return true; } },
  ] });
  redraw();
}
