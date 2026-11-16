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
async function ensureTrades(codes) {
  S.liveErr = null; if (!KEY) return;
  const seen = new Set(), jobs = [], ms = monthList(S.months);
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
let BLD = {}; try { BLD = JSON.parse(localStorage.getItem('bld_v3') || '{}') || {}; } catch (e) {}
const BY = new Map(); let bldSaveT = 0, bldErr = null;
const bkey = c => c.code + '|' + c.umd + '|' + c.jibun;
function bldSave() { clearTimeout(bldSaveT); bldSaveT = setTimeout(() => { try { localStorage.setItem('bld_v3', JSON.stringify(BLD)); } catch (e) {} }, 800); }
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
  return [hh, +(String(o.kaptUsedate || '').slice(0, 4)) || 0, parseInt(o.kaptTopFloor, 10) || 0, parseInt(o.kaptBaseFloor, 10) || 0, parseInt(o.kaptDongCnt, 10) || 0, 'K'];
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
async function ensureSilv(codes) {
  const seen = new Set(), jobs = [];
  for (const c of codes) for (const f of [c].concat(LEGACY[c] || [])) for (const ym of monthList(S.months)) { const k = f + '|' + ym; if (!SDONE.has(k) && !seen.has(k)) { seen.add(k); jobs.push([f, ym]); } }
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
      ST.log = log.join(' / '); if (last && log.every(x => x.includes('오류'))) throw last; return [];
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
  if (NOTICES.length) h += '<div class="lh"><b>분양 분석</b> 모집공고 요약·PPT ' + NOTICES.length + '건</div>' + NOTICES.map(n => `<div class="item nitem" data-nid="${esc(n.id)}"><div class="n"><div class="nm">${esc(n.name)}</div><div class="ad">${esc(n.addr)} · 공고 ${esc(n.noticeDate)}</div></div><div class="px"><small>요약·PPT</small></div></div>`).join('');
  h += '<div class="lh"><b>청약홈 분양정보</b> ';
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
    if (!ST.rows.length && ST.log) h += `<div class="status err" style="margin:10px 14px">청약홈 조회 결과가 0건이에요. 진단: ${esc(ST.log)} — 이 문구를 그대로 알려 주세요.</div>`;
    h += rows.slice(0, 200).map(r => { const id = String(r.HOUSE_MANAGE_NO), an = NOTICES.some(n => n.id === id);
      return `<div class="item${xsel === 's' + id ? ' sel' : ''}" data-sid="${esc(id)}"><div class="n"><div class="nm">${esc(r.HOUSE_NM || '(이름 없음)')}</div><div class="ad">${esc(r.HSSPLY_ADRES || '')}</div><div class="inf">공고 ${esc(r.RCRIT_PBLANC_DE || '-')} · ${esc(r.TOT_SUPLY_HSHLDCO == null ? '-' : r.TOT_SUPLY_HSHLDCO)}세대${r.MVN_PREARNGE_YM ? ' · 입주 ' + esc(r.MVN_PREARNGE_YM) : ''}</div></div><div class="px"><small>${an ? '분석 요약 있음' : '경쟁률'}</small></div></div>`; }).join('');
    if (rows.length > 200) h += '<div class="lh">최근 200건만 표시했어요. 시군구나 단지명으로 좁혀 보세요.</div>';
  }
  el.innerHTML = h;
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
  h += '<div class="note">층별 분양가·발코니 확장비·중도금 조건은 모집공고문 분석이 필요해요. 공고문을 Claude에게 보내면 요약과 PPT로 만들어 여기에 올릴 수 있어요.</div>';
  el.innerHTML = h; $('#dx').onclick = () => { xsel = null; salePin = null; el.hidden = true; renderExtraPins(); renderSaleList(); };
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
