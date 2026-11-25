// 参加費・領収書
//  ・本部（管理者・大会運営者）：チームごとの参加費の受領を記録し、領収書を発行する（事前に印刷／その場で印刷／QR／LINE）
//  ・受け取った人：QR・LINEのリンクから、自分の領収書を開いて保存する（/rcpt/<番号>）
//  発行した領収書は、発行元・金額・宛名をその時点の内容で保存している（あとから設定を変えても変わらない）
import { api } from './web-api.js';
import { h, mount, modal, confirmDialog, toast, run, copyText, formatDate, todayStr, lineShareUrl, saveImages, resizeImage, store } from './web-ui.js';

export const yen = (n) => `¥${Number(n || 0).toLocaleString('ja-JP')}`;
const METHOD = { cash: '現金', transfer: '振込', other: 'その他' };
const STATUS = { unpaid: '未収', paid: '受領済み', waived: '免除' };
const DELIVERY = { preprint: '事前に印刷', print: 'その場で印刷', qr: 'QRで渡す', line: 'LINEで送る', none: '控えのみ' };
export const receiptUrl = (r) => `${location.origin}/rcpt/${r.token}`;
const dateJa = (d) => (d ? formatDate(d).replace(/（.）$/, '') : '');
const STAMP_LIMIT = 50000; // 紙の領収書で5万円以上は収入印紙の欄を付ける

// ===================== 領収書（画面・印刷） =====================
export function receiptEl(r, { paper = false } = {}) {
  const iss = r.issuer || {};
  const invoice = !!iss.reg_no;
  const voided = r.status === 'void';
  return h('div', { class: `rc${paper ? ' rc-paper' : ''}${voided ? ' rc-void' : ''}` },
    h('div', { class: 'rc-top' }, h('span', null, `No. ${r.no}`), h('span', null, `発行日　${dateJa(r.issued_on)}`)),
    h('div', { class: 'rc-title' }, h('span', null, '領　収　書'), invoice ? h('small', null, '（適格簡易請求書）') : null),
    h('div', { class: 'rc-to' }, h('span', { class: 'rc-name' }, r.addressee), h('span', null, '様')),
    h('div', { class: 'rc-amount' }, h('span', null, yen(r.amount), h('small', null, '-')), h('em', null, invoice ? '（税込）' : '')),
    h('div', { class: 'rc-purpose' }, `但し　${r.purpose || 'サッカー大会参加費として'}`),
    h('div', { class: 'rc-detail' }, [iss.tournament ? `${iss.tournament}${iss.category ? `（${iss.category}）` : ''}` : '', r.method ? `お支払い：${METHOD[r.method] || ''}` : ''].filter(Boolean).join('　／　')),
    h('div', { class: 'rc-recv' }, '上記の金額を正に領収いたしました。'),
    h('div', { class: 'rc-bottom' },
      h('div', { class: 'rc-left' },
        invoice ? h('table', { class: 'rc-tax' }, h('tbody', null,
          h('tr', null, h('th', null, '10%対象'), h('td', null, yen(r.amount))),
          h('tr', null, h('th', null, '内消費税等'), h('td', null, yen(r.tax_amount))))) : null,
        paper && r.amount >= STAMP_LIMIT ? h('div', { class: 'rc-stamp' }, '収入', h('br'), '印紙') : null,
        r.reissue_of ? h('div', { class: 'rc-note' }, `再発行（元のNo. ${r.reissue_of}）`) : null,
        !paper ? h('div', { class: 'rc-note' }, '電子発行の領収書です') : null),
      h('div', { class: 'rc-issuer' },
        h('div', { class: 'rc-iss-text' },
          h('strong', null, iss.name || ''),
          iss.rep ? h('div', null, `${iss.title || '代表'}　${iss.rep}`) : null,
          iss.address ? h('div', null, iss.address) : null,
          iss.tel ? h('div', null, `TEL ${iss.tel}`) : null,
          invoice ? h('div', null, `登録番号　${iss.reg_no}`) : null),
        iss.seal ? h('img', { class: 'rc-seal', src: iss.seal, alt: '印' }) : h('span', { class: 'rc-seal ph' }, '印'))),
    voided ? h('div', { class: 'rc-void-mark' }, '取消') : null);
}

// 画面での見本：画像にして幅に収める（スマホでも崩れない）
export function receiptPreview(r) {
  const view = h('div', { class: 'rcpt-view' }, receiptEl(r));
  receiptCanvas(r).then((c) => mount(view, h('img', { class: 'rcpt-img', src: c.toDataURL('image/png'), alt: `領収書 No.${r.no}` }))).catch(() => {});
  return view;
}

// A4に複数枚（事前の印刷）、または1枚（その場で印刷）
export async function printReceipts(list, { perPage = 3, title = '領収書' } = {}) {
  const { runPrint } = await import('./web-print.js');
  const pages = [];
  for (let i = 0; i < list.length; i += perPage) pages.push(list.slice(i, i + perPage));
  const doc = h('div', { class: `rc-print per-${perPage}` }, pages.map((pg) => h('div', { class: 'rc-page' },
    pg.map((r) => h('div', { class: 'rc-slot' }, receiptEl(r, { paper: true }))))));
  runPrint(doc, title, '@page { size: A4; margin: 8mm; }');
}

