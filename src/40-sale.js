// 분양권·입주권 실거래, 청약홈 분양정보·경쟁률 탭
async function geocodeSale(addr, name) {
  const k = 'sale|' + addr + '|' + name;
  if (GEO[k]) return GEO[k];
  const done = v => {
    if (v) GEOC.put(k, v);
    return v;
  };
  let v = await geocodeLoose(addr);
  if (v) return done([v[0], v[1], false]);
  const adr = String(addr || ''),
    nm = String(name || '')
      .replace(/\(.*?\)/g, ' ')
      .replace(
        /(신혼희망타운|공공분양주택?|공공분양|본청약|조합원 취소분|이익공유형 분양주택|잔여세대|무순위|추가\s*모집|입주자\s*모집공고).*$/,
        '',
      )
      .trim();
  const city = (adr.match(/(?:경기도|인천광역시|서울특별시)\s+(\S+시(?:\s+\S+구)?|\S+구|\S+군)/) || [])[1] || '',
    c1 = city.split(' ')[0];
  if (nm && (v = await kwSearch(city + ' ' + nm, c1))) return done([v[0], v[1], false]);
  const dist = (adr.match(/([가-힣A-Za-z0-9·\- ]+?(?:지구|역세권|도시개발구역|도시개발사업지구|산업단지))/) || [])[1];
  if (dist && (v = await kwSearch(city + ' ' + dist.trim().split(' ').slice(-2).join(' '), c1))) return done([v[0], v[1], true]);
  const dong = (adr.replace(/\(.*?\)/g, ' ').match(/\s([가-힣0-9]+(?:동|읍|면|리|가))[\s,]/) || [])[1];
  if (dong && (v = await kwSearch(city + ' ' + dong, c1))) return done([v[0], v[1], true]);
  if (nm && (v = await kwSearch(nm, c1))) return done([v[0], v[1], true]);
  return null;
}
function centerRegion() {
  return new Promise(res =>
    geocoder.coord2RegionCode(S.center.lon, S.center.lat, (r, st) => {
      if (st !== kakao.maps.services.Status.OK) return res(null);
      const b = r.find(x => x.region_type === 'B');
      res(b || null);
    }),
  );
}
// 분양권·입주권 한 달치 → [읍면동, 지번, 단지명, 시군구명, 계약일, 전용㎡, 층, 만원, 분양권/입주권] (해제 거래 제외)
const silvRow = o => {
  const amt = dealAmt(o),
    area = dealArea(o),
    ymd = dealYmd(o);
  if (!amt || !area || !ymd) return null;
  return [o.umdNm || '', o.jibun || '', o.aptNm || o.aptName || '', o.sggNm || '', ymd, area, parseInt(o.floor, 10) || 0, amt, o.ownershipGbn || o.ownershipGbnNm || ''];
};
const silvRows = (f, ym) => rtMonth(SILV_API, f, ym, silvRow);
async function silvMonth(f, ym) {
  // 한 달치를 끝까지 받은 뒤에만 반영 (중간 실패 시 중복 방지). 다 받았다는 표시는 ensureMonths가 한다.
  for (const [umd, jibun, nm, sgg, ymd, area, floor, amt, own] of await cachedMonth('silv', f, ym, () => silvRows(f, ym))) {
    const t = [ymd, area, floor, amt, own],
      id = matchRow(f, umd, jibun, nm);
    if (id != null) push(SILVC, id, t);
    else {
      const k = f + '|' + umd + '|' + jibun + '|' + nn(nm);
      if (!SILVG.has(k)) SILVG.set(k, { key: k, code: f, umd, jibun, name: nm, sgg, trades: [] });
      SILVG.get(k).trades.push(t);
    }
  }
}
async function ensureSilv(codes, months) {
  const err = await ensureMonths({ codes, months: months || S.months, done: SDONE, pend: SPEND, run: silvMonth });
  if (err) X.err.push('분양권 실거래: ' + (err.kind === 'net' ? '접속 실패' : err.kind + ' ' + (err.msg || '')));
}
async function odGet(path, cond) {
  const key = apiKey();
  const q = new URLSearchParams({ page: 1, perPage: 1000, serviceKey: key });
  for (const k in cond) q.set(`cond[${k}]`, cond[k]);
  let r;
  try {
    r = await fetch(OD + path + '?' + q);
  } catch (e) {
    throw { kind: 'net' };
  }
  if (!r.ok) throw { kind: r.status === 401 || r.status === 403 ? 'key' : 'api', msg: 'HTTP ' + r.status };
  const j = await r.json();
  return Array.isArray(j.data) ? j.data : [];
}
// 청약홈 분양정보: 시도 단위로 받아 둔다. 조건 검색이 거절되면 조건 없이 받아 화면에서 거른다.
const ST = { meta: '', log: '', sido: '서울', q: '', years: 2, rows: null, err: null, loading: false, init: false, diag: '', ot: '' };
const SALEROW = new Map();
let salePin = null;
async function odPages(path, cond, maxPages) {
  const key = apiKey();
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({ page, perPage: 500, serviceKey: key });
    for (const k in cond) q.set(`cond[${k}]`, cond[k]);
    let r;
    try {
      r = await fetch(OD + path + '?' + q);
    } catch (e) {
      throw { kind: 'net' };
    }
    if (!r.ok) {
      let t = '';
      try {
        t = (await r.text()).slice(0, 120);
      } catch (e) {}
      throw { kind: r.status === 401 || r.status === 403 ? 'key' : 'api', msg: 'HTTP ' + r.status + ' ' + t };
    }
    const j = await r.json(),
      d = Array.isArray(j.data) ? j.data : [];
    ST.meta =
      `page ${page}: currentCount=${j.currentCount} matchCount=${j.matchCount} totalCount=${j.totalCount}` +
      (Array.isArray(j.data) ? '' : ' / 응답 키: ' + Object.keys(j).join(','));
    all.push(...d);
    if (d.length < 500) break;
  }
  return all;
}
const saleKey = sido => (S.asset === 'offi' ? 'o|' : '') + sido;
const rowId = r => (r._o ? 'o' : '') + r.HOUSE_MANAGE_NO;
// 오피스텔·도시형·생활숙박시설 분양정보 경로 (청약홈 'Urbty Ofctl' 계열). 이름이 다르면 오류 문구에 경로가 나온다.
const OFFI_SALE = {
  detail: 'ApplyhomeInfoDetailSvc/v1/getUrbtyOfctlLttotPblancDetail',
  mdl: 'ApplyhomeInfoDetailSvc/v1/getUrbtyOfctlLttotPblancMdl',
  cmp: 'ApplyhomeInfoCmpetRtSvc/v1/getUrbtyOfctlLttotPblancCmpet',
};
function salesOf(sido) {
  const offi = S.asset === 'offi',
    k = saleKey(sido);
  if (!SALES.has(k)) {
    const d = new Date(S.asOf.getFullYear() - 3, S.asOf.getMonth(), S.asOf.getDate());
    const from = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const path = offi ? OFFI_SALE.detail : 'ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail';
    const local = rows =>
      rows.filter(r => String(r.SUBSCRPT_AREA_CODE_NM || r.HSSPLY_ADRES || '').includes(sido) && String(r.RCRIT_PBLANC_DE || '') >= from);
    // 조건 검색이 거절되거나 0건이면 조건을 줄여 다시 받고 화면에서 거른다
    SALES.set(
      k,
      (async () => {
        const tries = [
          [{ 'SUBSCRPT_AREA_CODE_NM::EQ': sido, 'RCRIT_PBLANC_DE::GTE': from }, 6],
          [{ 'RCRIT_PBLANC_DE::GTE': from }, 12],
          [{}, 20],
        ];
        let last = null,
          log = [];
        for (const [cond, pages] of tries) {
          try {
            const rows = local(await odPages(path, cond, pages));
            if (offi)
              rows.forEach(r => {
                r._o = 1;
              });
            log.push(Object.keys(cond).length + '개 조건 → ' + rows.length + '건 (' + ST.meta + ')');
            if (rows.length) {
              ST.log = log.join(' / ');
              return rows;
            }
          } catch (e) {
            if (e.kind !== 'api') throw e;
            last = e;
            log.push(Object.keys(cond).length + '개 조건 → 오류 ' + (e.msg || '') + (offi ? ' [' + path.split('/').pop() + ']' : ''));
          }
        }
        ST.log = log.join(' / ');
        SALES.delete(k);
        if (last && log.every(x => x.includes('오류'))) throw last;
        return [];
      })().catch(e => {
        SALES.delete(k);
        throw e;
      }),
    );
  }
  return SALES.get(k);
}
async function loadSaleTab() {
  if (!KEY) {
    ST.rows = null;
    ST.err = null;
    renderSaleList();
    return;
  }
  ST.loading = true;
  ST.err = null;
  renderSaleList();
  const sido = ST.sido,
    asset = S.asset;
  try {
    const rows = await salesOf(sido);
    if (sido !== ST.sido || asset !== S.asset) return;
    ST.diag = rows.length && rows[0].HOUSE_NM === undefined ? '응답 항목이 예상과 달라요: ' + Object.keys(rows[0]).slice(0, 14).join(', ') : '';
    ST.rows = rows.slice().sort((a, b) => String(b.RCRIT_PBLANC_DE || '').localeCompare(String(a.RCRIT_PBLANC_DE || '')));
    for (const r of rows) SALEROW.set(rowId(r), r);
  } catch (e) {
    ST.rows = null;
    ST.err =
      e.kind === 'net'
        ? '청약홈 서버에 접속하지 못했어요 (브라우저 보안 정책 또는 네트워크 차단).'
        : e.kind === 'key'
          ? '청약홈 API 인증이 거절됐어요 (' + (e.msg || '') + '). 활용신청 승인이 반영됐는지 확인하세요.'
          : '청약홈 조회 오류: ' + (e.msg || '');
  }
  ST.loading = false;
  renderSaleList();
}
function renderSaleTab() {
  const el = $('#list');
  el.innerHTML = `<div class="lh"><div class="ctrl" style="margin:0"><label>시도<select id="ssido">${['서울', '경기', '인천'].map(x => `<option${x === ST.sido ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
  <label>기간<select id="syears">${[1, 2, 3].map(y => `<option value="${y}"${y === ST.years ? ' selected' : ''}>최근 ${y}년</option>`).join('')}</select></label>
  <label>시군구·단지명<input id="sq" type="search" placeholder="예: 용인, 처인구" value="${esc(ST.q)}" style="padding:6px 8px;font-size:13px"></label>${
    S.asset === 'offi'
      ? `<label>유형<select id="sot">${[
          ['', '전체'],
          ['오피스텔', '오피스텔'],
          ['생활숙박', '생활숙박시설'],
          ['도시형', '도시형생활주택'],
          ['임대', '민간임대'],
        ]
          .map(x => `<option value="${x[0]}"${x[0] === ST.ot ? ' selected' : ''}>${x[1]}</option>`)
          .join('')}</select></label>`
      : ''
  }</div></div><div id="slist"></div>`;
  $('#ssido').onchange = () => {
    ST.sido = $('#ssido').value;
    loadSaleTab();
  };
  $('#syears').onchange = () => {
    ST.years = +$('#syears').value;
    renderSaleList();
  };
  $('#sq').oninput = () => {
    ST.q = $('#sq').value.trim();
    renderSaleList();
  };
  if ($('#sot'))
    $('#sot').onchange = () => {
      ST.ot = $('#sot').value;
      renderSaleList();
    };
  renderSaleList();
}
const typeOf = r => String(r.HOUSE_DTL_SECD_NM || r.HOUSE_SECD_NM || ''); // 세부 구분(오피스텔·생활숙박시설…)이 있으면 그것을, 없으면 큰 구분을 쓴다
function renderSaleList() {
  const el = document.getElementById('slist');
  if (!el || S.tab !== 'sale') return;
  let h = '';
  if (NOTICES.length && S.asset === 'apt')
    h +=
      '<details class="nbox"><summary>분석해 둔 모집공고 요약·PPT ' +
      NOTICES.length +
      '건 보기</summary>' +
      NOTICES.map(
        n =>
          `<div class="item nitem" data-nid="${esc(n.id)}"><div class="n"><div class="nm">${esc(n.name)}</div><div class="ad">${esc(n.addr)} · 공고 ${esc(n.noticeDate)}</div></div><div class="px"><small>요약·PPT</small></div></div>`,
      ).join('') +
      '</details>';
  h +=
    '<div class="lh"><button id="sre" style="float:right;padding:2px 9px;font-size:12px">다시 조회</button><b>청약홈 분양정보' +
    (S.asset === 'offi' ? ' (오피스텔·도시형·생활숙박)' : '') +
    '</b> ';
  if (!KEY) h += '</div><div class="empty">국토부 인증키를 입력하면 조회돼요.</div>';
  else if (ST.loading) h += '조회 중…</div>';
  else if (ST.err) h += `</div><div class="status err" style="margin:10px 14px">${esc(ST.err)} 이 문구를 그대로 알려 주세요.</div>`;
  else if (!ST.rows) h += '</div>';
  else {
    const toks = ST.q.split(/\s+/).filter(Boolean);
    const yd = new Date(S.asOf.getFullYear() - ST.years, S.asOf.getMonth(), S.asOf.getDate()),
      yfrom = yd.getFullYear() + '-' + String(yd.getMonth() + 1).padStart(2, '0') + '-' + String(yd.getDate()).padStart(2, '0');
    const inYears = ST.rows.filter(r => String(r.RCRIT_PBLANC_DE || '') >= yfrom);
    const rows = inYears.filter(r => {
      const t = String(r.HOUSE_NM || '') + ' ' + String(r.HSSPLY_ADRES || '');
      return toks.every(x => t.includes(x)) && (S.asset !== 'offi' || !ST.ot || typeOf(r).includes(ST.ot));
    });
    h += `${ST.sido} 최근 ${ST.years}년 ${inYears.length}건${toks.length ? ' 중 ' + rows.length + '건' : ''} <small>(받은 자료: 최근 3년 ${ST.rows.length}건)</small></div>`;
    if (ST.diag) h += `<div class="status err" style="margin:10px 14px">${esc(ST.diag)} 이 문구를 그대로 알려 주세요.</div>`;
    if (!rows.length) h += '<div class="empty">조건에 맞는 공고가 없어요.</div>';
    if (!ST.rows.length && ST.log)
      h += `<div class="status err" style="margin:10px 14px">청약홈 서버가 지금 자료를 한 건도 주지 않고 있어요 (조건 없이 물어도 0건). 서버 쪽 일시 현상일 수 있으니 잠시 뒤 '다시 조회'를 눌러 보세요.<br><small>진단: ${esc(ST.log)}</small></div>`;
    h += rows
      .slice(0, 200)
      .map(r => {
        const id = rowId(r),
          an = NOTICES.some(n => n.id === id);
        return `<div class="item${xsel === 's' + id ? ' sel' : ''}" data-sid="${esc(id)}"><div class="n"><div class="nm">${esc(r.HOUSE_NM || '(이름 없음)')}</div><div class="ad">${esc(r.HSSPLY_ADRES || '')}</div><div class="inf">${r._o && typeOf(r) ? esc(typeOf(r)) + ' · ' : ''}공고 ${esc(r.RCRIT_PBLANC_DE || '-')} · ${esc(r.TOT_SUPLY_HSHLDCO == null ? '-' : r.TOT_SUPLY_HSHLDCO)}${r._o ? '실' : '세대'}${r.MVN_PREARNGE_YM ? ' · 입주 ' + esc(r.MVN_PREARNGE_YM) : ''}</div></div><div class="px"><small>${an ? '분석 요약 있음' : '경쟁률'}</small></div></div>`;
      })
      .join('');
    if (rows.length > 200) h += '<div class="lh">최근 200건만 표시했어요. 시군구나 단지명으로 좁혀 보세요.</div>';
  }
  el.innerHTML = h;
  const re = document.getElementById('sre');
  if (re)
    re.onclick = () => {
      SALES.delete(saleKey(ST.sido));
      loadSaleTab();
    };
}
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('.ctrl').style.display = t === 'sale' ? 'none' : '';
  if (t === 'sale') {
    if (!ST.init) {
      ST.init = true;
      const c = S.asset === 'apt' && S.list.length ? C[S.list[0].id] : null;
      if (c) {
        ST.sido = c.sido;
        ST.q = c.gu.split(' ')[0].replace(/시$|구$/, '');
      }
    }
    renderSaleTab();
    if (!ST.rows && !ST.loading) loadSaleTab();
  } else renderList();
}
// 실거래 탭: 반경 안의 분양권·입주권 거래(목록에 없는 입주 전 단지)를 지번으로 찍는다.
async function loadExtras(tok) {
  if (!KEY || !S.center) return;
  X.err = [];
  const codes = new Set(S.list.map(i => C[i.id].code)),
    gus = new Map();
  for (const i of S.list) {
    const c = C[i.id];
    gus.set(c.code, c.gu);
  }
  const reg = await centerRegion();
  if (reg && reg.code) {
    const c5 = String(reg.code).slice(0, 5);
    if (SIDO_OF[c5.slice(0, 2)]) {
      codes.add(c5);
      if (!gus.has(c5)) gus.set(c5, reg.region_2depth_name || '');
    }
  }
  if (tok !== S.token || !codes.size) return;
  await ensureSilv(codes);
  if (tok !== S.token) return;
  const cut = cutoff(),
    silv = [];
  await Promise.all(
    [...SILVG.values()]
      .filter(g => codes.has(g.code) || [...codes].some(c => (LEGACY[c] || []).includes(g.code)))
      .map(async g => {
        const tr = g.trades.filter(t => t[0] >= cut);
        if (!tr.length) return;
        const gu = gus.get(g.code) || g.sgg || '',
          sd = SIDO_OF[g.code.slice(0, 2)] || '';
        const p = await geocodeAddr(`${sd} ${gu} ${g.umd} ${g.jibun}`.replace(/\s+/g, ' ').trim());
        if (!p) return;
        const d = hav(S.center.lat, S.center.lon, p[0], p[1]);
        if (d > S.rad) return;
        silv.push({ key: g.key, name: g.name, addr: `${gu} ${g.umd} ${g.jibun}`, lat: p[0], lon: p[1], d, trades: tr });
      }),
  );
  if (tok !== S.token) return;
  X.silv = silv.sort((a, b) => a.d - b.d);
  renderExtraPins();
  renderList();
  if (S.sel != null) renderDetail();
  if (X.err.length && !S.liveErr) status(X.err.join(' / ') + ' — 이 문구를 그대로 알려 주세요.', true);
}
function silvBest(tr) {
  const b = dominant(tr);
  const latest = b.v.reduce((x, y) => (y[0] > x[0] ? y : x));
  return { py: pyeong(b.k), val: latest[3], n: tr.length };
}
function renderExtraPins() {
  XOV.forEach(o => o.setMap(null));
  XOV = [];
  if (!map) return;
  const add = (lat, lon, cls, html, title, fn, z) => {
    const el = document.createElement('div');
    el.className = 'pin ' + cls;
    el.innerHTML = html;
    el.title = title;
    el.addEventListener('click', e => {
      e.stopPropagation();
      fn();
    });
    const ov = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lon),
      content: el,
      xAnchor: 0.12,
      yAnchor: 1,
      zIndex: z,
      clickable: true,
    });
    ov.setMap(map);
    XOV.push(ov);
  };
  if (salePin)
    add(
      salePin.lat,
      salePin.lon,
      'spin sel',
      `<small>분양 ${esc(salePin.date)}</small><b>${esc(salePin.name.length > 12 ? salePin.name.slice(0, 12) + '…' : salePin.name)}</b>`,
      salePin.name,
      () => openSale(salePin.id),
      25,
    );
  if (S.asset !== 'apt') return;
  for (const g of X.silv) {
    const b = silvBest(g.trades);
    add(
      g.lat,
      g.lon,
      'vpin' + (xsel === 'v' + g.key ? ' sel' : ''),
      `<small>분양권 ${b.py}평</small><b>${eok(b.val)}</b>`,
      g.name,
      () => openSilv(g.key),
      22,
    );
  }
}
function silvTable(tr) {
  return (
    '<table><tr><th>계약일</th><th>구분</th><th>전용</th><th>층</th><th>거래가</th></tr>' +
    tr
      .slice()
      .sort((a, b) => b[0] - a[0])
      .slice(0, 20)
      .map(
        t =>
          `<tr><td>${ds(t[0])}</td><td>${esc(t[4] || '-')}</td><td>${t[1]}㎡ (${pyeong(t[1])}평)</td><td>${t[2]}</td><td><b>${eokFull(t[3])}</b></td></tr>`,
      )
      .join('') +
    '</table>' +
    (tr.length > 20 ? `<div class="note">최근 20건만 표시 (전체 ${tr.length}건)</div>` : '')
  );
}
function rawTable(rows) {
  if (!rows.length) return '';
  const ks = Object.keys(rows[0]);
  return (
    '<div class="note">항목 이름이 예상과 달라 원자료 그대로 표시해요. 이 표를 알려 주세요.</div><div style="overflow:auto"><table><tr>' +
    ks.map(k => `<th>${esc(k)}</th>`).join('') +
    '</tr>' +
    rows
      .slice(0, 30)
      .map(r => '<tr>' + ks.map(k => `<td>${esc(r[k] == null ? '' : r[k])}</td>`).join('') + '</tr>')
      .join('') +
    '</table></div>'
  );
}
async function saleExtra(id, offi) {
  // 주택형별 공급·최고분양가 + 경쟁률
  if (!KEY) return '<div class="note">국토부 인증키를 입력하면 청약 경쟁률이 표시돼요.</div>';
  const raw = String(id).replace(/^o/, '');
  if (!SALEX.has(id))
    SALEX.set(
      id,
      Promise.all([
        odGet(offi ? OFFI_SALE.mdl : 'ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl', { 'HOUSE_MANAGE_NO::EQ': raw }).catch(e => ({ err: e })),
        odGet(offi ? OFFI_SALE.cmp : 'ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet', { 'HOUSE_MANAGE_NO::EQ': raw }).catch(e => ({ err: e })),
      ]),
    );
  const [mdl, cmp] = await SALEX.get(id);
  const num = v =>
    v == null || v === '' ? '-' : isNaN(+String(v).replace(/,/g, '')) ? esc(v) : Number(String(v).replace(/,/g, '')).toLocaleString('ko-KR');
  const er = e =>
    `<div class="note">조회 실패 (${esc(e.kind || '')} ${esc(e.msg || '')}). 활용신청 승인 반영 전이거나 브라우저 접속이 막혔을 수 있어요.</div>`;
  let h = '<div class="sec">주택형별 공급 (청약홈)</div>';
  if (mdl.err) h += er(mdl.err);
  else if (!mdl.length) h += '<div class="note">자료 없음</div>';
  else if (mdl[0].HOUSE_TY === undefined && mdl[0].EXCLUSE_AR !== undefined) {
    // 오피스텔·도시형 자료: 전용면적(EXCLUSE_AR) 기준 주택형
    const L = { EXCLUSE_AR: '전용㎡', TP: '타입', GP: '공급규모', SUPLY_HSHLDCO: '공급(실)', SPSPLY_HSHLDCO: '특별' },
      ak = Object.keys(mdl[0]).filter(k => /AMOUNT/.test(k) && !/SUBSCRPT|REQST/.test(k));
    const cols = Object.keys(L)
        .filter(k => mdl[0][k] !== undefined)
        .concat(ak),
      lab = k => L[k] || '분양가(만원) [' + k + ']';
    h +=
      '<table><tr>' +
      cols.map(k => `<th>${esc(lab(k))}</th>`).join('') +
      '</tr>' +
      mdl
        .slice()
        .sort((a, b) => parseFloat(a.EXCLUSE_AR) - parseFloat(b.EXCLUSE_AR))
        .map(
          m =>
            '<tr>' +
            cols
              .map(
                k =>
                  `<td>${k === 'EXCLUSE_AR' ? esc(Math.round(parseFloat(m[k]) * 100) / 100) : k.includes('AMOUNT') ? '<b>' + num(m[k]) + '</b>' : esc(m[k] == null || m[k] === '' ? '-' : m[k])}</td>`,
              )
              .join('') +
            '</tr>',
        )
        .join('') +
      '</table><div class="note">오피스텔은 전용면적 기준 주택형이에요. 분양가는 주택형별 최고가 기준(층별 가격은 모집공고문)이에요.</div>';
  } else if (mdl[0].HOUSE_TY === undefined) h += rawTable(mdl);
  else
    h +=
      '<table><tr><th>주택형</th><th>공급면적㎡</th><th>일반</th><th>특별</th><th>최고 분양가(만원)</th></tr>' +
      mdl
        .map(
          m =>
            `<tr><td>${esc(m.HOUSE_TY)}</td><td>${esc(m.SUPLY_AR == null ? '-' : m.SUPLY_AR)}</td><td>${num(m.SUPLY_HSHLDCO)}</td><td>${num(m.SPSPLY_HSHLDCO)}</td><td><b>${num(m.LTTOT_TOP_AMOUNT)}</b></td></tr>`,
        )
        .join('') +
      '</table><div class="note">분양가는 주택형별 최고가 기준이에요. 층별 가격은 모집공고문에 있어요.</div>';
  h += '<div class="sec">청약 경쟁률 (청약홈' + (offi ? '' : ', 일반공급') + ')</div>';
  if (cmp.err) h += er(cmp.err);
  else if (!cmp.length) h += '<div class="note">아직 경쟁률 자료가 없어요 (청약 전이거나 미집계).</div>';
  else if (cmp[0].HOUSE_TY === undefined || cmp[0].CMPET_RATE === undefined) h += rawTable(cmp);
  else {
    const hasRank = cmp.some(c => c.SUBSCRPT_RANK_CODE !== undefined),
      hasRes = cmp.some(c => c.RESIDE_SENM !== undefined || c.RESIDE_SECD !== undefined); // 오피스텔 자료에는 순위·거주 구분이 없다
    h +=
      '<table><tr><th>주택형</th>' +
      (hasRank ? '<th>순위</th>' : '') +
      (hasRes ? '<th>거주</th>' : '') +
      '<th>공급</th><th>접수</th><th>경쟁률</th></tr>' +
      cmp
        .slice()
        .sort((a, b) => String(a.HOUSE_TY).localeCompare(String(b.HOUSE_TY)) || a.SUBSCRPT_RANK_CODE - b.SUBSCRPT_RANK_CODE)
        .map(
          c =>
            `<tr><td>${esc(c.HOUSE_TY)}</td>${hasRank ? `<td>${esc(c.SUBSCRPT_RANK_CODE)}순위</td>` : ''}${hasRes ? `<td>${esc(c.RESIDE_SENM || c.RESIDE_SECD || '')}</td>` : ''}<td>${num(c.SUPLY_HSHLDCO)}</td><td>${num(c.REQ_CNT)}</td><td><b>${esc(c.CMPET_RATE == null ? '-' : c.CMPET_RATE)}</b></td></tr>`,
        )
        .join('') +
      '</table>';
  }
  return h;
}
async function openSale(id) {
  const r = SALEROW.get(id);
  if (!r) return;
  if (NOTICES.some(n => n.id === id)) return openNotice(id, true);
  xsel = 's' + id;
  noticeSel = null;
  S.sel = null;
  salePin = null;
  renderPins();
  renderExtraPins();
  renderNoticePins();
  renderSaleList();
  const name = r.HOUSE_NM || '',
    addr = r.HSSPLY_ADRES || '',
    el = $('#detail');
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest' });
  const row = (k, v) => (v || v === 0 ? `<tr><td>${k}</td><td>${esc(v)}</td></tr>` : '');
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(name)}</h2><div class="ad">${esc(addr)}</div>`;
  if (r.PBLANC_URL) h += `<a class="dl" href="${esc(r.PBLANC_URL)}" target="_blank" rel="noopener">청약홈 모집공고 보기</a>`;
  h +=
    '<table class="kvt">' +
    row('모집공고일', r.RCRIT_PBLANC_DE) +
    row('공급세대', r.TOT_SUPLY_HSHLDCO) +
    row('청약접수', (r.RCEPT_BGNDE || '') + (r.RCEPT_ENDDE ? ' ~ ' + r.RCEPT_ENDDE : '')) +
    row('당첨자 발표', r.PRZWNER_PRESNATN_DE) +
    row('계약', (r.CNTRCT_CNCLS_BGNDE || '') + (r.CNTRCT_CNCLS_ENDDE ? ' ~ ' + r.CNTRCT_CNCLS_ENDDE : '')) +
    row('입주예정', r.MVN_PREARNGE_YM) +
    row('시공사', r.CNSTRCT_ENTRPS_NM) +
    row('사업주체', r.BSNS_MBY_NM) +
    row('주택구분', r.HOUSE_DTL_SECD_NM || r.HOUSE_SECD_NM) +
    '</table>';
  h += '<div id="sx"><div class="note">주택형·경쟁률 불러오는 중…</div></div><div id="sv"></div>';
  h +=
    '<div class="reqbox"><button id="rq" class="pri">모집공고 요약 요청하기</button><div id="rqo" class="note">층별 분양가·발코니 확장비·중도금 조건을 정리한 요약과 PPT를 Claude에게 요청할 때 눌러 주세요.</div></div>';
  el.innerHTML = h;
  $('#dx').onclick = () => {
    xsel = null;
    salePin = null;
    el.hidden = true;
    renderExtraPins();
    renderSaleList();
  };
  $('#rq').onclick = () => {
    const txt = `아래 단지 입주자모집공고를 분석해서 회사 양식 PPT로 만들고, 사이트(apt-map)에도 요약을 올려줘.\n- 단지명: ${name}\n- 주택관리번호: ${id}\n- 공급위치: ${addr}\n- 모집공고일: ${r.RCRIT_PBLANC_DE || ''}\n- 청약홈 공고: ${r.PBLANC_URL || ''}\n(공고문 PDF 첨부)`;
    const done = ok => {
      $('#rqo').innerHTML =
        (ok ? '<b>요청 문구를 복사했어요.</b> ' : '<b>아래 문구를 복사하세요.</b> ') +
        'Claude 대화창에 붙여넣고, 청약홈에서 받은 공고문 PDF를 함께 첨부해 보내면 돼요. 완성되면 이 단지에 "분석 요약"이 붙어요.' +
        ` <a href="https://claude.ai" target="_blank" rel="noopener">Claude 열기</a><textarea readonly style="width:100%;height:110px;margin-top:6px;font:12px/1.4 inherit">${esc(txt)}</textarea>`;
    };
    try {
      navigator.clipboard.writeText(txt).then(
        () => done(true),
        () => done(false),
      );
    } catch (e) {
      done(false);
    }
  };
  saleExtra(id, !!r._o).then(ex => {
    const sx = document.getElementById('sx');
    if (sx && xsel === 's' + id) sx.innerHTML = ex;
  });
  // 위치를 찾아 지도 이동, 그 시군구의 분양권·입주권 거래 중 이름이 맞는 것을 붙인다
  const g = await geocodeSale(addr, name);
  if (xsel !== 's' + id) return;
  const sv = document.getElementById('sv');
  if (!g) {
    if (sv) sv.innerHTML = '<div class="note">주소로 위치를 찾지 못해 지도에는 표시하지 못했어요.</div>';
    return;
  }
  salePin = { id, name, lat: g[0], lon: g[1], date: String(r.RCRIT_PBLANC_DE || '').slice(2, 7) };
  renderExtraPins();
  map.setLevel(5);
  map.panTo(new kakao.maps.LatLng(g[0], g[1]));
  if (r._o) {
    if (sv) sv.innerHTML = '<div class="note">오피스텔은 분양권 전매 실거래 공개 자료가 없어요. 분양가는 청약홈 주택형별 최고가 기준이에요.</div>';
    return;
  }
  const b = await new Promise(res =>
    geocoder.coord2RegionCode(g[1], g[0], (rr, st) => {
      if (st !== kakao.maps.services.Status.OK) return res(null);
      res(rr.find(x => x.region_type === 'B') || null);
    }),
  );
  if (!b || !b.code || xsel !== 's' + id) return;
  const c5 = String(b.code).slice(0, 5);
  X.err = [];
  await ensureSilv(new Set([c5]));
  if (xsel !== 's' + id) return;
  const key = nn(name),
    cutd = cutoff(),
    tr = [];
  for (const gp of SILVG.values()) {
    if (gp.code !== c5 && !(LEGACY[c5] || []).includes(gp.code)) continue;
    const k2 = nn(gp.name);
    if (k2 && key && (k2.includes(key) || key.includes(k2))) tr.push(...gp.trades.filter(t => t[0] >= cutd));
  }
  if (sv)
    sv.innerHTML =
      `<div class="sec">분양권·입주권 실거래 (최근 ${S.months}개월, ${tr.length}건)</div>` +
      (tr.length
        ? silvTable(tr)
        : `<div class="note">${X.err.length ? esc(X.err.join(' / ')) : '단지명이 일치하는 분양권·입주권 거래가 없어요. 신고 단지명이 다르면 실거래 탭의 보라색 핀에서 찾을 수 있어요.'}</div>`);
}
function openSilv(key) {
  const g = X.silv.find(s => s.key === key);
  if (!g) return;
  xsel = 'v' + key;
  noticeSel = null;
  S.sel = null;
  renderPins();
  renderExtraPins();
  renderNoticePins();
  const el = $('#detail');
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest' });
  const am = g.trades.map(t => t[3]);
  el.innerHTML =
    `<button class="x" id="dx">닫기</button><h2>${esc(g.name)}</h2><div class="ad">${esc(g.addr)} · 분양권·입주권 거래 단지</div>` +
    `<div class="kv"><div><small>거래 ${g.trades.length}건 중위</small><b>${eokFull(med(am))}</b></div><div><small>최고</small><b>${eokFull(Math.max(...am))}</b></div><div><small>최저</small><b>${eokFull(Math.min(...am))}</b></div></div>` +
    `<div class="sec">분양권·입주권 실거래 (최근 ${S.months}개월)</div>` +
    silvTable(g.trades) +
    '<div class="note">아직 단지 목록에 없는(입주 전) 단지예요. 위치는 신고 지번을 좌표로 바꾼 값이라 실제와 조금 다를 수 있어요.</div>';
  $('#dx').onclick = () => {
    xsel = null;
    el.hidden = true;
    renderExtraPins();
  };
}
