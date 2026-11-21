/* =========================================================
   화면 구성
   ========================================================= */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emo = k => EMO_BY_KEY[k];
/* 색 위 글자: 흰색과 진한 먹색 중 대비가 큰 쪽을 고른다(N-04 접근성). */
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
EMOTIONS.forEach(e => { const L = lum(e.color); e.on = contrast(L, 1) >= contrast(L, lum('#111111')) ? '#fff' : '#111'; });

const state = {
  id: POEMS[0].id,
  w: 0.5,
  tab: 'read',
  filter: 'all',
  theme: 'auto',
  results: []
};
try { const s = JSON.parse(localStorage.getItem('poem-temp') || '{}'); Object.assign(state, s); } catch (e) {}
if (!POEMS.some(p => p.id === state.id)) state.id = POEMS[0].id;
const save = () => { try { localStorage.setItem('poem-temp', JSON.stringify({ id: state.id, w: state.w, tab: state.tab, filter: state.filter, theme: state.theme })); } catch (e) {} };

const poemById = id => POEMS.find(p => p.id === id);
const resultById = id => state.results.find(r => r.id === id);

function recompute() { state.results = POEMS.map(p => analyzePoem(p, state.w)); }

/* ---------- 공통 조각 ---------- */
function barsHtml(vec) {
  const pc = toPercents(vec);
  return EMOTIONS.map((e, i) => `
    <div class="bar" style="--c:${e.color}">
      <span>${e.name}</span>
      <span class="track"><span class="fill" style="width:${pc[i]}%"></span></span>
      <span class="v">${pc[i]}%</span>
    </div>`).join('');
}
function dominantHtml(r, label = '지배 정서') {
  if (!r.dominant) return `<div><span class="lbl">${label}</span><span class="big">감지 없음</span></div>`;
  const e = emo(r.dominant);
  const pc = toPercents(r.vec)[e.i];
  return `<span class="dot" style="background:${e.color};width:16px;height:16px"></span>
    <div><span class="lbl">${label}</span><span class="big">${e.name} ${pc}%</span></div>`;
}
function linesHtml(lines) {
  let html = '', st = 0;
  lines.forEach(l => {
    if (l.stanza !== st) { if (st) html += '</div>'; html += '<div class="stanza">'; st = l.stanza; }
    let tx = '', pos = 0;
    l.hits.forEach(h => {
      tx += esc(l.text.slice(pos, h.start));
      tx += `<mark class="hit" style="--c:${emo(h.k).color}" data-tip="${esc(h.w)} → ${emo(h.k).name}">${esc(l.text.slice(h.start, h.end))}</mark>`;
      pos = h.end;
    });
    tx += esc(l.text.slice(pos));
    const chips = EMOTIONS.map((e, i) => l.counts[i] ? `<span class="chip" style="--c:${e.color};--on:${e.on}">${e.name}${l.counts[i] > 1 ? ' ×' + l.counts[i] : ''}</span>` : '').join('');
    html += `<div class="line"><span class="no">${l.no}</span><span class="tx">${tx}</span><span class="chips">${chips}</span></div>`;
  });
  return html + (st ? '</div>' : '');
}
function recsHtml(list) {
  return list.map(x => {
    const p = poemById(x.id), r = resultById(x.id), e = emo(r.dominant);
    return `<button class="rec" data-go="${p.id}">
      <span class="sim">${Math.round(x.sim * 100)}%</span>
      <span class="t">${esc(p.title)}</span>
      <span class="p">${esc(p.poet)} · 지배 정서 <span class="dot" style="background:${e.color}"></span> ${e.name}</span>
    </button>`;
  }).join('');
}

