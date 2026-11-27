// INFINEX 紹介ページの動き（スクロールで表示・動画は見えている間だけ再生・「使ってみたい」）
document.documentElement.classList.remove('no-js');
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };

  // ヘッダーの下線
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // スクロールで少しずつ表示（並んでいるものは順番に）
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target;
    const sibs = $$('.reveal', el.parentElement);
    el.style.transitionDelay = `${Math.min(sibs.indexOf(el), 6) * 70}ms`;
    el.classList.add('in');
    $$('.points li', el).forEach((li, i) => setTimeout(() => li.classList.add('in'), 300 + i * 220));
    io.unobserve(el);
  }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el) => io.observe(el));

  // 動画：画面に見えている間だけ読み込んで再生（通信量と電池を節約）
  const load = (v) => { if (!v.src && v.dataset.src) { v.src = v.dataset.src; v.load(); } };
  const vio = new IntersectionObserver((es) => es.forEach((e) => {
    const v = e.target;
    if (e.isIntersecting) {
      load(v);
      if (calm) return;
      const group = v.closest('[data-sync]');
      if (group) {
        // ヒーローの2台は同時に頭から再生して、動きをそろえる
        const vs = $$('video', group);
        vs.forEach(load);
        if (vs.every((x) => x.paused)) { vs.forEach((x) => { x.currentTime = 0; }); vs.forEach((x) => x.play().catch(() => {})); }
      } else v.play().catch(() => {});
    } else v.pause();
  }), { threshold: 0.25 });
  $$('video[data-src]').forEach((v) => vio.observe(v));
  // 2台の動画のずれを、1周ごとに直す
  const sync = $('[data-sync]');
  if (sync) {
    const [a, b] = $$('video', sync);
    a.addEventListener('timeupdate', () => { if (!b.paused && Math.abs(a.currentTime - b.currentTime) > 0.25) b.currentTime = a.currentTime; });
  }

  // 使い方：動画の進み具合に合わせて、今の手順を光らせる
  const prep = $('#prepVideo');
  const steps = $$('#steps li');
  const mark = (t) => {
    let cur = 0;
    steps.forEach((li, i) => { if (t >= Number(li.dataset.from)) cur = i; });
    steps.forEach((li, i) => li.classList.toggle('on', i === cur));
  };
  if (prep && steps.length) {
    mark(0);
    prep.addEventListener('timeupdate', () => mark(prep.currentTime));
    // 手順を押すと、その場面から再生
    steps.forEach((li) => {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => { load(prep); prep.currentTime = Number(li.dataset.from) + 0.05; prep.play().catch(() => {}); mark(prep.currentTime); });
    });
  }

  // 資料のギャラリー：途切れずに流れるよう、同じ並びをもう1組つなげる
  const track = $('.marquee-track');
  if (track && !calm) $$('figure', track).forEach((f) => { const c = f.cloneNode(true); c.setAttribute('aria-hidden', 'true'); $$('img', c).forEach((i) => { i.alt = ''; }); track.appendChild(c); });

  // ---------- 使ってみたい ----------
  const KEY = 'infinex_lp_want';
  let scene = null;
  $$('#scenes button').forEach((b) => {
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      scene = scene === b.dataset.scene ? null : b.dataset.scene;
      $$('#scenes button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.scene === scene)));
    });
  });
  const btn = $('#wantBtn');
  const thanks = () => {
    btn.hidden = true; $('#scenes').hidden = true; $('#thanks').hidden = false;
  };
  if (safe(() => localStorage.getItem(KEY), null)) thanks();
  const burst = (el) => {
    if (calm) return;
    const r = el.getBoundingClientRect();
    const colors = ['#C8FF3D', '#F2F4F1', '#06C755', '#A3ACA7'];
    for (let i = 0; i < 28; i++) {
      const d = document.createElement('i');
      d.className = 'burst';
      d.style.background = colors[i % colors.length];
      d.style.left = `${r.left + r.width / 2}px`; d.style.top = `${r.top + r.height / 2}px`;
      document.body.appendChild(d);
      const a = (Math.PI * 2 * i) / 28 + Math.random() * 0.4, dist = 80 + Math.random() * 90;
      d.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist + 40}px) rotate(${Math.random() * 360}deg)`, opacity: 0 }], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => d.remove();
    }
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.classList.add('pop'); burst(btn);
    try {
      await fetch('/api/lp/interest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene }) });
    } catch { /* 送れなくてもお礼は出す */ }
    safe(() => localStorage.setItem(KEY, '1'));
    setTimeout(thanks, 450);
  });
  fetch('/api/lp/status').then((r) => r.json()).then((s) => {
    if (s && s.interest) { const c = $('#wantCount'); c.textContent = `${s.interest.toLocaleString('ja-JP')}件の「使ってみたい」をいただいています`; c.hidden = false; }
  }).catch(() => {});

  // シェア
  const url = location.origin + '/lp/';
  const text = '少年サッカー大会の運営アプリ「INFINEX」。組み分け・日程づくりから当日の速報、参加費の領収書まで、スマホでスピーディーに。';
  $('#shX').href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  $('#shLine').href = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
  $('#shFb').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  $('#shCopy').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(url); b.textContent = 'コピーしました'; } catch { b.textContent = url; }
    setTimeout(() => { b.textContent = 'リンクをコピー'; }, 2000);
  });
})();