// 画像（LINE・写真に保存する用）：canvas に描く
export async function receiptCanvas(r) {
  const iss = r.issuer || {};
  const invoice = !!iss.reg_no;
  const W = 1200, H = 760, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const F = '"Inter","Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#1c1917'; x.lineWidth = 3; x.strokeRect(24, 24, W - 48, H - 48);
  x.fillStyle = '#1c1917'; x.textBaseline = 'alphabetic';
  x.font = `500 24px ${F}`; x.textAlign = 'left'; x.fillText(`No. ${r.no}`, 60, 80);
  x.textAlign = 'right'; x.fillText(`発行日　${dateJa(r.issued_on)}`, W - 60, 80);
  x.textAlign = 'center'; x.font = `800 52px ${F}`; x.fillText('領　収　書', W / 2, 150);
  if (invoice) { x.font = `500 22px ${F}`; x.fillText('（適格簡易請求書）', W / 2, 182); }
  x.textAlign = 'left';
  let size = 40; x.font = `700 ${size}px ${F}`;
  while (x.measureText(`${r.addressee}　様`).width > 760 && size > 20) { size -= 2; x.font = `700 ${size}px ${F}`; }
  x.fillText(`${r.addressee}　様`, 80, 250);
  x.fillRect(80, 262, 760, 2);
  x.fillStyle = '#f5f5f4'; x.fillRect(80, 290, 640, 96); x.fillStyle = '#1c1917';
  x.font = `800 60px ${F}`; x.fillText(`${yen(r.amount)}-`, 110, 360);
  if (invoice) { x.font = `500 24px ${F}`; x.fillText('（税込）', 740, 360); }
  x.font = `500 26px ${F}`; x.fillText(`但し　${r.purpose || 'サッカー大会参加費として'}`, 80, 430);
  x.font = `400 21px ${F}`; x.fillStyle = '#44403c';
  x.fillText([iss.tournament ? `${iss.tournament}${iss.category ? `（${iss.category}）` : ''}` : '', r.method ? `お支払い：${METHOD[r.method] || ''}` : ''].filter(Boolean).join('　／　'), 80, 468);
  x.fillStyle = '#1c1917'; x.font = `500 22px ${F}`; x.fillText('上記の金額を正に領収いたしました。', 80, 508);
  let ly = 560;
  if (invoice) {
    x.strokeStyle = '#1c1917'; x.lineWidth = 1.5; x.strokeRect(80, 540, 360, 84); x.beginPath(); x.moveTo(80, 582); x.lineTo(440, 582); x.stroke();
    x.font = `500 22px ${F}`; x.fillText('10%対象', 96, 570); x.fillText('内消費税等', 96, 612);
    x.textAlign = 'right'; x.fillText(yen(r.amount), 424, 570); x.fillText(yen(r.tax_amount), 424, 612); x.textAlign = 'left';
    ly = 660;
  }
  x.font = `400 18px ${F}`; x.fillStyle = '#57534e';
  if (r.reissue_of) { x.fillText(`再発行（元のNo. ${r.reissue_of}）`, 80, ly); ly += 26; }
  x.fillText('電子発行の領収書です', 80, ly);
  // 発行元
  x.fillStyle = '#1c1917'; x.textAlign = 'right';
  const lines = [[`700 26px ${F}`, iss.name || ''], iss.rep ? [`500 21px ${F}`, `${iss.title || '代表'}　${iss.rep}`] : null, iss.address ? [`400 19px ${F}`, iss.address] : null,
    iss.tel ? [`400 19px ${F}`, `TEL ${iss.tel}`] : null, invoice ? [`500 20px ${F}`, `登録番号　${iss.reg_no}`] : null].filter(Boolean);
  let y = 560;
  for (const [f, t] of lines) { x.font = f; x.fillText(t, W - 170, y, 560); y += 32; }
  x.textAlign = 'left';
  if (iss.seal) {
    try {
      const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = iss.seal; });
      const s = 100 / Math.max(img.width, img.height);
      x.drawImage(img, W - 150, 540, img.width * s, img.height * s);
    } catch { /* 印影が読めなくても領収書は出す */ }
  }
  if (r.status === 'void') {
    x.save(); x.translate(W / 2, H / 2); x.rotate(-0.25); x.strokeStyle = 'rgba(220,38,38,0.85)'; x.lineWidth = 8; x.strokeRect(-170, -70, 340, 140);
    x.fillStyle = 'rgba(220,38,38,0.85)'; x.textAlign = 'center'; x.font = `900 90px ${F}`; x.fillText('取消', 0, 32); x.restore();
  }
  return c;
}

