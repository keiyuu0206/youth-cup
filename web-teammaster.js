// チームマスタ：貼り付けた参加チーム一覧を読み取り、マスタと照らし合わせる（画面側で計算する）
// サーバーの負担を増やさないよう、照らし合わせはブラウザで行う。サーバー側の同じ規則は teamnorm.js（内容をそろえること）

export const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
  '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山',
  '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];

// 「静岡県」「東京都」「大阪府」→「静岡」「東京」「大阪」。都道府県でなければ null
export function normPref(s) {
  const v = String(s ?? '').normalize('NFKC').replace(/\s/g, '');
  if (!v) return null;
  if (PREFS.includes(v)) return v;
  const cut = v.replace(/[都道府県]$/, '');
  return PREFS.includes(cut) ? cut : null;
}

// 照らし合わせの基本の形：全角・半角、大文字・小文字、空白や記号の違いを無視する
export function normKey(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s.\-‐‑–—―−_・･'"`’”,、。\/()[\]{}「」『』【】]/g, '');
}

// ゆるい形：「FC」「SC」「少年団」「サッカークラブ」などの付け方の違いも無視する（似ているチームの候補を探す用）
const NOISE = ['サッカースポーツ少年団', 'サッカー少年団', 'スポーツ少年団', 'フットボールクラブ', 'サッカークラブ', 'footballclub', 'soccerclub',
  'ジュニアユース', 'ジュニア', 'junior', '少年団', 'サッカー', 'クラブ', 'club', 'fc', 'sc', 'jr', 'ss', 'sss'];
export function looseKey(s) {
  let v = normKey(s);
  for (const w of NOISE) v = v.split(w).join('');
  return v.replace(/u\d{1,2}$/, '') || normKey(s);
}

// 名前の最後の「A」「B」「①」「②」「Aチーム」などを、同じクラブの何チーム目かの印として取り出す
export function splitSuffix(name) {
  const s = String(name ?? '').trim();
  // strong：印だとはっきりわかる書き方（①、(A)、Aチーム、空白のあとのA）。「TDFC」の「C」のように名前の一部かもしれないものは弱い
  const pats = [[/^(.+?)\s*[（(]([A-EＡ-Ｅ①-⑳])[)）]$/, true], [/^(.+?)\s*([①-⑳])$/, true], [/^(.+?)\s*([A-EＡ-Ｅ])\s*チーム$/, true],
    [/^(.+?\S)[\s\u3000]+([A-EＡ-Ｅ])$/, true], [/^(.+?\S)([A-EＡ-Ｅ])$/, false]];
  for (const [re, strong] of pats) {
    const m = s.match(re);
    if (m && normKey(m[1]).length >= 2) return { base: m[1].trim(), suffix: /[①-⑳]/.test(m[2]) ? m[2] : m[2].normalize('NFKC'), strong };
  }
  return null;
}

// 1行を読み取る：「チーム名（静岡）」「チーム名, 静岡」「チーム名<TAB>静岡県」「A1 チーム名 (茨城)」「チーム名, クラブ名」
export function parseLine(line) {
  let s = String(line ?? '').replace(/　/g, ' ').trim();
  if (!s) return null;
  s = s.replace(/^\d{1,3}\s*[.．、)）:：]\s*/, '').replace(/^[A-HＡ-Ｈ][0-9０-９]{1,2}(\s+|\t)/, '');
  const cols = s.split(/\t|,|，|、/).map((x) => x.trim()).filter(Boolean);
  if (!cols.length) return null;
  let name = cols[0], pref = null, club = null, shortName = null;
  for (const c of cols.slice(1)) {
    const p = normPref(c);
    if (p && !pref) pref = p;
    else if (!club) club = c;
    else if (!shortName) shortName = c;
  }
  const m = name.match(/^(.*?)\s*[（(]([^（）()]{1,8})[)）]\s*$/);
  if (m && m[1].trim() && normPref(m[2])) { name = m[1].trim(); pref = pref || normPref(m[2]); }
  return { input: String(line).trim(), name: name.slice(0, 60), pref, club, shortName };
}

const bigrams = (s) => { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a.length ? a : [s]; };
function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const m = new Map();
  for (const x of a) m.set(x, (m.get(x) || 0) + 1);
  let hit = 0;
  for (const x of b) { const n = m.get(x); if (n) { hit++; m.set(x, n - 1); } }
  return (2 * hit) / (a.length + b.length);
}

// マスタの一覧から、照らし合わせ用の索引を作る（一度だけ）
export function buildIndex(masters) {
  const byKey = new Map();
  const items = masters.map((m) => {
    const it = { ...m, key: normKey(m.name), loose: looseKey(m.name) };
    it.bi = bigrams(it.loose);
    if (!byKey.has(it.key)) byKey.set(it.key, []);
    byKey.get(it.key).push(it);
    return it;
  });
  return { items, byKey };
}

// 都道府県が両方わかっていて違うものは別のチーム
const prefOk = (m, pref) => !pref || !m.prefecture || m.prefecture === pref;

// 1行を照らし合わせる → status: match（一致）／similar（確認が必要）／new（マスタに無い）
export function matchRow(row, index) {
  const strip = ({ key, loose, bi, ...m }) => m;
  const exact = (name) => (index.byKey.get(normKey(name)) || []).filter((m) => prefOk(m, row.pref));
  let hits = exact(row.name);
  let suffix = '';
  const sp = splitSuffix(row.name);
  if (!hits.length && sp) { hits = exact(sp.base); if (hits.length) suffix = sp.suffix; }
  if (hits.length === 1) return { ...row, status: 'match', master: strip(hits[0]), suffix, candidates: [] };
  if (hits.length > 1) return { ...row, status: 'similar', suffix, candidates: hits.map(strip) };
  // 似ているチーム：ゆるい形が同じ／片方を含む／文字の並びがよく似ている
  const targets = [row.name, sp ? sp.base : null].filter(Boolean).map((n) => ({ n, loose: looseKey(n) }));
  const scored = [];
  for (const m of index.items) {
    let best = 0;
    for (const t of targets) {
      let sc = 0;
      if (t.loose === m.loose) sc = 0.95;
      else if (t.loose.length >= 3 && m.loose.length >= 3 && (t.loose.includes(m.loose) || m.loose.includes(t.loose))) sc = 0.8;
      else sc = dice(bigrams(t.loose), m.bi);
      if (row.pref && m.prefecture && row.pref !== m.prefecture) sc *= 0.7;
      if (sc > best) best = sc;
    }
    if (best >= 0.6) scored.push([best, m]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  if (scored.length) {
    const cand = scored.slice(0, 5).map(([, m]) => strip(m));
    const sp2 = sp && looseKey(sp.base) === looseKey(cand[0].name) ? sp.suffix : '';
    return { ...row, status: 'similar', suffix: sp2, candidates: cand };
  }
  return { ...row, status: 'new', suffix: '', candidates: [] };
}

// 大会に登録するチーム名：マスタの名前＋A・Bなどの印
export function teamName(master, suffix) {
  if (!suffix) return master.name;
  // 「K-WEST.FC2001」＋A →「K-WEST.FC2001A」、「FC春江」＋② →「FC春江②」、「さくらFC」＋A →「さくらFC A」
  return /[①-⑳]/.test(suffix) || /[0-9０-９]$/.test(master.name) ? `${master.name}${suffix}` : `${master.name} ${suffix}`;
}
