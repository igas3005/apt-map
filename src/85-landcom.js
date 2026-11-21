// 토지·상업업무용(상가) 실거래 — 지번이 온전히 공개된 거래는 필지(지번) 단위로 정확한 위치에 찍고,
// 지번이 가려진 거래(예: 1**)는 법정동 단위로 모아 동 중심에 찍는다.
/* ---------- 토지 · 상업업무용 ---------- */
const LC_KIND = {
  land: {
    name: '토지',
    api: 'https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade',
    apiName: '국토교통부_토지 매매 실거래가 자료',
    months: 60,
    mopts: [12, 36, 60],
    bands: [
      { k: 'all', t: '전체 지목', m: () => true },
      { k: 'dae', t: '대', m: j => j === '대' },
      { k: 'jeon', t: '전', m: j => j === '전' },
      { k: 'dap', t: '답', m: j => j === '답' },
      { k: 'orch', t: '과수원', m: j => j === '과수원' },
      { k: 'forest', t: '임야', m: j => j === '임야' },
      { k: 'misc', t: '잡종지', m: j => j === '잡종지' },
      { k: 'ind', t: '공장·창고용지', m: j => /공장|창고/.test(j) },
      { k: 'etc', t: '기타 지목', m: j => !/^(대|전|답|과수원|임야|잡종지)$/.test(j) && !/공장|창고/.test(j) },
    ],
    opts: [
      { k: 'excl', t: '지분거래 제외' },
      { k: 'incl', t: '지분거래 포함' },
    ],
  },
  nrg: {
    name: '상업업무용',
    api: 'https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade',
    apiName: '국토교통부_상업업무용 부동산 매매 실거래가 자료',
    months: 36,
    mopts: [12, 36],
    bands: [
      { k: 'all', t: '전체 용도', m: () => true },
      { k: 'near', t: '근린생활시설', m: u => /근린/.test(u) },
      { k: 'office', t: '업무시설', m: u => /업무/.test(u) },
      { k: 'sale', t: '판매시설', m: u => /판매/.test(u) },
      { k: 'stay', t: '숙박시설', m: u => /숙박/.test(u) },
      { k: 'etc', t: '기타 용도', m: u => !/근린|업무|판매|숙박/.test(u) },
    ],
    opts: [
      { k: 'col', t: '집합(구분상가) · 전용 평당가' },
      { k: 'gen', t: '일반(통건물) · 대지 평당가' },
    ],
  },
};
const isLC = () => S.asset === 'land' || S.asset === 'nrg';
const LCD = { land: new Map(), nrg: new Map() }, // 필지 키(시군구코드|읍면동|지번) -> { key, code, umd, sgg, jibun, masked, trades, pe, p }
  LCDONG = new Map(), // 법정동 중심 좌표 캐시 (시군구코드|읍면동)
  LCDONE = new Set(),
  LCPEND = new Map();
const LC = { list: [], sum: new Map(), sel: null, ov: [], loading: false, opt: { land: 'excl', nrg: 'col' } };
const lcKind = () => LC_KIND[S.asset];
const lcBand = () => lcKind().bands.find(b => b.k === S.band) || lcKind().bands[0];
const pick = (o, ...ks) => {
  for (const k of ks) if (o[k] !== undefined && o[k] !== '') return String(o[k]).trim();
  return '';
};
const num = v => parseFloat(String(v || '').replace(/,/g, '')) || 0;

