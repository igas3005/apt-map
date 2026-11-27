// 오피스텔 모드: 실거래 조회, 건물 위치 찾기, 목록·지도·상세
/* ---------- 오피스텔 (아파트와 별도 모드: 상단 [아파트|오피스텔] 버튼) ---------- */
// 오피스텔은 단지 목록이 없어서, 실거래 신고의 (시군구·읍면동·지번·건물명)으로 건물을 묶고 신고 지번을 좌표로 바꿔 지도에 올린다.
// 위치 변환은 느리므로 ① 읍면동 중심이 반경 근처인 동만 고르고 ② 그 동의 건물 지번만 변환하며 ③ 결과는 브라우저에 저장해 두 번째부터는 빠르다.
const OFFI_API = 'https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade';
const OBANDS = [
  { k: 'all', t: '전체', a: 0, b: 1e9 },
  { k: 's', t: '~30㎡ (원룸형)', a: 0, b: 30 },
  { k: 'm', t: '30~60㎡ (투룸형)', a: 30, b: 60 },
  { k: 'l', t: '60~85㎡ (주거형)', a: 60, b: 85 },
  { k: 'xl', t: '85㎡~ (아파트형)', a: 85, b: 1e9 },
];
const OSIDO = Object.assign({ 26: '부산', 27: '대구', 29: '광주', 30: '대전', 31: '울산', 36: '세종' }, SIDO_OF);
const OFFI = new Map(),
  ODONE = new Set(),
  OPEND = new Map(),
  OREG = new Map(),
  OREGN = new Map();
const OF = { all: [], list: [], sum: new Map(), sel: null, dtype: null, ov: [], loading: false };
const yearOfG = g => {
  const b = BLD[obkey(g)];
  return (b && b[1]) || g.by || 0;
};
const passYear = g => !S.oyear || (yearOfG(g) > 0 && S.asOf.getFullYear() - yearOfG(g) <= S.oyear); // 준공연도 필터: N년 이내 (연도 모르면 제외)
const obandOf = () => OBANDS.find(b => b.k === S.band) || OBANDS[0];
const fl2 = a => Math.floor(a + 1e-6); // 전용면적은 소수점 버림으로 묶는다 (59.97→59, 84.97→84)
// 오피스텔 한 달치 → [읍면동, 지번, 건물명, 시군구명, 건축년도, 계약일, 전용㎡, 층, 만원] (해제 거래 제외)
const offiRow = o => {
  const amt = dealAmt(o),
    area = dealArea(o),
    ymd = dealYmd(o);
  if (!amt || !area || !ymd) return null;
  return [o.umdNm || '', o.jibun || '', o.offiNm || '', o.sggNm || '', +o.buildYear || 0, ymd, area, parseInt(o.floor, 10) || 0, amt];
};
const offiRows = (f, ym) => rtMonth(OFFI_API, f, ym, offiRow);
async function offiMonth(f, ym) {
  // 한 달치를 끝까지 받은 뒤에만 반영 (중간 실패 시 중복 방지). 다 받았다는 표시는 ensureMonths가 한다.
  for (const [umd, jibun, nm, sgg, by, ymd, area, floor, amt] of await cachedMonth('offi', f, ym, () => offiRows(f, ym))) {
    const k = f + '|' + umd + '|' + jibun + '|' + nn(nm);
    let g = OFFI.get(k);
    if (!g) OFFI.set(k, (g = { key: k, code: f, umd, jibun, name: nm, sgg, by: 0, trades: [], p: undefined }));
    if (by) g.by = by;
    g.trades.push([ymd, area, floor, amt]);
  }
}
const ensureOffi = (codes, months) =>
  ensureMonths({
    codes,
    months: months || S.months,
    done: ODONE,
    pend: OPEND,
    run: offiMonth,
    progress: (n, tot) => status(`오피스텔 실거래 조회 중… ${n}/${tot}`),
  });
