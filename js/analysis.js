/* =========================================================
   분석 엔진 (방식 1: 브라우저에서 감정 사전으로 계산)
   결과 구조는 기술명세서 3.4 Result 와 같다.
   ========================================================= */

const EMO_KEYS = EMOTIONS.map(e => e.k);
const EMO_BY_KEY = Object.fromEntries(EMOTIONS.map((e, i) => [e.k, { ...e, i }]));

/* 사전의 모든 시어를 긴 것부터 정렬해 하나의 정규식으로 만든다.
   긴 시어를 먼저 맞춰서 '부끄럼'이 '부끄러'보다 우선하도록 한다. */
const LEX_ENTRIES = [];
EMO_KEYS.forEach(k => LEXICON[k].forEach(w => LEX_ENTRIES.push({ w, k })));
LEX_ENTRIES.sort((a, b) => b.w.length - a.w.length);
const LEX_MAP = new Map(LEX_ENTRIES.map(o => [o.w, o.k]));
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LEX_RE = new RegExp(LEX_ENTRIES.map(o => escapeRe(o.w)).join('|'), 'g');

const zeros = () => EMO_KEYS.map(() => 0);
const sum = a => a.reduce((s, x) => s + x, 0);
const normalize = a => { const t = sum(a); return t > 0 ? a.map(x => x / t) : a.map(() => 0); };

/* 5.1 전처리: 줄바꿈으로 행을 나누고, 빈 줄을 연 구분으로 본다. */
function splitPoem(text) {
  const lines = [];
  let stanza = 1, no = 0, prevBlank = false;
  text.replace(/\r/g, '').split('\n').forEach(raw => {
    const t = raw.trim();
    if (!t) { if (lines.length && !prevBlank) stanza++; prevBlank = true; return; }
    prevBlank = false;
    lines.push({ no: ++no, stanza, text: t });
  });
  return lines;
}

/* 5.2 행 단위 감정 사전 분석 */
function analyzeText(text) {
  const lines = splitPoem(text).map(l => {
    const counts = zeros();
    const hits = [];
    let m;
    LEX_RE.lastIndex = 0;
    while ((m = LEX_RE.exec(l.text)) !== null) {
      const k = LEX_MAP.get(m[0]);
      counts[EMO_BY_KEY[k].i]++;
      hits.push({ w: m[0], k, start: m.index, end: m.index + m[0].length });
    }
    return { ...l, counts, hits };
  });
  const total = zeros();
  lines.forEach(l => l.counts.forEach((c, i) => total[i] += c));
  return { lines, total, lexVec: normalize(total) };
}

/* 해석 기반 프로필을 범주 순서 벡터로 바꾼다. */
function profileVec(poem) {
  return normalize(EMO_KEYS.map(k => (poem.profile && poem.profile[k]) || 0));
}

/* 5.3 최종 감정 비율: 사전 비율 × w + 해석 프로필 × (1 − w)
   사전에서 아무것도 잡히지 않으면 해석 프로필만 쓴다. */
function analyzePoem(poem, w) {
  const a = analyzeText(poem.text);
  const pv = profileVec(poem);
  const hasLex = sum(a.total) > 0;
  const hasProf = sum(pv) > 0;
  let vec;
  if (hasLex && hasProf) vec = normalize(a.lexVec.map((x, i) => x * w + pv[i] * (1 - w)));
  else vec = hasLex ? a.lexVec : pv;
  const di = vec.indexOf(Math.max(...vec));
  return {
    id: poem.id,
    vec,
    lexVec: a.lexVec,
    profVec: pv,
    dominant: sum(vec) > 0 ? EMO_KEYS[di] : null,
    lines: a.lines,
    total: a.total,
    method: hasProf && w < 1 ? (w > 0 ? 'hybrid' : 'profile') : 'lexicon'
  };
}

/* 화면에 보일 % 값: 반올림한 뒤 합계가 정확히 100이 되도록 맞춘다(최대 잔여 방식). */
function toPercents(vec) {
  if (sum(vec) === 0) return vec.map(() => 0);
  const raw = vec.map(x => x * 100);
  const floor = raw.map(Math.floor);
  let rest = 100 - sum(floor);
  raw.map((x, i) => [x - floor[i], i]).sort((a, b) => b[0] - a[0])
     .forEach(([, i]) => { if (rest > 0) { floor[i]++; rest--; } });
  return floor;
}

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/* 유사 감성 시 추천: 코사인 유사도 상위 n편 */
function recommend(vec, results, excludeId, n = 3) {
  return results.filter(r => r.id !== excludeId)
    .map(r => ({ id: r.id, sim: cosine(vec, r.vec) }))
    .sort((a, b) => b.sim - a.sim).slice(0, n);
}

/* 감성 지도: 주성분분석(PCA). 공분산 행렬의 고유벡터 2개를 거듭제곱법으로 구한다. */
function pca2(vectors) {
  const n = vectors.length, d = vectors[0].length;
  const mean = zeros().map((_, j) => sum(vectors.map(v => v[j])) / n);
  const X = vectors.map(v => v.map((x, j) => x - mean[j]));
  const C = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) =>
    sum(X.map(r => r[i] * r[j])) / (n - 1)));
  const mul = (M, v) => M.map(row => sum(row.map((x, j) => x * v[j])));
  const unit = v => { const s = Math.sqrt(sum(v.map(x => x * x))) || 1; return v.map(x => x / s); };
  const comps = [], vars = [];
  let M = C.map(r => r.slice());
  for (let c = 0; c < 2; c++) {
    let v = unit(Array.from({ length: d }, (_, i) => 1 + i * 0.37));
    for (let it = 0; it < 300; it++) v = unit(mul(M, v));
    const lambda = sum(mul(M, v).map((x, i) => x * v[i]));
    // 부호를 정해 축 방향을 안정시킨다(가장 큰 적재값이 양수가 되도록).
    const maxIdx = v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs)));
    if (v[maxIdx] < 0) v = v.map(x => -x);
    comps.push(v); vars.push(lambda);
    M = M.map((row, i) => row.map((x, j) => x - lambda * v[i] * v[j]));
  }
  const totalVar = sum(C.map((r, i) => r[i]));
  const points = X.map(r => comps.map(v => sum(r.map((x, j) => x * v[j]))));
  return { comps, points, explained: vars.map(l => totalVar ? l / totalVar : 0) };
}