/* ---------- 사전 기반 vs 문맥 기반 ---------- */
const topOf = v => { const m = Math.max(...v); return m > 0 ? EMOTIONS[v.indexOf(m)] : null; };
function versusHtml(p, r) {
  const lp = toPercents(r.lexVec), cp = toPercents(r.ctxVec);
  const lt = topOf(r.lexVec), ct = topOf(r.ctxVec);
  const agree = Math.round(cosine(r.lexVec, r.ctxVec) * 100);
  const same = lt && ct && lt.k === ct.k;
  const rows = EMOTIONS.map((e, i) => (lp[i] || cp[i]) ? `
    <div class="vs-row" style="--c:${e.color}">
      <span>${e.name}</span>
      <span class="vs-bars"><span style="width:${lp[i]}%"></span><span class="ctx" style="width:${cp[i]}%"></span></span>
      <span class="v">${lp[i]} / ${cp[i]}%</span>
    </div>` : '').join('');
  return `<h4>사전 기반 vs 문맥 기반</h4>
    <div class="vs-key"><span><i class="lx"></i>사전 기반(낱말)</span><span><i class="cx"></i>문맥 기반(흐름·화자·시대)</span></div>
    ${rows}
    <p class="vs-sum">사전 1위 <b>${lt ? lt.name : '없음'}</b> · 문맥 1위 <b>${ct.name}</b> · 일치도 <b>${agree}%</b>
      <span class="badge ${same ? 'ok' : 'no'}">${same ? '1위 일치' : '1위 다름'}</span></p>
    <p class="ctx-note"><b>문맥 근거</b> ${esc(p.context || '')}</p>`;
}

/* ---------- 작품 선반 (F-01) ---------- */
const visiblePoems = () => POEMS.filter(p => state.filter === 'all' || (state.filter === 'new') === !!p.isNew);
function renderShelf() {
  $('#legend').innerHTML = EMOTIONS.map(e => `<span><span class="dot" style="background:${e.color}"></span>${e.name}</span>`).join('');
  document.querySelectorAll('.fchip').forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === state.filter));
  const vis = new Set(visiblePoems().map(p => p.id));
  $('#shelf').innerHTML = POEMS.map(p => {
    const r = resultById(p.id), e = emo(r.dominant);
    return `<button class="book" role="option" data-go="${p.id}" aria-selected="${p.id === state.id}" style="--c:${e.color}"${vis.has(p.id) ? '' : ' hidden'}>
      ${p.isNew ? '<span class="new">NEW</span>' : ''}
      <span class="t" title="${esc(p.title)}">${esc(p.title)}</span>
      <span class="p">${esc(p.poet)} · ${p.year}</span><br>
      <span class="d"><span class="dot" style="background:${e.color}"></span>${e.name}</span>
    </button>`;
  }).join('');
  const sel = $('#shelf .book[aria-selected="true"]');
  if (sel && !sel.hidden) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- 상단 배너: 감정 온도계 ---------- */
