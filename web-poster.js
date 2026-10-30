// 結果一覧（ポスター）：最終順位・参加チームの一覧を、SNS用の画像（PNG）や PDF にする
// ブラウザの Canvas で直接描く（外部のサービスは使わない）
import { h, mount, modal, toast } from './web-ui.js';
import { teamMap } from './web-views.js';
import { runPrint } from './web-print.js';

const SIZES = {
  sns: { label: 'SNS用（縦 4:5）', w: 1080, h: 1350 },
  square: { label: '正方形（1:1）', w: 1080, h: 1080 },
  a4: { label: 'A4縦（印刷用）', w: 1654, h: 2339 },
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
function fitFont(ctx, text, maxW, size, weight = 900, min = 10) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > min) { s -= 1; ctx.font = `${weight} ${s}px ${FONT}`; }
  return s;
}

export async function drawPoster(canvas, t, cat, o) {
  const { w: W, h: H } = SIZES[o.size] || SIZES.sns;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = (ACCENTS[o.accent] || ACCENTS.lime)[1];
  const u = W / 1080; // 大きさの基準
  background(ctx, W, H);
  // タイトル・サブタイトル
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const pad = 64 * u;
  let y = 120 * u;
  const tLogo = o.showLogo && t.logo ? await loadImg(t.logo) : null;
  if (tLogo) { const s = 92 * u; ctx.drawImage(tLogo, W / 2 - s / 2, y - 92 * u, s, s); y += 24 * u; }
  const ts = fitFont(ctx, o.title, W - pad * 2, 84 * u, 900, 24 * u);
  ctx.fillStyle = '#f2f2f2'; ctx.font = `900 ${ts}px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12 * u;
  ctx.fillText(o.title, W / 2, y + ts * 0.25); ctx.shadowBlur = 0;
  y += ts * 0.25 + 64 * u;
  if (o.subtitle) {
    const ss = fitFont(ctx, o.subtitle, W - pad * 2, 46 * u, 900, 18 * u);
    ctx.fillStyle = accent; ctx.font = `900 ${ss}px ${FONT}`;
    ctx.fillText(o.subtitle, W / 2, y); y += 40 * u;
  }
  // 一覧
  const rows = rowsOf(cat, o.kind);
  const top = y + 30 * u, bottom = H - 70 * u;
  const n = rows.length;
  const cols = o.cols && o.cols !== 'auto' ? Number(o.cols) : n <= 12 ? 1 : n <= 44 ? 2 : 3;
  const perCol = Math.ceil(n / cols) || 1;
  const rowH = Math.min(78 * u, (bottom - top) / perCol);
  const colGap = 36 * u;
  const colW = (W - pad * 2 - colGap * (cols - 1)) / cols;
  const fs = Math.max(12 * u, Math.min(38 * u, rowH * 0.5));
  const noW = fs * 1.8, logoS = Math.min(rowH * 0.66, fs * 1.35);
  const logos = await Promise.all(rows.map((r) => (o.showTeamLogo ? loadImg(r.team.logo) : null)));
  rows.forEach((r, i) => {
    const c = Math.floor(i / perCol), k = i % perCol;
    const x = pad + c * (colW + colGap), cy = top + k * rowH + rowH / 2;
    // 区切りの線
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.beginPath(); ctx.moveTo(x + noW * 0.6, cy + rowH / 2 - 1); ctx.lineTo(x + colW, cy + rowH / 2 - 1); ctx.stroke();
    // 番号
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = r.no <= 3 && o.kind === 'ranking' ? accent : '#f2f2f2';
    ctx.font = `900 ${fs}px ${FONT}`; ctx.fillText(String(r.no), x + noW - 8 * u, cy);
    // ロゴ（無いときは頭文字の丸）
    const lx = x + noW + 6 * u;
    if (o.showTeamLogo) {
      if (logos[i]) {
        const im = logos[i], ratio = Math.min(logoS / im.width, logoS / im.height);
        ctx.drawImage(im, lx + (logoS - im.width * ratio) / 2, cy - (im.height * ratio) / 2, im.width * ratio, im.height * ratio);
      } else {
        ctx.fillStyle = '#2b2f2e'; ctx.beginPath(); ctx.arc(lx + logoS / 2, cy, logoS / 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#cfd5d2'; ctx.textAlign = 'center'; ctx.font = `800 ${logoS * 0.5}px ${FONT}`; ctx.fillText([...(r.team.short_name || r.team.name)][0] || '', lx + logoS / 2, cy + 1);
      }
    }
    // チーム名（長い名前は枠に収まるよう小さく）
    const nx = lx + (o.showTeamLogo ? logoS + 14 * u : 4 * u);
    const name = r.team.name;
    const maxW = x + colW - nx - 4 * u;
    const nfs = fitFont(ctx, name, maxW, fs, 900, 10 * u);
    ctx.textAlign = 'left'; ctx.fillStyle = '#f2f2f2';
    if (nfs < fs * 0.72 && rowH >= fs * 1.5) {
      // 1行だと小さくなりすぎる長い名前は、2行に分けて大きめに表示する
      const chars = [...name];
      let cut = Math.round(chars.length / 2);
      const sp = name.lastIndexOf(' ', Math.round(name.length / 2) + 4);
      if (sp > 2) cut = [...name.slice(0, sp)].length;
      const l1 = chars.slice(0, cut).join('').trim(), l2 = chars.slice(cut).join('').trim();
      const s2 = Math.min(fitFont(ctx, l1, maxW, fs * 0.8, 900, 9 * u), fitFont(ctx, l2, maxW, fs * 0.8, 900, 9 * u), rowH * 0.42);
      ctx.font = `900 ${s2}px ${FONT}`;
      ctx.fillText(l1, nx, cy - s2 * 0.52); ctx.fillText(l2, nx, cy + s2 * 0.58);
    } else {
      ctx.font = `900 ${nfs}px ${FONT}`; ctx.fillText(name, nx, cy + 1);
    }
  });
  // 下部（大会名・カテゴリ）
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `700 ${18 * u}px ${FONT}`;
  ctx.fillText(o.footer || '', W / 2, H - 28 * u);
  return { rows: n, cols };
}

// 結果一覧（ポスター）の画面
export function openResultPoster(t, categories, catId) {
  const cat0 = categories.find((c) => c.id === catId) || categories[0];
  const o = {
    catId: cat0.id, kind: (cat0.finalRanking || []).length ? 'ranking' : 'teams', size: 'sns', accent: 'lime', cols: 'auto',
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
  const redraw = async () => {
    const cat = categories.find((c) => c.id === o.catId);
    const r = await drawPoster(canvas, t, cat, o);
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
      { label: '画像を保存（PNG）', kind: 'btn-primary', onClick: () => {
        canvas.toBlob((blob) => {
          if (!blob) { toast('画像を作れませんでした', true); return; }
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: `${fileBase()}.png` });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          toast('画像を保存しました（スマホでは、開いた画像を長押しして保存できます）');
        }, 'image/png');
        return true;
      } },
    ],
  });
  redraw();
}
