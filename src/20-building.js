// 건축물대장·K-apt(세대수·준공연도·층수)와 단지별 시세 요약
/* ---------- 건축물대장 표제부: 세대수·사용승인연도·층수 ---------- */
// 단지 지번으로 조회하고, 결과는 바뀌지 않는 값이라 이 브라우저에 저장해 다시 조회하지 않는다.
const BLD_API = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
const BLD = {}; // 지번 키 -> [세대수, 준공연도, 지상층, 지하층, 동수, 출처, 공급/전용 비율] | 0(못 찾음)
const BLDC = kvCache('bld', BLD, v => (v ? 180 : 30) * DAY, 30000); // 찾은 값은 180일, 못 찾은 지번은 30일 뒤 다시 조회
const BY = new Map();
let bldErr = null;
const bkey = c => c.code + '|' + c.umd + '|' + c.jibun;
function regionCode(c) {
  return new Promise(res =>
    geocoder.coord2RegionCode(c.lon, c.lat, (r, st) => {
      if (st !== kakao.maps.services.Status.OK) return res(null);
      const b = r.find(x => x.region_type === 'B');
      res(b && b.code ? String(b.code) : null);
    }),
  );
}
// --- K-apt(공동주택관리정보시스템): 단지 단위 세대수·동수·최고층·지하층. 있으면 이쪽을 우선한다. ---
// 서비스 버전이 계정·시기에 따라 달라 후보를 차례로 시도하고, 성공한 주소를 기억한다.
const KAPT_LIST = { urls: ['AptListService3/getLegaldongAptList3', 'AptListService4/getLegaldongAptList4', 'AptListService2/getLegaldongAptList'] };
const KAPT_BASE = {
  urls: ['AptBasisInfoServiceV4/getAphusBassInfoV4', 'AptBasisInfoServiceV5/getAphusBassInfoV5', 'AptBasisInfoServiceV3/getAphusBassInfoV3'],
};
const KLIST = new Map();
let kaptErr = null;
function parseAny(text) {
  // JSON·XML 어느 쪽으로 와도 [{필드:값}] 로 바꾼다
  const t = text.trim();
  if (t[0] === '{') {
    const j = JSON.parse(t),
      r = j.response || j,
      h = r.header || {},
      b = r.body || {};
    if (h.resultCode && h.resultCode !== '00' && h.resultCode !== '000') throw { kind: 'api', msg: h.resultCode + ' ' + (h.resultMsg || '') };
    let it = b.items && b.items.item !== undefined ? b.items.item : b.items !== undefined ? b.items : b.item;
    if (!it) it = [];
    if (!Array.isArray(it)) it = [it];
    return { items: it.filter(x => x && typeof x === 'object'), total: +b.totalCount || it.length };
  }
  const doc = new DOMParser().parseFromString(t, 'text/xml');
  const g = n => {
    const e = doc.getElementsByTagName(n)[0];
    return e ? e.textContent.trim() : '';
  };
  if (doc.getElementsByTagName('parsererror').length) throw { kind: 'api', msg: t.slice(0, 80) };
  if (doc.documentElement.nodeName.indexOf('OpenAPI') === 0 || g('returnAuthMsg')) throw { kind: 'key', msg: g('returnAuthMsg') || g('errMsg') };
  const rc = g('resultCode');
  if (rc && rc !== '00' && rc !== '000') throw { kind: 'api', msg: rc + ' ' + g('resultMsg') };
  const items = [...doc.getElementsByTagName('item')].map(it => {
    const o = {};
    for (const ch of it.children) o[ch.nodeName] = ch.textContent.trim();
    return o;
  });
  return { items, total: +g('totalCount') || items.length };
}
async function callAny(group, params) {
  const order = group.ok != null ? [group.ok] : group.urls.map((_, i) => i);
  let last;
  for (const i of order) {
    try {
      const out = await apiPage('https://apis.data.go.kr/1613000/' + group.urls[i], params, 'ServiceKey');
      group.ok = i;
      return out;
    } catch (e) {
      last = e;
      last.url = group.urls[i];
    }
  }
  throw last;
}
function kaptList(bjd) {
  if (!KLIST.has(bjd))
    KLIST.set(
      bjd,
      (async () => {
        const all = [];
        for (let page = 1; page <= 5; page++) {
          const r = await callAny(KAPT_LIST, { bjdCode: bjd, pageNo: page, numOfRows: 200 });
          all.push(...r.items);
          if (page * 200 >= r.total || !r.items.length) break;
        }
        return all.map(x => ({ code: x.kaptCode, n: nn(x.kaptName) })).filter(x => x.code);
      })(),
    );
  return KLIST.get(bjd);
}
async function fetchKapt(c, rc) {
  let list;
  try {
    list = await kaptList(rc);
  } catch (e) {
    KLIST.delete(rc);
    throw e;
  }
  let cand = list.filter(x => x.n === c.nn);
  if (!cand.length && c.nn) cand = list.filter(x => x.n && (x.n.includes(c.nn) || c.nn.includes(x.n)));
  if (cand.length !== 1) return null;
  const r = await callAny(KAPT_BASE, { kaptCode: cand[0].code }),
    o = r.items[0];
  if (!o) return null;
  const hh = parseInt(o.kaptdaCnt, 10) || 0;
  if (!hh) return null;
  const ma = parseFloat(o.kaptMarea),
    pa = parseFloat(o.privArea),
    ratio = ma > 0 && pa > 0 && ma / pa >= 1.15 && ma / pa <= 1.6 ? Math.round((ma / pa) * 1000) / 1000 : 0;
  return [
    hh,
    +String(o.kaptUsedate || '').slice(0, 4) || 0,
    parseInt(o.kaptTopFloor, 10) || 0,
    parseInt(o.kaptBaseFloor, 10) || 0,
    parseInt(o.kaptDongCnt, 10) || 0,
    'K',
    ratio,
  ];
}
async function fetchBld(c) {
  const rc = await regionCode(c);
  if (!rc || rc.length < 10) return 0;
  if (!kaptErr) {
    try {
      const k = await fetchKapt(c, rc);
      if (k) return k;
    } catch (e) {
      kaptErr = e;
    }
  }
  return fetchLedger(c, rc);
}
async function fetchLedger(c, rc, purp) {
  const m = c.jibun.match(/^(산)?(\d+)(?:-(\d+))?$/);
  if (!m) return 0;
  const rows = [];
  for (let page = 1; page <= 4; page++) {
    const out = await apiPage(BLD_API, {
      sigunguCd: rc.slice(0, 5),
      bjdongCd: rc.slice(5, 10),
      platGbCd: m[1] ? '1' : '0',
      bun: m[2].padStart(4, '0'),
      ji: (m[3] || '0').padStart(4, '0'),
      numOfRows: 100,
      pageNo: page,
    });
    for (const o of out.items) {
      const v = k => String(o[k] == null ? '' : o[k]).trim();
      rows.push({
        main: v('mainAtchGbCd') !== '1',
        pu: v('mainPurpsCdNm') + ' ' + v('etcPurps'),
        hh: (purp ? +v('hoCnt') || +v('hhldCnt') : +v('hhldCnt') || +v('hoCnt')) || 0,
        up: +v('grndFlrCnt') || 0,
        dn: +v('ugrndFlrCnt') || 0,
        y: +v('useAprDay').slice(0, 4) || 0,
      });
    }
    if (page * 100 >= out.total || !out.items.length) break;
  }
  let use = rows.filter(x => x.main && x.hh > 0);
  if (!use.length) use = rows.filter(x => x.main);
  if (!use.length) return 0;
  if (purp) {
    const pr = use.filter(x => x.pu.includes(purp) || x.pu.includes('오피스텔'));
    if (pr.length) use = pr;
  } // 오피스텔: 같은 지번의 아파트·상가 동은 빼고 업무시설(오피스텔) 동만 합산
  const ys = use.map(x => x.y).filter(y => y > 1900);
  return [
    use.reduce((a, x) => a + x.hh, 0),
    ys.length ? Math.min(...ys) : 0,
    Math.max(...use.map(x => x.up)),
    Math.max(...rows.map(x => x.dn)),
    use.filter(x => x.hh > 0).length,
  ]; // 지하층은 지하주차장 등 세대 없는 동·부속건축물까지 포함해 최댓값
}
async function loadBld(tok) {
  if (!KEY || bldErr || !geocoder) return;
  const todo = S.list
    .slice(0, 80)
    .map(i => C[i.id])
    .filter(c => BLD[bkey(c)] === undefined);
  if (!todo.length) return;
  let k = 0,
    last = 0;
  const worker = async () => {
    while (k < todo.length && tok === S.token && !bldErr) {
      const c = todo[k++];
      try {
        BLDC.put(bkey(c), await fetchBld(c));
      } catch (e) {
        if (e.kind === 'key' || e.kind === 'net') bldErr = e;
      }
      if (tok === S.token && Date.now() - last > 500) {
        last = Date.now();
        renderList();
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (tok !== S.token) return;
  renderList();
  if (S.sel != null) renderDetail();
  if (bldErr && !S.liveErr)
    status(
      bldErr.kind === 'key'
        ? '세대수·층수(건축물대장) 조회가 거절됐어요 (' +
            (bldErr.msg || '') +
            '). 활용신청 승인이 아직 반영되지 않았을 수 있어요. 잠시 뒤 새로고침해 보세요.'
        : '세대수·층수(건축물대장) API에 접속하지 못했어요. 이 문구를 그대로 알려 주세요.',
      true,
    );
}
function infoLine(c) {
  const b = BLD[bkey(c)],
    parts = [],
    y = (b && b[1]) || BY.get(c.id);
  if (b && b[0]) parts.push(b[0].toLocaleString('ko-KR') + '세대' + (b[4] > 1 ? `(${b[4]}개동)` : ''));
  const src = b
    ? b[5] === 'K'
      ? ''
      : ' <span class="src" title="K-apt에 없어 건축물대장 기준으로 표시. 지하층·세대수가 일부만 잡힐 수 있어요.">대장</span>'
    : '';
  if (y) parts.push(y + '년');
  if (b && b[2]) parts.push((b[3] ? `지하${b[3]}/` : '') + `지상${b[2]}층`);
  return parts.length ? parts.join(' · ') + src : '';
}
function dominant(arr, fl) {
  // 거래가 가장 많은 전용면적 타입 (fl: 소수점 버림으로 묶음, 84.97㎡→84)
  const g = new Map();
  for (const t of arr) {
    const k = fl ? Math.floor(t[1] + 1e-6) : Math.round(t[1]);
    (g.get(k) || g.set(k, []).get(k)).push(t);
  }
  let best = null;
  for (const [k, v] of g) {
    const mx = Math.max(...v.map(t => t[0]));
    if (!best || v.length > best.v.length || (v.length === best.v.length && mx > best.mx)) best = { k, v, mx };
  }
  return best;
}
function summarize(id) {
  const cut = cutoff(),
    b = bandOf();
  const arr = tradesOf(id).filter(t => t[0] >= cut && t[1] >= b.a && t[1] < b.b);
  if (!arr.length) return null;
  const best = dominant(arr),
    latest = best.v.reduce((x, y) => (y[0] > x[0] ? y : x));
  const m = med(best.v.map(t => t[3]));
  return { n: arr.length, type: best.k, py: pyeong(best.k), cnt: best.v.length, latest, med: m, val: S.metric === 'latest' ? latest[3] : m };
}
