export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'html') el.innerHTML = v; // 固定文字列のみに使う
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function mount(root, ...kids) {
  root.replaceChildren();
  append(root, kids);
}

let toastTimer;
export function toast(msg, isError = false) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h('div', { class: `toast${isError ? ' error' : ''}`, role: 'status' }, msg);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 5000 : 2600);
}

export function modal({ title, content, actions = [], onClose }) {
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); prev && prev.focus && prev.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', null, title),
    content,
    actions.length ? h('div', { class: 'actions' }, actions.map((a) =>
      h('button', { class: `btn ${a.kind || ''}`, type: 'button', onclick: async (e) => {
        if (a.onClick) {
          // 二重送信を防ぐため処理中は押せなくし、終わったら必ず戻す。
          // e.currentTarget は処理の途中（await の後）で消えるので、先にボタンを覚えておく
          const btn = e.currentTarget;
          btn.disabled = true;
          try { const keep = await a.onClick(close); if (keep !== true) close(); }
          finally { btn.disabled = false; }
        } else close();
      } }, a.label))) : null);
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  const first = box.querySelector('input, select, textarea, button');
  first && first.focus();
  return { close, box };
}

export function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      content: h('p', null, text),
      actions: [
        { label: 'キャンセル', kind: 'btn-ghost', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, kind: danger ? 'btn-danger' : 'btn-primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};

export const toHHMM = (m) => {
  if (m == null) return '--:--';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
};
export const fromHHMM = (s) => { const [a, b] = String(s).split(':').map(Number); return a * 60 + (b || 0); };

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export function formatDate(s) {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
}

export function formatUpdated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 画像を縮小して data URL にする（ロゴ用）
export function resizeImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.type === 'image/svg+xml') {
      if (file.size > 200_000) return reject(new Error('SVGファイルが大きすぎます'));
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('画像を読み込めませんでした'));
      return r.readAsDataURL(file);
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

// 画面が表示されている間だけ定期実行する
export function poller(fn, ms) {
  let timer = null;
  const tick = async () => {
    timer = null;
    if (document.visibilityState === 'visible') { try { await fn(); } catch { /* 次回に再試行 */ } }
    timer = setTimeout(tick, ms);
  };
  const onVis = () => { if (document.visibilityState === 'visible' && timer) { clearTimeout(timer); tick(); } };
  document.addEventListener('visibilitychange', onVis);
  timer = setTimeout(tick, ms);
  return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
}

// 自動更新はしない。別のアプリなどから一定時間（初期値5分）たって画面に戻ってきたときだけ、1回だけ確認する
export function resumeCheck(fn, staleMs = 5 * 60 * 1000) {
  let hiddenAt = null;
  const onVis = async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= staleMs) { hiddenAt = null; try { await fn(); } catch { /* 次の操作で再試行 */ } }
  };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}

// 最後に情報を取得した時刻（「更新」ボタンに表示する）
let LAST_FETCH = null;
export const markFetched = () => { LAST_FETCH = new Date(); document.querySelectorAll('.rf-time').forEach((el) => { el.textContent = fetchedText(); }); };
const fetchedText = () => (LAST_FETCH ? `${toHHMM(LAST_FETCH.getHours() * 60 + LAST_FETCH.getMinutes())}時点` : '');

// 「更新」ボタン（取得した時刻つき）。スマホでは画面の右下に浮かべて常に見える位置に置く。押すと onRefresh（変化があれば true を返す）を呼ぶ
export function refreshButton(onRefresh, { withNav = false } = {}) {
  const btn = h('button', { class: `refresh-fab${withNav ? ' with-nav' : ''} no-print`, type: 'button', 'aria-label': '最新の情報に更新' },
    h('span', { class: 'rf-icon', 'aria-hidden': 'true' }, '↻'), h('span', { class: 'rf-label' }, '更新'), h('span', { class: 'rf-time' }, fetchedText()));
  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('busy');
    try { const changed = await onRefresh(); markFetched(); toast(changed ? '最新の情報に更新しました' : '最新の情報です'); }
    catch (e) { toast(e.message || '更新できませんでした。通信状況を確認してください', true); }
    finally { btn.disabled = false; btn.classList.remove('busy'); }
  };
  return btn;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch { toast('コピーできませんでした。長押しで選択してください', true); }
}

export async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message || 'エラーが発生しました', true);
    return undefined;
  }
}

