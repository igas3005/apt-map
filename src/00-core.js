// 기본: 공공데이터 요청 속도 제한, 설정값, 화면 상태(S), 공통 유틸
const $ = s => document.querySelector(s);
// 공공데이터포털은 짧은 시간에 요청이 몰리면 HTTP 429로 거절한다. 동시에 3건, 최소 간격을 두고 보내며 429면 기다렸다 다시 보낸다.
const _fetch = window.fetch.bind(window),
  _q = [];
let _active = 0,
  _last = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function _pump() {
  while (_active < 3 && _q.length) {
    const now = Date.now(),
      wait = Math.max(0, _last + 150 - now);
    _last = now + wait;
    _active++;
    setTimeout(_q.shift(), wait);
  }
}
function fetch(u, opt) {
  if (!/data\.go\.kr|odcloud\.kr/.test(String(u))) return _fetch(u, opt);
  return new Promise((res, rej) => {
    _q.push(async () => {
      try {
        let r;
        for (let a = 0; a < 5; a++) {
          r = await _fetch(u, opt);
          if (r.status !== 429) break;
          if (a < 4) await sleep(900 * (a + 1) * (a + 1));
        }
        res(r);
      } catch (e) {
        rej(e);
      } finally {
        _active--;
        _pump();
      }
    });
    _pump();
  });
}
const cfg = window.APP_CONFIG || {};
const PY = 3.3058; // ㎡ -> 평
const SUPPLY = 1.32; // 전용 -> 공급 면적 대략 비율 (평형 표시용 추정치)
const BANDS = [
  { k: 'all', t: '전체', a: 0, b: 1e9 },
  { k: 's', t: '~60㎡ (소형)', a: 0, b: 60.5 },
  { k: 'm', t: '60~85㎡ (중소형)', a: 60.5, b: 85.5 },
  { k: 'l', t: '85~102㎡ (중대형)', a: 85.5, b: 102.5 },
  { k: 'xl', t: '102㎡~ (대형)', a: 102.5, b: 1e9 },
];
const S = {
  oyear: 0,
  asset: 'apt',
  tab: 'trade',
  center: null,
  rad: 1000,
  months: 12,
  band: 'all',
  metric: 'latest',
  sort: 'dist',
  list: [],
  sum: new Map(),
  sel: null,
  dtype: null,
  ov: [],
  asOf: new Date(),
  hasData: false,
  token: 0,
};
let C = [],
  map,
  circle,
  centerMarker,
  geocoder,
  places;
const TR = new Map(); // 시군구코드 -> {c:{id:[[ymd,area,floor,amt]]}} | null

/* ---------- 유틸 ---------- */
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
function hav(a, b, c, d) {
  const t = Math.PI / 180,
    dl = (c - a) * t,
    dn = (d - b) * t;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dn / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}
const med = a => {
  const s = a.slice().sort((x, y) => x - y),
    n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
function eok(m) {
  if (m >= 10000) {
    const v = Math.round(m / 1000) / 10;
    return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + '억';
  }
  return Math.round(m).toLocaleString('ko-KR') + '만';
}
function eokFull(m) {
  m = Math.round(m);
  const e = Math.floor(m / 10000),
    r = m % 10000;
  return e ? e + '억' + (r ? ' ' + r.toLocaleString('ko-KR') + '만' : '') : r.toLocaleString('ko-KR') + '만';
}
const ds = y => {
  const s = String(y);
  return s.slice(2, 4) + '.' + s.slice(4, 6) + '.' + s.slice(6, 8);
};
const pyeong = a => Math.round((a * SUPPLY) / PY);
const ymdOf = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const cutoff = () => ymdOf(new Date(S.asOf.getFullYear(), S.asOf.getMonth() - S.months, S.asOf.getDate()));
const bandOf = () => BANDS.find(b => b.k === S.band);
async function getJSON(u) {
  const r = await fetch(u, { cache: 'no-cache' });
  if (!r.ok) throw new Error(u + ' ' + r.status);
  return r.json();
}
const RT_STALE = { n: 0, t: 0 }; // 서버 실패로 저장본을 쓴 달 수·가장 오래된 저장 시각 (05-storage.js cachedMonth)
function status(msg, err) {
  const el = $('#status');
  // 국토부 서버 실패로 저장본을 쓴 경우, 정상 안내 문구 뒤에 그 사실을 덧붙인다 (RT_STALE: 05-storage.js)
  if (!err && msg && RT_STALE.n) {
    const d = new Date(RT_STALE.t);
    msg += ` · 국토부 서버가 응답하지 않아 ${RT_STALE.n}개월은 저장본(${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 기준)으로 표시`;
  }
  el.textContent = msg || '';
  el.className = 'status' + (err ? ' err' : '');
}
