(function () {
'use strict';
const $ = s => document.querySelector(s);
// 공공데이터포털은 짧은 시간에 요청이 몰리면 HTTP 429로 거절한다. 동시에 3건, 최소 간격을 두고 보내며 429면 기다렸다 다시 보낸다.
const _fetch = window.fetch.bind(window), _q = []; let _active = 0, _last = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function _pump() { while (_active < 3 && _q.length) { const now = Date.now(), wait = Math.max(0, _last + 150 - now); _last = now + wait; _active++; setTimeout(_q.shift(), wait); } }
function fetch(u, opt) {
  if (!/data\.go\.kr|odcloud\.kr/.test(String(u))) return _fetch(u, opt);
  return new Promise((res, rej) => { _q.push(async () => {
    try { let r; for (let a = 0; a < 5; a++) { r = await _fetch(u, opt); if (r.status !== 429) break; if (a < 4) await sleep(900 * (a + 1) * (a + 1)); } res(r); }
    catch (e) { rej(e); } finally { _active--; _pump(); } }); _pump(); });
}
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
const S = { tab: 'trade', center: null, rad: 1000, months: 12, band: 'all', metric: 'latest', sort: 'dist',
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
    const names = [...new Set([last, c.umd, c.umd.split(' ')[0]])];
    for (const f of [c.code].concat(LEGACY[c.code] || [])) for (const u of names) { push(IDX1, f + '|' + u + '|' + c.jibun, c.id); push(IDX2, f + '|' + u + '|' + c.nn, c.id); } }
  S.asOf = new Date(); S.hasData = !!KEY;
}
function matchRow(f, umd, jibun, name) {
  const n = nn(name), u2 = String(umd).split(' ').pop(); let cand = IDX1.get(f + '|' + umd + '|' + jibun) || IDX1.get(f + '|' + u2 + '|' + jibun);
  if (cand) { if (cand.length === 1) return cand[0];
    const ex = cand.filter(i => C[i].nn === n); if (ex.length) return ex[0];
    const pt = n ? cand.filter(i => C[i].nn && (C[i].nn.includes(n) || n.includes(C[i].nn))) : [];
    return pt.length === 1 ? pt[0] : null; }
  cand = IDX2.get(f + '|' + umd + '|' + n) || IDX2.get(f + '|' + u2 + '|' + n); return cand && cand.length === 1 ? cand[0] : null;
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
      const by = +v('buildYear'); if (by) BY.set(id, by);
      got.push([id, [ymd, area, parseInt(v('floor'), 10) || 0, amt]]); }
    if (page * 1000 >= res.total || !res.items.length) break; page++;
  }
  for (const [id, t] of got) push(LIVE, id, t);
  DONE.add(f + '|' + ym);
}
async function ensureTrades(codes, months) {
  S.liveErr = null; if (!KEY) return;
  const seen = new Set(), jobs = [], ms = monthList(months || S.months);
  for (const c of codes) for (const f of [c].concat(LEGACY[c] || [])) for (const ym of ms) { const k = f + '|' + ym; if (!DONE.has(k) && !seen.has(k)) { seen.add(k); jobs.push([f, ym]); } }
  let k = 0, done = 0; const tot = jobs.length;
  const worker = async () => { while (k < jobs.length && !S.liveErr) { const j = jobs[k++];
    try { await fetchMonth(j[0], j[1]); } catch (e) { S.liveErr = e; } done++; if (!S.liveErr) status(`실거래 조회 중… ${done}/${tot}`); } };
  await Promise.all(Array.from({ length: 3 }, worker));
}
function liveErrText(e) {
  if (e.kind === 'net') return '브라우저에서 국토부 API에 접속하지 못했어요. 브라우저 보안 정책(CORS)이나 사내 네트워크 차단일 수 있어요. 이 문구를 그대로 알려 주세요.';
  if (e.kind === 'key') return '인증키 오류예요 (' + (e.msg || '') + '). 키가 맞는지, 공공데이터포털에서 아파트 매매 실거래가 활용신청이 승인됐는지 확인하세요.';
  if (/429/.test(e.msg || '')) return '국토부 API가 요청이 너무 많다며 거절했어요 (HTTP 429). 잠시 뒤 다시 검색해 보세요. 계속되면 오늘 호출 한도를 넘은 것일 수 있어요.';
  return '실거래 조회 오류: ' + (e.msg || '알 수 없음');
}
const tradesOf = id => LIVE.get(id) || [];

/* ---------- 건축물대장 표제부: 세대수·사용승인연도·층수 ---------- */
// 단지 지번으로 조회하고, 결과는 바뀌지 않는 값이라 이 브라우저에 저장해 다시 조회하지 않는다.
const BLD_API = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
let BLD = {}; try { BLD = JSON.parse(localStorage.getItem('bld_v4') || '{}') || {}; } catch (e) {}
const BY = new Map(); let bldSaveT = 0, bldErr = null;
const bkey = c => c.code + '|' + c.umd + '|' + c.jibun;
function bldSave() { clearTimeout(bldSaveT); bldSaveT = setTimeout(() => { try { localStorage.setItem('bld_v4', JSON.stringify(BLD)); } catch (e) {} }, 800); }
function regionCode(c) { return new Promise(res => geocoder.coord2RegionCode(c.lon, c.lat, (r, st) => {
  if (st !== kakao.maps.services.Status.OK) return res(null); const b = r.find(x => x.region_type === 'B'); res(b && b.code ? String(b.code) : null); })); }
