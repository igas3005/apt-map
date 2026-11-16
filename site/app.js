(function () {
'use strict';
const $ = s => document.querySelector(s);
const cfg = window.APP_CONFIG || {};
const PY = 3.3058;                 // ㎡ -> 평
const SUPPLY = 1.32;               // 전용 -> 공급 면적 대략 비율 (평형 표시용 추정치)
const BANDS = [
  { k: 'all', t: '전체', a: 0, b: 1e9 },
  { k: 's', t: '~60㎡ (소형)', a: 0, b: 60.5 },
  { k: 'm', t: '60~85㎡ (중소형)', a: 60.5, b: 85.5 },
  { k: 'l', t: '85~102㎡ (중대형)', a: 85.5, b: 102.5 },
  { k: 'xl', t: '102㎡~ (대형)', a: 102.5, b: 1e9 },
];
const S = { center: null, rad: 1000, months: 12, band: 'all', metric: 'latest', sort: 'dist',
  list: [], sum: new Map(), sel: null, dtype: null, ov: [], asOf: new Date(), hasData: false, token: 0 };
let C = [], map, circle, centerMarker, geocoder, places;
const TR = new Map();               // 시군구코드 -> {c:{id:[[ymd,area,floor,amt]]}} | null

/* ---------- 유틸 ---------- */
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
function hav(a, b, c, d) { const t = Math.PI / 180, dl = (c - a) * t, dn = (d - b) * t;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dn / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); }
const med = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function eok(m) { if (m >= 10000) { const v = Math.round(m / 1000) / 10; return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + '억'; } return Math.round(m).toLocaleString('ko-KR') + '만'; }
function eokFull(m) { m = Math.round(m); const e = Math.floor(m / 10000), r = m % 10000; return e ? e + '억' + (r ? ' ' + r.toLocaleString('ko-KR') + '만' : '') : r.toLocaleString('ko-KR') + '만'; }
const ds = y => { const s = String(y); return s.slice(2, 4) + '.' + s.slice(4, 6) + '.' + s.slice(6, 8); };
const pyeong = a => Math.round(a * SUPPLY / PY);
const ymdOf = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const cutoff = () => ymdOf(new Date(S.asOf.getFullYear(), S.asOf.getMonth() - S.months, S.asOf.getDate()));
const bandOf = () => BANDS.find(b => b.k === S.band);
async function getJSON(u) { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
function status(msg, err) { const el = $('#status'); el.textContent = msg || ''; el.className = 'status' + (err ? ' err' : ''); }

/* ---------- 데이터 ---------- */
// 실거래는 사이트를 연 브라우저가 국토교통부 API를 직접 조회한다. 인증키는 이 브라우저(localStorage)에만 저장한다.
const API_LIST = [
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
];
let apiIdx = 0, apiLocked = false;
// 2026년 개편으로 신설된 구는 개편 전 거래가 예전 시군구 코드에 남아 있을 수 있어 함께 조회한다.
const LEGACY = { '41591': ['41590'], '41593': ['41590'], '41595': ['41590'], '41597': ['41590'],
  '28125': ['28110', '28140'], '28155': ['28110'], '28275': ['28260'], '28290': ['28260'] };
const LIVE = new Map(), DONE = new Set(), IDX1 = new Map(), IDX2 = new Map();
let KEY = ''; try { KEY = localStorage.getItem('molit_key') || ''; } catch (e) {}
const nn = s => String(s || '').replace(/\(.*?\)/g, '').replace(/[\s·\-_.,/]/g, '').toLowerCase().replace(/아파트/g, '');
const push = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
async function loadComplexes() {
  const d = await getJSON('data/complexes.json');
  C = d.R.map((r, i) => { const p = d.L[r[0]].split('|');
    return { id: i, sido: p[0], gu: p[1], umd: p[2], code: p[3], name: r[1], jibun: r[2], lat: r[3], lon: r[4] }; });
  for (const c of C) { const last = c.umd.split(' ').pop(); c.nn = nn(c.name);
    for (const f of [c.code].concat(LEGACY[c.code] || [])) { push(IDX1, f + '|' + last + '|' + c.jibun, c.id); push(IDX2, f + '|' + last + '|' + c.nn, c.id); } }
  S.asOf = new Date(); S.hasData = !!KEY;
}
function matchRow(f, umd, jibun, name) {
  const n = nn(name); let cand = IDX1.get(f + '|' + umd + '|' + jibun);
  if (cand) { if (cand.length === 1) return cand[0];
    const ex = cand.filter(i => C[i].nn === n); if (ex.length) return ex[0];
    const pt = n ? cand.filter(i => C[i].nn && (C[i].nn.includes(n) || n.includes(C[i].nn))) : [];
    return pt.length === 1 ? pt[0] : null; }
  cand = IDX2.get(f + '|' + umd + '|' + n); return cand && cand.length === 1 ? cand[0] : null;
}
function monthList(n) { const out = []; for (let k = 0; k <= n; k++) { const d = new Date(S.asOf.getFullYear(), S.asOf.getMonth() - k, 1); out.push(String(d.getFullYear() * 100 + d.getMonth() + 1)); } return out; }
async function fetchPage(idx, f, ym, page) {
  let key = KEY; try { key = decodeURIComponent(KEY); } catch (e) {}
  const u = API_LIST[idx] + '?' + new URLSearchParams({ serviceKey: key, LAWD_CD: f, DEAL_YMD: ym, pageNo: page, numOfRows: 1000 });
  let r; try { r = await fetch(u); } catch (e) { throw { kind: 'net' }; }
  if (r.status === 401 || r.status === 403) throw { kind: 'key', msg: 'HTTP ' + r.status };
  if (!r.ok) throw { kind: 'api', msg: 'HTTP ' + r.status };
  const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
  const g = t => { const e = doc.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
  if (doc.documentElement.nodeName.indexOf('OpenAPI') === 0 || g('returnAuthMsg')) throw { kind: 'key', msg: g('returnAuthMsg') || g('errMsg') };
  const rc = g('resultCode'); if (rc && rc !== '00' && rc !== '000') throw { kind: 'api', msg: rc + ' ' + g('resultMsg') };
  return { total: +g('totalCount') || 0, items: [...doc.getElementsByTagName('item')] };
}
async function fetchMonth(f, ym) {
  let page = 1; const got = [];
  for (;;) {
    const used = apiIdx; let res;
    try { res = await fetchPage(used, f, ym, page); }
    catch (e) { if (e.kind === 'key' && !apiLocked) { if (used === apiIdx && apiIdx + 1 < API_LIST.length) { apiIdx++; continue; } if (used !== apiIdx) continue; } throw e; }
    apiLocked = true;
    for (const it of res.items) { const v = t => { const e = it.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
      if (v('cdealType').toUpperCase() === 'O' || v('cdealDay')) continue;
      const amt = parseInt(v('dealAmount').replace(/,/g, ''), 10), area = Math.round(parseFloat(v('excluUseAr')) * 100) / 100;
      const ymd = (+v('dealYear')) * 10000 + (+v('dealMonth')) * 100 + (+v('dealDay'));
      if (!amt || !area || !ymd) continue;
      const id = matchRow(f, v('umdNm'), v('jibun'), v('aptNm')); if (id == null) continue;
      got.push([id, [ymd, area, parseInt(v('floor'), 10) || 0, amt]]); }
    if (page * 1000 >= res.total || !res.items.length) break; page++;
  }
  for (const [id, t] of got) push(LIVE, id, t);
  DONE.add(f + '|' + ym);
}
async function ensureTrades(codes) {
  S.liveErr = null; if (!KEY) return;
  const seen = new Set(), jobs = [], ms = monthList(S.months);
  for (const c of codes) for (const f of [c].concat(LEGACY[c] || [])) for (const ym of ms) { const k = f + '|' + ym; if (!DONE.has(k) && !seen.has(k)) { seen.add(k); jobs.push([f, ym]); } }
  let k = 0, done = 0; const tot = jobs.length;
  const worker = async () => { while (k < jobs.length && !S.liveErr) { const j = jobs[k++];
    try { await fetchMonth(j[0], j[1]); } catch (e) { S.liveErr = e; } done++; if (!S.liveErr) status(`실거래 조회 중… ${done}/${tot}`); } };
  await Promise.all(Array.from({ length: 6 }, worker));
}
function liveErrText(e) {
  if (e.kind === 'net') return '브라우저에서 국토부 API에 접속하지 못했어요. 브라우저 보안 정책(CORS)이나 사내 네트워크 차단일 수 있어요. 이 문구를 그대로 알려 주세요.';
  if (e.kind === 'key') return '인증키 오류예요 (' + (e.msg || '') + '). 키가 맞는지, 공공데이터포털에서 아파트 매매 실거래가 활용신청이 승인됐는지 확인하세요.';
  return '실거래 조회 오류: ' + (e.msg || '알 수 없음');
}
const tradesOf = id => LIVE.get(id) || [];
function dominant(arr) {            // 거래가 가장 많은 전용면적 타입
  const g = new Map(); for (const t of arr) { const k = Math.round(t[1]); (g.get(k) || g.set(k, []).get(k)).push(t); }
  let best = null;
  for (const [k, v] of g) { const mx = Math.max(...v.map(t => t[0]));
    if (!best || v.length > best.v.length || (v.length === best.v.length && mx > best.mx)) best = { k, v, mx }; }
  return best;
}
function summarize(id) {
  const cut = cutoff(), b = bandOf();
  const arr = tradesOf(id).filter(t => t[0] >= cut && t[1] >= b.a && t[1] < b.b);
  if (!arr.length) return null;
  const best = dominant(arr), latest = best.v.reduce((x, y) => (y[0] > x[0] ? y : x));
  const m = med(best.v.map(t => t[3]));
  return { n: arr.length, type: best.k, py: pyeong(best.k), cnt: best.v.length, latest, med: m, val: S.metric === 'latest' ? latest[3] : m };
}

/* ---------- 주변 단지 ---------- */
function nearby(lat, lon, rad) {
  const dl = rad / 111320 * 1.05, dn = dl / Math.cos(lat * Math.PI / 180), out = [];
  for (const c of C) { if (Math.abs(c.lat - lat) > dl || Math.abs(c.lon - lon) > dn) continue;
    const d = hav(lat, lon, c.lat, c.lon); if (d <= rad) out.push({ id: c.id, d }); }
  return out.sort((a, b) => a.d - b.d);
}
async function refresh(fit) {
  if (!S.center) return;
  const tok = ++S.token;
  S.list = nearby(S.center.lat, S.center.lon, S.rad);
  renderList();
  if (S.hasData) {
    status('실거래 조회 중…');
    await ensureTrades(new Set(S.list.map(i => C[i.id].code)));
    if (tok !== S.token) return;
    if (S.liveErr) status(liveErrText(S.liveErr), true); else status('');
  } else status('아래에 국토부 인증키를 입력하면 시세가 표시돼요.');
  recompute();
  if (fit && circle) map.setBounds(circle.getBounds());
}
function recompute() {
  S.sum = new Map(S.list.map(i => [i.id, summarize(i.id)]));
  const key = i => { const s = S.sum.get(i.id); return s ? s : null; };
  if (S.sort === 'price') S.list.sort((a, b) => ((key(b) || { val: -1 }).val) - ((key(a) || { val: -1 }).val));
  else if (S.sort === 'cnt') S.list.sort((a, b) => ((key(b) || { n: -1 }).n) - ((key(a) || { n: -1 }).n));
  else S.list.sort((a, b) => a.d - b.d);
  renderList(); renderPins(); if (S.sel != null) renderDetail();
}

/* ---------- 지도 ---------- */
function setCenter(lat, lon, label, o) {
  o = o || {};
  S.center = { lat, lon, label }; S.sel = null; $('#detail').hidden = true; $('#maphint').style.display = 'none';
  const ll = new kakao.maps.LatLng(lat, lon);
  if (!centerMarker) centerMarker = new kakao.maps.Marker({ position: ll, map }); else { centerMarker.setPosition(ll); centerMarker.setMap(map); }
  if (!circle) circle = new kakao.maps.Circle({ center: ll, radius: S.rad, strokeWeight: 2, strokeColor: '#4655d6', strokeOpacity: .85,
    strokeStyle: 'dashed', fillColor: '#4655d6', fillOpacity: .06, map });
  else { circle.setPosition(ll); circle.setRadius(S.rad); circle.setMap(map); }
  map.setCenter(ll);
  refresh(!o.keepView);
}
function renderPins() {
  S.ov.forEach(o => o.setMap(null)); S.ov = [];
  if (!map) return;
  const lvl = map.getLevel(), items = S.list.slice(0, 300), dots = lvl >= 6 && items.length > 120;
  for (const it of items) {
    const c = C[it.id], s = S.sum.get(it.id), sel = S.sel === it.id, el = document.createElement('div');
    if (dots) el.className = 'dot' + (s ? '' : ' none') + (sel ? ' sel' : '');
    else {
      el.className = 'pin' + (s ? '' : ' none') + (sel ? ' sel' : '');
      el.innerHTML = (s ? `<small>${s.py}평</small><b>${eok(s.val)}</b>` : '<small>거래없음</small><b>-</b>') + (lvl <= 4 || sel ? `<i class="nm">${esc(c.name)}</i>` : '');
    }
    el.title = c.name;
    el.addEventListener('click', e => { e.stopPropagation(); select(it.id, false); });
    const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(c.lat, c.lon), content: el,
      xAnchor: dots ? .5 : .12, yAnchor: dots ? .5 : 1, zIndex: sel ? 20 : 1, clickable: true });
    ov.setMap(map); S.ov.push(ov);
  }
}

/* ---------- 목록 / 상세 ---------- */
function renderList() {
  const el = $('#list');
  if (!S.center) { el.innerHTML = '<div class="empty">주소를 검색하거나 지도를 클릭하면<br>반경 안의 단지와 시세가 여기에 나와요.</div>'; return; }
  const n = S.list.length;
  let h = `<div class="lh"><b>${esc(S.center.label || '선택한 위치')}</b> 반경 ${S.rad >= 1000 ? S.rad / 1000 + 'km' : S.rad + 'm'} · 단지 ${n.toLocaleString('ko-KR')}개${n > 300 ? ' (가까운 300개 표시)' : ''}</div>`;
  if (!n) h += '<div class="empty">이 반경에 등록된 단지가 없어요.<br>반경을 넓혀 보세요.</div>';
  h += S.list.slice(0, 300).map(it => { const c = C[it.id], s = S.sum.get(it.id);
    const px = s ? `<div class="px"><b>${eok(s.val)}</b><small>${s.py}평 · ${s.cnt}건</small></div>` : (S.hasData ? '<div class="px"><small>거래 없음</small></div>' : '');
    return `<div class="item${S.sel === it.id ? ' sel' : ''}" data-id="${it.id}"><div class="n"><div class="nm">${esc(c.name)}</div><div class="ad">${esc(c.umd)} ${esc(c.jibun)} · ${it.d < 1000 ? Math.round(it.d) + 'm' : (it.d / 1000).toFixed(2) + 'km'}</div></div>${px}</div>`; }).join('');
  el.innerHTML = h;
}
function select(id, pan) {
  S.sel = id; S.dtype = null; renderDetail(); renderPins(); renderList();
  if (pan) map.panTo(new kakao.maps.LatLng(C[id].lat, C[id].lon));
  const it = document.querySelector(`.item[data-id="${id}"]`); if (it) it.scrollIntoView({ block: 'nearest' });
}
function chart(arr) {
  const W = 360, H = 130, pl = 36, pb = 18, pt = 6, pr = 4, ms = [];
  for (let k = S.months - 1; k >= 0; k--) { const d = new Date(S.asOf.getFullYear(), S.asOf.getMonth() - k, 1); ms.push(d.getFullYear() * 100 + d.getMonth() + 1); }
  const vals = ms.map(m => { const v = arr.filter(t => Math.floor(t[0] / 100) === m).map(t => t[3]); return v.length ? { m, v: med(v), n: v.length } : { m, v: null, n: 0 }; });
  const all = vals.filter(x => x.v != null).map(x => x.v); if (!all.length) return '';
  const mx = Math.max(...all) * 1.08, bw = (W - pl - pr) / ms.length, ih = H - pt - pb;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="월별 중위 거래가">`;
  for (let k = 0; k <= 3; k++) { const y = pt + ih - ih * k / 3;
    s += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl - 4}" y="${y + 3.5}" font-size="10" text-anchor="end" fill="var(--mute)">${(mx * k / 3 / 10000).toFixed(mx >= 100000 ? 0 : 1)}억</text>`; }
  vals.forEach((o, k) => { const x = pl + k * bw + bw * .15, w = bw * .7, last = k >= vals.length - 2;
    if (o.v != null) { const h = ih * o.v / mx;
      s += `<rect x="${x}" y="${pt + ih - h}" width="${w}" height="${h}" rx="2" fill="var(--accent)" ${last ? 'opacity=".4"' : ''}><title>${String(o.m).slice(2, 4)}.${String(o.m).slice(4)} 중위 ${eokFull(o.v)} (${o.n}건)</title></rect>`; }
    if (k % (ms.length > 8 ? 2 : 1) === 0) s += `<text x="${x + w / 2}" y="${H - 5}" font-size="10" text-anchor="middle" fill="var(--mute)">${String(o.m).slice(2, 4)}.${String(o.m).slice(4)}</text>`; });
  return s + '</svg>';
}
function renderDetail() {
  const el = $('#detail'), c = C[S.sel]; if (!c) { el.hidden = true; return; }
  el.hidden = false;
  const cut = cutoff(), all = tradesOf(S.sel).filter(t => t[0] >= cut);
  const types = new Map(); for (const t of all) { const k = Math.round(t[1]); types.set(k, (types.get(k) || 0) + 1); }
  const dom = dominant(all.filter(t => t[1] >= bandOf().a && t[1] < bandOf().b)) || dominant(all);
  if (S.dtype == null) S.dtype = dom ? dom.k : 'all';
  const arr = S.dtype === 'all' ? all : all.filter(t => Math.round(t[1]) === S.dtype);
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(c.name)}</h2><div class="ad">${esc(c.sido)} ${esc(c.gu)} ${esc(c.umd)} ${esc(c.jibun)}</div>`;
  if (!S.hasData) h += '<div class="note">국토부 인증키를 입력하면 시세가 표시돼요.</div>';
  else if (!all.length) h += `<div class="note">최근 ${S.months}개월 거래가 없어요. 기간을 늘리거나, 실거래 신고 단지명이 달라 매칭되지 않았을 수 있어요.</div>`;
  else {
    h += '<div class="chips">' + [...types.keys()].sort((a, b) => a - b).map(k => `<button data-t="${k}" class="${S.dtype === k ? 'on' : ''}">${k}㎡ (${pyeong(k)}평) ${types.get(k)}</button>`).join('') +
      `<button data-t="all" class="${S.dtype === 'all' ? 'on' : ''}">전체 ${all.length}</button></div>`;
    const am = arr.map(t => t[3]);
    h += `<div class="kv"><div><small>거래 ${arr.length}건 중위</small><b>${eokFull(med(am))}</b></div><div><small>최고</small><b>${eokFull(Math.max(...am))}</b></div><div><small>최저</small><b>${eokFull(Math.min(...am))}</b></div></div>`;
    const ch = chart(arr); if (ch) h += `<div class="sec">월별 중위 거래가</div>${ch}`;
    h += `<div class="sec">최근 거래</div><table><tr><th>계약일</th><th>전용</th><th>층</th><th>거래가</th></tr>` +
      arr.slice().sort((a, b) => b[0] - a[0]).slice(0, 15).map(t => `<tr><td>${ds(t[0])}</td><td>${t[1]}㎡ (${pyeong(t[1])}평)</td><td>${t[2]}</td><td><b>${eokFull(t[3])}</b></td></tr>`).join('') + '</table>' +
      '<div class="note">연한 막대는 신고 기한(계약 후 30일) 때문에 아직 집계 중일 수 있는 최근 두 달이에요. 평형은 전용면적 기준 추정치(공급면적 ≈ 전용 × 1.32)입니다.</div>';
  }
  el.innerHTML = h;
  $('#dx').onclick = () => { S.sel = null; el.hidden = true; renderPins(); renderList(); };
  el.querySelectorAll('.chips button').forEach(b => b.onclick = () => { S.dtype = b.dataset.t === 'all' ? 'all' : +b.dataset.t; renderDetail(); });
}

/* ---------- 검색 ---------- */
let sugItems = [], sugOn = -1, deb = 0;
function search(q, cb) {
  const m = q.match(/^(-?\d{2}\.\d+)\s*[, ]\s*(-?\d{2,3}\.\d+)$/);
  if (m) return cb([{ label: `좌표 ${m[1]}, ${m[2]}`, sub: '입력한 좌표', lat: +m[1], lon: +m[2] }]);
  const out = []; let pending = 2; const OK = kakao.maps.services.Status.OK;
  const done = () => { if (--pending === 0) cb(out); };
  geocoder.addressSearch(q, (r, st) => { if (st === OK) r.slice(0, 5).forEach(x => out.push({
    label: x.address_name + (x.road_address && x.road_address.address_name ? ` (${x.road_address.address_name})` : ''), sub: '주소', lat: +x.y, lon: +x.x })); done(); });
  places.keywordSearch(q, (r, st) => { if (st === OK) r.slice(0, 5).forEach(x => out.push({ label: x.place_name, sub: x.address_name, lat: +x.y, lon: +x.x })); done(); });
}
function showSug(items) {
  sugItems = items; sugOn = -1; const sg = $('#sug');
  if (!items.length) { sg.innerHTML = '<div style="cursor:default">검색 결과가 없어요. 주소를 더 자세히 쓰거나 지도를 클릭해 보세요.</div>'; sg.style.display = 'block'; return; }
  sg.innerHTML = items.map((s, k) => `<div data-k="${k}">${esc(s.label)}<small>${esc(s.sub)}</small></div>`).join(''); sg.style.display = 'block';
}
function choose(k) { const s = sugItems[k]; if (!s) return; $('#sug').style.display = 'none'; $('#q').value = s.label; setCenter(s.lat, s.lon, s.label); }
function doSearch(pick) { const q = $('#q').value.trim(); if (!q) return; search(q, items => { showSug(items); if (pick && items.length) choose(0); }); }

/* ---------- 초기화 ---------- */
function bind() {
  $('#band').innerHTML = BANDS.map(b => `<option value="${b.k}">${b.t}</option>`).join('');
  $('#rad').onchange = () => { S.rad = +$('#rad').value; if (circle) circle.setRadius(S.rad); refresh(true); };
  $('#mon').onchange = () => { S.months = +$('#mon').value; if (S.center) refresh(false); };
  $('#band').onchange = () => { S.band = $('#band').value; S.dtype = null; recompute(); };
  $('#metric').onchange = () => { S.metric = $('#metric').value; recompute(); };
  $('#sort').onchange = () => { S.sort = $('#sort').value; recompute(); };
  $('#go').onclick = () => doSearch(true);
  $('#q').addEventListener('input', () => { clearTimeout(deb); const q = $('#q').value.trim(); if (q.length < 2) { $('#sug').style.display = 'none'; return; } deb = setTimeout(() => doSearch(false), 300); });
  $('#q').addEventListener('keydown', e => { const n = sugItems.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); sugOn = Math.min(n - 1, sugOn + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sugOn = Math.max(0, sugOn - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sugOn >= 0 && n) choose(sugOn); else doSearch(true); return; }
    else if (e.key === 'Escape') { $('#sug').style.display = 'none'; return; } else return;
    [...$('#sug').children].forEach((d, k) => d.classList.toggle('on', k === sugOn)); });
  $('#sug').addEventListener('mousedown', e => { const d = e.target.closest('[data-k]'); if (d) { e.preventDefault(); choose(+d.dataset.k); } });
  $('#q').addEventListener('blur', () => setTimeout(() => { $('#sug').style.display = 'none'; }, 150));
  $('#list').addEventListener('click', e => { const d = e.target.closest('.item'); if (d) select(+d.dataset.id, true); });
}
function loadKakao() {
  return new Promise((res, rej) => {
    const url = cfg.SDK_URL || `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(cfg.KAKAO_JS_KEY)}&libraries=services&autoload=false`;
    const s = document.createElement('script'); s.src = url;
    s.onload = () => kakao.maps.load(res); s.onerror = () => rej(new Error('카카오 지도 스크립트를 불러오지 못했어요.')); document.head.appendChild(s);
  });
}
function renderKey() {
  let el = $('#keybox'); if (!el) { el = document.createElement('div'); el.id = 'keybox'; el.className = 'keybox'; $('.ctrl').after(el); }
  if (KEY) { el.innerHTML = '<span>국토부 인증키 저장됨 (이 브라우저에만)</span> <button id="kchg">변경</button>'; $('#kchg').onclick = () => { KEY = ''; S.hasData = false; renderKey(); }; return; }
  el.innerHTML = '<input id="kin" type="password" autocomplete="off" placeholder="국토부 실거래가 인증키 붙여넣기"><button id="ksave" class="pri">저장</button><small>키는 이 브라우저에만 저장되고 사이트나 저장소에는 올라가지 않아요.</small>';
  $('#ksave').onclick = () => { const v = $('#kin').value.trim(); if (!v) return; KEY = v; try { localStorage.setItem('molit_key', v); } catch (e) {}
    S.hasData = true; apiIdx = 0; apiLocked = false; renderKey(); if (S.center) refresh(false); else status('주소를 검색하면 시세가 표시돼요.'); };
}
async function init() {
  bind(); renderKey(); renderList();
  try { await loadComplexes(); } catch (e) { status('단지 데이터를 불러오지 못했어요: ' + e.message, true); return; }
  if (!cfg.KAKAO_JS_KEY && !cfg.SDK_URL) { status('카카오 JavaScript 키가 설정되지 않았어요. (저장소 Settings > Variables 에 KAKAO_JS_KEY 등록 후 다시 배포)', true); return; }
  try { await loadKakao(); } catch (e) { status(e.message + ' 카카오 개발자 콘솔에 이 사이트 주소가 등록돼 있는지 확인하세요.', true); return; }
  map = new kakao.maps.Map($('#map'), { center: new kakao.maps.LatLng(37.5665, 126.978), level: 8 });
  map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  map.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT);
  geocoder = new kakao.maps.services.Geocoder(); places = new kakao.maps.services.Places();
  kakao.maps.event.addListener(map, 'zoom_changed', () => renderPins());
  kakao.maps.event.addListener(map, 'click', ev => { const ll = ev.latLng, lat = ll.getLat(), lon = ll.getLng();
    setCenter(lat, lon, '지도에서 선택한 위치', { keepView: true });
    geocoder.coord2Address(lon, lat, (r, st) => { if (st === kakao.maps.services.Status.OK && r[0]) {
      const a = (r[0].address && r[0].address.address_name) || ''; if (a && S.center && S.center.lat === lat) { S.center.label = a; renderList(); } } }); });
  if (!S.hasData) status('아래에 국토부 인증키를 입력하면 시세가 표시돼요.');
}
init();
})();
