// 時刻は「その日の0時からの分」で扱う（例: 9:30 → 570）

export const toHHMM = (m) => {
  if (m == null || Number.isNaN(m)) return '--:--';
  const h = Math.floor(m / 60);
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const fromHHMM = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
};

export const CATEGORY_NAMES = ['U7', 'U8', 'U9', 'U10', 'U11', 'U12'];

export const TIEBREAK_KEYS = {
  points: '勝点',
  gd: '得失点差',
  gf: '総得点',
  h2h: '当該チーム間の対戦成績',
  lottery: '抽選',
};

// 既定は「総合成績優先」
export const DEFAULT_TIEBREAK = ['points', 'gd', 'gf', 'h2h', 'lottery'];

export function defaultConfig() {
  return {
    startTime: 540, // 9:00
    halfMinutes: 15,
    halftimeMinutes: 5,
    intervalMinutes: 5,
    lunchEnabled: true,
    lunchStart: 720, // 12:00 を過ぎる試合は昼休憩の後に回す
    lunchMinutes: 45,
    minLunchMinutes: 0,
    courts: 2,
    courtNames: [],
    format: 'league', // league | knockout | league_knockout
    groups: 2,
    advance: 2, // リーグ→トーナメントで各組から進出するチーム数（1 or 2）
    rankMode: 'top3', // top3 | top3_shared | all
    tiebreak: [...DEFAULT_TIEBREAK],
    forfeitScore: [3, 0],
    showStandings: true,
    minRestSlots: 1, // 同じチームの試合の間に空ける枠数
    grouping: { fixed: {}, separate: [] },
    lottery: {},
  };
}

export function normalizeConfig(c) {
  const d = defaultConfig();
  const out = { ...d, ...(c || {}) };
  out.grouping = { ...d.grouping, ...(out.grouping || {}) };
  out.lottery = out.lottery || {};
  out.courts = Math.max(1, Math.min(12, Number(out.courts) || 1));
  out.groups = Math.max(1, Math.min(16, Number(out.groups) || 1));
  out.advance = Number(out.advance) === 1 ? 1 : 2;
  for (const k of ['startTime', 'halfMinutes', 'halftimeMinutes', 'intervalMinutes', 'lunchStart', 'lunchMinutes', 'minLunchMinutes', 'minRestSlots']) {
    out[k] = Math.max(0, Number(out[k]) || 0);
  }
  if (!Array.isArray(out.tiebreak) || !out.tiebreak.length) out.tiebreak = [...DEFAULT_TIEBREAK];
  out.tiebreak = out.tiebreak.filter((k) => k in TIEBREAK_KEYS);
  return out;
}

export const matchLength = (c) => c.halfMinutes * 2 + c.halftimeMinutes;

export function courtName(c, i) {
  return (c.courtNames && c.courtNames[i]) || `${String.fromCharCode(65 + i)}コート`;
}

// 枠番号ごとの開始時刻。lunchStart をまたぐ試合は昼休憩の後に回す。
export function slotTimes(c, n) {
  const len = matchLength(c);
  const step = len + c.intervalMinutes;
  const out = [];
  let t = c.startTime;
  let lunchDone = !c.lunchEnabled || c.lunchMinutes <= 0;
  let session = 'am';
  for (let i = 0; i < n; i++) {
    if (!lunchDone && t + len > c.lunchStart) {
      lunchDone = true;
      if (i > 0) {
        t = out[i - 1].start + len + c.lunchMinutes;
        session = 'pm';
      }
    }
    out.push({ start: t, session });
    t += step;
  }
  return out;
}
