// 試合ごとの結果報告のページ（/rep/<リンクの番号>）
// 本部がLINEで送ったリンクを開くと、その1試合だけが表示される。点数を入れて送ると「仮登録」になり、本部が承認して結果になる
import { api } from './web-api.js';
import { h, mount, toast, store } from './web-ui.js';

export async function report(root, token) {
  const nameKey = 'rep:name';
  let data = null;
  const v = { h: 0, a: 0, hp: 0, ap: 0 };
  let reporter = store.get(nameKey, '');
  let sentNow = null;

  const load = async () => { data = await api('GET', `/api/report/${token}`); };
  try { await load(); } catch (e) {
    mount(root, h('main', { class: 'wrap rep' }, h('div', { class: 'rep-card' }, h('h1', null, '結果の報告'), h('p', null, e.message || 'このリンクは使えません'))));
    return;
  }
  document.title = `結果の報告 | ${data.tournament.name}`;
  if (data.match.sent) Object.assign(v, { h: data.match.sent.home ?? 0, a: data.match.sent.away ?? 0, hp: data.match.sent.home_pk ?? 0, ap: data.match.sent.away_pk ?? 0 });
  if (data.reporter && !reporter) reporter = data.reporter;

  const tie = () => data.match.pk && v.h === v.a;
  const scoreText = () => `${v.h} - ${v.a}${tie() ? `（PK ${v.hp} - ${v.ap}）` : ''}`;

  const head = () => {
    const m = data.match;
    return h('div', { class: 'rep-head' },
      h('div', { class: 'rep-t' }, data.tournament.name),
      h('div', { class: 'rep-meta' }, [data.category, m.day ? `${m.day}日目` : '', m.start, m.court].filter(Boolean).join('　')),
      h('div', { class: 'rep-label' }, m.label));
  };

  const step = (key, label, small) => {
    const out = h('output', { 'aria-live': 'polite' }, v[key]);
    const bump = (d) => {
      const before = tie();
      v[key] = Math.max(0, Math.min(99, v[key] + d));
      out.textContent = v[key];
      if (before !== tie()) showPk();
      const btn = root.querySelector('.rep-send'); if (btn) btn.textContent = `${scoreText()} で送る`;
    };
    return h('div', { class: `sc-step${small ? ' small' : ''}` },
      h('span', { class: 'sc-step-name' }, h('b', null, label)),
      h('span', { class: 'sc-step-ctl' },
        h('button', { type: 'button', class: 'sc-pm', 'aria-label': `${label}を1減らす`, onclick: () => bump(-1) }, '−'),
        out,
        h('button', { type: 'button', class: 'sc-pm plus', 'aria-label': `${label}を1増やす`, onclick: () => bump(1) }, '＋')));
  };
  // PK戦の欄は場所を空けたまま見せる・隠すだけ（ボタンの位置が動いて押し間違えないように）
  const showPk = () => {
    const pk = root.querySelector('.sc-pk');
    if (!pk) return;
    const on = tie();
    pk.classList.toggle('is-off', !on);
    pk.querySelectorAll('button').forEach((b) => { b.disabled = !on; });
  };

  const send = async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    if (tie() && v.hp === v.ap) return toast('PK戦の結果で勝敗が決まるように入力してください', true);
    btn.disabled = true;
    try {
      await api('POST', `/api/report/${token}`, { home_score: v.h, away_score: v.a, home_pk: tie() ? v.hp : null, away_pk: tie() ? v.ap : null, reporter });
      try { store.set(nameKey, reporter); } catch { /* 保存できなくても続ける */ }
      sentNow = scoreText();
      draw();
      window.scrollTo(0, 0);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      if (err.status === 409) { try { await load(); draw(); } catch { /* そのまま */ } }
    }
  };

  function draw() {
    const m = data.match;
    if (data.closed) {
      mount(root, h('main', { class: 'wrap rep' }, h('div', { class: 'rep-card' }, head(),
        h('p', { class: 'rep-closed' }, data.closed), h('p', { class: 'muted small' }, 'このページは閉じてかまいません。'))));
      return;
    }
    if (sentNow) {
      mount(root, h('main', { class: 'wrap rep' }, h('div', { class: 'rep-card' }, head(),
        h('div', { class: 'sc-done' },
          h('div', { class: 'sc-done-mark', 'aria-hidden': 'true' }, '✓'),
          h('strong', null, '送信しました'),
          h('p', null, `${m.home}  ${sentNow}  ${m.away}`),
          h('p', { class: 'muted small' }, '本部が確認して、結果になります。間違えたときは、本部が確定する前なら送り直せます。'),
          h('button', { class: 'btn btn-block', type: 'button', onclick: () => { sentNow = null; draw(); } }, '入力をやり直す')))));
      return;
    }
    mount(root, h('main', { class: 'wrap rep' }, h('div', { class: 'rep-card stack' }, head(),
      m.sent ? h('p', { class: 'notice', style: { margin: 0 } }, `送信済みです（${m.sent.home} - ${m.sent.away}）。本部の確認待ちです。直すときは、入れ直してもう一度送ってください。`) : null,
      h('p', { class: 'muted small', style: { margin: 0 } }, '＋と−で点数を入れて、下のボタンで送ってください。'),
      step('h', m.home),
      step('a', m.away),
      m.pk ? h('div', { class: 'sc-pk' }, h('div', { class: 'small', style: { fontWeight: 700 } }, '同点のため、PK戦の結果を入力'),
        step('hp', `${m.home}（PK）`, true), step('ap', `${m.away}（PK）`, true)) : null,
      h('label', { class: 'field' }, h('span', null, 'お名前（任意）'),
        h('input', { type: 'text', maxlength: 20, value: reporter, placeholder: '例：審判 山田', autocomplete: 'name', oninput: (e) => { reporter = e.target.value; } })),
      h('button', { class: 'btn btn-primary btn-block rep-send', type: 'button', onclick: send }, `${scoreText()} で送る`),
      h('p', { class: 'muted small', style: { margin: 0 } }, '送った結果は、本部が確認してから公開されます。'))));
    showPk();
  }
  draw();
}

