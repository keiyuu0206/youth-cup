// チームマスタ：サーバー側で使う名前の正規化（画面側の web-teammaster.js と同じ規則。変えるときは両方そろえる）

export const PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
  '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山',
  '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];

export function normPref(s) {
  const v = String(s ?? '').normalize('NFKC').replace(/\s/g, '');
  if (!v) return null;
  if (PREFS.includes(v)) return v;
  const cut = v.replace(/[都道府県]$/, '');
  return PREFS.includes(cut) ? cut : null;
}

export function normKey(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s.\-‐‑–—―−_・･'"`’”,、。\/()[\]{}「」『』【】]/g, '');
}

// 「さくらFC（静岡）」→ { name: 'さくらFC', pref: '静岡' }（都道府県でないかっこ書きはそのまま）
export function splitPref(name) {
  const s = String(name ?? '').trim();
  const m = s.match(/^(.*?)\s*[（(]([^（）()]{1,8})[)）]\s*$/);
  if (m && m[1].trim() && normPref(m[2])) return { name: m[1].trim(), pref: normPref(m[2]) };
  return { name: s, pref: null };
}

// 名前の最後の A・B・①・② など（これまでのチームからマスタを作るときに、同じカテゴリに兄弟チームがあるかを見る）
export function stripSuffix(name) {
  const s = String(name ?? '').trim();
  const m = s.match(/^(.+?)\s*[（(]?([A-EＡ-Ｅ①-⑳])[)）]?\s*(チーム)?$/);
  return m && normKey(m[1]).length >= 2 ? m[1].trim() : null;
}
