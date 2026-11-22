// 아파트 단지 목록(complexes.json)과 국토부 아파트 매매 실거래 조회·단지 매칭
/* ---------- 데이터 ---------- */
// 실거래는 사이트를 연 브라우저가 국토교통부 API를 직접 조회한다. 인증키는 이 브라우저(localStorage)에만 저장한다.
const API_LIST = [
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
];
let apiIdx = 0,
  apiLocked = false;
// 2026년 개편으로 신설된 구는 개편 전 거래가 예전 시군구 코드에 남아 있을 수 있어 함께 조회한다.
const LEGACY = {
  41591: ['41590'],
  41593: ['41590'],
  41595: ['41590'],
  41597: ['41590'],
  28125: ['28110', '28140'],
  28155: ['28110'],
  28275: ['28260'],
  28290: ['28260'],
};
const LIVE = new Map(),
  DONE = new Set(),
  IDX1 = new Map(),
  IDX2 = new Map(),
  UNM = [], // UNM: 단지 목록에 매칭되지 않아 버려진 실거래
  STATIC = new Set(), // 정적 단지 목록(수도권)에 있는 시군구 코드
  DYN = new Set(); // 실거래로 단지 목록을 새로 만든 시군구 코드(광역시)
let KEY = '';
try {
  KEY = localStorage.getItem('molit_key') || '';
} catch (e) {}
const nn = s =>
  String(s || '')
    .replace(/\(.*?\)/g, '')
    .replace(/[\s·\-_.,/]/g, '')
    .toLowerCase()
    .replace(/아파트/g, '');