// 本部の画面：試合を選んで報告のリンクを出す（LINEで送る・コピー・その場でQRを見せる・取り消す）
export async function openReportLink({ t, m, home, away, when, onChange }) {
  const { modal, confirmDialog, copyText, lineShareUrl, formatUpdated } = await import('./web-ui.js');
  const { qrDataUrl } = await import('./web-qr.js');
  let r;
  try { r = await api('POST', `/api/admin/matches/${m.id}/report-link`); } catch (e) { toast(e.message, true); return; }
  const text = [`【${t.name}】結果の報告のお願い`, `${when}　${m.label}`, `${home} − ${away}`, '', '試合が終わったら、下のリンクを開いて点数を入れて送ってください（この試合だけの入力ページです）。', r.url].join('\n');
  let qr = null;
  const qrBox = h('div');
  const content = h('div', { class: 'stack' },
    h('p', { style: { margin: 0 } }, h('b', null, `${home} − ${away}`), h('br'), h('span', { class: 'muted small' }, `${when}　${m.label}`)),
    r.used_at ? h('p', { class: 'notice', style: { margin: 0 } }, `このリンクから報告が届いています（${r.reporter || '名前なし'}・${formatUpdated(r.used_at)}）。「結果」の仮登録から承認してください。`) : null,
    h('p', { class: 'muted small', style: { margin: 0 } }, '送った人がこのリンクを開くと、この試合だけの入力ページが開きます。届いた点数は「仮登録」になり、本部が承認すると結果になります。'),
    h('div', { class: 'rep-link-url' }, r.url),
    qrBox);
  modal({ title: '結果報告のリンク', content, actions: [
    { label: '取り消す', kind: 'btn-ghost', onClick: async () => {
      if (!(await confirmDialog('リンクを取り消します', 'このリンクは使えなくなります。もう一度送るときは、新しいリンクを発行します。', '取り消す', true))) return true;
      try { await api('POST', `/api/admin/report-links/${r.id}/revoke`); toast('リンクを取り消しました'); onChange && onChange(); } catch (e) { toast(e.message, true); return true; }
      return false;
    } },
    { label: 'QRを表示', onClick: async () => {
      qr = qr ? null : qrDataUrl(r.url);
      mount(qrBox, qr ? h('img', { class: 'rep-link-qr', src: qr, alt: '報告ページのQRコード' }) : null);
      return true;
    } },
    { label: '文をコピー', onClick: async () => { await copyText(text); return true; } },
    { label: 'LINEで送る', kind: 'btn-line', onClick: async () => { window.open(lineShareUrl(text), '_blank', 'noopener'); return true; } },
  ] });
}