function renderHero() {
  const p = poemById(state.id), r = resultById(state.id), pc = toPercents(r.vec);
  const e = emo(r.dominant);
  $('#hero').style.setProperty('--hc', e.color);
  $('#hMeta').textContent = `${p.poet} · ${p.year}${p.isNew ? ' · 신규 수록' : ''} · 지배 정서 ${e.name} ${pc[e.i]}%`;
  $('#hTitle').textContent = p.title;
  $('#hKey').textContent = p.key ? `“${p.key}”` : '';
  const order = EMOTIONS.map((x, i) => ({ ...x, v: pc[i] })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  $('#thermo').innerHTML = order.map(x => `<span style="--c:${x.color};--on:${x.on};flex-basis:${x.v}%" title="${x.name} ${x.v}%">${x.v >= (innerWidth < 600 ? 14 : 9) ? x.name.split('·')[0] + ' ' + x.v + '%' : ''}</span>`).join('');
  $('#thermo').setAttribute('aria-label', '감정 온도계: ' + order.map(x => `${x.name} ${x.v}%`).join(', '));
  $('#thermoLegend').innerHTML = order.map(x => `<span><span class="dot" style="background:${x.color}"></span> <b>${x.name}</b> ${x.v}%</span>`).join('');
}
function step(d) {
  const list = visiblePoems();
  let i = list.findIndex(p => p.id === state.id);
  if (i < 0) i = 0; else i = (i + d + list.length) % list.length;
  select(list[i].id, false);
}

/* ---------- 읽기 (F-02 ~ F-05) ---------- */
function renderRead() {
  const p = poemById(state.id), r = resultById(state.id);
  $('#pTitle').textContent = p.title;
  $('#pMeta').textContent = `${p.poet} · ${p.year}년 발표 · 시인 사망 ${p.poetDeath}년`;
  $('#pText').innerHTML = linesHtml(r.lines);
  const d = $('#pDominant');
  d.style.setProperty('--c', emo(r.dominant).color);
  d.innerHTML = dominantHtml(r);
  $('#pBars').innerHTML = barsHtml(r.vec);
  $('#pVersus').innerHTML = versusHtml(p, r);
  $('#pFacts').innerHTML = [['주제', p.theme], ['화자', p.speaker], ['표현', p.devices]]
    .filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  $('#pInterp').textContent = p.interp;
  $('#pKey').textContent = p.key || '';
  $('#pSource').textContent = '출처: ' + p.source;
}

/* ---------- 감정 차트 (F-06, F-07, F-09) ---------- */
let radarChart, flowChart;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function renderCharts() {
  if (typeof Chart === 'undefined') return;
  const p = poemById(state.id), r = resultById(state.id);
  const recs = recommend(r.vec, state.results, p.id);
  const top = poemById(recs[0].id), topR = resultById(recs[0].id);
  const ink = cssVar('--ink'), line = cssVar('--line'), accent = cssVar('--accent'), muted = cssVar('--muted');
  Chart.defaults.color = muted;
  Chart.defaults.font.family = "'Noto Sans KR', sans-serif";

  const radarData = {
    labels: EMOTIONS.map(e => e.name),
    datasets: [
      { label: p.title, data: r.vec.map(x => +(x * 100).toFixed(1)), borderColor: accent, backgroundColor: accent + '33', borderWidth: 2, pointBackgroundColor: EMOTIONS.map(e => e.color) },
      { label: top.title + ' (추천 1위)', data: topR.vec.map(x => +(x * 100).toFixed(1)), borderColor: muted, borderDash: [5, 4], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 2 }
    ]
  };
  if (radarChart) radarChart.destroy();
  radarChart = new Chart($('#radar'), {
    type: 'radar', data: radarData,
    options: {
      maintainAspectRatio: false,
      scales: { r: { beginAtZero: true, grid: { color: line }, angleLines: { color: line }, pointLabels: { color: ink, font: { size: 12 } }, ticks: { backdropColor: 'transparent', callback: v => v + '%' } } },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw}%` } } }
    }
  });

  if (flowChart) flowChart.destroy();
  flowChart = new Chart($('#flowChart'), {
    type: 'bar',
    data: {
      labels: r.lines.map(l => l.no),
      datasets: EMOTIONS.map((e, i) => ({ label: e.name, data: r.lines.map(l => l.counts[i]), backgroundColor: e.color, stack: 's' }))
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, title: { display: true, text: '행 번호' }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: '감지 시어 수' }, grid: { color: line } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          filter: c => c.raw > 0,
          callbacks: {
            title: items => { const l = r.lines[items[0].dataIndex]; return `${l.no}행: ${l.text}`; },
            afterBody: items => { const l = r.lines[items[0].dataIndex]; return l.hits.length ? '감지: ' + l.hits.map(h => h.w).join(', ') : ''; }
          }
        }
      }
    }
  });
  $('#recs').innerHTML = recsHtml(recs);
}

/* ---------- 시어 흐름도 (F-08) ---------- */
function renderFlow() {
  const p = poemById(state.id), r = resultById(state.id);
  const wc = new Map();
  r.lines.forEach(l => l.hits.forEach(h => {
    const key = h.w + '|' + h.k;
    wc.set(key, (wc.get(key) || 0) + 1);
  }));
  const words = [...wc.entries()].map(([key, n]) => { const [w, k] = key.split('|'); return { w, k, n }; })
    .sort((a, b) => b.n - a.n).slice(0, 10);
  const pc = toPercents(r.vec);
  const emos = EMOTIONS.map((e, i) => ({ ...e, i, v: pc[i] })).filter(e => e.v > 0 || words.some(w => w.k === e.k)).sort((a, b) => b.v - a.v);
  const W = 860, rowH = 38, H = Math.max(words.length, emos.length, 3) * rowH + 40;
  const xW = 20, xE = 330, xT = 610;
  const yOf = (i, n) => 20 + (H - 40) * (i + .5) / n;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.title)}의 시어-감정-주제 흐름도">`;
  // 시어 → 감정
  words.forEach((w, i) => {
    const ei = emos.findIndex(e => e.k === w.k);
    const y1 = yOf(i, words.length), y2 = yOf(ei, emos.length);
    svg += `<path d="M${xW + 150},${y1} C${xW + 240},${y1} ${xE - 90},${y2} ${xE},${y2}" fill="none" stroke="${emo(w.k).color}" stroke-opacity=".55" stroke-width="${1 + w.n * 1.5}"/>`;
  });
  // 감정 → 주제
  const yT = H / 2;
  emos.forEach((e, i) => {
    if (!e.v) return;
    const y = yOf(i, emos.length);
    svg += `<path d="M${xE + 170},${y} C${xE + 230},${y} ${xT - 60},${yT} ${xT},${yT}" fill="none" stroke="${e.color}" stroke-opacity=".5" stroke-width="${1 + e.v / 6}"/>`;
  });
  words.forEach((w, i) => {
    const y = yOf(i, words.length);
    svg += `<rect x="${xW}" y="${y - 13}" width="150" height="26" rx="13" fill="${emo(w.k).color}" fill-opacity=".14" stroke="${emo(w.k).color}"/>
      <text x="${xW + 12}" y="${y + 5}" font-size="14">${esc(w.w)}</text><text x="${xW + 140}" y="${y + 5}" font-size="12" text-anchor="end" opacity=".7">×${w.n}</text>`;
  });
  emos.forEach((e, i) => {
    const y = yOf(i, emos.length), bw = Math.max(4, e.v * 1.7);
    svg += `<rect x="${xE}" y="${y - 12}" width="${bw}" height="24" rx="4" fill="${e.color}"/>
      <text x="${xE + bw + 8}" y="${y + 5}" font-size="13">${e.name} ${e.v}%</text>`;
  });
  const theme = p.theme;
  const parts = theme.length > 18 ? [theme.slice(0, Math.ceil(theme.length / 2)), theme.slice(Math.ceil(theme.length / 2))] : [theme];
  svg += `<rect x="${xT}" y="${yT - 44}" width="${W - xT - 10}" height="88" rx="12" fill="none" stroke="currentColor" stroke-opacity=".35"/>
    <text x="${xT + 14}" y="${yT - 18}" font-size="11" opacity=".7">주제</text>`;
  parts.forEach((t, i) => svg += `<text x="${xT + 14}" y="${yT + 4 + i * 20}" font-size="15" font-weight="700">${esc(t.trim())}</text>`);
  svg += '</svg>';
  $('#flowSvg').innerHTML = words.length ? svg : '<p class="sub">이 시에서는 사전 시어가 잡히지 않았습니다.</p>';
}

/* ---------- 비교 (F-10, F-12) ---------- */
function renderCompare() {
  const head = '<tr><th>작품</th>' + EMOTIONS.map(e => `<th><span class="dot" style="background:${e.color}"></span><br>${e.name}</th>`).join('') + '</tr>';
  const rows = state.results.map(r => {
    const p = poemById(r.id), pc = toPercents(r.vec);
    return `<tr class="${r.id === state.id ? 'sel' : ''}"><td class="name" data-go="${p.id}">${esc(p.title)}</td>` +
      EMOTIONS.map((e, i) => `<td class="v" style="background:color-mix(in srgb, ${e.color} ${Math.min(100, pc[i] * 1.8)}%, transparent);color:${pc[i] > 30 ? '#fff' : 'inherit'}">${pc[i]}</td>`).join('') + '</tr>';
  }).join('');
  $('#heat').innerHTML = `<table class="heat"><thead>${head}</thead><tbody>${rows}</tbody></table>`;

  const vs = state.results.map(r => ({ r, p: poemById(r.id), lt: topOf(r.lexVec), ct: topOf(r.ctxVec), a: cosine(r.lexVec, r.ctxVec) }))
    .sort((x, y) => x.a - y.a);
  const dot = e => e ? `<span class="dot" style="background:${e.color}"></span> ${e.name}` : '없음';
  $('#vsTable').innerHTML = `<table class="vs"><thead><tr><th>작품</th><th>사전 기반 1위</th><th>문맥 기반 1위</th><th>일치도</th><th></th></tr></thead><tbody>` +
    vs.map(x => `<tr data-go="${x.p.id}" class="${x.p.id === state.id ? 'sel' : ''}"><td>${esc(x.p.title)}</td><td>${dot(x.lt)}</td><td>${dot(x.ct)}</td><td>${Math.round(x.a * 100)}%</td>
      <td><span class="badge ${x.lt && x.lt.k === x.ct.k ? 'ok' : 'no'}">${x.lt && x.lt.k === x.ct.k ? '일치' : '다름'}</span></td></tr>`).join('') + '</tbody></table>';
  const n = vs.filter(x => x.lt && x.lt.k === x.ct.k).length;
  $('#vsTable').insertAdjacentHTML('beforeend', `<p class="sub" style="margin-top:8px">15편 중 ${n}편은 두 기준의 1위가 같고, ${15 - n}편은 다릅니다.</p>`);

  const { comps, points, explained } = pca2(state.results.map(r => r.vec));
  const axisDesc = v => {
    const s = EMOTIONS.map((e, i) => ({ n: e.name, v: v[i] })).sort((a, b) => b.v - a.v);
    return { pos: s.slice(0, 2).map(x => x.n).join('·'), neg: s.slice(-2).reverse().map(x => x.n).join('·') };
  };
  const a1 = axisDesc(comps[0]), a2 = axisDesc(comps[1]);
  $('#pcaNote').innerHTML = `가로축(PC1, 분산의 ${Math.round(explained[0] * 100)}%)은 오른쪽으로 갈수록 <b>${a1.pos}</b>, 왼쪽으로 갈수록 <b>${a1.neg}</b> 쪽입니다. ` +
    `세로축(PC2, ${Math.round(explained[1] * 100)}%)은 위로 갈수록 <b>${a2.pos}</b>, 아래로 갈수록 <b>${a2.neg}</b> 쪽입니다. 점을 누르면 그 시로 이동합니다.`;
  const W = 760, H = 480, pad = 40, padB = 50;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const span = (a) => { const mn = Math.min(...a), mx = Math.max(...a); return [mn, mx === mn ? mn + 1 : mx]; };
  const [x0, x1] = span(xs), [y0, y1] = span(ys);
  const X = x => pad + 20 + (x - x0) / (x1 - x0) * (W - 2 * pad - 180);
  const Y = y => H - padB - (y - y0) / (y1 - y0) * (H - pad - padB - 10);
  const ox = X(0), oy = Y(0);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="15편의 감성 지도">
    <line x1="10" y1="${oy}" x2="${W - 10}" y2="${oy}" stroke="currentColor" stroke-opacity=".2"/>
    <line x1="${ox}" y1="10" x2="${ox}" y2="${H - padB + 10}" stroke="currentColor" stroke-opacity=".2"/>
    <text x="${W - 10}" y="${H - 12}" font-size="12" text-anchor="end" opacity=".75">PC1 → ${a1.pos}</text>
    <text x="10" y="${H - 12}" font-size="12" opacity=".75">${a1.neg} ← PC1</text>
    <text x="10" y="20" font-size="12" opacity=".75">↑ PC2: ${a2.pos} / ↓ ${a2.neg}</text>`;
  // 라벨 겹침을 줄이기 위해 오른쪽·왼쪽·위·아래 중 빈 자리를 고른다.
  const boxes = [];
  const hit = b => boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  const order = state.results.map((r, i) => i).sort((i, j) => points[i][0] - points[j][0]);
  const pts = state.results.map((r, i) => ({ cx: X(points[i][0]), cy: Y(points[i][1]) }));
  pts.forEach(p => boxes.push({ x: p.cx - 9, y: p.cy - 9, w: 18, h: 18 }));
  let labels = '';
  order.forEach(i => {
    const r = state.results[i], p = poemById(r.id), { cx, cy } = pts[i];
    const tw = p.title.length * 13 + 4, th = 16;
    const cands = [[cx + 12, cy - 8, 'start'], [cx - 12 - tw, cy - 8, 'start'], [cx - tw / 2, cy - 28, 'start'], [cx - tw / 2, cy + 12, 'start'],
                   [cx + 12, cy - 24, 'start'], [cx + 12, cy + 8, 'start'], [cx - 12 - tw, cy - 24, 'start'], [cx - 12 - tw, cy + 8, 'start']];
    let pick = cands.find(([x, y]) => !hit({ x, y, w: tw, h: th }) && x >= 0 && x + tw <= W) || cands[0];
    boxes.push({ x: pick[0], y: pick[1], w: tw, h: th });
    labels += `<text x="${pick[0]}" y="${pick[1] + 12}" font-size="13" font-weight="${r.id === state.id ? 700 : 400}" data-go="${p.id}" style="cursor:pointer">${esc(p.title)}</text>`;
  });
  state.results.forEach((r, i) => {
    const p = poemById(r.id), e = emo(r.dominant), sel = r.id === state.id, { cx, cy } = pts[i];
    svg += `<circle data-go="${p.id}" style="cursor:pointer" cx="${cx}" cy="${cy}" r="${sel ? 10 : 7}" fill="${e.color}" stroke="${sel ? 'currentColor' : 'none'}" stroke-width="2"><title>${esc(p.title)} · ${e.name}</title></circle>`;
  });
  svg += labels;
  $('#pcaSvg').innerHTML = svg + '</svg>';
}

/* ---------- 내 시 분석 (F-11) ---------- */
function runMine() {
  const title = $('#mTitle').value.trim() || '내 시';
  const text = $('#mText').value;
  if (!text.trim()) { $('#mMsg').textContent = '본문을 입력해 주세요.'; $('#mResult').hidden = true; return; }
  const r = analyzePoem({ id: 'custom', title, text, profile: null }, 1);
  $('#mResult').hidden = false;
  if (!r.dominant) {
    $('#mMsg').textContent = '사전에 있는 시어가 감지되지 않았습니다. 다른 표현으로 시도해 보세요.';
    $('#mBars').innerHTML = barsHtml(r.vec); $('#mDominant').innerHTML = ''; $('#mRecs').innerHTML = '';
  } else {
    $('#mMsg').textContent = `「${title}」 분석 완료`;
    $('#mBars').innerHTML = barsHtml(r.vec);
    const d = $('#mDominant'); d.style.setProperty('--c', emo(r.dominant).color); d.innerHTML = dominantHtml(r);
    $('#mRecs').innerHTML = recsHtml(recommend(r.vec, state.results, null));
  }
  $('#mLines').innerHTML = linesHtml(r.lines);
}

/* ---------- 분석 방법 ---------- */
const CHECKS = [
  { id: 'nongae', title: '비교 대상과 후렴에 끌려감',
    why: '‘사랑보다도’ 규칙으로 비교 대상 ‘사랑’은 빠졌지만 ‘정열·아리땁·입맞추·꽃다운·그대’가 사랑으로, 후렴의 ‘물결’과 3연의 ‘강물’이 평온으로 세어진다. 문맥상 이 시는 순국의 의지와 분노를 찬양한다.' },
  { id: 'spring-field', title: '표면의 기쁨과 이면의 비애',
    why: '가운데 연의 ‘반갑다·웃네·고맙게·가뿐하다’가 기쁨으로 잡힌다. 그러나 시는 물음으로 시작해 ‘봄조차 빼앗기겠네’라는 탄식으로 끝나며, 그 기쁨은 꿈결 속의 착각이다.' },
  { id: 'azalea', title: '반어를 읽지 못함',
    why: '‘역겨워’(1·4연 반복)와 ‘즈려밟고’가 원망으로 잡힌다. ‘죽어도 아니 눈물 흘리오리다’는 울지 않겠다는 반어로 슬픔을 드러내는데, 사전은 부정과 반어를 구분하지 못한다.' },
  { id: 'cat', title: '중의적 낱말과 범주 배정',
    why: '‘봄’을 희망의 시어로 의지·저항에 넣었는데 이 시에서는 계절 그 자체다. ‘미친 봄의 불길’의 ‘미친’도 생명력의 과장인데 분노로 잡힌다.' },
  { id: 'boat', title: '떠남의 결심과 미련',
    why: '수미의 ‘간다·가련다’가 반복돼 의지가 1위가 된다. 문맥상 띄어 적은 ‘나 두 야’는 머뭇거림이고, 가운데 연은 두고 가는 사람들에 대한 슬픔과 그리움이다.' }
];
function renderMethod() {
  $('#emoDefs').innerHTML = EMOTIONS.map(e => `<div class="emo-def" style="--c:${e.color}"><b>${e.name}</b> <small>(${e.k})</small><p>${e.def}</p></div>`).join('');
  $('#lexTable').innerHTML = EMOTIONS.map(e => `<div class="lex-row" style="--c:${e.color}"><b>${e.name} (${LEXICON[e.k].length})</b><span>${LEXICON[e.k].map(esc).join(', ')}</span></div>`).join('');
  $('#checks').innerHTML = CHECKS.map((c, n) => {
    const p = poemById(c.id), r = resultById(c.id), pc = toPercents(r.lexVec);
    const top = EMOTIONS.map((e, i) => ({ e, v: pc[i] })).sort((a, b) => b.v - a.v).slice(0, 3);
    return `<div class="check"><h4>${n + 1}. 「${esc(p.title)}」 · ${c.title}</h4>
      <p><b>사전 기반:</b> ${top.map(t => `${t.e.name} ${t.v}%`).join(', ')} → <b>문맥 기반 1위:</b> ${topOf(r.ctxVec).name} · 일치도 ${Math.round(cosine(r.lexVec, r.ctxVec) * 100)}%</p>
      <p>${c.why}</p></div>`;
  }).join('');
}

/* ---------- 탭 · 이벤트 ---------- */
function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== 'tab-' + tab);
  renderTab();
  save();
}
function renderTab() {
  ({ read: renderRead, chart: renderCharts, flow: renderFlow, compare: renderCompare, method: renderMethod, mine: () => {} })[state.tab]();
}
function renderAll() {
  recompute();
  renderShelf();
  renderHero();
  renderTab();
  if (!$('#mResult').hidden) runMine();
}
function select(id, scroll = true) {
  state.id = id; save();
  renderShelf(); renderHero(); renderTab();
  if (state.tab === 'mine' || state.tab === 'method') showTab('read');
  if (scroll) $('#hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const label = { auto: '자동', light: '밝게', dark: '어둡게' }[state.theme];
  $('#themeBtn').textContent = '◐ 테마: ' + label;
}

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) select(go.dataset.go);
  const tab = e.target.closest('.tabs button');
  if (tab) showTab(tab.dataset.tab);
  const f = e.target.closest('.fchip');
  if (f) { state.filter = f.dataset.filter; save(); renderShelf(); }
});
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});
$('#themeBtn').addEventListener('click', () => {
  state.theme = { auto: 'dark', dark: 'light', light: 'auto' }[state.theme];
  applyTheme(); save(); renderTab();
});
$('#w').addEventListener('input', e => {
  state.w = e.target.value / 100;
  $('#wOut').textContent = e.target.value + '%';
  renderAll(); save();
});
$('#mRun').addEventListener('click', runMine);

const tip = $('#tip');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip; tip.hidden = false;
});
document.addEventListener('mousemove', e => { if (!tip.hidden) { tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; } });

$('#w').value = Math.round(state.w * 100);
$('#wOut').textContent = Math.round(state.w * 100) + '%';
applyTheme();
recompute();
renderShelf();
renderHero();
showTab(state.tab);