// ---------- アイコン（線画・currentColor） ----------
const ICONS = {
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  list: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M3.5 14.5h17M9 9.5v10.5"/>',
  trophy: '<path d="M8 3.5h8v5.5a4 4 0 0 1-8 0V3.5z"/><path d="M16 5h3.5v1.5A3.5 3.5 0 0 1 16 10M8 5H4.5v1.5A3.5 3.5 0 0 0 8 10M12 13v4M8.5 20.5h7M10 17h4"/>',
  shield: '<path d="M12 3l7.5 3v5.4c0 4.4-3.1 8-7.5 9.6-4.4-1.6-7.5-5.2-7.5-9.6V6L12 3z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  star: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z" fill="currentColor"/>',
  share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 12.5v6a2.5 2.5 0 0 0 2.5 2.5h9a2.5 2.5 0 0 0 2.5-2.5v-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9.5 6l6 6-6 6"/>',
  bag: '<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  car: '<path d="M5 16.5h14v-4l-2-5H7l-2 5z"/><circle cx="8" cy="16.5" r="1.6"/><circle cx="16" cy="16.5" r="1.6"/><path d="M5 12.5h14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.8 2.8-1.5 4.4H9.7l-1.5-4.4z"/><path d="M12 3v4.5M20.6 9.6l-4.8.7M17.3 19.4l-3-4.7M6.7 19.4l3-4.7M3.4 9.6l4.8.7"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ico ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---------- 下からせり上がるシート ----------
export function sheet({ title, content }) {
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev && prev.focus && prev.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = h('div', { class: 'sheet-body' });
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', onclick: () => close() }, icon('close'))),
    body);
  const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) close(); } }, box);
  mount(body, typeof content === 'function' ? content(close) : content);
  document.body.append(back);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  const first = box.querySelector('input, button.pick');
  first && first.focus();
  return { close, body };
}

// バナー画像を縮小して data URL にする（透過部分は白で塗り、JPEG で保存）
export function resizeBanner(file, maxW = 1200, maxH = 600) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!/^image\//.test(file.type)) return reject(new Error('画像ファイルを選んでください'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = 0.88;
      let out = c.toDataURL('image/jpeg', q);
      while (out.length > 600_000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      resolve(out);
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

// 利用マニュアル（PDF）。manuals フォルダのファイルを、アプリと同じアドレスから配信する
export const MANUALS = {
  parents: { href: '/INFINEX_manual_parents.pdf', title: '保護者マニュアル', desc: '日程・結果・順位表・トーナメント表の見かた' },
  team: { href: '/INFINEX_manual_team.pdf', title: 'チーム関係者マニュアル', desc: '試合結果の入力（仮登録）のしかた' },
  scorer: { href: '/INFINEX_manual_scorer.pdf', title: '大会運営者・スコア管理者マニュアル', desc: 'スコアの登録・修正、SNS画像の出力、忘れ物の登録' },
  organizer: { href: '/INFINEX_manual_organizer.pdf', title: '大会管理者マニュアル', desc: '大会の作成から当日の運営、資料の出力まで' },
  superadmin: { href: '/INFINEX_manual_superadmin.pdf', title: '全体管理者マニュアル', desc: 'アカウントの管理、テンプレートの公開' },
};
export const manualLink = (key, label, cls = 'manual-link') => h('a', { class: cls, href: MANUALS[key].href, target: '_blank', rel: 'noopener' }, '📖 ', label || MANUALS[key].title);

// ポップアップ（中央の入力欄・下から出る入力欄）がすべて閉じられるように
export function closeOverlays() {
  if (!document.querySelector('.modal-back, .sheet-back')) return false;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return true;
}

// ===== 画像の保存（スマホ・タブレットは共有の画面から「画像を保存」で写真へ。パソコンはダウンロード） =====
const isMobileLike = () => /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
function dataUrlToFile(dataUrl, name) {
  const [head, b64] = dataUrl.split(',');
  const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type });
}
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_');
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// canvases：保存するキャンバス（1枚または複数）、baseName：ファイル名のもと
export async function saveImages(canvases, baseName) {
  const list = Array.isArray(canvases) ? canvases : [canvases];
  // 共有はタップの直後に呼ぶ必要があるため、画像の変換は同期で行う
  const files = list.map((c, i) => dataUrlToFile(c.toDataURL('image/jpeg', 0.92), `${safeName(baseName)}${list.length > 1 ? `_${i + 1}` : ''}.jpg`));
  if (isMobileLike() && navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      toast('保存しました（共有の画面で「画像を保存」を選ぶと、写真に入ります）');
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false; // 共有の画面を閉じた
      // タップから時間がたって共有できないときは、もう一度押してもらう
      return new Promise((resolve) => {
        const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
          h('h2', null, '画像の準備ができました'),
          h('p', null, `${files.length}枚の画像を保存します。下のボタンを押して、共有の画面で「画像を保存」を選んでください。`),
          h('div', { class: 'actions' },
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { back.remove(); resolve(false); } }, 'やめる'),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { back.remove(); try { await navigator.share({ files }); resolve(true); } catch { files.forEach(downloadFile); resolve(true); } } }, '写真に保存する'))));
        document.body.append(back);
      });
    }
  }
  files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 400));
  toast(files.length > 1 ? `${files.length}枚の画像を保存しました` : '画像を保存しました');
  return true;
}

