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
          e.currentTarget.disabled = true;
          try { const keep = await a.onClick(close); if (keep !== true) close(); }
          finally { if (e.currentTarget) e.currentTarget.disabled = false; }
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