// ===================== 受け取った人が開く領収書のページ =====================
export async function receiptPage(root, token) {
  let r;
  try { r = (await api('GET', `/api/rcpt/${token}`)).receipt; } catch (e) {
    mount(root, h('main', { class: 'wrap rcpt-page' }, h('div', { class: 'panel' }, h('h1', null, '領収書'), h('p', null, e.message)))); return;
  }
  document.title = `領収書 No.${r.no}`;
  // 画面には画像で出す（スマホの幅に収まり、長押しで写真に保存もできる）
  const view = receiptPreview(r);
  mount(root, h('main', { class: 'wrap rcpt-page' },
    r.status === 'void' ? h('p', { class: 'notice error' }, 'この領収書は取り消されました。新しい領収書を受け取っている場合は、そちらをお使いください。') : null,
    view,
    h('div', { class: 'rcpt-actions no-print' },
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => saveImages(await receiptCanvas(r), `領収書_${r.no}`) }, '画像で保存'),
      h('button', { class: 'btn btn-block', type: 'button', onclick: () => printReceipts([r], { perPage: 1, title: `領収書_${r.no}` }) }, '印刷・PDFで保存'),
      h('p', { class: 'muted small' }, 'このページのURLを知っている人だけが開けます。経費の精算などに、画像やPDFで保存してお使いください。'))));
}

// ===================== 発行元の設定（管理者） =====================
// 白い背景を透明にする（印影の写真・スキャン用）
async function clearWhite(dataUrl) {
  if (!/^data:image\/(png|jpeg|webp)/.test(dataUrl)) return dataUrl;
  const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = dataUrl; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
    if (v > 225) d.data[i + 3] = 0; else if (v > 190) d.data[i + 3] = Math.round(255 * (225 - v) / 35);
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}

export async function issuerForm(container, { onSaved } = {}) {
  let iss;
  try { iss = (await api('GET', '/api/admin/issuer')).issuer; } catch (e) { mount(container, h('p', { class: 'empty' }, e.message)); return; }
  const f = { name: iss ? iss.name : '', title: iss ? iss.title : '代表', rep: iss ? iss.rep : '', address: iss ? iss.address : '', tel: iss ? iss.tel : '', reg_no: iss ? iss.reg_no : '', seal: undefined };
  let sealShown = iss && iss.seal;
  const prev = h('div', { class: 'iss-preview' });
  const draw = () => mount(prev, receiptEl({ no: '2026-0001', issued_on: todayStr(), addressee: '（チーム名）', amount: 15000, tax_amount: f.reg_no ? Math.floor(150000 / 110) : null,
    purpose: 'サッカー大会参加費として', status: 'valid', issuer: { ...f, reg_no: /^T\d{13}$/.test(f.reg_no) ? f.reg_no : '', seal: f.seal === undefined ? sealShown : f.seal, tournament: '（大会名）' } }, { paper: true }));
  const field = (k, label, ph, max) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'text', value: f[k] || '', placeholder: ph || '', maxlength: max || 80, oninput: (e) => { f[k] = e.target.value; draw(); } }));
  draw();
  mount(container, h('div', { class: 'iss-grid' },
    h('section', { class: 'panel stack' },
      h('h2', null, '領収書の発行元'),
      h('p', { class: 'muted small', style: { margin: 0 } }, 'あなたが管理する大会の領収書に印字されます。発行した領収書は、その時点の内容で保存されるため、ここを変えても発行済みの領収書は変わりません。'),
      field('name', '団体名（必須）', '例：INFINITY FOOTBALL CLUB 2024'),
      h('div', { class: 'grid-form' }, field('title', '肩書き', '代表', 30), field('rep', '代表者名', '例：山田 太郎', 40)),
      field('address', '住所', '例：静岡県〇〇市〇〇 1-2-3', 120),
      field('tel', '電話番号', '例：090-0000-0000', 30),
      h('label', { class: 'field' }, h('span', null, 'インボイスの登録番号（お持ちの場合）'),
        h('input', { type: 'text', value: f.reg_no || '', placeholder: 'T1234567890123', maxlength: 20, oninput: (e) => { f.reg_no = e.target.value.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase(); draw(); } })),
      h('p', { class: 'muted small', style: { margin: 0 } }, '登録番号を入れると、領収書が「適格簡易請求書」の形になり、税率10%と消費税額（内税）が印字されます。登録していない場合は空欄のままにしてください（通常の領収書になります）。'),
      h('div', null, h('span', { class: 'small', style: { fontWeight: 700 } }, '印影（任意）'),
        h('div', { class: 'row' },
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': '印影の画像', onchange: async (e) => {
            const v = await run(async () => clearWhite(await resizeImage(e.target.files[0], 300)));
            if (v) { f.seal = v; draw(); }
          } }),
          (iss && iss.seal) || f.seal ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { f.seal = null; sealShown = null; draw(); } }, '印影を外す') : null),
        h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, '白い紙に押した印影の写真でOKです。白い部分は自動で透明になります。')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const body = { name: f.name, title: f.title, rep: f.rep, address: f.address, tel: f.tel, reg_no: f.reg_no };
        if (f.seal !== undefined) body.seal = f.seal;
        if (await run(() => api('PUT', '/api/admin/issuer', body), '発行元を保存しました')) { if (onSaved) onSaved(); else issuerForm(container, { onSaved }); }
      } }, '保存')),
    h('section', { class: 'panel' }, h('h2', { style: { marginBottom: '8px' } }, '見本'), h('div', { class: 'iss-prev-wrap' }, prev))));
}

