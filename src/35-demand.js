// 수요·공급 자료: 인구·세대, 연령 구성, 입주예정 물량 (상세자료 PPT용 쪽 포함)
// 인구·세대: 행정안전부 법정동별 주민등록 인구 및 세대현황 (월 기준, 2022.10부터)
const POP_API = 'https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus';
async function popFetch(code, ym, lv, api) {
  let key = KEY;
  try {
    key = decodeURIComponent(KEY);
  } catch (e) {}
  let r;
  try {
    r = await fetch(
      (api || POP_API) +
        '?' +
        new URLSearchParams({ serviceKey: key, stdgCd: code, srchFrYm: ym, srchToYm: ym, lv, regSeCd: 1, type: 'JSON', numOfRows: 100, pageNo: 1 }),
    );
  } catch (e) {
    throw new Error('네트워크 오류로 인구 자료를 받지 못했습니다');
  }
  let j;
  try {
    j = JSON.parse(await r.text());
  } catch (e) {
    throw new Error('인구 API 응답을 해석하지 못했습니다 (HTTP ' + r.status + ')');
  }
  if (j.OpenAPI_ServiceResponse)
    throw new Error('인구 API 오류: ' + ((j.OpenAPI_ServiceResponse.cmmMsgHeader || {}).returnAuthMsg || 'HTTP ' + r.status));
  const R = j.Response,
    head = R && R.head;
  if (!head || String(head.resultCode) !== '0') throw new Error('인구 API 오류: ' + ((head && head.resultMsg) || 'HTTP ' + r.status));
  const it = R.items && R.items.item;
  return it ? [].concat(it) : [];
}
async function popData(reg) {
  const sgg = String(reg.code).slice(0, 5) + '00000',
    now = new Date();
  let ym0 = 0;
  for (let k = 1; k <= 4 && !ym0; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1),
      ym = d.getFullYear() * 100 + d.getMonth() + 1;
    try {
      if ((await popFetch(sgg, ym, 6)).length) ym0 = ym;
    } catch (e) {
      if (/서비스키|등록|인증|네트워크/.test(e.message) || k === 4) throw e;
    }
  }
  if (!ym0) throw new Error('최근 월의 인구 자료가 없습니다');
  const yms = [];
  for (let y = 0; y <= 4; y++) {
    const ym = ym0 - y * 100;
    if (ym >= 202210) yms.push(ym);
  }
  yms.reverse();
  const ser = await Promise.all(
    yms.map(async ym => {
      const [a, b] = await Promise.all([popFetch(sgg, ym, 6), popFetch(sgg, ym, 3)]);
      const g = x => ({ pop: +x.totNmprCnt || 0, hh: +x.hhCnt || 0, name: x.stdgNm || '', sgg: x.sggNm || '', code: x.stdgCd || '' });
      return { ym, s: a[0] ? g(a[0]) : null, d: b.map(g).filter(x => x.name) };
    }),
  );
  return { ym0, ser, sggName: (ser[ser.length - 1].s || {}).sgg || '' };
}
// 연령 구성: 행정안전부 성/연령별 주민등록 인구 (10세 단위, 시군구·읍면동)
const AGE_API = 'https://apis.data.go.kr/1741000/stdgSexdAgePpltn/selectStdgSexdAgePpltn';
const AGE_GRP = [
  ['0~9세', [0]],
  ['10대', [10]],
  ['20대', [20]],
  ['30대', [30]],
  ['40대', [40]],
  ['50대', [50]],
  ['60대', [60]],
  ['70대', [70]],
  ['80세 이상', [80, 90, 100]],
];
function ageBuckets(x) {
  const v = a => (+x['male' + a + 'AgeNmprCnt'] || 0) + (+x['feml' + a + 'AgeNmprCnt'] || 0);
  const b = AGE_GRP.map(g => g[1].reduce((s, a) => s + v(a), 0));
  return { b, tot: +x.totNmprCnt || b.reduce((s, a) => s + a, 0) };
}
async function ageData(reg, ym) {
  const sgg = String(reg.code).slice(0, 5) + '00000';
  const [a, b] = await Promise.all([popFetch(sgg, ym, 6, AGE_API), popFetch(sgg, ym, 3, AGE_API)]);
  if (!a[0]) throw new Error('연령별 인구 자료가 없습니다');
  const d3 = String(reg.region_3depth_name || '').split(' ')[0],
    dongRow = b.find(x => x.stdgNm === d3) || b.find(x => String(x.stdgCd) === String(reg.code)) || null;
  return {
    sgg: Object.assign({ name: a[0].sggNm || '' }, ageBuckets(a[0])),
    dong: dongRow ? Object.assign({ name: dongRow.stdgNm }, ageBuckets(dongRow)) : null,
  };
}
async function addAgeSlide(K, pd) {
  const { pres, page, kpi, tbl, cell, TH, chartBase, F, LX, LW, NAVY, INK, MUTE, GOLD, GOLDBG, n } = K;
  let ad = null,
    err = '';
  try {
    if (!pd || !pd.ym0) throw new Error('인구 기준월을 알 수 없습니다');
    ad = await ageData(K.reg, pd.ym0);
  } catch (e) {
    err = e.message || '조회하지 못했습니다';
  }
  let sl;
  if (!ad) {
    sl = page('연령 구성 자료를 불러오지 못했습니다', 'DEMAND · AGE');
    sl.addText(err || '조회 결과가 없습니다.', {
      x: LX,
      y: 1.5,
      w: LW,
      h: 0.4,
      fontFace: F,
      fontSize: 11,
      color: MUTE,
      margin: 0,
      isTextBox: true,
    });
    return;
  }
  const S0 = ad.sgg,
    D0 = ad.dong,
    base = D0 || S0,
    sh = (o, idx) => (o.tot ? (idx.reduce((s, i) => s + o.b[i], 0) / o.tot) * 100 : 0),
    f1 = v => v.toFixed(1) + '%';
  const grp = [
    ['20~30대', [2, 3]],
    ['40~50대', [4, 5]],
    ['60대 이상', [6, 7, 8]],
  ];
  const nm = base.name,
    who = D0 ? `${D0.name}` : `${S0.name}`;
  sl = page(
    `${who} 20~30대 ${f1(sh(base, [2, 3]))}, 40~50대 ${f1(sh(base, [4, 5]))}, 60대 이상 ${f1(sh(base, [6, 7, 8]))}${D0 ? ` · ${S0.name} ${f1(sh(S0, [2, 3]))} / ${f1(sh(S0, [4, 5]))} / ${f1(sh(S0, [6, 7, 8]))}` : ''}`,
    'DEMAND · AGE',
  );
  const kg = 0.21,
    kw3 = (LW - kg * 2) / 3;
  grp.forEach((g, i) => {
    const a = sh(base, g[1]),
      b = sh(S0, g[1]);
    kpi(
      sl,
      LX + (kw3 + kg) * i,
      1.4,
      kw3,
      `${nm} ${g[0]} 비중`,
      f1(a),
      D0 ? `${S0.name} ${f1(b)} (${a - b >= 0 ? '+' : ''}${(a - b).toFixed(1)}%p)` : '시군구 기준(대상 동 자료 없음)',
    );
  });
  sl.addText('연령대별 인구 비중 (%)', {
    x: LX,
    y: 2.75,
    w: 7.2,
    h: 0.26,
    fontFace: F,
    fontSize: 11,
    bold: true,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  const lbl = AGE_GRP.map(g => g[0]),
    ser = [{ name: S0.name, labels: lbl, values: S0.b.map(v => Math.round((v / S0.tot) * 1000) / 10) }];
  if (D0) ser.push({ name: D0.name, labels: lbl, values: D0.b.map(v => Math.round((v / D0.tot) * 1000) / 10) });
  sl.addChart(
    pres.ChartType.bar,
    ser,
    Object.assign(chartBase(), {
      x: LX,
      y: 3.05,
      w: 7.3,
      h: 3.15,
      barDir: 'col',
      barGrouping: 'clustered',
      chartColors: D0 ? [NAVY, GOLD] : [NAVY],
      showValue: true,
      dataLabelFormatCode: '0.0',
      dataLabelFontSize: 7.5,
      barGapWidthPct: 40,
      showLegend: true,
      legendPos: 't',
      legendFontSize: 9,
      legendFontFace: F,
    }),
  );
  sl.addText('연령대별 인구 (명)', {
    x: LX + 7.55,
    y: 2.75,
    w: 4.6,
    h: 0.26,
    fontFace: F,
    fontSize: 11,
    bold: true,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  const head = ['연령대', S0.name].concat(D0 ? [D0.name] : []).map(TH);
  const rows = AGE_GRP.map((g, i) => {
    const st = {};
    return [cell(g[0], { align: 'left' }), cell(n(S0.b[i]))].concat(D0 ? [cell(n(D0.b[i]), { fill: { color: GOLDBG } })] : []);
  });
  rows.push(
    [cell('합계', { bold: true, align: 'left' }), cell(n(S0.tot), { bold: true })].concat(
      D0 ? [cell(n(D0.tot), { bold: true, fill: { color: GOLDBG } })] : [],
    ),
  );
  tbl(sl, [head].concat(rows), LX + 7.55, 3.05, 4.6, D0 ? [1.4, 1.6, 1.6] : [2.0, 2.6], 8.5, 0.29);
  sl.addText(
    [
      `행정안전부 성/연령별 주민등록 인구(${String(pd.ym0).slice(0, 4)}년 ${+String(pd.ym0).slice(4)}월 기준, 10세 단위). 연령 구간은 공공데이터가 10세 단위로만 제공해 65세 이상 등 다른 구간은 만들 수 없습니다.`,
      '비중은 해당 지역 전체 주민등록 인구 중 연령대 인구의 비율입니다. 20~30대는 신혼·1~2인 가구, 40~50대는 자녀 양육·교체 수요, 60대 이상은 고령 가구로 읽는 참고 기준이며 실제 매수층은 별도로 판단해야 합니다.',
    ].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
    { x: LX, y: 6.3, w: LW, h: 0.62, fontFace: F, fontSize: 8.5, color: MUTE, margin: 0, valign: 'top', paraSpaceAfter: 3, isTextBox: true },
  );
}
// 공급분석 — 입주예정물량: 청약홈 분양공고(최근 3년)의 입주예정월 기준. 인허가·착공물량은 포함하지 않는다.
async function addSupplySlide(K, pd) {
  const { pres, page, kpi, tbl, cell, TH, chartBase, F, LX, LW, NAVY, INK, MUTE, GOLD, GOLDBG, n, d2, d3, sido } = K,
    offi = S.asset === 'offi',
    unit = offi ? '실' : '세대';
  let rows = [],
    err = '',
    total = 0;
  try {
    const all = await salesOf(sido);
    total = all.length;
    rows = all.filter(
      r =>
        String(r.HSSPLY_ADRES || '').includes(d2) &&
        /^\d{6}$/.test(String(r.MVN_PREARNGE_YM || '')) &&
        (!offi || typeOf(r).includes('오피스텔')) &&
        !/무순위|잔여세대|취소분|추가\s*모집|자격상실|계약취소|재공급/.test(String(r.HOUSE_NM || '')),
    );
  } catch (e) {
    err = e.message || e.msg || '청약홈 자료를 받지 못했습니다';
  }
  const now = new Date(),
    ym0 = now.getFullYear() * 100 + now.getMonth() + 1,
    ymEnd = (() => {
      const d = new Date(now.getFullYear(), now.getMonth() + 36, 1);
      return d.getFullYear() * 100 + d.getMonth() + 1;
    })();
  const seen = new Set(),
    list = [];
  rows
    .slice()
    .sort((a, b) => String(b.RCRIT_PBLANC_DE || '').localeCompare(String(a.RCRIT_PBLANC_DE || '')))
    .forEach(r => {
      const k = String(r.HOUSE_NM || '').replace(/\s/g, '') + '|' + String(r.HSSPLY_ADRES || '').replace(/\s/g, '');
      if (seen.has(k)) return;
      seen.add(k);
      list.push({
        nm: r.HOUSE_NM || '',
        ad: String(r.HSSPLY_ADRES || ''),
        ym: +r.MVN_PREARNGE_YM,
        hh: +r.TOT_SUPLY_HSHLDCO || 0,
        de: r.RCRIT_PBLANC_DE || '',
        mine: !!d3 && String(r.HSSPLY_ADRES || '').includes(d3),
      });
    });
  const fut = list.filter(x => x.ym >= ym0 && x.ym <= ymEnd).sort((a, b) => a.ym - b.ym || b.hh - a.hh),
    later = list.filter(x => x.ym > ymEnd).length;
  let sl;
  if (err || !fut.length) {
    sl = page(
      err ? '입주예정 자료를 불러오지 못했습니다' : `${d2} 향후 3년 입주예정 물량이 청약홈 공고에서 확인되지 않았습니다`,
      'SUPPLY · MOVE-IN',
    );
    sl.addText(
      err ||
        `청약홈 최근 3년 공고 ${n(total)}건 중 ${d2} ${offi ? '오피스텔' : '아파트'}로서 향후 36개월 안에 입주예정인 단지가 없습니다. 분양공고 없이 공급되는 물량(인허가·착공 단계 포함)은 이 쪽에 반영되지 않습니다.`,
      { x: LX, y: 1.5, w: LW, h: 0.8, fontFace: F, fontSize: 11, color: MUTE, margin: 0, valign: 'top', isTextBox: true },
    );
    return;
  }
  const sum = a => a.reduce((s, x) => s + x.hh, 0),
    yrOf = x => Math.floor(x.ym / 100),
    Yc = now.getFullYear();
  const mineAll = fut.filter(x => x.mine),
    tot = sum(fut),
    hh0 = pd && pd.ser && pd.ser[pd.ser.length - 1].s ? pd.ser[pd.ser.length - 1].s.hh : 0;
  sl = page(
    `${d2} 향후 3년 입주예정 ${n(tot)}${unit}(${fut.length}개 단지)${hh0 && !offi ? ` · 현재 세대수 대비 ${((tot / hh0) * 100).toFixed(1)}%` : ''}${mineAll.length ? ` · ${d3} ${n(sum(mineAll))}${unit}` : ''}`,
    'SUPPLY · MOVE-IN',
  );
  const kg = 0.21,
    kw3 = (LW - kg * 2) / 3,
    byY = y => sum(fut.filter(x => yrOf(x) === y));
  kpi(sl, LX, 1.4, kw3, `${Yc}년 잔여 입주예정`, `${n(byY(Yc))}${unit}`, `${d2} 청약홈 공고 단지 기준`);
  kpi(
    sl,
    LX + kw3 + kg,
    1.4,
    kw3,
    `${Yc + 1}년 입주예정`,
    `${n(byY(Yc + 1))}${unit}`,
    `${Yc + 2}년 ${n(byY(Yc + 2))}${unit} · ${Yc + 3}년 ${n(byY(Yc + 3))}${unit}`,
  );
  kpi(
    sl,
    LX + (kw3 + kg) * 2,
    1.4,
    kw3,
    d3 ? `${d3} 입주예정 (36개월)` : '대상지 동',
    mineAll.length ? `${n(sum(mineAll))}${unit} (${mineAll.length}개 단지)` : '없음',
    mineAll.length
      ? mineAll
          .slice(0, 2)
          .map(x =>
            x.nm
              .replace(/\(.*?\)/g, '')
              .trim()
              .slice(0, 12),
          )
          .join(', ')
      : `${d3 || '대상 동'} 주소의 공고 단지가 없음`,
  );
  const qOf = ym => {
      const y = Math.floor(ym / 100),
        m = ym % 100;
      return y * 10 + Math.ceil(m / 3);
    },
    qs = [];
  {
    let y = now.getFullYear(),
      q = Math.ceil((now.getMonth() + 1) / 3);
    for (let i = 0; i < 12; i++) {
      qs.push(y * 10 + q);
      if (++q > 4) {
        q = 1;
        y++;
      }
    }
  }
  const qv = qs.map(q => sum(fut.filter(x => qOf(x.ym) === q))),
    ql = qs.map(q => `'${String(Math.floor(q / 10)).slice(2)} ${q % 10}Q`);
  sl.addText(`${d2} 분기별 입주예정 (${unit})`, {
    x: LX,
    y: 2.75,
    w: 6.0,
    h: 0.26,
    fontFace: F,
    fontSize: 11,
    bold: true,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  sl.addChart(
    pres.ChartType.bar,
    [{ name: '입주예정', labels: ql, values: qv }],
    Object.assign(chartBase(), {
      x: LX,
      y: 3.05,
      w: 6.0,
      h: 3.15,
      barDir: 'col',
      chartColors: [NAVY],
      showValue: true,
      dataLabelFormatCode: '#,##0',
      dataLabelFontSize: 7.5,
      barGapWidthPct: 40,
    }),
  );
  sl.addText('입주예정 단지 (입주 빠른 순)', {
    x: LX + 6.25,
    y: 2.75,
    w: 5.9,
    h: 0.26,
    fontFace: F,
    fontSize: 11,
    bold: true,
    color: INK,
    margin: 0,
    isTextBox: true,
  });
  const dongOf = ad => (ad.replace(/\(.*?\)/g, ' ').match(/\s([가-힣0-9]+(?:동|읍|면|리|가))(?:\s|$|\d)/) || [])[1] || '';
  const tr = fut.slice(0, 10).map(x => {
    const st = x.mine ? { bold: true, fill: { color: GOLDBG } } : {};
    return [
      cell(
        x.nm
          .replace(/\(.*?\)/g, '')
          .trim()
          .slice(0, 16),
        Object.assign({ align: 'left' }, st),
      ),
      cell(dongOf(x.ad), st),
      cell(n(x.hh), st),
      cell(String(x.ym).replace(/(\d{4})(\d{2})/, '$1.$2'), st),
    ];
  });
  tbl(sl, [['단지', '동', unit, '입주예정'].map(TH)].concat(tr), LX + 6.25, 3.05, 5.9, [2.6, 1.1, 0.9, 1.3], 8.5, 0.29);
  sl.addText(
    [
      `청약홈 분양공고(최근 3년, 입주예정월이 있는 단지) 기준이며 무순위·잔여세대 재공고는 중복으로 보고 뺐습니다. 입주예정월은 공고 당시 예정이라 실제와 달라질 수 있습니다.${later ? ` 36개월 뒤 입주 예정 ${later}개 단지는 제외했습니다.` : ''}${fut.length > 10 ? ` 표에는 ${fut.length}개 중 10개만 실었습니다.` : ''}`,
      '인허가·착공 단계의 물량, 분양공고 없이 공급되는 물량, 정비사업·택지 예정물량, 공공임대는 포함하지 않아 실제 공급은 이보다 많을 수 있습니다(시장 판단 때 별도로 감안).' +
        (offi ? ' 오피스텔은 청약홈 공고 대상 단지만 잡힙니다.' : ''),
    ].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
    { x: LX, y: 6.3, w: LW, h: 0.62, fontFace: F, fontSize: 8.5, color: MUTE, margin: 0, valign: 'top', paraSpaceAfter: 3, isTextBox: true },
  );
}