// --- K-apt(공동주택관리정보시스템): 단지 단위 세대수·동수·최고층·지하층. 있으면 이쪽을 우선한다. ---
// 서비스 버전이 계정·시기에 따라 달라 후보를 차례로 시도하고, 성공한 주소를 기억한다.
const KAPT_LIST = { urls: ['AptListService3/getLegaldongAptList3', 'AptListService4/getLegaldongAptList4', 'AptListService2/getLegaldongAptList'] };
const KAPT_BASE = { urls: ['AptBasisInfoServiceV4/getAphusBassInfoV4', 'AptBasisInfoServiceV5/getAphusBassInfoV5', 'AptBasisInfoServiceV3/getAphusBassInfoV3'] };
const KLIST = new Map(); let kaptErr = null;
function parseAny(text) {            // JSON·XML 어느 쪽으로 와도 [{필드:값}] 로 바꾼다
  const t = text.trim();
  if (t[0] === '{') { const j = JSON.parse(t), r = j.response || j, h = r.header || {}, b = r.body || {};
    if (h.resultCode && h.resultCode !== '00' && h.resultCode !== '000') throw { kind: 'api', msg: h.resultCode + ' ' + (h.resultMsg || '') };
    let it = (b.items && b.items.item !== undefined) ? b.items.item : (b.items !== undefined ? b.items : b.item);
    if (!it) it = []; if (!Array.isArray(it)) it = [it];
    return { items: it.filter(x => x && typeof x === 'object'), total: +b.totalCount || it.length }; }
  const doc = new DOMParser().parseFromString(t, 'text/xml');
  const g = n => { const e = doc.getElementsByTagName(n)[0]; return e ? e.textContent.trim() : ''; };
  if (doc.getElementsByTagName('parsererror').length) throw { kind: 'api', msg: t.slice(0, 80) };
  if (doc.documentElement.nodeName.indexOf('OpenAPI') === 0 || g('returnAuthMsg')) throw { kind: 'key', msg: g('returnAuthMsg') || g('errMsg') };
  const rc = g('resultCode'); if (rc && rc !== '00' && rc !== '000') throw { kind: 'api', msg: rc + ' ' + g('resultMsg') };
  const items = [...doc.getElementsByTagName('item')].map(it => { const o = {}; for (const ch of it.children) o[ch.nodeName] = ch.textContent.trim(); return o; });
  return { items, total: +g('totalCount') || items.length };
}
async function callAny(group, params) {
  let key = KEY; try { key = decodeURIComponent(KEY); } catch (e) {}
  const order = group.ok != null ? [group.ok] : group.urls.map((_, i) => i); let last;
  for (const i of order) {
    try {
      let r; try { r = await fetch('https://apis.data.go.kr/1613000/' + group.urls[i] + '?' + new URLSearchParams(Object.assign({ ServiceKey: key }, params))); } catch (e) { throw { kind: 'net' }; }
      if (r.status === 401 || r.status === 403) throw { kind: 'key', msg: 'HTTP ' + r.status };
      if (!r.ok) throw { kind: 'api', msg: 'HTTP ' + r.status };
      const out = parseAny(await r.text()); group.ok = i; return out;
    } catch (e) { last = e; last.url = group.urls[i]; }
  }
  throw last;
}
function kaptList(bjd) {
  if (!KLIST.has(bjd)) KLIST.set(bjd, (async () => { const all = [];
    for (let page = 1; page <= 5; page++) { const r = await callAny(KAPT_LIST, { bjdCode: bjd, pageNo: page, numOfRows: 200 });
      all.push(...r.items); if (page * 200 >= r.total || !r.items.length) break; }
    return all.map(x => ({ code: x.kaptCode, n: nn(x.kaptName) })).filter(x => x.code); })());
  return KLIST.get(bjd);
}
async function fetchKapt(c, rc) {
  let list; try { list = await kaptList(rc); } catch (e) { KLIST.delete(rc); throw e; }
  let cand = list.filter(x => x.n === c.nn);
  if (!cand.length && c.nn) cand = list.filter(x => x.n && (x.n.includes(c.nn) || c.nn.includes(x.n)));
  if (cand.length !== 1) return null;
  const r = await callAny(KAPT_BASE, { kaptCode: cand[0].code }), o = r.items[0]; if (!o) return null;
  const hh = parseInt(o.kaptdaCnt, 10) || 0; if (!hh) return null;
  const ma = parseFloat(o.kaptMarea), pa = parseFloat(o.privArea), ratio = (ma > 0 && pa > 0 && ma / pa >= 1.15 && ma / pa <= 1.6) ? Math.round(ma / pa * 1000) / 1000 : 0;
  return [hh, +(String(o.kaptUsedate || '').slice(0, 4)) || 0, parseInt(o.kaptTopFloor, 10) || 0, parseInt(o.kaptBaseFloor, 10) || 0, parseInt(o.kaptDongCnt, 10) || 0, 'K', ratio];
}
async function fetchBld(c) {
  const rc = await regionCode(c); if (!rc || rc.length < 10) return 0;
  if (!kaptErr) { try { const k = await fetchKapt(c, rc); if (k) return k; } catch (e) { kaptErr = e; } }
  return fetchLedger(c, rc);
}
async function fetchLedger(c, rc) {
  const m = c.jibun.match(/^(산)?(\d+)(?:-(\d+))?$/); if (!m) return 0;
  let key = KEY; try { key = decodeURIComponent(KEY); } catch (e) {}
  const rows = [];
  for (let page = 1; page <= 4; page++) {
    const u = BLD_API + '?' + new URLSearchParams({ serviceKey: key, sigunguCd: rc.slice(0, 5), bjdongCd: rc.slice(5, 10), platGbCd: m[1] ? '1' : '0',
      bun: m[2].padStart(4, '0'), ji: (m[3] || '0').padStart(4, '0'), numOfRows: 100, pageNo: page });
    let r; try { r = await fetch(u); } catch (e) { throw { kind: 'net' }; }
    if (r.status === 401 || r.status === 403) throw { kind: 'key', msg: 'HTTP ' + r.status };
    if (!r.ok) throw { kind: 'api', msg: 'HTTP ' + r.status };
    const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
    const g = t => { const e = doc.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
    if (doc.documentElement.nodeName.indexOf('OpenAPI') === 0 || g('returnAuthMsg')) throw { kind: 'key', msg: g('returnAuthMsg') || g('errMsg') };
    const rcode = g('resultCode'); if (rcode && rcode !== '00' && rcode !== '000') throw { kind: 'api', msg: rcode + ' ' + g('resultMsg') };
    const items = [...doc.getElementsByTagName('item')];
    for (const it of items) { const v = t => { const e = it.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
      rows.push({ main: v('mainAtchGbCd') !== '1', hh: +v('hhldCnt') || 0, up: +v('grndFlrCnt') || 0, dn: +v('ugrndFlrCnt') || 0, y: +(v('useAprDay').slice(0, 4)) || 0 }); }
    if (page * 100 >= (+g('totalCount') || 0) || !items.length) break;
  }
  let use = rows.filter(x => x.main && x.hh > 0); if (!use.length) use = rows.filter(x => x.main); if (!use.length) return 0;
  const ys = use.map(x => x.y).filter(y => y > 1900);
  return [use.reduce((a, x) => a + x.hh, 0), ys.length ? Math.min(...ys) : 0, Math.max(...use.map(x => x.up)), Math.max(...rows.map(x => x.dn)), use.filter(x => x.hh > 0).length];  // 지하층은 지하주차장 등 세대 없는 동·부속건축물까지 포함해 최댓값
}
async function loadBld(tok) {
  if (!KEY || bldErr || !geocoder) return;
  const todo = S.list.slice(0, 80).map(i => C[i.id]).filter(c => BLD[bkey(c)] === undefined);
  if (!todo.length) return;
  let k = 0, last = 0;
  const worker = async () => { while (k < todo.length && tok === S.token && !bldErr) { const c = todo[k++];
    try { BLD[bkey(c)] = await fetchBld(c); bldSave(); } catch (e) { if (e.kind === 'key' || e.kind === 'net') bldErr = e; }
    if (tok === S.token && Date.now() - last > 500) { last = Date.now(); renderList(); } } };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (tok !== S.token) return;
  renderList(); if (S.sel != null) renderDetail();
  if (bldErr && !S.liveErr) status(bldErr.kind === 'key'
    ? '세대수·층수(건축물대장) 조회가 거절됐어요 (' + (bldErr.msg || '') + '). 활용신청 승인이 아직 반영되지 않았을 수 있어요. 잠시 뒤 새로고침해 보세요.'
    : '세대수·층수(건축물대장) API에 접속하지 못했어요. 이 문구를 그대로 알려 주세요.', true);
}
function infoLine(c) {
  const b = BLD[bkey(c)], parts = [], y = (b && b[1]) || BY.get(c.id);
  if (b && b[0]) parts.push(b[0].toLocaleString('ko-KR') + '세대' + (b[4] > 1 ? `(${b[4]}개동)` : ''));
  const src = b ? (b[5] === 'K' ? '' : ' <span class="src" title="K-apt에 없어 건축물대장 기준으로 표시. 지하층·세대수가 일부만 잡힐 수 있어요.">대장</span>') : '';
  if (y) parts.push(y + '년');
  if (b && b[2]) parts.push((b[3] ? `지하${b[3]}/` : '') + `지상${b[2]}층`);
  return parts.length ? parts.join(' · ') + src : '';
}
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

/* ---------- 분양권·입주권 실거래 + 청약홈 분양정보·경쟁률 ---------- */
const SILV_API = 'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';
const OD = 'https://api.odcloud.kr/api/';
const SIDO_OF = { '11': '서울', '41': '경기', '28': '인천' };
const SILVC = new Map(), SILVG = new Map(), SDONE = new Set(), SALES = new Map(), SALEX = new Map();
let GEO = {}; try { GEO = JSON.parse(localStorage.getItem('geo_v1') || '{}') || {}; } catch (e) {}
let XOV = [], xsel = null, geoT = 0;
const X = { silv: [], err: [] };
function geocodeAddr(addr) {
  if (GEO[addr]) return Promise.resolve(GEO[addr]);
  return new Promise(res => geocoder.addressSearch(addr, (r, st) => {
    const v = (st === kakao.maps.services.Status.OK && r[0]) ? [+r[0].y, +r[0].x] : null;
    if (v) { GEO[addr] = v; clearTimeout(geoT); geoT = setTimeout(() => { try { localStorage.setItem('geo_v1', JSON.stringify(GEO)); } catch (e) {} }, 800); }
    res(v); }));
}
async function geocodeLoose(addr) {
  const a = String(addr || '').replace(/\(.*?\)/g, ' ').replace(/(일원|일대|번지|외\s*\d+\s*필지).*$/, '').replace(/\s+/g, ' ').trim();
  const toks = a.split(' ');
  for (let k = 0; k < 3 && toks.length >= 3; k++) { const v = await geocodeAddr(toks.join(' ')); if (v) return v; toks.pop(); }
  return null;
}
function centerRegion() { return new Promise(res => geocoder.coord2RegionCode(S.center.lon, S.center.lat, (r, st) => {
  if (st !== kakao.maps.services.Status.OK) return res(null); const b = r.find(x => x.region_type === 'B'); res(b || null); })); }
async function silvMonth(f, ym) {
  let key = KEY; try { key = decodeURIComponent(KEY); } catch (e) {}
  for (let page = 1; page <= 5; page++) {
    let r; try { r = await fetch(SILV_API + '?' + new URLSearchParams({ serviceKey: key, LAWD_CD: f, DEAL_YMD: ym, pageNo: page, numOfRows: 1000 })); } catch (e) { throw { kind: 'net' }; }
    if (r.status === 401 || r.status === 403) throw { kind: 'key', msg: 'HTTP ' + r.status };
    if (!r.ok) throw { kind: 'api', msg: 'HTTP ' + r.status };
    const out = parseAny(await r.text());
    for (const o of out.items) {
      if (String(o.cdealType || '').toUpperCase() === 'O' || o.cdealDay) continue;
      const amt = parseInt(String(o.dealAmount || '').replace(/,/g, ''), 10), area = Math.round(parseFloat(o.excluUseAr) * 100) / 100;
      const ymd = (+o.dealYear) * 10000 + (+o.dealMonth) * 100 + (+o.dealDay);
      if (!amt || !area || !ymd) continue;
      const t = [ymd, area, parseInt(o.floor, 10) || 0, amt, o.ownershipGbn || o.ownershipGbnNm || ''];
      const nm = o.aptNm || o.aptName || '', id = matchRow(f, o.umdNm || '', o.jibun || '', nm);
      if (id != null) push(SILVC, id, t);
      else { const k = f + '|' + (o.umdNm || '') + '|' + (o.jibun || '') + '|' + nn(nm);
        if (!SILVG.has(k)) SILVG.set(k, { key: k, code: f, umd: o.umdNm || '', jibun: o.jibun || '', name: nm, sgg: o.sggNm || '', trades: [] });
        SILVG.get(k).trades.push(t); }
    }
    if (page * 1000 >= out.total || !out.items.length) break;
  }
  SDONE.add(f + '|' + ym);
}
async function ensureSilv(codes, months) {
  const seen = new Set(), jobs = [];
  for (const c of codes) for (const f of [c].concat(LEGACY[c] || [])) for (const ym of monthList(months || S.months)) { const k = f + '|' + ym; if (!SDONE.has(k) && !seen.has(k)) { seen.add(k); jobs.push([f, ym]); } }
  let k = 0, err = null;
  const worker = async () => { while (k < jobs.length && !err) { const j = jobs[k++]; try { await silvMonth(j[0], j[1]); } catch (e) { err = e; } } };
  await Promise.all(Array.from({ length: 3 }, worker));
  if (err) X.err.push('분양권 실거래: ' + (err.kind === 'net' ? '접속 실패' : (err.kind + ' ' + (err.msg || ''))));
}
async function odGet(path, cond) {
  let key = KEY; try { key = decodeURIComponent(KEY); } catch (e) {}
  const q = new URLSearchParams({ page: 1, perPage: 1000, serviceKey: key }); for (const k in cond) q.set(`cond[${k}]`, cond[k]);
  let r; try { r = await fetch(OD + path + '?' + q); } catch (e) { throw { kind: 'net' }; }
  if (!r.ok) throw { kind: r.status === 401 || r.status === 403 ? 'key' : 'api', msg: 'HTTP ' + r.status };
  const j = await r.json(); return Array.isArray(j.data) ? j.data : [];
}
// 청약홈 분양정보: 시도 단위로 받아 둔다. 조건 검색이 거절되면 조건 없이 받아 화면에서 거른다.
const ST = { meta: '', log: '', sido: '서울', q: '', years: 2, rows: null, err: null, loading: false, init: false, diag: '' };
const SALEROW = new Map(); let salePin = null;
async function odPages(path, cond, maxPages) {
  let key = KEY; try { key = decodeURIComponent(KEY); } catch (e) {}
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({ page, perPage: 500, serviceKey: key }); for (const k in cond) q.set(`cond[${k}]`, cond[k]);
    let r; try { r = await fetch(OD + path + '?' + q); } catch (e) { throw { kind: 'net' }; }
    if (!r.ok) { let t = ''; try { t = (await r.text()).slice(0, 120); } catch (e) {} throw { kind: r.status === 401 || r.status === 403 ? 'key' : 'api', msg: 'HTTP ' + r.status + ' ' + t }; }
    const j = await r.json(), d = Array.isArray(j.data) ? j.data : [];
    ST.meta = `page ${page}: currentCount=${j.currentCount} matchCount=${j.matchCount} totalCount=${j.totalCount}` + (Array.isArray(j.data) ? '' : ' / 응답 키: ' + Object.keys(j).join(','));
    all.push(...d); if (d.length < 500) break;
  }
  return all;
}
function salesOf(sido) {
  const k = sido;
  if (!SALES.has(k)) { const d = new Date(S.asOf.getFullYear() - 3, S.asOf.getMonth(), S.asOf.getDate());
    const from = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const path = 'ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail';
    const local = rows => rows.filter(r => String(r.SUBSCRPT_AREA_CODE_NM || r.HSSPLY_ADRES || '').includes(sido) && String(r.RCRIT_PBLANC_DE || '') >= from);
    // 조건 검색이 거절되거나 0건이면 조건을 줄여 다시 받고 화면에서 거른다
    SALES.set(k, (async () => {
      const tries = [[{ 'SUBSCRPT_AREA_CODE_NM::EQ': sido, 'RCRIT_PBLANC_DE::GTE': from }, 6], [{ 'RCRIT_PBLANC_DE::GTE': from }, 12], [{}, 20]]; let last = null, log = [];
      for (const [cond, pages] of tries) {
        try { const rows = local(await odPages(path, cond, pages)); log.push(Object.keys(cond).length + '개 조건 → ' + rows.length + '건 (' + ST.meta + ')'); if (rows.length) { ST.log = log.join(' / '); return rows; } }
        catch (e) { if (e.kind !== 'api') throw e; last = e; log.push(Object.keys(cond).length + '개 조건 → 오류 ' + (e.msg || '')); }
      }
      ST.log = log.join(' / '); SALES.delete(k); if (last && log.every(x => x.includes('오류'))) throw last; return [];
    })()
      .catch(e => { SALES.delete(k); throw e; })); }
  return SALES.get(k);
}
async function loadSaleTab() {
  if (!KEY) { ST.rows = null; ST.err = null; renderSaleList(); return; }
  ST.loading = true; ST.err = null; renderSaleList();
  const sido = ST.sido;
  try { const rows = await salesOf(sido); if (sido !== ST.sido) return;
    ST.diag = rows.length && rows[0].HOUSE_NM === undefined ? '응답 항목이 예상과 달라요: ' + Object.keys(rows[0]).slice(0, 14).join(', ') : '';
    ST.rows = rows.slice().sort((a, b) => String(b.RCRIT_PBLANC_DE || '').localeCompare(String(a.RCRIT_PBLANC_DE || '')));
    for (const r of rows) SALEROW.set(String(r.HOUSE_MANAGE_NO), r);
  } catch (e) { ST.rows = null; ST.err = e.kind === 'net' ? '청약홈 서버에 접속하지 못했어요 (브라우저 보안 정책 또는 네트워크 차단).' : (e.kind === 'key' ? '청약홈 API 인증이 거절됐어요 (' + (e.msg || '') + '). 활용신청 승인이 반영됐는지 확인하세요.' : '청약홈 조회 오류: ' + (e.msg || '')); }
  ST.loading = false; renderSaleList();
}
function renderSaleTab() {
  const el = $('#list');
  el.innerHTML = `<div class="lh"><div class="ctrl" style="margin:0"><label>시도<select id="ssido">${['서울', '경기', '인천'].map(x => `<option${x === ST.sido ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>기간<select id="syears">${[1, 2, 3].map(y => `<option value="${y}"${y === ST.years ? ' selected' : ''}>최근 ${y}년</option>`).join('')}</select></label>
    <label>시군구·단지명<input id="sq" type="search" placeholder="예: 용인, 처인구" value="${esc(ST.q)}" style="padding:6px 8px;font-size:13px"></label></div></div><div id="slist"></div>`;
  $('#ssido').onchange = () => { ST.sido = $('#ssido').value; loadSaleTab(); };
  $('#syears').onchange = () => { ST.years = +$('#syears').value; renderSaleList(); };
  $('#sq').oninput = () => { ST.q = $('#sq').value.trim(); renderSaleList(); };
  renderSaleList();
}
function renderSaleList() {
  const el = document.getElementById('slist'); if (!el || S.tab !== 'sale') return;
  let h = '';
  if (NOTICES.length) h += '<details class="nbox"><summary>분석해 둔 모집공고 요약·PPT ' + NOTICES.length + '건 보기</summary>' + NOTICES.map(n => `<div class="item nitem" data-nid="${esc(n.id)}"><div class="n"><div class="nm">${esc(n.name)}</div><div class="ad">${esc(n.addr)} · 공고 ${esc(n.noticeDate)}</div></div><div class="px"><small>요약·PPT</small></div></div>`).join('') + '</details>';
  h += '<div class="lh"><button id="sre" style="float:right;padding:2px 9px;font-size:12px">다시 조회</button><b>청약홈 분양정보</b> ';
  if (!KEY) h += '</div><div class="empty">국토부 인증키를 입력하면 조회돼요.</div>';
  else if (ST.loading) h += '조회 중…</div>';
  else if (ST.err) h += `</div><div class="status err" style="margin:10px 14px">${esc(ST.err)} 이 문구를 그대로 알려 주세요.</div>`;
  else if (!ST.rows) h += '</div>';
  else {
    const toks = ST.q.split(/\s+/).filter(Boolean);
    const yd = new Date(S.asOf.getFullYear() - ST.years, S.asOf.getMonth(), S.asOf.getDate()), yfrom = yd.getFullYear() + '-' + String(yd.getMonth() + 1).padStart(2, '0') + '-' + String(yd.getDate()).padStart(2, '0');
    const inYears = ST.rows.filter(r => String(r.RCRIT_PBLANC_DE || '') >= yfrom);
    const rows = inYears.filter(r => { const t = String(r.HOUSE_NM || '') + ' ' + String(r.HSSPLY_ADRES || ''); return toks.every(x => t.includes(x)); });
    h += `${ST.sido} 최근 ${ST.years}년 ${inYears.length}건${toks.length ? ' 중 ' + rows.length + '건' : ''} <small>(받은 자료: 최근 3년 ${ST.rows.length}건)</small></div>`;
    if (ST.diag) h += `<div class="status err" style="margin:10px 14px">${esc(ST.diag)} 이 문구를 그대로 알려 주세요.</div>`;
    if (!rows.length) h += '<div class="empty">조건에 맞는 공고가 없어요.</div>';
    if (!ST.rows.length && ST.log) h += `<div class="status err" style="margin:10px 14px">청약홈 서버가 지금 자료를 한 건도 주지 않고 있어요 (조건 없이 물어도 0건). 서버 쪽 일시 현상일 수 있으니 잠시 뒤 '다시 조회'를 눌러 보세요.<br><small>진단: ${esc(ST.log)}</small></div>`;
    h += rows.slice(0, 200).map(r => { const id = String(r.HOUSE_MANAGE_NO), an = NOTICES.some(n => n.id === id);
      return `<div class="item${xsel === 's' + id ? ' sel' : ''}" data-sid="${esc(id)}"><div class="n"><div class="nm">${esc(r.HOUSE_NM || '(이름 없음)')}</div><div class="ad">${esc(r.HSSPLY_ADRES || '')}</div><div class="inf">공고 ${esc(r.RCRIT_PBLANC_DE || '-')} · ${esc(r.TOT_SUPLY_HSHLDCO == null ? '-' : r.TOT_SUPLY_HSHLDCO)}세대${r.MVN_PREARNGE_YM ? ' · 입주 ' + esc(r.MVN_PREARNGE_YM) : ''}</div></div><div class="px"><small>${an ? '분석 요약 있음' : '경쟁률'}</small></div></div>`; }).join('');
    if (rows.length > 200) h += '<div class="lh">최근 200건만 표시했어요. 시군구나 단지명으로 좁혀 보세요.</div>';
  }
  el.innerHTML = h;
  const re = document.getElementById('sre'); if (re) re.onclick = () => { SALES.delete(ST.sido); loadSaleTab(); };
}
function setTab(t) {
  S.tab = t; document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('.ctrl').style.display = t === 'sale' ? 'none' : '';
  if (t === 'sale') {
    if (!ST.init) { ST.init = true; const c = S.list.length ? C[S.list[0].id] : null; if (c) { ST.sido = c.sido; ST.q = c.gu.split(' ')[0].replace(/시$|구$/, ''); } }
    renderSaleTab(); if (!ST.rows && !ST.loading) loadSaleTab();
  } else renderList();
}
// 실거래 탭: 반경 안의 분양권·입주권 거래(목록에 없는 입주 전 단지)를 지번으로 찍는다.
async function loadExtras(tok) {
  if (!KEY || !S.center) return;
  X.err = [];
  const codes = new Set(S.list.map(i => C[i.id].code)), gus = new Map();
  for (const i of S.list) { const c = C[i.id]; gus.set(c.code, c.gu); }
  const reg = await centerRegion();
  if (reg && reg.code) { const c5 = String(reg.code).slice(0, 5); if (SIDO_OF[c5.slice(0, 2)]) { codes.add(c5); if (!gus.has(c5)) gus.set(c5, reg.region_2depth_name || ''); } }
  if (tok !== S.token || !codes.size) return;
  await ensureSilv(codes);
  if (tok !== S.token) return;
  const cut = cutoff(), silv = [];
  await Promise.all([...SILVG.values()].filter(g => codes.has(g.code) || [...codes].some(c => (LEGACY[c] || []).includes(g.code))).map(async g => {
    const tr = g.trades.filter(t => t[0] >= cut); if (!tr.length) return;
    const gu = gus.get(g.code) || g.sgg || '', sd = SIDO_OF[g.code.slice(0, 2)] || '';
    const p = await geocodeAddr(`${sd} ${gu} ${g.umd} ${g.jibun}`.replace(/\s+/g, ' ').trim()); if (!p) return;
    const d = hav(S.center.lat, S.center.lon, p[0], p[1]); if (d > S.rad) return;
    silv.push({ key: g.key, name: g.name, addr: `${gu} ${g.umd} ${g.jibun}`, lat: p[0], lon: p[1], d, trades: tr }); }));
  if (tok !== S.token) return;
  X.silv = silv.sort((a, b) => a.d - b.d);
  renderExtraPins(); renderList(); if (S.sel != null) renderDetail();
  if (X.err.length && !S.liveErr) status(X.err.join(' / ') + ' — 이 문구를 그대로 알려 주세요.', true);
}
function silvBest(tr) { const b = dominant(tr); const latest = b.v.reduce((x, y) => (y[0] > x[0] ? y : x)); return { py: pyeong(b.k), val: latest[3], n: tr.length }; }
function renderExtraPins() {
  XOV.forEach(o => o.setMap(null)); XOV = [];
  if (!map) return;
  const add = (lat, lon, cls, html, title, fn, z) => { const el = document.createElement('div'); el.className = 'pin ' + cls; el.innerHTML = html; el.title = title;
    el.addEventListener('click', e => { e.stopPropagation(); fn(); });
    const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(lat, lon), content: el, xAnchor: .12, yAnchor: 1, zIndex: z, clickable: true }); ov.setMap(map); XOV.push(ov); };
  if (salePin) add(salePin.lat, salePin.lon, 'spin sel', `<small>분양 ${esc(salePin.date)}</small><b>${esc(salePin.name.length > 12 ? salePin.name.slice(0, 12) + '…' : salePin.name)}</b>`, salePin.name, () => openSale(salePin.id), 25);
  for (const g of X.silv) { const b = silvBest(g.trades);
    add(g.lat, g.lon, 'vpin' + (xsel === 'v' + g.key ? ' sel' : ''), `<small>분양권 ${b.py}평</small><b>${eok(b.val)}</b>`, g.name, () => openSilv(g.key), 22); }
}
function silvTable(tr) {
  return '<table><tr><th>계약일</th><th>구분</th><th>전용</th><th>층</th><th>거래가</th></tr>' + tr.slice().sort((a, b) => b[0] - a[0]).slice(0, 20).map(t =>
    `<tr><td>${ds(t[0])}</td><td>${esc(t[4] || '-')}</td><td>${t[1]}㎡ (${pyeong(t[1])}평)</td><td>${t[2]}</td><td><b>${eokFull(t[3])}</b></td></tr>`).join('') + '</table>' + (tr.length > 20 ? `<div class="note">최근 20건만 표시 (전체 ${tr.length}건)</div>` : '');
}
function rawTable(rows) { if (!rows.length) return ''; const ks = Object.keys(rows[0]);
  return '<div class="note">항목 이름이 예상과 달라 원자료 그대로 표시해요. 이 표를 알려 주세요.</div><div style="overflow:auto"><table><tr>' + ks.map(k => `<th>${esc(k)}</th>`).join('') + '</tr>' + rows.slice(0, 30).map(r => '<tr>' + ks.map(k => `<td>${esc(r[k] == null ? '' : r[k])}</td>`).join('') + '</tr>').join('') + '</table></div>'; }
async function saleExtra(id) {       // 주택형별 공급·최고분양가 + 경쟁률
  if (!KEY) return '<div class="note">국토부 인증키를 입력하면 청약 경쟁률이 표시돼요.</div>';
  if (!SALEX.has(id)) SALEX.set(id, Promise.all([
    odGet('ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl', { 'HOUSE_MANAGE_NO::EQ': id }).catch(e => ({ err: e })),
    odGet('ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet', { 'HOUSE_MANAGE_NO::EQ': id }).catch(e => ({ err: e }))]));
  const [mdl, cmp] = await SALEX.get(id); const num = v => (v == null || v === '') ? '-' : (isNaN(+String(v).replace(/,/g, '')) ? esc(v) : Number(String(v).replace(/,/g, '')).toLocaleString('ko-KR'));
  const er = e => `<div class="note">조회 실패 (${esc(e.kind || '')} ${esc(e.msg || '')}). 활용신청 승인 반영 전이거나 브라우저 접속이 막혔을 수 있어요.</div>`;
  let h = '<div class="sec">주택형별 공급 (청약홈)</div>';
  if (mdl.err) h += er(mdl.err); else if (!mdl.length) h += '<div class="note">자료 없음</div>';
  else if (mdl[0].HOUSE_TY === undefined) h += rawTable(mdl);
  else h += '<table><tr><th>주택형</th><th>공급면적㎡</th><th>일반</th><th>특별</th><th>최고 분양가(만원)</th></tr>' + mdl.map(m => `<tr><td>${esc(m.HOUSE_TY)}</td><td>${esc(m.SUPLY_AR == null ? '-' : m.SUPLY_AR)}</td><td>${num(m.SUPLY_HSHLDCO)}</td><td>${num(m.SPSPLY_HSHLDCO)}</td><td><b>${num(m.LTTOT_TOP_AMOUNT)}</b></td></tr>`).join('') + '</table><div class="note">분양가는 주택형별 최고가 기준이에요. 층별 가격은 모집공고문에 있어요.</div>';
  h += '<div class="sec">청약 경쟁률 (청약홈, 일반공급)</div>';
  if (cmp.err) h += er(cmp.err); else if (!cmp.length) h += '<div class="note">아직 경쟁률 자료가 없어요 (청약 전이거나 미집계).</div>';
  else if (cmp[0].HOUSE_TY === undefined || cmp[0].CMPET_RATE === undefined) h += rawTable(cmp);
  else h += '<table><tr><th>주택형</th><th>순위</th><th>거주</th><th>공급</th><th>접수</th><th>경쟁률</th></tr>' + cmp.slice().sort((a, b) => String(a.HOUSE_TY).localeCompare(String(b.HOUSE_TY)) || (a.SUBSCRPT_RANK_CODE - b.SUBSCRPT_RANK_CODE)).map(c =>
    `<tr><td>${esc(c.HOUSE_TY)}</td><td>${esc(c.SUBSCRPT_RANK_CODE)}순위</td><td>${esc(c.RESIDE_SENM || c.RESIDE_SECD || '')}</td><td>${num(c.SUPLY_HSHLDCO)}</td><td>${num(c.REQ_CNT)}</td><td><b>${esc(c.CMPET_RATE == null ? '-' : c.CMPET_RATE)}</b></td></tr>`).join('') + '</table>';
  return h;
}
async function openSale(id) {
  const r = SALEROW.get(id); if (!r) return;
  if (NOTICES.some(n => n.id === id)) return openNotice(id, true);
  xsel = 's' + id; noticeSel = null; S.sel = null; salePin = null; renderPins(); renderExtraPins(); renderNoticePins(); renderSaleList();
  const name = r.HOUSE_NM || '', addr = r.HSSPLY_ADRES || '', el = $('#detail'); el.hidden = false; el.scrollIntoView({ block: 'nearest' });
  const row = (k, v) => (v || v === 0) ? `<tr><td>${k}</td><td>${esc(v)}</td></tr>` : '';
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(name)}</h2><div class="ad">${esc(addr)}</div>`;
  if (r.PBLANC_URL) h += `<a class="dl" href="${esc(r.PBLANC_URL)}" target="_blank" rel="noopener">청약홈 모집공고 보기</a>`;
  h += '<table class="kvt">' + row('모집공고일', r.RCRIT_PBLANC_DE) + row('공급세대', r.TOT_SUPLY_HSHLDCO) + row('청약접수', (r.RCEPT_BGNDE || '') + (r.RCEPT_ENDDE ? ' ~ ' + r.RCEPT_ENDDE : '')) + row('당첨자 발표', r.PRZWNER_PRESNATN_DE) +
    row('계약', (r.CNTRCT_CNCLS_BGNDE || '') + (r.CNTRCT_CNCLS_ENDDE ? ' ~ ' + r.CNTRCT_CNCLS_ENDDE : '')) + row('입주예정', r.MVN_PREARNGE_YM) + row('시공사', r.CNSTRCT_ENTRPS_NM) + row('사업주체', r.BSNS_MBY_NM) + row('주택구분', r.HOUSE_DTL_SECD_NM || r.HOUSE_SECD_NM) + '</table>';
  h += '<div id="sx"><div class="note">주택형·경쟁률 불러오는 중…</div></div><div id="sv"></div>';
  h += '<div class="reqbox"><button id="rq" class="pri">모집공고 요약 요청하기</button><div id="rqo" class="note">층별 분양가·발코니 확장비·중도금 조건을 정리한 요약과 PPT를 Claude에게 요청할 때 눌러 주세요.</div></div>';
  el.innerHTML = h; $('#dx').onclick = () => { xsel = null; salePin = null; el.hidden = true; renderExtraPins(); renderSaleList(); };
  $('#rq').onclick = () => {
    const txt = `아래 단지 입주자모집공고를 분석해서 회사 양식 PPT로 만들고, 사이트(apt-map)에도 요약을 올려줘.\n- 단지명: ${name}\n- 주택관리번호: ${id}\n- 공급위치: ${addr}\n- 모집공고일: ${r.RCRIT_PBLANC_DE || ''}\n- 청약홈 공고: ${r.PBLANC_URL || ''}\n(공고문 PDF 첨부)`;
    const done = ok => { $('#rqo').innerHTML = (ok ? '<b>요청 문구를 복사했어요.</b> ' : '<b>아래 문구를 복사하세요.</b> ') + 'Claude 대화창에 붙여넣고, 청약홈에서 받은 공고문 PDF를 함께 첨부해 보내면 돼요. 완성되면 이 단지에 "분석 요약"이 붙어요.' +
      ` <a href="https://claude.ai" target="_blank" rel="noopener">Claude 열기</a><textarea readonly style="width:100%;height:110px;margin-top:6px;font:12px/1.4 inherit">${esc(txt)}</textarea>`; };
    try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (e) { done(false); } };
  saleExtra(id).then(ex => { const sx = document.getElementById('sx'); if (sx && xsel === 's' + id) sx.innerHTML = ex; });
  // 위치를 찾아 지도 이동, 그 시군구의 분양권·입주권 거래 중 이름이 맞는 것을 붙인다
  const g = await geocodeLoose(addr); if (xsel !== 's' + id) return;
  const sv = document.getElementById('sv');
  if (!g) { if (sv) sv.innerHTML = '<div class="note">주소로 위치를 찾지 못해 지도에는 표시하지 못했어요.</div>'; return; }
  salePin = { id, name, lat: g[0], lon: g[1], date: String(r.RCRIT_PBLANC_DE || '').slice(2, 7) }; renderExtraPins();
  map.setLevel(5); map.panTo(new kakao.maps.LatLng(g[0], g[1]));
  const b = await new Promise(res => geocoder.coord2RegionCode(g[1], g[0], (rr, st) => { if (st !== kakao.maps.services.Status.OK) return res(null); res(rr.find(x => x.region_type === 'B') || null); }));
  if (!b || !b.code || xsel !== 's' + id) return;
  const c5 = String(b.code).slice(0, 5); X.err = []; await ensureSilv(new Set([c5])); if (xsel !== 's' + id) return;
  const key = nn(name), cutd = cutoff(), tr = [];
  for (const gp of SILVG.values()) { if (gp.code !== c5 && !(LEGACY[c5] || []).includes(gp.code)) continue; const k2 = nn(gp.name);
    if (k2 && key && (k2.includes(key) || key.includes(k2))) tr.push(...gp.trades.filter(t => t[0] >= cutd)); }
  if (sv) sv.innerHTML = `<div class="sec">분양권·입주권 실거래 (최근 ${S.months}개월, ${tr.length}건)</div>` + (tr.length ? silvTable(tr) : `<div class="note">${X.err.length ? esc(X.err.join(' / ')) : '단지명이 일치하는 분양권·입주권 거래가 없어요. 신고 단지명이 다르면 실거래 탭의 보라색 핀에서 찾을 수 있어요.'}</div>`);
}
function openSilv(key) {
  const g = X.silv.find(s => s.key === key); if (!g) return;
  xsel = 'v' + key; noticeSel = null; S.sel = null; renderPins(); renderExtraPins(); renderNoticePins();
  const el = $('#detail'); el.hidden = false; el.scrollIntoView({ block: 'nearest' });
  const am = g.trades.map(t => t[3]);
  el.innerHTML = `<button class="x" id="dx">닫기</button><h2>${esc(g.name)}</h2><div class="ad">${esc(g.addr)} · 분양권·입주권 거래 단지</div>` +
    `<div class="kv"><div><small>거래 ${g.trades.length}건 중위</small><b>${eokFull(med(am))}</b></div><div><small>최고</small><b>${eokFull(Math.max(...am))}</b></div><div><small>최저</small><b>${eokFull(Math.min(...am))}</b></div></div>` +
    `<div class="sec">분양권·입주권 실거래 (최근 ${S.months}개월)</div>` + silvTable(g.trades) + '<div class="note">아직 단지 목록에 없는(입주 전) 단지예요. 위치는 신고 지번을 좌표로 바꾼 값이라 실제와 조금 다를 수 있어요.</div>';
  $('#dx').onclick = () => { xsel = null; el.hidden = true; renderExtraPins(); };
}

/* ---------- 시장조사 기초자료 PPT (브라우저에서 바로 생성) ---------- */
// 범위: 대상지와 같은 동(읍·면 지역은 읍·면 전체). 준공 5년 이내 단지 → 없으면 10년 이내 → 없으면 전체.
// 실거래: 단지별 최근 1년, 1년 내 거래가 없으면 최근 2년. 단지별 면적타입 요약(최고·최저·중위·평균)과 최근 5건.
function loadScript(src) { return new Promise((res, rej) => { if (window.PptxGenJS) return res(); const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('PPT 라이브러리를 불러오지 못했어요.')); document.head.appendChild(el); }); }
const ymdAgo = m => ymdOf(new Date(S.asOf.getFullYear(), S.asOf.getMonth() - m, S.asOf.getDate()));
async function makeReport() {
  if (!S.center) return status('먼저 주소를 검색해 대상지를 정해 주세요.', true);
  if (!KEY) return status('국토부 인증키를 입력한 뒤 눌러 주세요.', true);
  const btn = $('#rpt'); btn.disabled = true;
  try {
    status('기초자료 준비 중… 대상 동 확인');
    const reg = await centerRegion(); if (!reg || !reg.code) throw new Error('대상지의 행정구역을 확인하지 못했어요.');
    const code5 = String(reg.code).slice(0, 5), d1 = reg.region_1depth_name || '', d2 = reg.region_2depth_name || '', d3 = reg.region_3depth_name || '';
    const isEup = /[읍면]$/.test(d3);
    let pool = C.filter(c => c.code === code5);
    if (!pool.length && d2) pool = C.filter(c => d2.split(' ').every(t => c.gu.includes(t)));
    const inDong = pool.filter(c => isEup ? c.umd.split(' ')[0] === d3 : c.umd === d3);
    if (!inDong.length) throw new Error(`${d2} ${d3}에는 단지 목록에 등록된 아파트가 없어요.`);
    const codes = new Set(inDong.map(c => c.code));
    status('기초자료 준비 중… 최근 2년 실거래 조회');
    await ensureTrades(codes, 24); if (S.liveErr) throw new Error(liveErrText(S.liveErr));
    X.err = []; await ensureSilv(codes, 24);
    // 준공연도: 실거래의 건축년도 → 없으면 K-apt·건축물대장
    const fetchInfo = async (list, label) => { let k = 0, dn = 0;
      const w = async () => { while (k < list.length && !bldErr) { const c = list[k++]; try { BLD[bkey(c)] = await fetchBld(c); bldSave(); } catch (e) { if (e.kind === 'key' || e.kind === 'net') bldErr = e; } status(`기초자료 준비 중… ${label} ${++dn}/${list.length}`); } };
      await Promise.all([w(), w(), w()]); };
    await fetchInfo(inDong.filter(c => !BY.get(c.id) && BLD[bkey(c)] === undefined), '단지 준공연도 확인');
    const Y = S.asOf.getFullYear(), cut1 = ymdAgo(12), cut2 = ymdAgo(24);
    const mk = c => { const all = tradesOf(c.id), t1 = all.filter(t => t[0] >= cut1), tr = t1.length ? t1 : all.filter(t => t[0] >= cut2), b = BLD[bkey(c)];
      return { c, tr, all: all.filter(t => t[0] >= cut2), span: t1.length ? 1 : 2, year: BY.get(c.id) || (b && b[1]) || 0, hh: (b && b[0]) || 0, up: (b && b[2]) || 0, dn: (b && b[3]) || 0, ratio: (b && b[6]) || 0, d: hav(S.center.lat, S.center.lon, c.lat, c.lon) }; };
    let rows = inDong.map(mk);
    const t5 = rows.filter(r => r.year && Y - r.year <= 5), t10 = rows.filter(r => r.year && Y - r.year <= 10);
    let pick = t5.length ? t5 : (t10.length ? t10 : rows); const tier = t5.length ? '준공 5년 이내' : (t10.length ? '준공 10년 이내' : '전체 연차'), tierNote = t5.length ? '' : (t10.length ? ' (5년 이내 단지 없음)' : ' (10년 이내 단지 없음)');
    // 세대수·층수·공급면적 비율: 대상 단지만 추가 조회
    await fetchInfo(pick.map(r => r.c).filter(c => BLD[bkey(c)] === undefined), '단지 세대수·면적 확인');
    pick = pick.map(r => mk(r.c)); pick.sort((a, b) => (b.year - a.year) || (b.hh - a.hh));
    status('기초자료 준비 중… PPT 작성');
    await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js');
    const pres = new PptxGenJS(); pres.layout = 'LAYOUT_WIDE'; pres.title = '공동주택 시장조사 기초자료';   // 13.33 x 7.5 in
    const F = '맑은 고딕', NAVY = '12263F', INK = '1B2430', MUTE = '6B7785', LINE = 'D5DAE1', BG = 'F3F5F8', ACC = '0E9F9A', WARN = 'C2410C', LX = 0.55, LW = 12.23;
    const today = S.asOf.getFullYear() + '.' + String(S.asOf.getMonth() + 1).padStart(2, '0') + '.' + String(S.asOf.getDate()).padStart(2, '0');
    const n = v => (v == null || isNaN(v)) ? '-' : Math.round(v).toLocaleString('ko-KR'), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const rOf = r => r.ratio || SUPPLY, ppy = (r, t) => t[3] / (t[1] * rOf(r) / PY), pyR = (r, a) => Math.round(a * rOf(r) / PY);
    const area = `${d1} ${d2} ${d3}`.trim();
    const TH = t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, align: 'center' } });
    const cell = (t, o) => ({ text: String(t), options: Object.assign({ align: 'center' }, o || {}) });
    const tbl = (sl, data, x, y, w, colW, fs, rowH) => sl.addTable(data, { x, y, w, colW, fontFace: F, fontSize: fs || 9, border: { type: 'solid', pt: 0.5, color: LINE }, valign: 'middle', margin: [2, 5, 2, 5], rowH: rowH || 0.28, color: INK });
    let pageNo = 1;
    const page = (headline, tag) => { const sl = pres.addSlide(); pageNo++; sl.background = { color: 'FFFFFF' };
      sl.addText(tag, { x: LX, y: 0.32, w: 8, h: 0.24, fontFace: F, fontSize: 9, bold: true, color: ACC, margin: 0, isTextBox: true });
      sl.addText(headline, { x: LX, y: 0.56, w: LW, h: 0.62, fontFace: F, fontSize: 20, bold: true, color: INK, margin: 0, valign: 'middle', isTextBox: true, fit: 'shrink' });
      sl.addText(`출처: 국토교통부 실거래가 공개시스템, K-apt, 청약홈 · 기준일 ${today} · 해제 거래 제외 · 참고용`, { x: LX, y: 7.08, w: 10.5, h: 0.22, fontFace: F, fontSize: 8, color: MUTE, margin: 0, isTextBox: true });
      sl.addText(String(pageNo), { x: 12.08, y: 7.08, w: 0.7, h: 0.22, fontFace: F, fontSize: 8, color: MUTE, align: 'right', margin: 0, isTextBox: true });
      return sl; };
    const kpi = (sl, x, y, w, label, value, sub) => { sl.addShape(pres.ShapeType.rect, { x, y, w, h: 1.15, fill: { color: BG }, line: { color: BG, width: 0 } });
      sl.addText(label, { x: x + 0.18, y: y + 0.12, w: w - 0.3, h: 0.24, fontFace: F, fontSize: 9.5, color: MUTE, margin: 0, isTextBox: true });
      sl.addText(value, { x: x + 0.18, y: y + 0.36, w: w - 0.3, h: 0.48, fontFace: F, fontSize: 24, bold: true, color: NAVY, margin: 0, isTextBox: true, fit: 'shrink' });
      sl.addText(sub || '', { x: x + 0.18, y: y + 0.84, w: w - 0.3, h: 0.22, fontFace: F, fontSize: 8.5, color: MUTE, margin: 0, isTextBox: true }); };
    const chartBase = () => ({ catAxisLabelFontFace: F, valAxisLabelFontFace: F, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelColor: MUTE, valAxisLabelColor: MUTE, valGridLine: { color: 'E6E9EE', size: 0.5 }, catGridLine: { style: 'none' }, showLegend: false, dataLabelFontFace: F, dataLabelFontSize: 8.5, dataLabelColor: INK, valAxisLabelFormatCode: '#,##0', dataLabelFormatCode: '#,##0' });
    // 집계
    const pairs1 = pick.flatMap(r => r.all.filter(t => t[0] >= cut1).map(t => [r, t])), pairs0 = pick.flatMap(r => r.all.filter(t => t[0] < cut1).map(t => [r, t]));
    const mp1 = pairs1.length ? med(pairs1.map(([r, t]) => ppy(r, t))) : null, mp0 = pairs0.length ? med(pairs0.map(([r, t]) => ppy(r, t))) : null, chg = (mp1 && mp0) ? (mp1 / mp0 - 1) * 100 : null;
    const chgTxt = chg == null ? '비교 불가' : (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%';
    const sumOf = r => { if (!r.tr.length) return null; const b = dominant(r.tr), am = b.v.map(t => t[3]); return { type: b.k, cnt: r.tr.length, med: med(am), max: Math.max(...am), min: Math.min(...am), ppy: med(b.v.map(t => ppy(r, t))) }; };
    const det = pick.filter(r => r.tr.length), noTr = pick.filter(r => !r.tr.length);
    const estN = det.filter(r => !r.ratio).length;

    // 표지
    let sl = pres.addSlide(); sl.background = { color: NAVY };
    sl.addText('MARKET SNAPSHOT', { x: 0.8, y: 2.0, w: 8, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: ACC, charSpacing: 3, margin: 0, isTextBox: true });
    sl.addText('공동주택 시장조사 기초자료', { x: 0.8, y: 2.4, w: 11.5, h: 0.9, fontFace: F, fontSize: 38, bold: true, color: 'FFFFFF', margin: 0, isTextBox: true });
    sl.addText(area, { x: 0.8, y: 3.35, w: 11.5, h: 0.5, fontFace: F, fontSize: 20, color: 'DCE3EC', margin: 0, isTextBox: true });
    sl.addText(`대상지: ${S.center.label || area}\n조사 범위: ${d3} 아파트 ${inDong.length}개 단지 중 ${pick.length}개 (${tier}${tierNote})\n기준일: ${today}`, { x: 0.8, y: 4.6, w: 11.5, h: 1.0, fontFace: F, fontSize: 11.5, color: 'AEB9C7', margin: 0, isTextBox: true, valign: 'top', paraSpaceAfter: 4 });

    // 요약
    sl = page(mp1 ? `${d3} ${tier} ${pick.length}개 단지, 최근 1년 중위 평당가 ${n(mp1)}만원 (직전 1년 대비 ${chgTxt})` : `${d3} ${tier} ${pick.length}개 단지, 최근 1년 실거래 없음`, 'EXECUTIVE SUMMARY');
    const kw = 2.9, kg = 0.21;
    kpi(sl, LX, 1.4, kw, '대상 단지', `${pick.length}개`, `${d3} 전체 ${inDong.length}개 중 · ${tier}`);
    kpi(sl, LX + (kw + kg), 1.4, kw, '최근 1년 거래', `${n(pairs1.length)}건`, `직전 1년 ${n(pairs0.length)}건`);
    kpi(sl, LX + (kw + kg) * 2, 1.4, kw, '중위 평당가 (공급면적)', mp1 ? `${n(mp1)}만원` : '-', mp0 ? `직전 1년 ${n(mp0)}만원` : '직전 1년 거래 없음');
    kpi(sl, LX + (kw + kg) * 3, 1.4, kw, '직전 1년 대비', chgTxt, '중위 평당가 기준');
    const bars = det.map(r => ({ name: r.c.name.length > 14 ? r.c.name.slice(0, 14) + '…' : r.c.name, v: Math.round(sumOf(r).ppy) })).sort((a, b) => b.v - a.v).slice(0, 10).reverse();
    sl.addText('단지별 평당가 (주력 면적타입 중위, 만원)', { x: LX, y: 2.8, w: 7.4, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
    if (bars.length) sl.addChart(pres.ChartType.bar, [{ name: '평당가', labels: bars.map(b => b.name), values: bars.map(b => b.v) }], Object.assign(chartBase(), { x: LX, y: 3.08, w: 7.4, h: 3.85, barDir: 'bar', chartColors: [NAVY], showValue: true, dataLabelPosition: 'outEnd', barGapWidthPct: 55, valAxisMinVal: 0 }));
    else sl.addText('기간 내 거래가 없어 차트를 그리지 못했습니다.', { x: LX, y: 3.2, w: 7.4, h: 0.3, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true });
    sl.addText('조사 기준', { x: 8.3, y: 2.8, w: 4.4, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
    sl.addText([`범위: 대상지와 같은 ${isEup ? '읍·면' : '법정동'}(${d3})의 아파트`, `연차: 준공 5년 이내 우선, 없으면 10년 이내, 없으면 전체 → 이번 자료는 ${tier}${tierNote}`, '실거래: 단지별 최근 1년, 1년 내 거래가 없는 단지는 최근 2년', `평당가: 공급면적 기준. 단지별 공급/전용 비율은 K-apt 값을 쓰고, 없는 ${estN}개 단지는 전용 × 1.32로 추정`,
      noTr.length ? `최근 2년 거래가 없는 단지 ${noTr.length}개는 요약표에만 표시` : '대상 단지 모두 최근 2년 내 거래 있음'].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      { x: 8.3, y: 3.1, w: 4.45, h: 3.6, fontFace: F, fontSize: 10.5, color: INK, margin: 0, valign: 'top', paraSpaceAfter: 8, isTextBox: true });

    // 추이
    const ms = []; for (let k = 23; k >= 0; k--) { const d = new Date(S.asOf.getFullYear(), S.asOf.getMonth() - k, 1); ms.push(d.getFullYear() * 100 + d.getMonth() + 1); }
    const allPairs = pick.flatMap(r => r.all.map(t => [r, t]));
    const byM = ms.map(m => { const v = allPairs.filter(([r, t]) => Math.floor(t[0] / 100) === m); return { m, lab: String(m).slice(2, 4) + '.' + String(m).slice(4), cnt: v.length, p: v.length ? Math.round(med(v.map(([r, t]) => ppy(r, t)))) : null }; });
    const withP = byM.filter(x => x.p != null);
    sl = page(mp1 ? `최근 12개월 중위 평당가 ${n(mp1)}만원, 직전 12개월 대비 ${chgTxt} · 월평균 거래 ${(pairs1.length / 12).toFixed(1)}건` : '최근 2년 거래 추이', 'PRICE & VOLUME TREND');
    sl.addText('월별 중위 평당가 (만원, 거래가 있는 달만)', { x: LX, y: 1.4, w: 6, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
    if (withP.length > 1) sl.addChart(pres.ChartType.line, [{ name: '중위 평당가', labels: withP.map(x => x.lab), values: withP.map(x => x.p) }], Object.assign(chartBase(), { x: LX, y: 1.7, w: 6.0, h: 5.1, chartColors: [ACC], lineSize: 2.25, lineDataSymbolSize: 6, catAxisLabelFontSize: 8 }));
    else sl.addText('월별 추이를 그릴 만큼 거래가 없습니다.', { x: LX, y: 1.8, w: 6, h: 0.3, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true });
    sl.addText('월별 거래 건수 (최근 24개월)', { x: 6.9, y: 1.4, w: 5.9, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
    sl.addChart(pres.ChartType.bar, [{ name: '거래 건수', labels: byM.map(x => x.lab), values: byM.map(x => x.cnt) }], Object.assign(chartBase(), { x: 6.9, y: 1.7, w: 5.88, h: 5.1, barDir: 'col', chartColors: [NAVY], catAxisLabelFontSize: 7.5, barGapWidthPct: 40, valAxisMinVal: 0 }));

    // 단지 요약표
    const sumHead = ['단지명', '준공', '세대수', '층수', '주력 전용', '거래 건수', '중위가', '최고가', '최저가', '평당가(중위)', '공급/전용', '기간'].map(TH), sumW = [3.0, 0.7, 0.8, 0.95, 0.9, 0.85, 1.05, 1.05, 1.05, 1.08, 0.9, 0.7];
    const sumRows = pick.map(r => { const m = sumOf(r);
      return [cell(r.c.name, { align: 'left', bold: true }), cell(r.year || '-'), cell(r.hh ? n(r.hh) : '-'), cell(r.up ? (r.dn ? `B${r.dn}/` : '') + r.up + 'F' : '-'), cell(m ? m.type + '㎡' : '-'), cell(m ? m.cnt : 0), cell(m ? n(m.med) : '-'), cell(m ? n(m.max) : '-'), cell(m ? n(m.min) : '-'), cell(m ? n(m.ppy) : '-', { bold: true, color: NAVY }), cell(r.ratio ? r.ratio.toFixed(2) : '1.32*', r.ratio ? {} : { color: WARN }), cell(m ? r.span + '년' : '-')]; });
    for (let i = 0; i < Math.max(sumRows.length, 1); i += 16) {
      sl = page(`대상 ${pick.length}개 단지 요약: 평당가 ${det.length ? n(Math.min(...det.map(r => sumOf(r).ppy))) + '~' + n(Math.max(...det.map(r => sumOf(r).ppy))) + '만원' : '거래 없음'}${i ? ' (계속)' : ''}`, 'COMPARABLE SET');
      tbl(sl, [sumHead].concat(sumRows.slice(i, i + 16)), LX, 1.4, LW, sumW, 9, 0.3);
      sl.addText('단위: 만원 · 주력 면적타입(거래가 가장 많은 전용면적) 기준 · 공급/전용 비율은 K-apt 단지 평균, *는 1.32 추정 · 세대수·층수는 K-apt 또는 건축물대장', { x: LX, y: 6.72, w: LW, h: 0.22, fontFace: F, fontSize: 8, color: MUTE, margin: 0, isTextBox: true });
    }

    // 단지별: 한 쪽에 한 단지 (왼쪽 표, 오른쪽 월별 추이)
    for (const r of det.slice(0, 20)) { const c = r.c, m = sumOf(r);
      sl = page(`${c.name}: 전용 ${m.type}㎡ 중위 ${n(m.med)}만원, 평당 ${n(m.ppy)}만원`, 'COMPLEX PROFILE');
      sl.addText([r.year ? `${r.year}년 준공` : '준공연도 미확인', r.hh ? n(r.hh) + '세대' : '', r.up ? (r.dn ? `지하${r.dn}/` : '') + `지상${r.up}층` : '', `${c.umd} ${c.jibun}`, `대상지에서 ${r.d < 1000 ? Math.round(r.d) + 'm' : (r.d / 1000).toFixed(1) + 'km'}`, `최근 ${r.span}년 거래 ${r.tr.length}건`, r.ratio ? `공급/전용 ${r.ratio.toFixed(2)} (K-apt)` : '공급/전용 1.32 (추정)'].filter(Boolean).join('  ·  '),
        { x: LX, y: 1.3, w: LW, h: 0.26, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true });
      const g = new Map(); for (const t of r.tr) { const kk = Math.round(t[1]); (g.get(kk) || g.set(kk, []).get(kk)).push(t); }
      const types = [...g.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5).sort((a, b) => a[0] - b[0]);
      sl.addText(`면적타입별 요약 (최근 ${r.span}년, 만원)`, { x: LX, y: 1.75, w: 7, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
      const st = [['전용', '공급(평)', '건수', '최고가', '최저가', '중위가', '평균가', '평당가'].map(TH)].concat(types.map(([kk, v]) => { const am = v.map(t => t[3]);
        return [cell(kk + '㎡'), cell(pyR(r, kk) + '평'), cell(v.length), cell(n(Math.max(...am))), cell(n(Math.min(...am))), cell(n(med(am)), { bold: true, color: NAVY }), cell(n(mean(am))), cell(n(med(v.map(t => ppy(r, t)))), { bold: true })]; }));
      tbl(sl, st, LX, 2.05, 7.0, [0.8, 0.85, 0.6, 0.95, 0.95, 0.95, 0.95, 0.95], 9, 0.29);
      const y1 = 2.05 + 0.29 * st.length + 0.28;
      sl.addText('최근 거래 5건', { x: LX, y: y1, w: 7, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
      const rc = [['계약일', '전용 (공급 평)', '층', '거래가(만원)', '평당가(만원)'].map(TH)].concat(r.tr.slice().sort((a, b) => b[0] - a[0]).slice(0, 5).map(t => [cell(ds(t[0])), cell(`${t[1]}㎡ (${pyR(r, t[1])}평)`), cell(t[2]), cell(n(t[3]), { bold: true }), cell(n(ppy(r, t)))]));
      tbl(sl, rc, LX, y1 + 0.3, 7.0, [1.2, 2.0, 0.8, 1.6, 1.4], 9, 0.29);
      const cm = ms.map(mm => { const v = r.all.filter(t => Math.floor(t[0] / 100) === mm); return v.length ? { lab: String(mm).slice(2, 4) + '.' + String(mm).slice(4), p: Math.round(med(v.map(t => ppy(r, t)))) } : null; }).filter(Boolean);
      sl.addText('월별 중위 평당가 (최근 2년, 만원)', { x: 7.9, y: 1.75, w: 4.9, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
      if (cm.length > 1) sl.addChart(pres.ChartType.line, [{ name: '중위 평당가', labels: cm.map(x => x.lab), values: cm.map(x => x.p) }], Object.assign(chartBase(), { x: 7.9, y: 2.05, w: 4.88, h: 4.75, chartColors: [ACC], lineSize: 2.25, lineDataSymbolSize: 6, catAxisLabelFontSize: 8 }));
      else sl.addText('추이를 그릴 만큼 거래가 없습니다.', { x: 7.9, y: 2.15, w: 4.8, h: 0.3, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true });
    }

    // 분양권·분양 사례
    const sv = [];
    for (const g of SILVG.values()) { if (!codes.has(g.code) && ![...codes].some(c => (LEGACY[c] || []).includes(g.code))) continue;
      const u0 = g.umd.split(' '); if (!(isEup ? u0[0] === d3 : u0[u0.length - 1] === d3 || g.umd === d3)) continue;
      const tr = g.trades.filter(t => t[0] >= cut2); if (tr.length) sv.push({ name: g.name, addr: g.umd + ' ' + g.jibun, tr }); }
    for (const r of rows) { const tr = (SILVC.get(r.c.id) || []).filter(t => t[0] >= cut2); if (tr.length) sv.push({ name: r.c.name, addr: r.c.umd + ' ' + r.c.jibun, tr }); }
    let sales = null, saleNote = '';
    try { const sido = SIDO_OF[code5.slice(0, 2)], from = String(cut2).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      sales = (await salesOf(sido)).filter(r0 => String(r0.RCRIT_PBLANC_DE || '') >= from && d2.split(' ').every(t => String(r0.HSSPLY_ADRES || '').includes(t))).sort((a, b) => String(b.RCRIT_PBLANC_DE).localeCompare(String(a.RCRIT_PBLANC_DE)));
      if (!sales.length) saleNote = ST.log && !SALES.has(sido) ? '청약홈 서버가 자료를 주지 않아 분양 사례를 넣지 못했습니다.' : '최근 2년 내 청약홈 공고가 없습니다.';
    } catch (e) { saleNote = '청약홈 분양정보를 조회하지 못했습니다.'; }
    // 분양 사례의 대표 주택형 분양가(청약홈 공급면적 기준 평당가)와 1순위 경쟁률
    const saleRows = [];
    for (const r0 of (sales || []).slice(0, 9)) { let top = '-', pp = '-', cr = '-';
      try { const [mdl, cmp] = (await (saleExtra(String(r0.HOUSE_MANAGE_NO)), SALEX.get(String(r0.HOUSE_MANAGE_NO))));
        if (Array.isArray(mdl) && mdl.length && mdl[0].LTTOT_TOP_AMOUNT !== undefined) { const m0 = mdl.slice().sort((a, b) => (+b.SUPLY_HSHLDCO || 0) - (+a.SUPLY_HSHLDCO || 0))[0], amt = +String(m0.LTTOT_TOP_AMOUNT).replace(/,/g, ''), su = parseFloat(m0.SUPLY_AR);
          if (amt) { top = `${String(m0.HOUSE_TY).replace(/^0+/, '').slice(0, 7)} ${n(amt)}`; if (su > 0) pp = n(amt / (su / PY)); } }
        if (Array.isArray(cmp) && cmp.length && cmp[0].REQ_CNT !== undefined) { const c1 = cmp.filter(x => String(x.SUBSCRPT_RANK_CODE) === '1'), req = c1.reduce((a, x) => a + (+String(x.REQ_CNT).replace(/,/g, '') || 0), 0), ty = new Map(); for (const x of c1) ty.set(x.HOUSE_TY, +x.SUPLY_HSHLDCO || 0);
          const sup = [...ty.values()].reduce((a, x) => a + x, 0); if (sup > 0) cr = (req / sup).toFixed(2) + ' : 1'; }
      } catch (e) {}
      saleRows.push([cell(r0.RCRIT_PBLANC_DE || '-'), cell(r0.HOUSE_NM || '', { align: 'left', bold: true }), cell(String(r0.HSSPLY_ADRES || '').replace(/^\S+(특별시|광역시|도)\s*/, '').trim(), { align: 'left' }), cell(n(+r0.TOT_SUPLY_HSHLDCO)), cell(r0.MVN_PREARNGE_YM || '-'), cell(top), cell(pp, { bold: true, color: NAVY }), cell(cr)]); }
    sl = page(`${d2} 최근 2년 분양 ${sales ? sales.length : 0}건 · ${d3} 분양권·입주권 거래 ${sv.reduce((a, g) => a + g.tr.length, 0)}건`, 'NEW SUPPLY & PRE-SALE RIGHTS');
    sl.addText('분양 사례 (청약홈, 대표 주택형 최고 분양가·평당가는 청약홈 공급면적 기준, 만원)', { x: LX, y: 1.4, w: LW, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
    let y = 1.7;
    if (saleRows.length) { tbl(sl, [['모집공고일', '단지명', '공급위치', '세대', '입주예정', '대표 주택형 분양가', '평당가', '1순위 경쟁률'].map(TH)].concat(saleRows), LX, y, LW, [1.05, 2.6, 3.3, 0.7, 0.85, 1.75, 0.9, 1.08], 8.5, 0.28); y += 0.28 * (saleRows.length + 1) + 0.3; }
    else { sl.addText(saleNote, { x: LX, y, w: LW, h: 0.28, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true }); y += 0.55; }
    sl.addText('분양권·입주권 실거래 (최근 2년, 만원)', { x: LX, y, w: LW, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true }); y += 0.3;
    if (sv.length) { const maxR = Math.max(1, Math.min(8, Math.floor((6.6 - y) / 0.28) - 1));
      tbl(sl, [['단지명', '소재지', '건수', '주력 전용', '중위가', '최고가', '최저가', '최근 거래'].map(TH)].concat(sv.sort((a, b) => b.tr.length - a.tr.length).slice(0, maxR).map(g => { const b = dominant(g.tr), am = b.v.map(t => t[3]);
        return [cell(g.name, { align: 'left', bold: true }), cell(g.addr, { align: 'left' }), cell(g.tr.length), cell(b.k + '㎡'), cell(n(med(am)), { bold: true, color: NAVY }), cell(n(Math.max(...am))), cell(n(Math.min(...am))), cell(ds(Math.max(...g.tr.map(t => t[0]))))]; })), LX, y, LW, [3.2, 2.5, 0.8, 1.1, 1.25, 1.25, 1.25, 0.88], 8.5, 0.28);
    } else sl.addText(X.err.length ? '분양권 자료를 조회하지 못했습니다: ' + X.err.join(' / ') : '최근 2년 내 분양권·입주권 거래가 없습니다.', { x: LX, y, w: LW, h: 0.28, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true });

    // 기준과 한계
    sl = page('이 자료의 기준과 한계', 'METHODOLOGY');
    sl.addText([`조사 범위는 대상지와 같은 ${isEup ? '읍·면' : '법정동'}(${d3})의 아파트 ${inDong.length}개 단지이며, 준공 5년 이내 → 10년 이내 → 전체 순으로 해당 단지가 있는 첫 구간만 넣었습니다 (이번 자료: ${tier}, ${pick.length}개).`,
      '실거래는 국토교통부 신고 자료이며 해제된 거래는 뺐습니다. 최근 두 달은 신고 기한(계약 후 30일) 때문에 건수가 더 늘 수 있습니다.',
      `평당가는 공급면적 기준입니다. 실거래 자료에는 전용면적만 있어, 기존 단지는 K-apt의 단지 평균 공급/전용 비율을 곱했고(같은 단지 안에서도 타입별로 2~3% 차이가 날 수 있음), 비율이 없는 ${estN}개 단지는 1.32로 추정했습니다. 분양 사례는 청약홈의 주택형별 공급면적을 썼습니다.`,
      noTr.length ? `최근 2년 거래가 없어 상세에서 뺀 단지: ${noTr.slice(0, 15).map(r => r.c.name).join(', ')}${noTr.length > 15 ? ' 외' : ''}` : '',
      det.length > 20 ? `단지별 상세는 20개까지만 넣었습니다 (전체 ${det.length}개는 요약표 참조).` : '',
      '분양 사례의 분양가는 주택형별 최고가입니다. 층별 분양가, 발코니 확장비, 중도금 조건은 모집공고문 분석이 필요합니다.',
      '인구·세대, 미분양, 인허가 등 통계와 적정 분양가 검토는 이 자료에 없습니다.'].filter(Boolean).map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      { x: LX, y: 1.5, w: LW, h: 5.2, fontFace: F, fontSize: 12, color: INK, margin: 0, valign: 'top', paraSpaceAfter: 10, isTextBox: true });

    await pres.writeFile({ fileName: `시장조사 기초자료_${d2.replace(/\s/g, '')}_${d3}_${today.replace(/\./g, '')}.pptx` });
    status(`기초자료 PPT를 만들었어요. (${d3} ${pick.length}개 단지, ${tier}${tierNote})`);
  } catch (e) { status('기초자료 PPT를 만들지 못했어요: ' + (e.message || e.msg || e), true); }
  btn.disabled = false; recompute();
}

/* ---------- 분양 분석 (모집공고 요약) ---------- */
// data/notices/index.json 에 올라온 단지를 지도에 표시하고, 누르면 요약과 PPT 내려받기를 보여 준다.
let NOTICES = [], NOV = [], noticeSel = null; const NJSON = new Map();
async function loadNotices() {
  try { NOTICES = await getJSON('data/notices/index.json'); } catch (e) { NOTICES = []; }
  await Promise.all(NOTICES.map(n => new Promise(res => {
    if (n.lat && n.lon) return res();
    geocoder.addressSearch(n.addr, (r, st) => { if (st === kakao.maps.services.Status.OK && r[0]) { n.lat = +r[0].y; n.lon = +r[0].x; } res(); }); })));
  renderNoticePins(); renderList(); renderSaleList();
}
function renderNoticePins() {
  NOV.forEach(o => o.setMap(null)); NOV = [];
  for (const n of NOTICES) { if (!n.lat) continue;
    const el = document.createElement('div'); el.className = 'pin npin' + (noticeSel === n.id ? ' sel' : '');
    el.innerHTML = `<small>분양 분석</small><b>${esc(n.name)}</b>`; el.title = n.name + ' 모집공고 요약';
    el.addEventListener('click', e => { e.stopPropagation(); openNotice(n.id, false); });
    const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(n.lat, n.lon), content: el, xAnchor: .12, yAnchor: 1, zIndex: 30, clickable: true });
    ov.setMap(map); NOV.push(ov); }
}
async function openNotice(id, pan) {
  const n = NOTICES.find(x => x.id === id); if (!n) return;
  noticeSel = id; S.sel = null; xsel = null; renderPins(); renderNoticePins(); renderExtraPins();
  if (pan && n.lat) { map.setLevel(5); map.panTo(new kakao.maps.LatLng(n.lat, n.lon)); }
  const el = $('#detail'); el.hidden = false; el.innerHTML = '<div class="note">요약 불러오는 중…</div>'; el.scrollIntoView({ block: 'nearest' });
  let d = NJSON.get(id);
  if (!d) { try { d = await getJSON(n.json); NJSON.set(id, d); } catch (e) { el.innerHTML = '<div class="note">요약을 불러오지 못했어요.</div>'; return; } }
  if (noticeSel !== id) return;
  const num = v => Number(v).toLocaleString('ko-KR'), kv = rows => '<table class="kvt">' + rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('') + '</table>';
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(d.name)}</h2><div class="ad">${esc(d.addr)} · 모집공고 ${esc(d.noticeDate)} · ${num(d.units)}세대 · 입주 ${esc(d.moveIn)}</div>`;
  h += `<a class="dl" href="${esc(d.file)}" download="${esc(d.name)} 모집공고 분석.pptx">분석 PPT 내려받기</a>`;
  h += `<div class="kv"><div><small>평균 평당가(확장 전)</small><b>${num(d.all.avgPy)}천원</b></div><div><small>확장 포함</small><b>${num(d.all.avgExtPy)}천원</b></div><div><small>평균 분양가</small><b>${eokFull(d.all.avg / 10)}</b></div></div>`;
  h += '<div class="sec">타입별 분양가 (천원, 세대수 가중평균)</div><table><tr><th>타입</th><th>세대</th><th>평균 분양가</th><th>평당가</th><th>확장비</th><th>확장 포함 평당</th></tr>' +
    d.price.map(p => `<tr><td>${esc(p.type)}<br><small style="color:var(--mute)">${p.py}평</small></td><td>${num(p.units)}</td><td>${num(p.avg)}</td><td>${num(p.avgPy)}</td><td>${num(p.ext)}</td><td><b>${num(p.avgExtPy)}</b></td></tr>`).join('') + '</table>';
  h += '<details><summary>층별 분양가 보기</summary><table><tr><th>타입·층</th><th>세대</th><th>분양가</th><th>평당가</th><th>확장 포함</th></tr>' +
    d.price.map(p => p.floors.map(f => `<tr><td>${esc(p.type)} ${esc(f.f)}</td><td>${num(f.n)}</td><td>${num(f.amt)}</td><td>${num(f.py)}</td><td>${num(f.amtExt)}</td></tr>`).join('')).join('') + '</table></details>';
  h += '<div class="sec">납부 조건</div>' + kv(d.pay.map(r => [r[0] + ' ' + r[1], r[2]]));
  h += '<div class="sec">공급 세대</div><table><tr><th>타입</th><th>전용㎡</th><th>총</th><th>특별</th><th>일반</th></tr>' + d.supply.map(x => `<tr><td>${esc(x.type)}</td><td>${x.ex.toFixed(2)}</td><td>${num(x.total)}</td><td>${num(x.special)}</td><td>${num(x.general)}</td></tr>`).join('') + '</table>';
  h += '<div class="sec">유상 옵션 (천원)</div>' + kv(d.options.map(r => [r[0] + ' · ' + r[1], r[2]]));
  h += '<div class="sec">사업개요</div>' + kv(d.overview) + '<div class="sec">청약·규제 조건</div>' + kv(d.rules);
  h += `<div class="sec">청약 일정</div><div class="note" style="white-space:pre-line">${esc(d.sched)}</div>`;
  h += '<div class="sec">확인 필요 사항</div><div class="note">' + d.todo.map(t => '· ' + esc(t)).join('<br>') + '</div>';
  h += `<div class="note">${esc(d.made)} · 입주자모집공고문에서 발췌·계산한 내용이며 [p.N]은 공고문 쪽수입니다. 참고용입니다.</div>`;
  h += '<div id="sx"></div>';
  el.innerHTML = h;
  $('#dx').onclick = () => { noticeSel = null; el.hidden = true; renderNoticePins(); };
  if (KEY) { const ex = await saleExtra(id); const sx = document.getElementById('sx'); if (sx && noticeSel === id) sx.innerHTML = ex; }
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
  loadBld(tok); loadExtras(tok);
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
  S.center = { lat, lon, label }; S.sel = null; if (!noticeSel) $('#detail').hidden = true; xsel = null; X.silv = []; renderExtraPins(); $('#maphint').style.display = 'none';
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
  if (S.tab === 'sale') { renderSaleList(); return; }
  const nl = '';
  if (!S.center) { el.innerHTML = '<div class="empty">주소를 검색하거나 지도를 클릭하면<br>반경 안의 단지와 시세가 여기에 나와요.</div>' + nl; return; }
  const n = S.list.length;
  let h = `<div class="lh"><b>${esc(S.center.label || '선택한 위치')}</b> 반경 ${S.rad >= 1000 ? S.rad / 1000 + 'km' : S.rad + 'm'} · 단지 ${n.toLocaleString('ko-KR')}개${n > 300 ? ' (가까운 300개 표시)' : ''}</div>`;
  if (!n) h += '<div class="empty">이 반경에 등록된 단지가 없어요.<br>반경을 넓혀 보세요.</div>';
  h += S.list.slice(0, 300).map(it => { const c = C[it.id], s = S.sum.get(it.id), inf = infoLine(c);
    const px = s ? `<div class="px"><b>${eok(s.val)}</b><small>${s.py}평 · ${s.cnt}건</small></div>` : (S.hasData ? '<div class="px"><small>거래 없음</small></div>' : '');
    return `<div class="item${S.sel === it.id ? ' sel' : ''}" data-id="${it.id}"><div class="n"><div class="nm">${esc(c.name)}</div><div class="ad">${esc(c.umd)} ${esc(c.jibun)} · ${it.d < 1000 ? Math.round(it.d) + 'm' : (it.d / 1000).toFixed(2) + 'km'}</div>${inf ? `<div class="inf">${inf}</div>` : ''}</div>${px}</div>`; }).join('');
  if (X.silv.length) h += `<div class="lh"><b>분양권·입주권 거래 단지</b> ${X.silv.length}곳 (입주 전)</div>` + X.silv.map(g => { const b = silvBest(g.trades); return `<div class="item" data-vid="${esc(g.key)}"><div class="n"><div class="nm">${esc(g.name)}</div><div class="ad">${esc(g.addr)} · ${Math.round(g.d)}m</div></div><div class="px"><b>${eok(b.val)}</b><small>${b.py}평 · ${b.n}건</small></div></div>`; }).join('');
  el.innerHTML = h + nl;
}
function select(id, pan) {
  if (noticeSel) { noticeSel = null; renderNoticePins(); }
  if (xsel) { xsel = null; renderExtraPins(); }
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
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(c.name)}</h2><div class="ad">${esc(c.sido)} ${esc(c.gu)} ${esc(c.umd)} ${esc(c.jibun)}${infoLine(c) ? '<br>' + infoLine(c) : ''}</div>`;
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
  const sv = (SILVC.get(S.sel) || []).filter(t => t[0] >= cut);
  if (sv.length) h += `<div class="sec">분양권·입주권 실거래 (${sv.length}건)</div>` + silvTable(sv);
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
  const tabs = document.createElement('div'); tabs.className = 'tabs';
  tabs.innerHTML = '<button data-tab="trade" class="on">실거래 (매매·분양권·입주권)</button><button data-tab="sale">분양정보 (청약홈·분석)</button>';
  $('.sbox').before(tabs); tabs.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  $('#band').innerHTML = BANDS.map(b => `<option value="${b.k}">${b.t}</option>`).join('');
  $('#rad').onchange = () => { S.rad = +$('#rad').value; if (circle) circle.setRadius(S.rad); refresh(true); };
  $('#mon').onchange = () => { S.months = +$('#mon').value; if (S.center) refresh(false); };
  $('#band').onchange = () => { S.band = $('#band').value; S.dtype = null; recompute(); };
  $('#metric').onchange = () => { S.metric = $('#metric').value; recompute(); };
  $('#sort').onchange = () => { S.sort = $('#sort').value; recompute(); };
  $('#go').onclick = () => doSearch(true);
  const rb = document.createElement('button'); rb.id = 'rpt'; rb.textContent = '이 위치의 동 기준 시장조사 기초자료 PPT 만들기'; rb.style.cssText = 'grid-column:1/-1;padding:7px'; $('.ctrl').appendChild(rb); rb.onclick = makeReport;
  $('#q').addEventListener('input', () => { clearTimeout(deb); const q = $('#q').value.trim(); if (q.length < 2) { $('#sug').style.display = 'none'; return; } deb = setTimeout(() => doSearch(false), 300); });
  $('#q').addEventListener('keydown', e => { const n = sugItems.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); sugOn = Math.min(n - 1, sugOn + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sugOn = Math.max(0, sugOn - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sugOn >= 0 && n) choose(sugOn); else doSearch(true); return; }
    else if (e.key === 'Escape') { $('#sug').style.display = 'none'; return; } else return;
    [...$('#sug').children].forEach((d, k) => d.classList.toggle('on', k === sugOn)); });
  $('#sug').addEventListener('mousedown', e => { const d = e.target.closest('[data-k]'); if (d) { e.preventDefault(); choose(+d.dataset.k); } });
  $('#q').addEventListener('blur', () => setTimeout(() => { $('#sug').style.display = 'none'; }, 150));
  $('#list').addEventListener('click', e => { const d = e.target.closest('.item'); if (!d) return; if (d.dataset.nid) openNotice(d.dataset.nid, true); else if (d.dataset.sid) openSale(d.dataset.sid); else if (d.dataset.vid) openSilv(d.dataset.vid); else select(+d.dataset.id, true); });
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
    S.hasData = true; apiIdx = 0; apiLocked = false; bldErr = null; kaptErr = null; renderKey(); if (S.tab === 'sale') loadSaleTab(); if (S.center) refresh(false); else status('주소를 검색하면 시세가 표시돼요.'); };
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
  loadNotices();
  kakao.maps.event.addListener(map, 'click', ev => { const ll = ev.latLng, lat = ll.getLat(), lon = ll.getLng();
    setCenter(lat, lon, '지도에서 선택한 위치', { keepView: true });
    geocoder.coord2Address(lon, lat, (r, st) => { if (st === kakao.maps.services.Status.OK && r[0]) {
      const a = (r[0].address && r[0].address.address_name) || ''; if (a && S.center && S.center.lat === lat) { S.center.label = a; renderList(); } } }); });
  if (!S.hasData) status('아래에 국토부 인증키를 입력하면 시세가 표시돼요.');
}
init();
})();