// ===================== 参加費の画面（本部） =====================
// opts：{ tid, tournament, canSettings（金額の既定・発行元を変えられる）, compact（スマホ） }
export function feeView(opts) {
  const host = h('div', { class: `fee${opts.compact ? ' fee-compact' : ''}` });
  const st = { data: null, filter: store.get('fee:filter', 'all'), cat: 'all', q: '' };
  const t = opts.tournament;
  const load = async () => { st.data = await api('GET', `/api/admin/tournaments/${opts.tid}/fees`); };
  const reload = async () => { try { await load(); draw(); } catch (e) { toast(e.message, true); } };
  const validOf = (tid) => st.data.receipts.filter((r) => r.team_id === tid && r.status === 'valid').pop();

  // ----- 領収書を渡す（その場で印刷・QR・LINE） -----
  const deliver = async (r, how) => {
    if (how === 'print') return printReceipts([r], { perPage: 1, title: `領収書_${r.no}_${r.addressee}` });
    if (how === 'qr') {
      const { qrDataUrl } = await import('./web-qr.js');
      modal({ title: 'QRを読み取ってもらう', content: h('div', { class: 'stack', style: { textAlign: 'center' } },
        h('p', { style: { margin: 0 } }, h('b', null, `${r.addressee} 様　${yen(r.amount)}`)),
        h('img', { class: 'fee-qr', src: qrDataUrl(receiptUrl(r)), alt: '領収書のQRコード' }),
        h('p', { class: 'muted small', style: { margin: 0 } }, 'スマホのカメラで読み取ると、領収書が開きます。画像やPDFで保存できます。')),
      actions: [{ label: '閉じる', kind: 'btn-primary' }] });
      return;
    }
    if (how === 'line') {
      const text = [`【${t.name}】領収書`, `${r.addressee} 様　${yen(r.amount)}（No. ${r.no}）`, '下のリンクから領収書を開いて、画像やPDFで保存してください。', receiptUrl(r)].join('\n');
      modal({ title: 'LINEで送る', content: h('div', { class: 'stack' }, h('pre', { class: 'fee-line-text' }, text)),
        actions: [{ label: '文をコピー', onClick: async () => { await copyText(text); return true; } },
          { label: 'LINEで送る', kind: 'btn-line', onClick: async () => { window.open(lineShareUrl(text), '_blank', 'noopener'); return true; } }] });
    }
  };

  const issue = async (teamIds, extra = {}) => {
    const r = await run(() => api('POST', `/api/admin/tournaments/${opts.tid}/receipts`, { team_ids: teamIds, ...extra }));
    if (!r) return null;
    if (r.skipped.length && !r.receipts.length) toast(r.skipped[0].reason === 'issued' ? 'すでに領収書を発行しています' : '参加費が0円（免除）のため発行していません', true);
    return r;
  };

  // ----- 受け取った -----
  const receive = (tm) => {
    const existing = validOf(tm.team_id);
    const f = { method: 'cash', how: existing ? 'preprint' : 'print', addressee: tm.name };
    const box = h('div');
    const opt = (k, label, desc) => h('label', { class: `fee-opt${f.how === k ? ' on' : ''}` },
      h('input', { type: 'radio', name: 'fee-how', checked: f.how === k, onchange: () => { f.how = k; drawBox(); } }), h('span', null, h('b', null, label), desc ? h('small', null, desc) : null));
    const drawBox = () => mount(box, h('div', { class: 'stack' },
      h('div', { class: 'fee-recv-head' }, h('strong', null, tm.name), h('span', { class: 'fee-amt' }, yen(tm.amount))),
      tm.note ? h('p', { class: 'muted small', style: { margin: 0 } }, `メモ：${tm.note}`) : null,
      h('div', null, h('span', { class: 'small', style: { fontWeight: 700 } }, 'お支払い'),
        h('div', { class: 'chips' }, Object.entries(METHOD).map(([k, l]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(f.method === k), onclick: () => { f.method = k; drawBox(); } }, l)))),
      h('div', { class: 'stack', style: { gap: '6px' } }, h('span', { class: 'small', style: { fontWeight: 700 } }, '領収書'),
        existing ? opt('preprint', `事前に印刷した領収書を渡した（No. ${existing.no}）`) : null,
        opt('print', existing ? '印刷して渡す' : 'その場で印刷して渡す', 'プリンタがあるとき'),
        opt('qr', 'QRを読み取ってもらう', '相手のスマホに電子の領収書'),
        opt('line', 'LINEで送る', 'リンクを送る'),
        opt('none', '今は渡さない', 'あとから「領収書」で発行できます')),
      !existing && f.how !== 'none' ? h('label', { class: 'field' }, h('span', null, '宛名'), h('input', { type: 'text', value: f.addressee, maxlength: 60, oninput: (e) => { f.addressee = e.target.value; } })) : null));
    drawBox();
    modal({ title: '参加費を受け取った', content: box, actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '受け取りを記録', kind: 'btn-primary', onClick: async () => {
      if (!(await run(() => api('PATCH', `/api/admin/tournaments/${opts.tid}/fees/${tm.team_id}`, { status: 'paid', method: f.method })))) return true;
      let rc = existing;
      if (!rc && f.how !== 'none') {
        const r = await issue([tm.team_id], { delivery: f.how, addressee: f.addressee });
        rc = r && r.receipts[0];
      }
      await reload();
      toast(`${tm.name}：受け取りを記録しました`);
      if (rc && ['print', 'qr', 'line'].includes(f.how)) deliver(rc, f.how);
    } }] });
  };

  // ----- 金額・メモ・免除 -----
  const editFee = (tm) => {
    const def = st.data.settings.amount;
    const f = { amount: tm.custom && tm.status !== 'waived' ? String(tm.amount) : '', note: tm.note };
    modal({ title: `${tm.name}の参加費`, content: h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', null, `金額（空欄＝大会の参加費 ${def != null ? yen(def) : '未設定'}）`),
        h('input', { type: 'text', inputmode: 'numeric', value: f.amount, placeholder: def != null ? String(def) : '', oninput: (e) => { f.amount = e.target.value.normalize('NFKC').replace(/[^\d]/g, ''); } })),
      h('label', { class: 'field' }, h('span', null, 'メモ（領収書には印字されません）'), h('input', { type: 'text', value: f.note, maxlength: 60, placeholder: '例：主催／共催／2チーム目割引', oninput: (e) => { f.note = e.target.value; } })),
      validOf(tm.team_id) ? h('p', { class: 'notice', style: { margin: 0 } }, '発行済みの領収書の金額は変わりません。金額を変えたら「領収書」→「再発行」をしてください。') : null),
    actions: [
      tm.status === 'waived' ? { label: '免除をやめる', onClick: async () => { if (await run(() => api('PATCH', `/api/admin/tournaments/${opts.tid}/fees/${tm.team_id}`, { status: 'unpaid' }), '未収に戻しました')) await reload(); } }
        : { label: '免除にする', onClick: async () => { if (await run(() => api('PATCH', `/api/admin/tournaments/${opts.tid}/fees/${tm.team_id}`, { status: 'waived', note: f.note || '免除' }), '免除にしました')) await reload(); } },
      tm.status === 'paid' ? { label: '未収に戻す', onClick: async () => {
        if (!(await confirmDialog('未収に戻します', '受け取りの記録を取り消します。発行済みの領収書は残るので、必要なら「領収書」から取り消してください。', '未収に戻す', true))) return true;
        if (await run(() => api('PATCH', `/api/admin/tournaments/${opts.tid}/fees/${tm.team_id}`, { status: 'unpaid' }), '未収に戻しました')) await reload();
      } } : null,
      { label: '保存', kind: 'btn-primary', onClick: async () => { if (await run(() => api('PATCH', `/api/admin/tournaments/${opts.tid}/fees/${tm.team_id}`, { amount: f.amount === '' ? null : Number(f.amount), note: f.note }), '保存しました')) await reload(); } },
    ].filter(Boolean) });
  };

  // ----- 領収書のメニュー -----
  const receiptMenu = (r, tm) => {
    const prev = receiptPreview(r);
    const askReason = (title, label, okLabel, danger, fn) => {
      let reason = '';
      modal({ title, content: h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'text', maxlength: 60, placeholder: '例：宛名の誤り／金額の変更／不参加', oninput: (e) => { reason = e.target.value; } }))),
        actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: okLabel, kind: danger ? 'btn-danger' : 'btn-primary', onClick: async () => fn(reason) }] });
    };
    const changed = tm && r.status === 'valid' && tm.amount !== r.amount;
    modal({ title: `領収書 No. ${r.no}`, content: h('div', { class: 'stack' },
      r.status === 'void' ? h('p', { class: 'notice error', style: { margin: 0 } }, `取消済み${r.void_reason ? `（${r.void_reason}）` : ''}`) : null,
      changed ? h('p', { class: 'notice', style: { margin: 0 } }, `いまの参加費（${yen(tm.amount)}）と金額が違います。「再発行」で今の金額の領収書を出せます。`) : null,
      h('p', { class: 'muted small', style: { margin: 0 } }, `${DELIVERY[r.delivery] || ''}・${r.created_by || ''}（${String(r.created_at || '').slice(0, 16).replace('T', ' ')}）`),
      prev),
    actions: r.status !== 'valid' ? [{ label: '閉じる', kind: 'btn-primary' }] : [
      { label: '取消', kind: 'btn-ghost', onClick: async () => {
        let reason = '';
        let unpaid = !!(tm && tm.status === 'paid');
        modal({ title: '領収書を取り消します', content: h('div', { class: 'stack' },
          h('label', { class: 'field' }, h('span', null, '取り消す理由'), h('input', { type: 'text', maxlength: 60, placeholder: '例：宛名の誤り／不参加／試しに出した', oninput: (e) => { reason = e.target.value; } })),
          tm && tm.status === 'paid' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: unpaid, onchange: (e) => { unpaid = e.target.checked; } }), '受け取りの記録も取り消して「未収」に戻す') : null),
        actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '取り消す', kind: 'btn-danger', onClick: async () => {
          if (await run(() => api('POST', `/api/admin/receipts/${r.id}/void`, { reason, unpaid }), unpaid ? '取り消して未収に戻しました' : '取り消しました')) await reload();
        } }] });
      } },
      { label: '再発行', onClick: async () => {
        let reason = '', addressee = r.addressee;
        modal({ title: '再発行', content: h('div', { class: 'stack' },
          h('p', { class: 'muted small', style: { margin: 0 } }, `No. ${r.no} を取り消し、新しい番号で発行します（金額は今の参加費 ${tm ? yen(tm.amount) : ''}）。`),
          h('label', { class: 'field' }, h('span', null, '宛名'), h('input', { type: 'text', value: addressee, maxlength: 60, oninput: (e) => { addressee = e.target.value; } })),
          h('label', { class: 'field' }, h('span', null, '理由'), h('input', { type: 'text', maxlength: 60, placeholder: '例：宛名の誤り', oninput: (e) => { reason = e.target.value; } }))),
        actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '再発行する', kind: 'btn-primary', onClick: async () => {
          const res = await run(() => api('POST', `/api/admin/receipts/${r.id}/reissue`, { reason, addressee }));
          if (res) { await reload(); toast(`No. ${res.receipt.no} を発行しました`); receiptMenu(res.receipt, tm); }
        } }] });
      } },
      { label: '画像で保存', onClick: async () => { await saveImages(await receiptCanvas(r), `領収書_${r.no}`); return true; } },
      { label: 'QR', onClick: async () => { deliver(r, 'qr'); return true; } },
      { label: 'LINE', kind: 'btn-line', onClick: async () => { deliver(r, 'line'); return true; } },
      { label: '印刷', kind: 'btn-primary', onClick: async () => { deliver(r, 'print'); return true; } },
    ] });
  };

  // ----- 事前にまとめて印刷 -----
  const batch = () => {
    const teams = st.data.teams.filter((x) => x.amount > 0 && x.status !== 'waived');
    const pick = new Set(teams.filter((x) => x.status === 'unpaid' && !validOf(x.team_id)).map((x) => x.team_id));
    const f = { date: t.date || todayStr(), perPage: 3 };
    const box = h('div');
    const drawB = () => mount(box, h('div', { class: 'stack' },
      h('p', { class: 'muted small', style: { margin: 0 } }, '大会の前に、チームごとの領収書をまとめて発行してA4で印刷します。当日は参加費を受け取ったら、印刷した領収書を渡して「受け取った」を押してください。発行済みのチームは、印刷し直しになります（番号は変わりません）。'),
      h('div', { class: 'grid-form' },
        h('label', { class: 'field' }, h('span', null, '発行日'), h('input', { type: 'date', value: f.date, oninput: (e) => { f.date = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '1ページの枚数'), h('select', { onchange: (e) => { f.perPage = Number(e.target.value); } }, [2, 3].map((n) => h('option', { value: n, selected: f.perPage === n }, `${n}枚`))))),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { teams.forEach((x) => pick.add(x.team_id)); drawB(); } }, 'すべて選ぶ'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { pick.clear(); drawB(); } }, 'すべて外す'),
        h('span', { class: 'muted small' }, `${pick.size}チーム`)),
      h('div', { class: 'fee-pick' }, teams.map((x) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: pick.has(x.team_id), onchange: (e) => { if (e.target.checked) pick.add(x.team_id); else pick.delete(x.team_id); drawB(); } }),
        h('span', null, `${x.category}　${x.name}　${yen(x.amount)}`, validOf(x.team_id) ? h('small', { class: 'muted' }, `　発行済み No. ${validOf(x.team_id).no}`) : null, x.status === 'paid' ? h('small', { class: 'muted' }, '　受領済み') : null))))));
    drawB();
    modal({ title: '事前にまとめて印刷', content: box, actions: [{ label: 'キャンセル', kind: 'btn-ghost' }, { label: '発行して印刷', kind: 'btn-primary', onClick: async () => {
      if (!pick.size) { toast('チームを選んでください', true); return true; }
      const ids = [...pick];
      const fresh = ids.filter((id) => !validOf(id));
      if (fresh.length) { const r = await issue(fresh, { delivery: 'preprint', issued_on: f.date }); if (!r) return true; }
      await reload();
      const list = ids.map((id) => validOf(id)).filter(Boolean);
      printReceipts(list, { perPage: f.perPage, title: `${t.name}_領収書` });
    } }] });
  };

  // ----- 一覧をExcelで保存 -----
  const exportXlsx = async () => {
    const { buildXlsx, downloadBlob } = await import('./web-xlsx.js');
    const d = st.data;
    const recNo = (tid) => d.receipts.filter((r) => r.team_id === tid && r.status === 'valid').map((r) => r.no).join(' ');
    const blob = buildXlsx([
      { name: '参加費', header: ['カテゴリ', '組', 'チーム', '金額', '状態', '支払方法', '受領日時', '受領者', 'メモ', '領収書No.'],
        rows: d.teams.map((x) => [x.category, x.group_label || '', x.name, x.amount ?? '', STATUS[x.status], METHOD[x.method] || '', x.paid_at ? x.paid_at.slice(0, 16).replace('T', ' ') : '', x.paid_by || '', x.note, recNo(x.team_id)]) },
      { name: '領収書の控え', header: ['No.', '発行日', '宛名', '金額', '内消費税等', '但し書き', '発行方法', '状態', '取消の理由', '再発行の元', '発行者', '発行元', '登録番号'],
        rows: d.receipts.map((r) => [r.no, r.issued_on, r.addressee, r.amount, r.tax_amount ?? '', r.purpose || '', DELIVERY[r.delivery] || '', r.status === 'void' ? '取消' : '有効', r.void_reason || '', r.reissue_of || '', r.created_by || '', r.issuer.name || '', r.issuer.reg_no || '']) },
    ]);
    downloadBlob(blob, `${t.name}_参加費.xlsx`);
  };

  // ----- 設定（管理者） -----
  const settingsPanel = () => {
    const s = st.data.settings;
    const f = { amount: s.amount != null ? String(s.amount) : '', purpose: s.purpose || '', issuer_id: s.issuer_id || '' };
    const sel = h('select', { onchange: (e) => { f.issuer_id = e.target.value; } }, h('option', { value: '' }, '大会を作った管理者の発行元'));
    api('GET', '/api/admin/issuers').then((r) => { for (const i of r.issuers) sel.append(h('option', { value: i.id, selected: i.id === f.issuer_id }, `${i.name}${i.reg_no ? '（登録番号あり）' : ''}`)); }).catch(() => {});
    return h('details', { class: 'panel fee-settings', open: s.amount == null || !st.data.issuer },
      h('summary', null, h('strong', null, '参加費の設定'), h('span', { class: 'muted small' }, `　${s.amount != null ? yen(s.amount) : '未設定'}・${st.data.issuer ? st.data.issuer.name : '発行元が未設定'}`)),
      h('div', { class: 'grid-form', style: { marginTop: '10px' } },
        h('label', { class: 'field' }, h('span', null, '参加費（1チーム）'), h('input', { type: 'text', inputmode: 'numeric', value: f.amount, placeholder: '例：15000', oninput: (e) => { f.amount = e.target.value.normalize('NFKC').replace(/[^\d]/g, ''); } })),
        h('label', { class: 'field' }, h('span', null, '但し書き'), h('input', { type: 'text', value: f.purpose, maxlength: 60, placeholder: 'サッカー大会参加費として', oninput: (e) => { f.purpose = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, '発行元'), sel)),
      !st.data.issuer ? h('p', { class: 'notice error' }, '領収書の発行元が未登録です。上部の「発行元（領収書）」から登録してください。') : null,
      h('p', { class: 'muted small' }, '主催・共催チームの免除や、複数チームの割引は、チームの行の「金額」から変えられます。'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
          if (await run(() => api('PUT', `/api/admin/tournaments/${opts.tid}/fees/settings`, { amount: f.amount, purpose: f.purpose, issuer_id: f.issuer_id || null }), '保存しました')) await reload();
        } }, '保存'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost fee-reset', type: 'button', onclick: async () => {
          const n = st.data.receipts.length;
          if (!(await confirmDialog('参加費・領収書を初期化します', `この大会の領収書（${n}枚）と、受け取りの記録をすべて消して、全チームを「未収」に戻します。チームごとの金額・メモ・免除と、参加費の設定はそのまま残ります。試しに使ったあとなど、本番の前に使ってください。すでに渡した領収書がある場合は、初期化せずに1枚ずつ「取消」してください（記録が残ります）。消した領収書は元に戻せません。`, '初期化する', true))) return;
          const r = await run(() => api('POST', `/api/admin/tournaments/${opts.tid}/fees/reset`));
          if (r) { toast(`初期化しました（領収書 ${r.deleted}枚を削除）`); await reload(); }
        } }, '初期化')));
  };

  function draw() {
    const d = st.data;
    const teams = d.teams;
    const due = teams.filter((x) => x.status !== 'waived' && (x.amount || 0) > 0);
    const paid = teams.filter((x) => x.status === 'paid');
    const sum = (l) => l.reduce((a, x) => a + (x.amount || 0), 0);
    const cats = [...new Set(teams.map((x) => x.category))];
    const list = teams.filter((x) => (st.cat === 'all' || x.category === st.cat) && (st.filter === 'all' || x.status === st.filter));
    const row = (tm) => {
      const rc = validOf(tm.team_id);
      return h('div', { class: `fee-row s-${tm.status}` },
        h('div', { class: 'fee-main' },
          h('div', { class: 'fee-name' }, h('strong', null, tm.name), h('small', null, `${tm.category}${tm.group_label ? ` ${tm.group_label}組` : ''}`)),
          h('div', { class: 'fee-sub' },
            h('span', { class: `fee-st s-${tm.status}` }, STATUS[tm.status]),
            h('span', { class: 'fee-amt' }, tm.amount == null ? '金額未設定' : yen(tm.amount)),
            tm.custom || tm.note ? h('span', { class: 'fee-note' }, tm.note || '個別の金額') : null,
            tm.status === 'paid' && tm.method ? h('span', { class: 'muted small' }, METHOD[tm.method]) : null,
            rc ? h('span', { class: 'fee-rc' }, `No. ${rc.no}`) : null)),
        h('div', { class: 'fee-btns' },
          tm.status === 'unpaid' && tm.amount ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => receive(tm) }, '受け取った') : null,
          rc ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => receiptMenu(rc, tm) }, '領収書')
            : tm.status === 'paid' && tm.amount ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
              const r = await issue([tm.team_id], { delivery: 'print' }); if (r && r.receipts[0]) { await reload(); receiptMenu(r.receipts[0], tm); }
            } }, '領収書を出す') : null,
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => editFee(tm) }, '金額')));
    };
    mount(host,
      h('div', { class: 'fee-stats' },
        h('div', { class: 'stat-card' }, h('span', null, '受領済み'), h('b', null, `${paid.length}`), h('small', null, ` / ${due.length}チーム`)),
        h('div', { class: 'stat-card' }, h('span', null, '受け取った金額'), h('b', null, yen(sum(paid)))),
        h('div', { class: 'stat-card accent' }, h('span', null, '未収'), h('b', null, yen(sum(due.filter((x) => x.status === 'unpaid')))), h('small', null, ` ${due.filter((x) => x.status === 'unpaid').length}チーム`)),
        h('div', { class: 'stat-card' }, h('span', null, '免除'), h('b', null, `${teams.filter((x) => x.status === 'waived').length}`), h('small', null, 'チーム'))),
      opts.canSettings ? settingsPanel() : !d.issuer || d.settings.amount == null ? h('p', { class: 'notice' }, '参加費の金額か発行元が未設定です。大会の管理者に設定してもらってください。') : null,
      h('div', { class: 'row fee-tools' },
        h('button', { class: 'btn btn-sm', type: 'button', disabled: !d.issuer, onclick: batch }, '事前にまとめて印刷'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: exportXlsx }, '一覧をExcelで保存'),
        h('span', { class: 'spacer' }),
        h('input', { type: 'search', class: 'fee-search', placeholder: 'チーム名で探す', value: st.q, oninput: (e) => { st.q = e.target.value; drawList(); } })),
      h('div', { class: 'chips' }, [['all', 'すべて'], ['unpaid', `未収（${teams.filter((x) => x.status === 'unpaid').length}）`], ['paid', `受領済み（${paid.length}）`], ['waived', '免除']].map(([k, l]) =>
        h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.filter === k), onclick: () => { st.filter = k; store.set('fee:filter', k); draw(); } }, l)),
        cats.length > 1 ? [h('span', { class: 'chip-sep' }), ['all', ...cats].map((c) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(st.cat === c), onclick: () => { st.cat = c; draw(); } }, c === 'all' ? '全カテゴリ' : c))] : null),
      h('div', { class: 'fee-list' }),
      d.receipts.length ? h('details', { class: 'panel fee-ledger' }, h('summary', null, h('strong', null, `発行した領収書（${d.receipts.length}枚）`)),
        h('div', { class: 'fee-ledger-list' }, [...d.receipts].reverse().map((r) => h('button', { class: `fee-ledger-row${r.status === 'void' ? ' void' : ''}`, type: 'button', onclick: () => receiptMenu(r, teams.find((x) => x.team_id === r.team_id)) },
          h('span', { class: 'num' }, r.no), h('span', null, r.addressee), h('span', null, yen(r.amount)), h('span', { class: 'muted small' }, r.status === 'void' ? '取消' : DELIVERY[r.delivery] || ''))))) : null);
    const drawList = () => {
      const el = host.querySelector('.fee-list');
      const l2 = list.filter((x) => !st.q.trim() || x.name.normalize('NFKC').toLowerCase().includes(st.q.trim().normalize('NFKC').toLowerCase()));
      mount(el, l2.length ? l2.map(row) : h('p', { class: 'empty' }, teams.length ? '該当するチームはありません' : 'チームがまだ登録されていません'));
    };
    drawList();
  }

  mount(host, h('p', { class: 'muted' }, '読み込んでいます…'));
  load().then(draw).catch((e) => mount(host, h('p', { class: 'empty' }, e.message)));
  return host;
}