// 한 달치 원자료. 토지: [읍면동, 지번, 지목, 용도지역, 계약일, 면적㎡, 만원, 지분여부, 시군구명]
//               상가: [읍면동, 지번, 일반/집합, 건물주용도, 용도지역, 계약일, 건물면적㎡, 대지면적㎡, 층, 만원, 지분여부, 건축년도, 시군구명]
async function lcRows(kind, f, ym) {
  let key = KEY;
  try {
    key = decodeURIComponent(KEY);
  } catch (e) {
    key = KEY;
  }
  const rows = [],
    land = kind === 'land';
  for (let page = 1; page <= 10; page++) {
    let r;
    try {
      r = await fetch(LC_KIND[kind].api + '?' + new URLSearchParams({ serviceKey: key, LAWD_CD: f, DEAL_YMD: ym, pageNo: page, numOfRows: 1000 }));
    } catch (e) {
      throw { kind: 'net' };
    }
    if (r.status === 401 || r.status === 403) throw { kind: 'key', msg: 'HTTP ' + r.status };
    if (!r.ok) throw { kind: 'api', msg: 'HTTP ' + r.status };
    const out = parseAny(await r.text());
    let used = 0;
    for (const o of out.items) {
      if (pick(o, 'cdealType').toUpperCase() === 'O' || pick(o, 'cdealDay')) continue;
      const amt = num(o.dealAmount),
        ymd = +o.dealYear * 10000 + +o.dealMonth * 100 + +o.dealDay,
        share = /지분/.test(pick(o, 'shareDealingType', 'shrDealingType', 'dealingType')) ? 1 : 0;
      if (!amt || !ymd) continue;
      if (land) {
        const area = num(pick(o, 'dealArea', 'area', 'lndpclAr'));
        if (!area) continue;
        rows.push([pick(o, 'umdNm'), pick(o, 'jibun'), pick(o, 'jimok', 'lndcgr'), pick(o, 'landUse', 'prposArea'), ymd, area, amt, share, pick(o, 'sggNm')]);
      } else {
        const bAr = num(pick(o, 'buildingAr', 'bldgArea')),
          pAr = num(pick(o, 'plottageAr', 'plottageArea'));
        if (!bAr && !pAr) continue;
        rows.push([
          pick(o, 'umdNm'),
          pick(o, 'jibun'),
          pick(o, 'buildingType'),
          pick(o, 'buildingUse'),
          pick(o, 'landUse'),
          ymd,
          bAr,
          pAr,
          parseInt(pick(o, 'floor'), 10) || 0,
          amt,
          share,
          +pick(o, 'buildYear') || 0,
          pick(o, 'sggNm'),
        ]);
      }
      used++;
    }
    // 거래는 있는데 하나도 읽지 못했다면 응답 항목 이름이 예상과 다른 것 — 항목 이름을 그대로 보여 줘서 고칠 수 있게 한다
    if (out.items.length && !used && !out.items.some(o => pick(o, 'cdealType').toUpperCase() === 'O' || pick(o, 'cdealDay')))
      throw { kind: 'api', msg: '응답 항목 이름이 예상과 달라요: ' + Object.keys(out.items[0]).join(', ') };
    if (page * 1000 >= out.total || !out.items.length) break;
  }
  return rows;
}
async function lcMonth(kind, f, ym) {
  const m = LCD[kind];
  for (const r of await cachedMonth(kind, f, ym, () => lcRows(kind, f, ym))) {
    const t =
      kind === 'land'
        ? { jibun: r[1], kind: r[2], zone: r[3], ymd: r[4], area: r[5], amt: r[6], share: r[7] }
        : { jibun: r[1], btype: r[2], kind: r[3], zone: r[4], ymd: r[5], bArea: r[6], pArea: r[7], floor: r[8], amt: r[9], share: r[10], by: r[11] };
    const umd = r[0],
      sgg = kind === 'land' ? r[8] : r[12],
      masked = !t.jibun || /\*/.test(t.jibun),
      k = f + '|' + umd + '|' + (masked ? '' : t.jibun);
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, code: f, umd, sgg, jibun: masked ? '' : t.jibun, masked, trades: [], pe: undefined, p: undefined }));
    g.trades.push(t);
  }
  LCDONE.add(kind + '|' + f + '|' + ym);
}
const lcOnce = (kind, f, ym) => {
  const k = kind + '|' + f + '|' + ym;
  if (LCDONE.has(k)) return Promise.resolve();
  if (!LCPEND.has(k)) LCPEND.set(k, lcMonth(kind, f, ym).finally(() => LCPEND.delete(k)));
  return LCPEND.get(k);
};
async function ensureLC(kind, codes, months) {
  const jobs = [],
    seen = new Set();
  for (const c of codes)
    for (const f of [c].concat(LEGACY[c] || []))
      for (const ym of monthList(months)) {
        const k = kind + '|' + f + '|' + ym;
        if (!LCDONE.has(k) && !seen.has(k)) {
          seen.add(k);
          jobs.push([f, ym]);
        }
      }
  let err = null,
    done = 0;
  await pool(jobs, 3, async j => {
    if (err) return;
    try {
      await lcOnce(kind, j[0], j[1]);
    } catch (e) {
      err = e;
    }
    done++;
    if (!err) status(`${LC_KIND[kind].name} 실거래 조회 중… ${done}/${jobs.length}${jobs.length > 60 ? ' (처음 한 번만 오래 걸려요)' : ''}`);
  });
  return err;
}
function lcErrText(e) {
  const k = lcKind();
  if (e.kind === 'net')
    return '브라우저에서 국토부 API에 접속하지 못했어요. 브라우저 보안 정책(CORS)이나 사내 네트워크 차단일 수 있어요. 이 문구를 그대로 알려 주세요.';
  if (e.kind === 'key')
    return `${k.name} 실거래 조회 권한 오류예요 (${e.msg || ''}). 공공데이터포털에서 「${k.apiName}」 활용신청이 승인됐는지 확인하세요. 승인 직후에는 반영에 시간이 걸릴 수 있어요.`;
  if (/429/.test(e.msg || '')) return '국토부 API가 요청이 너무 많다며 거절했어요 (HTTP 429). 잠시 뒤 다시 검색해 보세요.';
  return `${k.name} 실거래 조회 오류: ${e.msg || '알 수 없음'} — 이 문구를 그대로 알려 주세요.`;
}