// ===== 入力欄を押したら、キーボードに隠れないよう画面の中央へ移動（スマホ・タブレット） =====
if (typeof document !== 'undefined' && typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || /^(file|checkbox|radio|button|submit)$/.test(el.type)) return;
    const center = () => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* 古い端末 */ } };
    setTimeout(center, 320); // キーボードが出てから
    if (window.visualViewport) {
      const onResize = () => { center(); window.visualViewport.removeEventListener('resize', onResize); };
      window.visualViewport.addEventListener('resize', onResize);
      setTimeout(() => window.visualViewport.removeEventListener('resize', onResize), 1500);
    }
  });
}

// 得点の入力：0〜99の整数にそろえる（全角数字も半角に。先頭の0・小数点・記号は取り除く）
export function cleanScore(v) {
  const m = String(v ?? '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).match(/[0-9]+/);
  const s = m ? m[0] : '';
  if (s === '') return '';
  return String(Math.min(99, parseInt(s, 10)));
}

// ===== 上部のボタン：パソコンでは横に並べ、スマホでは［メニュー］1つにまとめる =====
// actions：[{ label, onClick } または { label, href }]、who：メニューの上に出す「ログイン中の人」
export function headActions(actions, who) {
  const list = actions.filter(Boolean);
  const mk = (a, cls) => a.href
    ? h('a', { class: cls, href: a.href, target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, a.label)
    : h('button', { class: cls, type: 'button', onclick: a.onClick }, a.label);
  const open = () => {
    const close = () => document.querySelector('.sheet-back')?.remove();
    sheet({ title: 'メニュー', content: h('div', { class: 'head-menu-list' },
      who ? h('p', { class: 'muted small', style: { margin: '0 0 6px' } }, who) : null,
      list.map((a) => { const el = mk(a, 'btn btn-block'); if (!a.href) el.onclick = (e) => { close(); a.onClick(e); }; return el; })) });
  };
  return [
    h('span', { class: 'head-actions' }, list.map((a) => mk(a, a.cls || 'btn btn-sm'))),
    h('button', { class: 'btn btn-sm head-menu-btn', type: 'button', 'aria-label': 'メニューを開く', onclick: open },
      h('span', { 'aria-hidden': 'true', style: { fontSize: '1.05em', lineHeight: 1 } }, '☰'), 'メニュー'),
  ];
}

// ===== 写真の縮小（忘れ物など）：iPhone・iPadの高画素の写真でも失敗しにくいように =====
// 1. メモリを使いすぎない読み込み（createImageBitmap）→ だめなら従来の読み込み
// 2. 長い辺を maxSide に縮め、上限（limit）に収まるまで画質と大きさを段階的に下げて JPEG にする
async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 下の方法で読み込む */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('写真を読み込めませんでした。別の写真を選ぶか、カメラで撮り直してください')); };
    img.src = url;
  });
}
export async function resizePhoto(file, maxSide = 1280, limit = 450_000) {
  if (!file) return null;
  if (file.type && !/^image\//.test(file.type)) throw new Error('写真（画像）のファイルを選んでください');
  const bmp = await loadBitmap(file);
  const W0 = bmp.width, H0 = bmp.height;
  if (!W0 || !H0) throw new Error('写真を読み込めませんでした。別の写真を選んでください');
  let side = maxSide;
  for (let tries = 0; tries < 6; tries++) {
    const scale = Math.min(1, side / Math.max(W0, H0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W0 * scale)); c.height = Math.max(1, Math.round(H0 * scale));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.58, 0.46]) {
      const out = c.toDataURL('image/jpeg', q);
      if (out.length <= limit) { if (bmp.close) bmp.close(); return out; }
    }
    side = Math.round(side * 0.75); // まだ大きいときは、さらに小さくする
  }
  if (bmp.close) bmp.close();
  throw new Error('写真を小さくできませんでした。別の写真を選んでください');
}
