// 분양권 자료 상수, 주소→좌표 변환, 입지환경(카카오 장소 검색)
/* ---------- 분양권·입주권 실거래 + 청약홈 분양정보·경쟁률 ---------- */
const SILV_API = 'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';
const OD = 'https://api.odcloud.kr/api/';
const SIDO_OF = { 11: '서울', 41: '경기', 28: '인천' };
const SILVC = new Map(),
  SILVG = new Map(),
  SDONE = new Set(),
  SALES = new Map(),
  SALEX = new Map();
const GEO = {}; // 주소(또는 sale|주소|단지명) -> [위도, 경도(, 개략 여부)]
const GEOC = kvCache('geo', GEO, () => 180 * DAY, 30000);
let XOV = [],
  xsel = null;
const X = { silv: [], err: [] };
function geocodeAddr(addr) {
  if (GEO[addr]) return Promise.resolve(GEO[addr]);
  return new Promise(res =>
    geocoder.addressSearch(addr, (r, st) => {
      const v = st === kakao.maps.services.Status.OK && r[0] ? [+r[0].y, +r[0].x] : null;
      if (v) GEOC.put(addr, v);
      res(v);
    }),
  );
}
async function geocodeLoose(addr) {
  // 공급위치가 '지구명 블록(경기도 ○○시 ○○동 646-2 일원)'처럼 괄호 안에 지번 주소가 있으면 그 주소부터 찾는다
  const inner = (String(addr || '').match(/\(([^()]*(?:시|군|구)\s[^()]*\d[^()]*)\)/) || [])[1];
  if (inner) {
    const v = await geocodeLoose(inner);
    if (v) return v;
  }
  const a = String(addr || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/(일원|일대|번지|외\s*\d+\s*필지).*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const toks = a.split(' ');
  for (let k = 0; k < 3 && toks.length >= 3; k++) {
    const v = await geocodeAddr(toks.join(' '));
    if (v) return v;
    toks.pop();
  }
  return null;
}
// 분양 단지 위치: 주소 → 단지명 → 지구명 → 동 순으로 찾는다. 공공택지('○○지구 내 A-6블록')나 주소가 어긋난 공고는 주소만으로 못 찾는다.
// 반환 [lat, lon, approx]: approx=true면 지구·동 중심 정도의 개략 위치.
function kwSearch(q, cityTok) {
  return new Promise(res => {
    if (!places) return res(null);
    places.keywordSearch(q, (r, st) => {
      if (st !== kakao.maps.services.Status.OK) return res(null);
      const h = r.find(x => !cityTok || String(x.address_name || '').includes(cityTok));
      res(h ? [+h.y, +h.x] : null);
    });
  });
}
// 입지환경: 카카오 로컬 검색으로 대상지 주변 시설까지의 거리·개수를 모은다 (직선거리 기준)
function kakaoNear(kind, c, radius, filt) {
  return new Promise(res => {
    if (!places || !window.kakao) return res(null);
    const S0 = kakao.maps.services,
      items = [];
    let fin = false;
    const end = v => {
      if (!fin) {
        fin = true;
        res(v);
      }
    };
    setTimeout(() => end(null), 9000);
    const cb = (r, st, pg) => {
      if (st === S0.Status.OK) {
        items.push(...r);
        if (pg.hasNextPage && pg.current < 3) pg.nextPage();
        else end({ total: pg.totalCount, items: filt ? items.filter(filt) : items });
      } else end(st === S0.Status.ZERO_RESULT ? { total: 0, items: [] } : null);
    };
    const opt = { location: new kakao.maps.LatLng(c.lat, c.lon), radius, sort: S0.SortBy.DISTANCE };
    try {
      if (kind.cat) places.categorySearch(kind.cat, cb, opt);
      else places.keywordSearch(kind.kw, cb, opt);
    } catch (e) {
      end(null);
    }
  });
}
async function locEnv(c) {
  const cn = x => String(x.category_name || ''),
    sch = re => x => re.test(cn(x)) && !/학원|교습|어린이집/.test(cn(x));
  const [sub, el, mi, hi, aca, kid, mart, dept, hosp, park] = await Promise.all([
    kakaoNear({ cat: 'SW8' }, c, 2000),
    kakaoNear({ kw: '초등학교' }, c, 1500, sch(/초등학교/)),
    kakaoNear({ kw: '중학교' }, c, 2000, sch(/중학교/)),
    kakaoNear({ kw: '고등학교' }, c, 3000, sch(/고등학교/)),
    kakaoNear({ cat: 'AC5' }, c, 1000),
    kakaoNear({ cat: 'PS3' }, c, 500),
    kakaoNear({ cat: 'MT1' }, c, 3000, x => /대형마트/.test(cn(x))),
    kakaoNear(
      { kw: '백화점' },
      c,
      5000,
      x => /백화점/.test(cn(x)) && !/혼수|이불|침구|커튼|커텐|의류|아울렛|매장\s*$/.test(String(x.place_name || '')),
    ),
    kakaoNear({ kw: '종합병원' }, c, 5000, x => /종합병원/.test(cn(x))),
    kakaoNear({ kw: '공원' }, c, 1500, x => /공원/.test(cn(x)) && !/주차/.test(cn(x))),
  ]);
  return { sub, el, mi, hi, aca, kid, mart, dept, hosp, park };
}
const walkMin = d => Math.max(1, Math.round(d / 80)),
  dm = d => (d < 1000 ? Math.round(d) + 'm' : (d / 1000).toFixed(1) + 'km');
function envRows(env) {
  // [구분, 시설, 이름, 거리, 도보] 목록과 제목 문장을 만든다
  const nearest = (r, k, grp, lab, rad) => {
    const arr = r ? r.items.slice(0, k) : null;
    if (!arr) return [[grp, lab, '조회하지 못함', '-', '-']];
    if (!arr.length) return [[grp, lab, `반경 ${dm(rad)} 안에 없음`, '-', '-']];
    return arr.map((x, i) => [i ? '' : grp, i ? '' : lab, String(x.place_name).slice(0, 18), dm(+x.distance), walkMin(+x.distance) + '분']);
  };
  const count = (r, grp, lab, rad, unit) => [
    [grp, lab, r ? `반경 ${dm(rad)} 안 ${r.total >= 45 ? '45' : r.total}${unit}${r.total >= 45 ? ' 이상' : ''}` : '조회하지 못함', '', ''],
  ];
  const L = [].concat(
    nearest(env.sub, 3, '교통', '지하철역', 2000),
    nearest(env.el, 2, '교육', '초등학교', 1500),
    nearest(env.mi, 1, '', '중학교', 2000),
    nearest(env.hi, 1, '', '고등학교', 3000),
    count(env.aca, '', '학원', 1000, '곳'),
    count(env.kid, '', '어린이집·유치원', 500, '곳'),
  );
  const R = [].concat(
    nearest(env.mart, 2, '생활', '대형마트', 3000),
    nearest(env.dept, 1, '', '백화점', 5000),
    nearest(env.hosp, 1, '의료', '종합병원', 5000),
    nearest(env.park, 2, '여가', '공원', 1500),
  );
  const f = r => (r && r.items[0] ? r.items[0] : null),
    s1 = f(env.sub),
    e1 = f(env.el),
    m1 = f(env.mart);
  const head =
    s1 || e1 || m1
      ? [
          '가장 가까운 ' +
            (s1 ? `지하철역 ${String(s1.place_name).slice(0, 14)} ${dm(+s1.distance)}(도보 약 ${walkMin(+s1.distance)}분)` : '지하철역 2km 밖'),
          e1 ? `초등학교 ${dm(+e1.distance)}` : '',
          m1 ? `대형마트 ${dm(+m1.distance)}` : '',
        ]
          .filter(Boolean)
          .join(', ')
      : '입지환경 정보를 불러오지 못했습니다';
  return { L, R, head };
}