// 평당가 기준: 토지는 거래면적, 상가 집합은 건물(전용)면적, 상가 일반은 대지면적
function lcBasis(t) {
  if (S.asset === 'land') return t.area;
  return LC.opt.nrg === 'gen' ? t.pArea : t.bArea;
}
const lcUnit = t => {
  const a = lcBasis(t);
  return a > 0 ? t.amt / (a / PY) : null;
};
function lcPass(t, cut) {
  if (t.ymd < cut || !lcBand().m(t.kind)) return false;
  if (S.asset === 'land') return LC.opt.land === 'incl' || !t.share;
  if (t.share) return false; // 상가 지분거래는 단가를 왜곡해 항상 제외
  return LC.opt.nrg === 'gen' ? t.btype.includes('일반') : !t.btype.includes('일반');
}
function lcSum(g) {
  const arr = g.trades.filter(t => lcPass(t, cutoff()) && lcUnit(t) != null);
  if (!arr.length) return null;
  const u = arr.map(lcUnit);
  return { n: arr.length, med: med(u), amt: med(arr.map(t => t.amt)), latest: Math.max(...arr.map(t => t.ymd)), arr };
}

// 위치: 지번이 온전한 필지는 '시도 시군구 읍면동 지번'을 좌표로 바꿔 정확한 위치에 찍는다.
// 지번이 가려진 거래 묶음은 동 중심에 찍는다 (동 중심이 반경+500m 안이면 포함).
const lcBase = g => OREGN.get(g.code) || ((OSIDO[g.code.slice(0, 2)] || '') + ' ' + g.sgg).trim();
async function locateLC(kind, codes, tok) {
  const all = new Set();
  for (const c of codes) {
    all.add(c);
    (LEGACY[c] || []).forEach(x => all.add(x));
  }
  const cut = cutoff(),
    gs = [...LCD[kind].values()].filter(g => all.has(g.code) && g.trades.some(t => t.ymd >= cut)),
    umds = new Map();
  for (const g of gs) {
    const k = g.code + '|' + g.umd;
    (umds.get(k) || umds.set(k, []).get(k)).push(g);
  }
  // 1) 동 중심 — 반경에서 3km 넘게 떨어진 동은 필지 위치를 찾지 않는다 (동 위치를 못 찾으면 버리지 않고 포함)
  const near = [];
  await pool([...umds.keys()], 4, async k => {
    if (tok !== S.token) return;
    const list = umds.get(k);
    if (!LCDONG.has(k)) LCDONG.set(k, await geocodeAddr((lcBase(list[0]) + ' ' + list[0].umd).replace(/\s+/g, ' ').trim()));
    const p = LCDONG.get(k);
    if (!p || hav(S.center.lat, S.center.lon, p[0], p[1]) <= S.rad + 3000) near.push(...list);
  });
  // 2) 필지 위치
  const todo = near.filter(g => !g.masked && g.pe === undefined);
  let n = 0;
  await pool(todo, 4, async g => {
    if (tok !== S.token) return;
    g.pe = await geocodeAddr((lcBase(g) + ' ' + g.umd + ' ' + g.jibun).replace(/\s+/g, ' ').trim());
    if (todo.length > 20) status(`필지 위치 확인 중… ${++n}/${todo.length}${todo.length > 100 ? ' (처음 한 번만 오래 걸려요)' : ''}`);
  });
  const out = [];
  let miss = 0;
  for (const g of near) {
    const dc = LCDONG.get(g.code + '|' + g.umd);
    g.p = g.masked ? dc : g.pe;
    if (!g.p) {
      miss++;
      continue;
    }
    const d = hav(S.center.lat, S.center.lon, g.p[0], g.p[1]);
    if (d <= (g.masked ? S.rad + 500 : S.rad)) out.push({ g, d });
  }
  return { out, miss };
}
async function refreshLC(fit) {
  if (!S.center) return;
  const tok = ++S.token,
    kind = S.asset;
  LC.list = [];
  LC.sum = new Map();
  LC.sel = null;
  $('#detail').hidden = true;
  LC.loading = !!KEY;
  renderLCList();
  renderLCPins();
  if (!S.hasData) {
    status('아래에 국토부 인증키를 입력하면 시세가 표시돼요.');
    return;
  }
  status('주변 시군구 확인 중…');
  const codes = await regionsAround(S.center, S.rad + 500);
  if (tok !== S.token) return;
  if (!codes.size) {
    LC.loading = false;
    status('이 위치의 시군구를 확인하지 못했어요. (수도권·광역시만 지원)', true);
    renderLCList();
    return;
  }
  const err = await ensureLC(kind, codes, S.months);
  if (tok !== S.token) return;
  if (err) {
    LC.loading = false;
    status(lcErrText(err), true);
    renderLCList();
    return;
  }
  status('법정동 위치 확인 중…');
  const { out, miss } = await locateLC(kind, codes, tok);
  if (tok !== S.token) return;
  LC.loading = false;
  LC.list = out;
  status(miss ? `주소로 위치를 찾지 못한 ${miss}곳은 제외했어요.` : '');
  recomputeLC();
  if (fit && circle) map.setBounds(circle.getBounds());
}
function recomputeLC() {
  LC.sum = new Map(LC.list.map(i => [i.g.key, lcSum(i.g)]));
  const v = i => LC.sum.get(i.g.key);
  if (S.sort === 'price') LC.list.sort((a, b) => (v(b) || { med: -1 }).med - (v(a) || { med: -1 }).med);
  else if (S.sort === 'cnt') LC.list.sort((a, b) => (v(b) || { n: -1 }).n - (v(a) || { n: -1 }).n);
  else LC.list.sort((a, b) => a.d - b.d);
  renderLCList();
  renderLCPins();
  if (LC.sel) renderLCDetail();
}
function clearLCPins() {
  LC.ov.forEach(o => o.setMap(null));
  LC.ov = [];
}
function renderLCPins() {
  clearLCPins();
  if (!map || !isLC()) return;
  for (const it of LC.list) {
    const g = it.g,
      s = LC.sum.get(g.key),
      sel = LC.sel === g.key,
      el = document.createElement('div');
    el.className = 'pin lpin ' + S.asset + (s ? '' : ' none') + (sel ? ' sel' : '') + (g.masked ? ' approx' : '');
    el.innerHTML = (s ? `<small>${s.n}건 · 평당</small><b>${eok(s.med)}</b>` : '<small>조건 거래없음</small><b>-</b>') + `<i class="nm">${esc(lcName(g))}</i>`;
    el.title = lcName(g);
    el.addEventListener('click', e => {
      e.stopPropagation();
      openLC(g.key, false);
    });
    const ov = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(g.p[0], g.p[1]),
      content: el,
      xAnchor: 0.12,
      yAnchor: 1,
      zIndex: sel ? 20 : 2,
      clickable: true,
    });
    ov.setMap(map);
    LC.ov.push(ov);
  }
}
const lcName = g => (g.masked ? g.umd + ' (지번 비공개)' : g.umd + ' ' + g.jibun);
const yrsTxt = () => (S.months % 12 ? S.months + '개월' : S.months / 12 + '년');
function lcFilterTxt() {
  const k = lcKind();
  return `${lcBand().t} · ${(k.opts.find(o => o.k === LC.opt[S.asset]) || k.opts[0]).t} · 최근 ${yrsTxt()}`;
}
function renderLCList() {
  const el = $('#list'),
    k = lcKind();
  if (!S.center) {
    el.innerHTML = `<div class="empty">주소를 검색하거나 지도를 클릭하면<br>반경 안 지번별 ${k.name} 거래가 여기에 나와요.</div>`;
    return;
  }
  const n = LC.list.length;
  let h = `<div class="lh"><b>${esc(S.center.label || '선택한 위치')}</b> 반경 ${S.rad >= 1000 ? S.rad / 1000 + 'km' : S.rad + 'm'} · ${n}곳<br><small>${esc(lcFilterTxt())}</small></div>`;
  if (!n) h += `<div class="empty">${LC.loading ? '거래를 모으는 중이에요…' : '이 반경에서 조건에 맞는 거래가 없어요.<br>반경·기간·필터를 바꿔 보세요.'}</div>`;
  h += LC.list
    .map(it => {
      const g = it.g,
        s = LC.sum.get(g.key);
      const px = s ? `<div class="px"><b>${eok(s.med)}</b><small>평당 · ${s.n}건</small></div>` : '<div class="px"><small>조건 거래 없음</small></div>';
      return `<div class="item${LC.sel === g.key ? ' sel' : ''}" data-lid="${esc(g.key)}"><div class="n"><div class="nm">${esc(lcName(g))}</div><div class="ad">${esc(g.sgg)} · ${g.masked ? '동 중심 ' : ''}${it.d < 1000 ? Math.round(it.d) + 'm' : (it.d / 1000).toFixed(2) + 'km'}</div></div>${px}</div>`;
    })
    .join('');
  h += `<div class="note" style="margin:10px 14px">지번이 공개된 거래는 해당 지번의 위치에, 지번이 가려진 거래(예: 1**)는 법정동 단위로 묶어 동 중심에 표시해요. 위치는 지번 주소를 지도 검색으로 변환한 값이라 실제 필지와 조금 다를 수 있어요.</div>`;
  el.innerHTML = h;
}
function openLC(key, pan) {
  const g = LCD[S.asset].get(key);
  if (!g || !g.p) return;
  LC.sel = key;
  renderLCDetail();
  renderLCPins();
  renderLCList();
  if (pan) map.panTo(new kakao.maps.LatLng(g.p[0], g.p[1]));
  const it = document.querySelector(`.item[data-lid="${CSS.escape(key)}"]`);
  if (it) it.scrollIntoView({ block: 'nearest' });
}
function barSvg(rows) {
  // rows: [{ lab, v, n }] — 연도별 중위 평당가 막대
  const W = 360,
    H = 130,
    pl = 44,
    pb = 18,
    pt = 14,
    ih = H - pt - pb,
    vs = rows.filter(r => r.v != null).map(r => r.v);
  if (!vs.length) return '';
  const mx = Math.max(...vs) * 1.12,
    bw = (W - pl - 4) / rows.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="연도별 중위 평당가">`;
  for (let k = 0; k <= 3; k++) {
    const y = pt + ih - (ih * k) / 3;
    s += `<line x1="${pl}" x2="${W - 4}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl - 4}" y="${y + 3.5}" font-size="10" text-anchor="end" fill="var(--mute)">${eok((mx * k) / 3)}</text>`;
  }
  rows.forEach((r, i) => {
    const x = pl + i * bw + bw * 0.2,
      w = bw * 0.6;
    if (r.v != null) {
      const h = (ih * r.v) / mx;
      s += `<rect x="${x}" y="${pt + ih - h}" width="${w}" height="${h}" rx="2" fill="var(--accent)"><title>${r.lab} 중위 ${Math.round(r.v).toLocaleString('ko-KR')}만원/평 (${r.n}건)</title></rect><text x="${x + w / 2}" y="${pt + ih - h - 3}" font-size="9.5" text-anchor="middle" fill="var(--ink)">${r.n}건</text>`;
    }
    s += `<text x="${x + w / 2}" y="${H - 5}" font-size="10" text-anchor="middle" fill="var(--mute)">${r.lab}</text>`;
  });
  return s + '</svg>';
}
function renderLCDetail() {
  const el = $('#detail'),
    g = LCD[S.asset] && LCD[S.asset].get(LC.sel);
  if (!g || !isLC()) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const land = S.asset === 'land',
    s = lcSum(g),
    allN = g.trades.filter(t => t.ymd >= cutoff()).length;
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(lcName(g))}</h2><div class="ad">${esc(g.sgg)} · ${esc(lcKind().name)} · ${esc(lcFilterTxt())}<br>${g.masked ? '지번이 가려진 거래를 동 단위로 묶은 값 · ' : ''}최근 ${yrsTxt()} 전체 거래 ${allN}건 중 조건에 맞는 거래 ${s ? s.n : 0}건</div>`;
  if (!s) h += '<div class="note">조건에 맞는 거래가 없어요. 위쪽 지목·용도·유형 필터나 기간을 바꿔 보세요.</div>';
  else {
    const u = s.arr.map(lcUnit);
    h += `<div class="kv"><div><small>중위 평당가</small><b>${Math.round(s.med).toLocaleString('ko-KR')}만</b></div><div><small>최고</small><b>${Math.round(Math.max(...u)).toLocaleString('ko-KR')}만</b></div><div><small>최저</small><b>${Math.round(Math.min(...u)).toLocaleString('ko-KR')}만</b></div></div>`;
    const y1 = S.asOf.getFullYear(),
      years = [];
    for (let y = y1 - Math.ceil(S.months / 12); y <= y1; y++) {
      const v = s.arr.filter(t => Math.floor(t.ymd / 10000) === y);
      if (y < y1 - Math.ceil(S.months / 12) + 1 && !v.length) continue;
      years.push({ lab: "'" + String(y).slice(2), v: v.length ? med(v.map(lcUnit)) : null, n: v.length });
    }
    const ch = barSvg(years);
    if (ch) h += `<div class="sec">연도별 중위 평당가 (만원)</div>${ch}`;
    // 지목·용도별 요약
    const by = new Map();
    for (const t of s.arr) (by.get(t.kind || '미상') || by.set(t.kind || '미상', []).get(t.kind || '미상')).push(t);
    h +=
      `<div class="sec">${land ? '지목' : '건물주용도'}별</div><table><tr><th>${land ? '지목' : '용도'}</th><th>건수</th><th>중위 평당가</th><th>중위 거래가</th></tr>` +
      [...by]
        .sort((a, b) => b[1].length - a[1].length)
        .map(
          ([k, v]) =>
            `<tr><td>${esc(k)}</td><td>${v.length}</td><td>${Math.round(med(v.map(lcUnit))).toLocaleString('ko-KR')}만</td><td>${eokFull(med(v.map(t => t.amt)))}</td></tr>`,
        )
        .join('') +
      '</table>';
    const head = land
      ? '<tr><th>계약일</th><th>지번</th><th>지목</th><th>용도지역</th><th>면적</th><th>거래가</th><th>평당</th></tr>'
      : '<tr><th>계약일</th><th>지번</th><th>용도</th><th>건물/대지</th><th>층</th><th>거래가</th><th>평당</th></tr>';
    h +=
      `<div class="sec">최근 거래 (${Math.min(30, s.arr.length)}/${s.arr.length}건)</div><div style="overflow:auto"><table>${head}` +
      s.arr
        .slice()
        .sort((a, b) => b.ymd - a.ymd)
        .slice(0, 30)
        .map(t =>
          land
            ? `<tr><td>${ds(t.ymd)}</td><td>${esc(t.jibun)}</td><td>${esc(t.kind)}</td><td>${esc(t.zone)}</td><td>${Math.round(t.area).toLocaleString('ko-KR')}㎡<br><small>${(t.area / PY).toFixed(0)}평${t.share ? ' · 지분' : ''}</small></td><td><b>${eokFull(t.amt)}</b></td><td>${Math.round(lcUnit(t)).toLocaleString('ko-KR')}만</td></tr>`
            : `<tr><td>${ds(t.ymd)}</td><td>${esc(t.jibun)}</td><td>${esc(t.kind)}<br><small>${esc(t.zone)}${t.by ? ' · ' + t.by + '년' : ''}</small></td><td>${Math.round(t.bArea).toLocaleString('ko-KR')} / ${t.pArea ? Math.round(t.pArea).toLocaleString('ko-KR') : '-'}㎡</td><td>${t.floor || '-'}</td><td><b>${eokFull(t.amt)}</b></td><td>${Math.round(lcUnit(t)).toLocaleString('ko-KR')}만</td></tr>`,
        )
        .join('') +
      '</table></div>';
    h += land
      ? '<div class="note">평당가 = 거래금액 ÷ 거래면적(평). 지분거래는 면적 대비 금액이 왜곡될 수 있어 기본으로 뺍니다. 지번이 가려진(1** 등) 거래는 정확한 필지를 알 수 없어요.</div>'
      : `<div class="note">평당가 = 거래금액 ÷ ${LC.opt.nrg === 'gen' ? '대지면적(평) — 통건물은 대지 기준으로 비교하는 게 일반적이에요' : '건물(전용)면적(평)'}. 지분거래는 뺍니다. 층은 집합건물만 공개돼요.</div>`;
  }
  el.innerHTML = h;
  $('#dx').onclick = () => {
    LC.sel = null;
    el.hidden = true;
    renderLCPins();
    renderLCList();
  };
}
// 모드 전환 때 필터·기간 선택지를 바꾼다 (아파트·오피스텔로 돌아가면 원래대로)
const MON0 = [3, 6, 12];
function setupLCControls(a) {
  const lc = a === 'land' || a === 'nrg',
    k = LC_KIND[a];
  const ms = lc ? k.mopts : MON0;
  S.months = lc ? k.months : 12;
  $('#mon').innerHTML = ms.map(m => `<option value="${m}"${m === S.months ? ' selected' : ''}>${lc ? m / 12 + '년' : m + '개월'}</option>`).join('');
  let o = document.getElementById('lclab');
  if (!o) {
    o = document.createElement('label');
    o.id = 'lclab';
    o.style.gridColumn = '1/-1';
    o.innerHTML = '조건<select id="lcopt"></select>';
    $('.ctrl').appendChild(o);
    $('#lcopt').onchange = () => {
      LC.opt[S.asset] = $('#lcopt').value;
      recomputeLC();
    };
  }
  o.style.display = lc ? '' : 'none';
  if (lc) {
    $('#lcopt').innerHTML = k.opts.map(x => `<option value="${x.k}">${x.t}</option>`).join('');
    $('#lcopt').value = LC.opt[a];
  }
  for (const id of ['rpt', 'rpt2', 'rfl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = lc ? 'none' : '';
  }
  const tabs = document.querySelector('.tabs');
  if (tabs) tabs.style.display = lc ? 'none' : '';
  const mt = $('#metric');
  if (mt) mt.closest('label').style.display = lc ? 'none' : '';
}
