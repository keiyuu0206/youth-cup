import { h, mount } from './web-ui.js';

const root = document.getElementById('app');

async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  document.body.classList.remove('has-bottom-nav');
  const navigate = (to) => { history.pushState(null, '', to); route(); window.scrollTo(0, 0); };
  try {
    if (path.startsWith('/admin')) {
      const { admin } = await import('./web-admin.js');
      return await admin(root, path, navigate);
    }
    let m = path.match(/^\/t\/([^/]+)$/);
    if (m) {
      const { viewer } = await import('./web-viewer.js');
      return await viewer(root, m[1]);
    }
    m = path.match(/^\/r\/([^/]+)$/);
    if (m) {
      const { relative } = await import('./web-relative.js');
      return await relative(root, m[1]);
    }
    home();
  } catch (e) {
    console.error(e);
    mount(root, h('div', { class: 'wrap' }, h('p', { class: 'empty' }, '画面を表示できませんでした。再読み込みしてください。')));
  }
}

function home() {
  mount(root,
    h('header', { class: 'site-head' }, h('div', { class: 'wrap' }, h('h1', null, '少年サッカー 大会運営'))),
    h('main', { class: 'wrap stack', style: { marginTop: '24px' } },
      h('p', null, '試合結果は、大会本部から共有されたURLで見られます。'),
      h('a', { class: 'btn btn-primary', href: '/admin' }, '大会運営者のログイン')));
}

window.addEventListener('popstate', route);
route();