const push = (m, k, v) => {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
};
async function loadComplexes() {
  const d = await getJSON('data/complexes.json');
  C = d.R.map((r, i) => {
    const p = d.L[r[0]].split('|');
    return { id: i, sido: p[0], gu: p[1], umd: p[2], code: p[3], name: r[1], jibun: r[2], lat: r[3], lon: r[4] };
  });
  for (const c of C) {
    STATIC.add(c.code);
    addIndex(c);
  }
  S.asOf = new Date();
  S.hasData = !!KEY;
}
function addIndex(c) {
  const last = c.umd.split(' ').pop();
  c.nn = nn(c.name);
  const names = [...new Set([last, c.umd, c.umd.split(' ')[0]])];
  for (const f of [c.code].concat(LEGACY[c.code] || []))
    for (const u of names) {
      push(IDX1, f + '|' + u + '|' + c.jibun, c.id);
      push(IDX2, f + '|' + u + '|' + c.nn, c.id);
    }
}
function matchRow(f, umd, jibun, name) {
  const n = nn(name),
    u2 = String(umd).split(' ').pop();
  let cand = IDX1.get(f + '|' + umd + '|' + jibun) || IDX1.get(f + '|' + u2 + '|' + jibun);
  if (cand) {
    if (cand.length === 1) return cand[0];
    const ex = cand.filter(i => C[i].nn === n);
    if (ex.length) return ex[0];
    const pt = n ? cand.filter(i => C[i].nn && (C[i].nn.includes(n) || n.includes(C[i].nn))) : [];
    return pt.length === 1 ? pt[0] : null;
  }
  cand = IDX2.get(f + '|' + umd + '|' + n) || IDX2.get(f + '|' + u2 + '|' + n);
  return cand && cand.length === 1 ? cand[0] : null;
}
function monthList(n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const d = new Date(S.asOf.getFullYear(), S.asOf.getMonth() - k, 1);
    out.push(String(d.getFullYear() * 100 + d.getMonth() + 1));
  }
  return out;
}
async function fetchPage(idx, f, ym, page) {
  let key = KEY;
  try {
    key = decodeURIComponent(KEY);
  } catch (e) {}
  const u = API_LIST[idx] + '?' + new URLSearchParams({ serviceKey: key, LAWD_CD: f, DEAL_YMD: ym, pageNo: page, numOfRows: 1000 });
  let r;
  try {
    r = await fetch(u);
  } catch (e) {
    throw { kind: 'net' };
  }
  if (r.status === 401 || r.status === 403) throw { kind: 'key', msg: 'HTTP ' + r.status };
  if (!r.ok) throw { kind: 'api', msg: 'HTTP ' + r.status };
  const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
  const g = t => {
    const e = doc.getElementsByTagName(t)[0];
    return e ? e.textContent.trim() : '';
  };
  if (doc.documentElement.nodeName.indexOf('OpenAPI') === 0 || g('returnAuthMsg')) throw { kind: 'key', msg: g('returnAuthMsg') || g('errMsg') };
  const rc = g('resultCode');
  if (rc && rc !== '00' && rc !== '000') throw { kind: 'api', msg: rc + ' ' + g('resultMsg') };
  return { total: +g('totalCount') || 0, items: [...doc.getElementsByTagName('item')] };
}
async function aptRows(f, ym) {
  // 한 달치 → [읍면동, 지번, 단지명, 계약일, 전용㎡, 층, 만원, 건축년도] (해제 거래 제외)
  let page = 1;
  const rows = [];
  for (;;) {
    const used = apiIdx;
    let res;
    try {
      res = await fetchPage(used, f, ym, page);
    } catch (e) {
      if (e.kind === 'key' && !apiLocked) {
        if (used === apiIdx && apiIdx + 1 < API_LIST.length) {
          apiIdx++;
          continue;
        }
        if (used !== apiIdx) continue;
      }
      throw e;
    }
    apiLocked = true;
    for (const it of res.items) {
      const v = t => {
        const e = it.getElementsByTagName(t)[0];
        return e ? e.textContent.trim() : '';
      };
      if (v('cdealType').toUpperCase() === 'O' || v('cdealDay')) continue;
      const amt = parseInt(v('dealAmount').replace(/,/g, ''), 10),
        area = Math.round(parseFloat(v('excluUseAr')) * 100) / 100;
      const ymd = +v('dealYear') * 10000 + +v('dealMonth') * 100 + +v('dealDay');
      if (!amt || !area || !ymd) continue;
      rows.push([v('umdNm'), v('jibun'), v('aptNm'), ymd, area, parseInt(v('floor'), 10) || 0, amt, +v('buildYear') || 0]);
    }
    if (page * 1000 >= res.total || !res.items.length) break;
    page++;
  }
  return rows;
}
async function fetchMonth(f, ym) {
  const rows = await cachedMonth('apt', f, ym, () => aptRows(f, ym)),
    got = [];
  for (const [umd, jibun, name, ymd, area, floor, amt, by] of rows) {
    const id = matchRow(f, umd, jibun, name);
    if (id == null) {
      UNM.push({ f, ym, umd, jibun, name });
      continue;
    }
    if (by) BY.set(id, by);
    got.push([id, [ymd, area, floor, amt]]);
  }
  for (const [id, t] of got) push(LIVE, id, t);
  DONE.add(f + '|' + ym);
}
async function ensureTrades(codes, months) {
  S.liveErr = null;
  if (!KEY) return;
  const seen = new Set(),
    jobs = [],
    ms = monthList(months || S.months);
  for (const c of codes)
    for (const f of [c].concat(LEGACY[c] || []))
      for (const ym of ms) {
        const k = f + '|' + ym;
        if (!DONE.has(k) && !seen.has(k)) {
          seen.add(k);
          jobs.push([f, ym]);
        }
      }
  let k = 0,
    done = 0;
  const tot = jobs.length;
  const worker = async () => {
    while (k < jobs.length && !S.liveErr) {
      const j = jobs[k++];
      try {
        await fetchMonth(j[0], j[1]);
      } catch (e) {
        S.liveErr = e;
      }
      done++;
      if (!S.liveErr) status(`실거래 조회 중… ${done}/${tot}`);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
}
function liveErrText(e) {
  if (e.kind === 'net')
    return '브라우저에서 국토부 API에 접속하지 못했어요. 브라우저 보안 정책(CORS)이나 사내 네트워크 차단일 수 있어요. 이 문구를 그대로 알려 주세요.';
  if (e.kind === 'key')
    return '인증키 오류예요 (' + (e.msg || '') + '). 키가 맞는지, 공공데이터포털에서 아파트 매매 실거래가 활용신청이 승인됐는지 확인하세요.';
  if (/429/.test(e.msg || ''))
    return '국토부 API가 요청이 너무 많다며 거절했어요 (HTTP 429). 잠시 뒤 다시 검색해 보세요. 계속되면 오늘 호출 한도를 넘은 것일 수 있어요.';
  return '실거래 조회 오류: ' + (e.msg || '알 수 없음');
}
const tradesOf = id => LIVE.get(id) || [];