function regionAt(lat, lon) {
  const k = lat.toFixed(3) + ',' + lon.toFixed(3);
  if (OREG.has(k)) return Promise.resolve(OREG.get(k));
  return new Promise(res =>
    geocoder.coord2RegionCode(lon, lat, (r, st) => {
      const b = st === kakao.maps.services.Status.OK ? r.find(x => x.region_type === 'B') : null,
        v = b && b.code ? String(b.code).slice(0, 5) : null;
      if (v && !OREGN.has(v)) OREGN.set(v, (b.region_1depth_name + ' ' + b.region_2depth_name).trim());
      OREG.set(k, v);
      res(v);
    }),
  );
}
async function regionsAround(c, rad) {
  // 중심과 반경 둘레 8방향의 시군구 코드
  const pts = [[c.lat, c.lon]],
    dl = rad / 111320,
    dn = dl / Math.cos((c.lat * Math.PI) / 180);
  for (let a = 0; a < 8; a++) {
    const t = (a * Math.PI) / 4;
    pts.push([c.lat + dl * Math.sin(t), c.lon + dn * Math.cos(t)]);
  }
  const codes = await Promise.all(pts.map(p => regionAt(p[0], p[1])));
  return new Set(codes.filter(x => x && OSIDO[x.slice(0, 2)]));
}
const offiBase = g => OREGN.get(g.code) || ((OSIDO[g.code.slice(0, 2)] || '') + ' ' + g.sgg).trim();
async function locateOffi(codes, tok, cutY, rad) {
  rad = rad || S.rad;
  const all = new Set();
  for (const c of codes) {
    all.add(c);
    (LEGACY[c] || []).forEach(x => all.add(x));
  }
  const cut = cutY || cutoff(),
    umds = new Map();
  for (const g of OFFI.values()) {
    if (!all.has(g.code) || !g.trades.some(t => t[0] >= cut)) continue;
    const k = g.code + '|' + g.umd;
    (umds.get(k) || umds.set(k, []).get(k)).push(g);
  }
  const near = [];
  await pool([...umds.keys()], 4, async k => {
    if (tok !== S.token) return;
    const gs = umds.get(k),
      p = await geocodeAddr((offiBase(gs[0]) + ' ' + gs[0].umd).trim());
    if (!p || hav(S.center.lat, S.center.lon, p[0], p[1]) <= rad + 3000) near.push(...gs);
  }); // 동 위치를 못 찾으면 버리지 않고 포함
  let n = 0,
    miss = 0;
  const todo = near.filter(g => g.p === undefined);
  await pool(near, 4, async g => {
    if (tok !== S.token) return;
    if (g.p === undefined) {
      g.p = await geocodeAddr((offiBase(g) + ' ' + g.umd + ' ' + g.jibun).replace(/\s+/g, ' ').trim());
      n++;
      if (todo.length > 20) status(`오피스텔 위치 확인 중… ${Math.min(n, todo.length)}/${todo.length} (처음 한 번만 오래 걸려요)`);
    }
  });
  const out = [];
  for (const g of near) {
    if (!g.p) {
      miss++;
      continue;
    }
    const d = hav(S.center.lat, S.center.lon, g.p[0], g.p[1]);
    if (d <= rad) out.push({ g, d });
  }
  return { out, miss };
}
const obkey = g => 'o|' + bkey(g);
function offiInfo(g) {
  const b = BLD[obkey(g)],
    parts = [],
    y = (b && b[1]) || g.by;
  if (b && b[0]) parts.push(b[0].toLocaleString('ko-KR') + '호(실)');
  if (y) parts.push(y + '년');
  if (b && b[2]) parts.push((b[3] ? `지하${b[3]}/` : '') + `지상${b[2]}층`);
  return parts.join(' · ');
}
async function loadOffiBld(tok) {
  // 건축물대장 표제부로 호(실)수·층수를 채운다 (가까운 80곳)
  if (!KEY || bldErr || !geocoder) return;
  const todo = OF.list
    .slice(0, 80)
    .map(i => i.g)
    .filter(g => BLD[obkey(g)] === undefined);
  if (!todo.length) return;
  let k = 0,
    last = 0;
  const worker = async () => {
    while (k < todo.length && tok === S.token && !bldErr) {
      const g = todo[k++];
      try {
        const rc = await regionCode({ lat: g.p[0], lon: g.p[1] });
        BLDC.put(obkey(g), rc && rc.length >= 10 ? await fetchLedger(g, rc, '업무') : 0);
      } catch (e) {
        if (e.kind === 'key' || e.kind === 'net') bldErr = e;
      }
      if (tok === S.token && Date.now() - last > 500) {
        last = Date.now();
        renderOffiList();
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (tok !== S.token) return;
  renderOffiList();
  if (OF.sel) renderOffiDetail();
  if (bldErr)
    status(
      bldErr.kind === 'key'
        ? '호(실)수·층수(건축물대장) 조회가 거절됐어요 (' + (bldErr.msg || '') + '). 활용신청 승인이 반영되지 않았을 수 있어요.'
        : '건축물대장 API에 접속하지 못했어요. 이 문구를 그대로 알려 주세요.',
      true,
    );
}
function offiErrText(e) {
  if (e.kind === 'net')
    return '브라우저에서 국토부 API에 접속하지 못했어요. 브라우저 보안 정책(CORS)이나 사내 네트워크 차단일 수 있어요. 이 문구를 그대로 알려 주세요.';
  if (e.kind === 'key')
    return (
      '오피스텔 매매 실거래 조회 권한 오류예요 (' +
      (e.msg || '') +
      '). 공공데이터포털에서 「국토교통부_오피스텔 매매 실거래가 자료」 활용신청이 승인됐는지 확인하세요. 승인 직후에는 반영에 시간이 걸릴 수 있어요.'
    );
  if (e.kind === 'quota' || e.retry) return rtBusyText('오피스텔', e);
  if (/429/.test(e.msg || '')) return '국토부 API가 요청이 너무 많다며 거절했어요 (HTTP 429). 잠시 뒤 다시 검색해 보세요.';
  return '오피스텔 실거래 조회 오류: ' + (e.msg || '알 수 없음');
}
async function refreshOffi(fit) {
  if (!S.center) return;
  const tok = ++S.token;
  OF.all = [];
  OF.list = [];
  OF.sum = new Map();
  OF.sel = null;
  $('#detail').hidden = true;
  OF.loading = !!KEY;
  renderOffiList();
  renderOffiPins();
  if (!S.hasData) {
    status('아래에 국토부 인증키를 입력하면 시세가 표시돼요.');
    return;
  }
  status('주변 시군구 확인 중…');
  const codes = await regionsAround(S.center, S.rad);
  if (tok !== S.token) return;
  if (!codes.size) {
    OF.loading = false;
    status('이 위치의 시군구를 확인하지 못했어요. (수도권·광역시만 지원)', true);
    renderOffiList();
    return;
  }
  const err = await ensureOffi(codes);
  if (tok !== S.token) return;
  if (err) {
    OF.loading = false;
    status(offiErrText(err), true);
    renderOffiList();
    return;
  }
  status('오피스텔 위치 확인 중…');
  const { out, miss } = await locateOffi(codes, tok);
  if (tok !== S.token) return;
  OF.loading = false;
  OF.all = out;
  OF.list = out;
  status(miss ? `지번으로 위치를 찾지 못한 ${miss}곳은 제외했어요.` : '');
  recomputeOffi();
  if (fit && circle) map.setBounds(circle.getBounds());
  loadOffiBld(tok);
}
function offiSum(g) {
  const cut = cutoff(),
    b = obandOf(),
    arr = g.trades.filter(t => t[0] >= cut && t[1] >= b.a && t[1] < b.b);
  if (!arr.length) return null;
  const best = dominant(arr, true),
    latest = best.v.reduce((x, y) => (y[0] > x[0] ? y : x)),
    m = med(best.v.map(t => t[3]));
  return { n: arr.length, type: best.k, cnt: best.v.length, latest, med: m, val: S.metric === 'latest' ? latest[3] : m };
}
function recomputeOffi() {
  OF.sum = new Map(OF.list.map(i => [i.g.key, offiSum(i.g)]));
  const v = i => OF.sum.get(i.g.key);
  if (S.sort === 'price') OF.list.sort((a, b) => (v(b) || { val: -1 }).val - (v(a) || { val: -1 }).val);
  else if (S.sort === 'cnt') OF.list.sort((a, b) => (v(b) || { n: -1 }).n - (v(a) || { n: -1 }).n);
  else OF.list.sort((a, b) => a.d - b.d);
  renderOffiList();
  renderOffiPins();
  if (OF.sel) renderOffiDetail();
}
function renderOffiPins() {
  OF.ov.forEach(o => o.setMap(null));
  OF.ov = [];
  if (!map) return;
  const lvl = map.getLevel(),
    items = OF.list.slice(0, 300),
    dots = lvl >= 6 && items.length > 120;
  for (const it of items) {
    const g = it.g,
      s = OF.sum.get(g.key),
      sel = OF.sel === g.key,
      el = document.createElement('div');
    if (dots) el.className = 'dot odot' + (s ? '' : ' none') + (sel ? ' sel' : '');
    else {
      el.className = 'pin opin' + (s ? '' : ' none') + (sel ? ' sel' : '');
      el.innerHTML =
        (s ? `<small>전용 ${s.type}㎡</small><b>${eok(s.val)}</b>` : '<small>거래없음</small><b>-</b>') +
        (lvl <= 4 || sel ? `<i class="nm">${esc(g.name)}</i>` : '');
    }
    el.title = g.name;
    el.addEventListener('click', e => {
      e.stopPropagation();
      openOffi(g.key, false);
    });
    const ov = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(g.p[0], g.p[1]),
      content: el,
      xAnchor: dots ? 0.5 : 0.12,
      yAnchor: dots ? 0.5 : 1,
      zIndex: sel ? 20 : 1,
      clickable: true,
    });
    ov.setMap(map);
    OF.ov.push(ov);
  }
}
function renderOffiList() {
  const el = $('#list');
  if (!S.center) {
    el.innerHTML = '<div class="empty">주소를 검색하거나 지도를 클릭하면<br>반경 안의 오피스텔과 매매 시세가 여기에 나와요.</div>';
    return;
  }
  const n = OF.list.length;
  let h = `<div class="lh"><b>${esc(S.center.label || '선택한 위치')}</b> 반경 ${S.rad >= 1000 ? S.rad / 1000 + 'km' : S.rad + 'm'} · 오피스텔 ${n.toLocaleString('ko-KR')}곳${n > 300 ? ' (가까운 300곳 표시)' : ''}</div>`;
  if (!n)
    h += `<div class="empty">${OF.loading ? '오피스텔을 찾는 중이에요…' : '이 반경에서 최근 거래된 오피스텔이 없어요.<br>반경이나 기간을 늘려 보세요.'}</div>`;
  h += OF.list
    .slice(0, 300)
    .map(it => {
      const g = it.g,
        s = OF.sum.get(g.key);
      const px = s
        ? `<div class="px"><b>${eok(s.val)}</b><small>전용 ${s.type}㎡ · ${s.cnt}건</small></div>`
        : '<div class="px"><small>거래 없음</small></div>';
      return `<div class="item${OF.sel === g.key ? ' sel' : ''}" data-oid="${esc(g.key)}"><div class="n"><div class="nm">${esc(g.name)}</div><div class="ad">${esc(g.umd)} ${esc(g.jibun)} · ${it.d < 1000 ? Math.round(it.d) + 'm' : (it.d / 1000).toFixed(2) + 'km'}</div>${offiInfo(g) ? `<div class="inf">${offiInfo(g)}</div>` : ''}</div>${px}</div>`;
    })
    .join('');
  el.innerHTML = h;
}
function openOffi(key, pan) {
  const g = OFFI.get(key);
  if (!g || !g.p) return;
  OF.sel = key;
  OF.dtype = null;
  renderOffiDetail();
  renderOffiPins();
  renderOffiList();
  if (pan) map.panTo(new kakao.maps.LatLng(g.p[0], g.p[1]));
  const it = document.querySelector(`.item[data-oid="${CSS.escape(key)}"]`);
  if (it) it.scrollIntoView({ block: 'nearest' });
}
function renderOffiDetail() {
  const el = $('#detail'),
    g = OFFI.get(OF.sel);
  if (!g) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const cut = cutoff(),
    all = g.trades.filter(t => t[0] >= cut),
    b = obandOf();
  const types = new Map();
  for (const t of all) {
    const k = fl2(t[1]);
    types.set(k, (types.get(k) || 0) + 1);
  }
  if (OF.dtype == null) {
    const dom =
      dominant(
        all.filter(t => t[1] >= b.a && t[1] < b.b),
        true,
      ) || dominant(all, true);
    OF.dtype = dom ? dom.k : 'all';
  }
  const arr = OF.dtype === 'all' ? all : all.filter(t => fl2(t[1]) === OF.dtype);
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(g.name)}</h2><div class="ad">${esc(g.umd)} ${esc(g.jibun)} · 오피스텔${offiInfo(g) ? '<br>' + offiInfo(g) : ''}</div>`;
  if (!all.length) h += `<div class="note">최근 ${S.months}개월 거래가 없어요. 기간을 늘려 보세요.</div>`;
  else {
    h +=
      '<div class="chips">' +
      [...types.keys()]
        .sort((a, c) => a - c)
        .map(k => `<button data-t="${k}" class="${OF.dtype === k ? 'on' : ''}">전용 ${k}㎡ ${types.get(k)}</button>`)
        .join('') +
      `<button data-t="all" class="${OF.dtype === 'all' ? 'on' : ''}">전체 ${all.length}</button></div>`;
    const am = arr.map(t => t[3]);
    h += `<div class="kv"><div><small>거래 ${arr.length}건 중위</small><b>${eokFull(med(am))}</b></div><div><small>최고</small><b>${eokFull(Math.max(...am))}</b></div><div><small>최저</small><b>${eokFull(Math.min(...am))}</b></div></div>`;
    const ch = chart(arr);
    if (ch) h += `<div class="sec">월별 중위 거래가</div>${ch}`;
    h +=
      '<div class="sec">최근 거래</div><table><tr><th>계약일</th><th>전용</th><th>층</th><th>거래가</th></tr>' +
      arr
        .slice()
        .sort((a, c) => c[0] - a[0])
        .slice(0, 15)
        .map(t => `<tr><td>${ds(t[0])}</td><td>${t[1]}㎡ (${(t[1] / PY).toFixed(1)}평)</td><td>${t[2]}</td><td><b>${eokFull(t[3])}</b></td></tr>`)
        .join('') +
      '</table>' +
      '<div class="note">면적은 전용면적 기준이에요. 오피스텔은 전용률이 낮아(대개 50~60%대) 계약·공급면적과 차이가 커서, 아파트처럼 공급평형으로 환산하지 않았어요. 연한 막대는 신고 기한 때문에 아직 집계 중일 수 있는 최근 두 달이에요.</div>';
  }
  el.innerHTML = h;
  $('#dx').onclick = () => {
    OF.sel = null;
    el.hidden = true;
    renderOffiPins();
    renderOffiList();
  };
  el.querySelectorAll('.chips button').forEach(
    bt =>
      (bt.onclick = () => {
        OF.dtype = bt.dataset.t === 'all' ? 'all' : +bt.dataset.t;
        renderOffiDetail();
      }),
  );
}
let FOOT0 = '';
function setAsset(a) {
  if (S.asset === a) return;
  S.asset = a;
  const offi = a === 'offi',
    lc = a === 'land' || a === 'nrg';
  $('#ylab').style.display = offi ? '' : 'none';
  document.querySelectorAll('[data-asset]').forEach(b => b.classList.toggle('on', b.dataset.asset === a));
  if (!FOOT0) FOOT0 = $('#foot').textContent;
  $('#foot').textContent = offi
    ? '국토교통부 오피스텔 매매 실거래가를 실시간 조회 · 해제 거래 제외 · 신고 지번을 좌표로 바꿔 표시(위치 약간 오차 가능) · 참고용'
    : lc
      ? `국토교통부 ${LC_KIND[a].name} 매매 실거래가를 실시간 조회 · 해제 거래 제외 · 지번이 공개된 거래는 필지 위치에, 가려진 거래는 법정동 단위로 표시 · 참고용`
      : FOOT0;
  $('#band').innerHTML = (offi ? OBANDS : lc ? LC_KIND[a].bands : BANDS).map(b => `<option value="${b.k}">${b.t}</option>`).join('');
  S.band = 'all';
  $('#band').value = 'all';
  const tb = document.querySelectorAll('.tabs button');
  tb[0].textContent = offi ? '실거래 (매매)' : '실거래 (매매·분양권·입주권)';
  tb[1].textContent = offi ? '분양정보 (청약홈)' : '분양정보 (청약홈·분석)';
  ST.rows = null;
  ST.err = null;
  ST.init = false;
  salePin = null;
  {
    const rb = document.getElementById('rpt');
    if (rb)
      rb.textContent = offi ? '이 위치의 반경 기준 오피스텔 시장조사 기초자료 PPT 만들기' : '이 위치의 반경 기준 시장조사 기초자료 PPT 만들기';
  }
  if (lc && S.tab === 'sale') setTab('trade');
  setupLCControls(a);
  S.sel = null;
  OF.sel = null;
  LC.sel = null;
  xsel = null;
  noticeSel = null;
  $('#detail').hidden = true;
  renderPins();
  renderExtraPins();
  renderNoticePins();
  if (S.tab === 'sale') {
    renderSaleTab();
    loadSaleTab();
  } else if (S.center) refresh(false);
  else renderList();
}
