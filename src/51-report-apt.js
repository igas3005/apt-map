// 아파트 시장조사 PPT (기초자료·상세자료)
async function makeReport(detail) {
  if (!S.center) return status('먼저 주소를 검색해 대상지를 정해 주세요.', true);
  if (!KEY) return status('국토부 인증키를 입력한 뒤 눌러 주세요.', true);
  const btn = $('#rpt'),
    btn2 = $('#rpt2');
  btn.disabled = true;
  if (btn2) btn2.disabled = true;
  try {
    status('기초자료 준비 중… 대상지 확인');
    const reg = await centerRegion();
    if (!reg || !reg.code) throw new Error('대상지의 행정구역을 확인하지 못했어요.');
    const code5 = String(reg.code).slice(0, 5),
      d1 = reg.region_1depth_name || '',
      d2 = reg.region_2depth_name || '',
      d3 = reg.region_3depth_name || '';
    const Y = S.asOf.getFullYear(),
      cut1 = ymdAgo(12),
      cut2 = ymdAgo(24),
      MAXR = 3000;
    const steps = [500, 1000, 2000, 3000].filter(v => v >= S.rad);
    if (!steps.length) steps.push(S.rad);
    const near = nearby(S.center.lat, S.center.lon, Math.max(MAXR, S.rad));
    if (!near.length) throw new Error('대상지 주변에 단지 목록에 등록된 아파트가 없어요.');
    const fetchInfo = async (list, label) => {
      let k = 0,
        dn = 0;
      const w = async () => {
        while (k < list.length && !bldErr) {
          const c = list[k++];
          try {
            BLDC.put(bkey(c), await fetchBld(c));
          } catch (e) {
            if (e.kind === 'key' || e.kind === 'net') bldErr = e;
          }
          status(`기초자료 준비 중… ${label} ${++dn}/${list.length}`);
        }
      };
      await Promise.all([w(), w(), w()]);
    };
    const yearOf = c => BY.get(c.id) || (BLD[bkey(c)] && BLD[bkey(c)][1]) || 0;
    const mk = c => {
      const all = tradesOf(c.id),
        t1 = all.filter(t => t[0] >= cut1),
        tr = t1.length ? t1 : all.filter(t => t[0] >= cut2),
        b = BLD[bkey(c)];
      return {
        c,
        tr,
        all: all.filter(t => t[0] >= cut2),
        span: t1.length ? 1 : 2,
        year: yearOf(c),
        hh: (b && b[0]) || 0,
        up: (b && b[2]) || 0,
        dn: (b && b[3]) || 0,
        ratio: (b && b[6]) || 0,
        d: hav(S.center.lat, S.center.lon, c.lat, c.lon),
      };
    };
    // 반경을 넓혀 가며 준공 5년 이내 단지가 3개 이상 잡히는 첫 반경을 쓴다 (최대 3km)
    let radUsed = steps[0],
      cand = [],
      t5 = [],
      t10 = [];
    for (const R of steps) {
      cand = near.filter(i => i.d <= R).map(i => C[i.id]);
      radUsed = R;
      const cs = new Set(cand.map(c => c.code));
      status(`기초자료 준비 중… 반경 ${R >= 1000 ? R / 1000 + 'km' : R + 'm'} 실거래 조회 (단지 ${cand.length}개)`);
      await ensureTrades(cs, 24);
      if (S.liveErr) throw new Error(liveErrText(S.liveErr));
      await fetchInfo(cand.filter(c => !BY.get(c.id) && BLD[bkey(c)] === undefined).slice(0, 60), '단지 준공연도 확인');
      const rr = cand.map(mk);
      t5 = rr.filter(r => r.year && Y - r.year <= 5);
      t10 = rr.filter(r => r.year && Y - r.year <= 10);
      if (t5.length >= 3) break;
    }
    const codes = new Set(cand.map(c => c.code));
    codes.add(code5);
    X.err = [];
    await ensureSilv(codes, 24);
    const rows = cand.map(mk),
      radTxt = radUsed >= 1000 ? radUsed / 1000 + 'km' : radUsed + 'm',
      radAsk = S.rad >= 1000 ? S.rad / 1000 + 'km' : S.rad + 'm';
    const umdSet = new Set(cand.map(c => c.umd.split(' ').pop())),
      ym1 = String(cut1).slice(0, 6),
      unmG = new Map();
    for (const u of UNM) {
      if (u.ym < ym1 || (!codes.has(u.f) && ![...codes].some(c => (LEGACY[c] || []).includes(u.f)))) continue;
      if (!umdSet.has(String(u.umd).split(' ').pop())) continue;
      const k = u.name + ' ' + u.jibun;
      unmG.set(k, (unmG.get(k) || 0) + 1);
    }
    const unmN = [...unmG.values()].reduce((a, x) => a + x, 0),
      unmEx = [...unmG.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, c]) => `${k}(${c}건)`)
        .join(', ');
    const noYear = rows.filter(r => !r.year).length;
    const tiers = [
      [rows.filter(r => r.year && Y - r.year <= 5), '준공 5년 이내'],
      [rows.filter(r => r.year && Y - r.year <= 10), '준공 10년 이내'],
      [rows, '전체 연차'],
    ];
    const hit = tiers.find(t => t[0].length >= 3) || tiers.find(t => t[0].length) || tiers[2];
    let pick = hit[0].slice(),
      tier = hit[1];
    const tierNote =
      pick.length < 3 ? ` (반경 ${radTxt} 안 비교 단지 ${pick.length}개)` : tier === '준공 5년 이내' ? '' : ' (5년 이내 단지 3개 미만)';
    // 세대수·층수·공급면적 비율: 대상 단지만 추가 조회
    await fetchInfo(
      pick.map(r => r.c).filter(c => BLD[bkey(c)] === undefined),
      '단지 세대수·면적 확인',
    );
    pick = pick.map(r => mk(r.c));
    pick.sort((a, b) => a.d - b.d);
    const cutN = pick.length > 30 ? pick.length - 30 : 0;
    if (cutN) pick = pick.slice(0, 30);
    // 주변 분양 (청약홈): 최근 2년, 반경 3km 이내 → 없으면 같은 시·군 가까운 순 3건
    status('기초자료 준비 중… 주변 분양 단지 확인');
    let sales = [],
      saleNote = '',
      saleFar = false;
    const noGeo = [];
    const saleR = Math.max(radUsed, 3000),
      saleRTxt = saleR / 1000 + 'km';
    try {
      const sido = SIDO_OF[code5.slice(0, 2)],
        from = String(cut2).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        city = d2.split(' ')[0];
      const rowsS = (await salesOf(sido)).filter(r0 => String(r0.RCRIT_PBLANC_DE || '') >= from && String(r0.HSSPLY_ADRES || '').includes(city));
      let k = 0;
      const geo = [];
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (k < rowsS.length) {
            const r0 = rowsS[k++];
            const p = await geocodeSale(r0.HSSPLY_ADRES, r0.HOUSE_NM);
            if (p) geo.push({ r0, lat: p[0], lon: p[1], approx: p[2], d: hav(S.center.lat, S.center.lon, p[0], p[1]) });
            else noGeo.push(r0);
          }
        }),
      );
      geo.sort((a, b) => a.d - b.d);
      sales = geo.filter(x => x.d <= saleR);
      if (!sales.length && geo.length) {
        sales = geo.slice(0, 3);
        saleFar = true;
      }
      if (!rowsS.length)
        saleNote =
          ST.log && !SALES.has(sido) ? '청약홈 서버가 자료를 주지 않아 분양 사례를 넣지 못했습니다.' : '최근 2년 내 청약홈 공고가 없습니다.';
      else if (!geo.length) saleNote = '분양 단지의 위치를 확인하지 못했습니다.';
    } catch (e) {
      saleNote = '청약홈 분양정보를 조회하지 못했습니다.';
    }
    sales = sales.slice(0, 9);
    status('기초자료 준비 중… PPT 작성');
    await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js');
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    pres.title = detail ? '공동주택 시장조사 상세자료' : '공동주택 시장조사 기초자료'; // 13.33 x 7.5 in
    const K0 = reportKit(pres, '국토교통부 실거래가 공개시스템, K-apt, 청약홈');
    const { F, FH, NAVY, INK, MUTE, LINE, BG, ACC, GOLD, GOLDBG, ZEBRA, WARN, LX, LW, today, n, mean, TH, cell, tbl, page, kpi, chartBase } = K0;
    const rOf = r => r.ratio || SUPPLY,
      ppy = (r, t) => t[3] / ((t[1] * rOf(r)) / PY),
      pyR = (r, a) => Math.round((a * rOf(r)) / PY);
    const area = `${d1} ${d2} ${d3}`.trim();
    // 집계
    const pairs1 = pick.flatMap(r => r.all.filter(t => t[0] >= cut1).map(t => [r, t])),
      pairs0 = pick.flatMap(r => r.all.filter(t => t[0] < cut1).map(t => [r, t]));
    const mp1 = pairs1.length ? med(pairs1.map(([r, t]) => ppy(r, t))) : null,
      mp0 = pairs0.length ? med(pairs0.map(([r, t]) => ppy(r, t))) : null,
      chg = mp1 && mp0 ? (mp1 / mp0 - 1) * 100 : null;
    const chgTxt = chg == null ? '비교 불가' : (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%';
    const bk = t => Math.floor(t[1] + 1e-6); // 전용면적은 소수점 버림 (84.97㎡→84, 59.98㎡→59)
    const stOf = (r, k) => {
      const v = r.tr.filter(t => bk(t) === k);
      if (!v.length) return null;
      const am = v.map(t => t[3]);
      return { cnt: v.length, med: med(am), max: Math.max(...am), min: Math.min(...am), ppy: med(v.map(t => ppy(r, t))) };
    };
    const sumOf = r => {
      if (!r.tr.length) return null;
      const b = dominant(r.tr, true),
        am = b.v.map(t => t[3]);
      return { type: b.k, cnt: r.tr.length, med: med(am), max: Math.max(...am), min: Math.min(...am), ppy: med(b.v.map(t => ppy(r, t))) };
    };
    const det = pick.filter(r => r.tr.length),
      noTr = pick.filter(r => !r.tr.length);
    const estN = det.filter(r => !r.ratio).length;

    // 표지
    status('기초자료 준비 중… 위치도 작성');
    const mapPts = pick.slice(0, 30),
      salePts = sales.slice(0, 8),
      mi = await mapImage(
        S.center,
        mapPts.map(r => ({ lat: r.c.lat, lon: r.c.lon })),
        1640,
        1100,
        salePts.map(x => ({ lat: x.lat, lon: x.lon })),
      ),
      far = Math.max(...mapPts.map(r => r.d));
    coverSlide(
      K0,
      mi,
      '공동주택\n시장조사 기초자료',
      area,
      `대상지  ${S.center.label || area}\n조사 범위  반경 ${radTxt} 아파트 ${cand.length}개 단지 중 ${pick.length}개 (${tier}${tierNote})\n주변 분양  ${sales.length}건`,
    );
    let sl;

    // 요약
    const p84 = pairs1.filter(([r, t]) => bk(t) === 84),
      p59 = pairs1.filter(([r, t]) => bk(t) === 59),
      mA = a => (a.length ? n(med(a.map(([r, t]) => t[3]))) : null),
      pA = a => (a.length ? n(med(a.map(([r, t]) => ppy(r, t)))) : null);
    const hp = [p84.length ? `84㎡ 중위 ${mA(p84)}만원(${p84.length}건)` : '', p59.length ? `59㎡ 중위 ${mA(p59)}만원(${p59.length}건)` : '']
      .filter(Boolean)
      .join(', ');
    sl = page(
      hp
        ? `반경 ${radTxt} ${tier} ${pick.length}개 단지, 최근 1년 ${hp}`
        : mp1
          ? `반경 ${radTxt} ${tier} ${pick.length}개 단지, 최근 1년 중위 평당가 ${n(mp1)}만원 (직전 1년 대비 ${chgTxt})`
          : `반경 ${radTxt} ${tier} ${pick.length}개 단지, 최근 1년 실거래 없음`,
      'EXECUTIVE SUMMARY',
    );
    const kw = 2.9,
      kg = 0.21;
    kpi(sl, LX, 1.4, kw, '대상 단지', `${pick.length}개`, `반경 ${radTxt} 내 ${cand.length}개 중 · ${tier}`);
    kpi(sl, LX + (kw + kg), 1.4, kw, '최근 1년 거래', `${n(pairs1.length)}건`, `직전 1년 ${n(pairs0.length)}건 · 평당가 ${chgTxt}`);
    kpi(
      sl,
      LX + (kw + kg) * 2,
      1.4,
      kw,
      '84㎡ 중위 실거래가',
      p84.length ? `${mA(p84)}만원` : '-',
      p84.length ? `최근 1년 ${p84.length}건 · 평당 ${pA(p84)}만원` : '최근 1년 84㎡ 거래 없음',
    );
    kpi(
      sl,
      LX + (kw + kg) * 3,
      1.4,
      kw,
      '59㎡ 중위 실거래가',
      p59.length ? `${mA(p59)}만원` : '-',
      p59.length ? `최근 1년 ${p59.length}건 · 평당 ${pA(p59)}만원` : '최근 1년 59㎡ 거래 없음',
    );
    const kBar = det.some(r => stOf(r, 84)) ? 84 : det.some(r => stOf(r, 59)) ? 59 : 0;
    const bars = (
      kBar
        ? det
            .filter(r => stOf(r, kBar))
            .map(r => ({ name: r.c.name.length > 14 ? r.c.name.slice(0, 14) + '…' : r.c.name, v: Math.round(stOf(r, kBar).med) }))
        : det.map(r => ({ name: r.c.name.length > 14 ? r.c.name.slice(0, 14) + '…' : r.c.name, v: Math.round(sumOf(r).ppy) }))
    )
      .sort((a, b) => b.v - a.v)
      .slice(0, 10)
      .reverse();
    const nBarAll = kBar ? det.filter(r => stOf(r, kBar)).length : det.length,
      noK = kBar ? det.filter(r => !stOf(r, kBar)) : [];
    const barNote =
      (kBar === 84
        ? '84㎡(국민평형) 실거래가 있는 ' +
          nBarAll +
          '개 단지만 그렸습니다. 같은 면적끼리 비교하려는 기준이라 해당 면적 거래가 없는 단지는 제외합니다.'
        : kBar === 59
          ? '대상 단지에 84㎡ 거래가 없어 59㎡ 기준으로 그렸습니다(거래 있는 ' + nBarAll + '개 단지). 같은 면적끼리 비교하려는 기준입니다.'
          : '84㎡·59㎡ 거래가 모두 없어 단지별 주력 면적 중위 평당가로 비교했습니다.') +
      (noK.length
        ? ` ${kBar}㎡ 거래 없음 ${noK.length}개: ${noK
            .slice(0, 4)
            .map(r => r.c.name)
            .join(', ')}${noK.length > 4 ? ' 외 ' + (noK.length - 4) + '개' : ''}.`
        : '') +
      (nBarAll > 10 ? ` 상위 10개만 표시(전체 ${nBarAll}개).` : '');
    sl.addText(kBar ? `단지별 ${kBar}㎡ 중위 실거래가 (만원)` : '단지별 평당가 (주력 면적타입 중위, 만원)', {
      x: LX,
      y: 2.8,
      w: 7.4,
      h: 0.26,
      fontFace: F,
      fontSize: 11,
      bold: true,
      color: INK,
      margin: 0,
      isTextBox: true,
    });
    if (bars.length)
      sl.addChart(
        pres.ChartType.bar,
        [{ name: kBar ? '중위 실거래가' : '평당가', labels: bars.map(b => b.name), values: bars.map(b => b.v) }],
        Object.assign(chartBase(), {
          x: LX,
          y: 3.08,
          w: 7.4,
          h: 3.3,
          barDir: 'bar',
          chartColors: [NAVY],
          showValue: true,
          dataLabelPosition: 'outEnd',
          barGapWidthPct: 55,
          valAxisMinVal: 0,
        }),
      );
    else
      sl.addText('기간 내 거래가 없어 차트를 그리지 못했습니다.', {
        x: LX,
        y: 3.2,
        w: 7.4,
        h: 0.3,
        fontFace: F,
        fontSize: 10,
        color: MUTE,
        margin: 0,
        isTextBox: true,
      });
    sl.addText(barNote, { x: LX, y: 6.45, w: 7.4, h: 0.5, fontFace: F, fontSize: 8.5, color: MUTE, margin: 0, valign: 'top', isTextBox: true });
    sl.addShape(pres.ShapeType.rect, { x: 8.1, y: 2.72, w: 4.68, h: 4.2, fill: { color: BG }, line: { color: BG, width: 0 } });
    sl.addText('조사 기준', { x: 8.3, y: 2.85, w: 4.4, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
    sl.addText(
      [
        `범위: 대상지 반경 ${radTxt} 안 아파트 (선택 반경 ${radAsk}${radUsed > S.rad ? ', 비교 단지가 3개 미만이라 확대' : ''})`,
        `연차: 준공 5년 이내 우선(3개 이상), 아니면 10년 이내, 아니면 전체 → 이번 자료는 ${tier}${tierNote}`,
        '실거래: 단지별 최근 1년, 1년 내 거래가 없는 단지는 최근 2년',
        `평당가: 공급면적 기준. 단지별 공급/전용 비율은 K-apt 값을 쓰고, 없는 ${estN}개 단지는 전용 × 1.32로 추정`,
        noTr.length ? `최근 2년 거래가 없는 단지 ${noTr.length}개는 요약표에만 표시` : '대상 단지 모두 최근 2년 내 거래 있음',
        `차트: ${kBar ? kBar + '㎡ 거래가 있는 단지만 (같은 면적끼리 비교)' : '주력 면적 평당가 (84·59㎡ 거래 없음)'}${noK.length ? ', 거래 없는 ' + noK.length + '개 제외' : ''}`,
        `분양: 청약홈 최근 2년 공고, 반경 ${saleRTxt} 이내 ${saleFar ? '없음 → 같은 시·군 가까운 순 ' : ''}${sales.length}건`,
      ].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      { x: 8.3, y: 3.2, w: 4.33, h: 3.6, fontFace: F, fontSize: 9.5, color: INK, margin: 0, valign: 'top', paraSpaceAfter: 6, isTextBox: true },
    );

    // 위치도
    sl = page(
      `대상지에서 ${far < 1000 ? Math.round(far) + 'm' : (far / 1000).toFixed(1) + 'km'} 안에 비교 단지 ${mapPts.length}개, 분양 단지 ${salePts.length}개가 분포`,
      'LOCATION',
    );
    if (mi) sl.addImage({ data: mi.data, x: LX, y: 1.4, w: 8.05, h: 5.4 });
    sl.addText(
      mi && mi.tiles
        ? '원형 번호는 비교 단지(단지 요약표와 동일), 주황 사각형 알파벳은 분양 단지입니다.'
        : '배경지도를 받지 못해 위치 관계만 표시했습니다. 원형 번호는 비교 단지, 주황 사각형 알파벳은 분양 단지입니다.',
      { x: LX, y: 6.82, w: 8.2, h: 0.16, fontFace: F, fontSize: 7.5, color: MUTE, margin: 0, isTextBox: true },
    );
    const dTxt = d => (d < 1000 ? Math.round(d) + 'm' : (d / 1000).toFixed(1) + 'km'),
      nC = salePts.length ? 12 : 18;
    tbl(
      sl,
      [['No.', '단지명', '준공', '거리'].map(TH)]
        .concat(
          mapPts
            .slice(0, nC)
            .map((r, i) => [cell(i + 1, { bold: true, color: NAVY }), cell(r.c.name, { align: 'left' }), cell(r.year || '-'), cell(dTxt(r.d))]),
        )
        .concat(
          salePts
            .slice(0, 6)
            .map((x, i) => [
              cell(String.fromCharCode(65 + i), { bold: true, color: 'E8710A' }),
              cell(String(x.r0.HOUSE_NM || '') + ' (분양)', { align: 'left' }),
              cell(String(x.r0.MVN_PREARNGE_YM || '').slice(0, 4) || '-'),
              cell(dTxt(x.d)),
            ]),
        ),
      8.95,
      1.4,
      3.83,
      [0.45, 2.1, 0.6, 0.68],
      8.5,
      0.27,
    );
    if (mapPts.length > nC)
      sl.addText(`${nC + 1}번 이후 ${mapPts.length - nC}개 단지는 단지 요약표 참조`, {
        x: 8.95,
        y: 6.7,
        w: 3.8,
        h: 0.2,
        fontFace: F,
        fontSize: 8,
        color: MUTE,
        margin: 0,
        isTextBox: true,
      });

    if (detail) await addDetailSlides(Object.assign({ reg, d2, d3, sido: SIDO_OF[code5.slice(0, 2)] }, K0));
    // 추이
    const ms = [];
    for (let k = 23; k >= 0; k--) {
      const d = new Date(S.asOf.getFullYear(), S.asOf.getMonth() - k, 1);
      ms.push(d.getFullYear() * 100 + d.getMonth() + 1);
    }
    const allPairs = pick.flatMap(r => r.all.map(t => [r, t]));
    const byM = ms.map(m => {
      const v = allPairs.filter(([r, t]) => Math.floor(t[0] / 100) === m);
      return {
        m,
        lab: String(m).slice(2, 4) + '.' + String(m).slice(4),
        cnt: v.length,
        p: v.length ? Math.round(med(v.map(([r, t]) => ppy(r, t)))) : null,
      };
    });
    const withP = byM.filter(x => x.p != null);
    sl = page(
      mp1
        ? `최근 12개월 중위 평당가 ${n(mp1)}만원, 직전 12개월 대비 ${chgTxt} · 월평균 거래 ${(pairs1.length / 12).toFixed(1)}건`
        : '최근 2년 거래 추이',
      'PRICE & VOLUME TREND',
    );
    sl.addText('월별 중위 평당가 (만원, 거래가 있는 달만)', {
      x: LX,
      y: 1.4,
      w: 6,
      h: 0.26,
      fontFace: F,
      fontSize: 11,
      bold: true,
      color: INK,
      margin: 0,
      isTextBox: true,
    });
    if (withP.length > 1)
      sl.addChart(
        pres.ChartType.line,
        [{ name: '중위 평당가', labels: withP.map(x => x.lab), values: withP.map(x => x.p) }],
        Object.assign(chartBase(), {
          x: LX,
          y: 1.7,
          w: 6.0,
          h: 5.1,
          chartColors: [GOLD],
          lineSize: 2.25,
          lineDataSymbolSize: 6,
          catAxisLabelFontSize: 8,
        }),
      );
    else
      sl.addText('월별 추이를 그릴 만큼 거래가 없습니다.', {
        x: LX,
        y: 1.8,
        w: 6,
        h: 0.3,
        fontFace: F,
        fontSize: 10,
        color: MUTE,
        margin: 0,
        isTextBox: true,
      });
    sl.addText('월별 거래 건수 (최근 24개월)', {
      x: 6.9,
      y: 1.4,
      w: 5.9,
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
      [{ name: '거래 건수', labels: byM.map(x => x.lab), values: byM.map(x => x.cnt) }],
      Object.assign(chartBase(), {
        x: 6.9,
        y: 1.7,
        w: 5.88,
        h: 5.1,
        barDir: 'col',
        chartColors: [NAVY],
        catAxisLabelFontSize: 7.5,
        barGapWidthPct: 40,
        valAxisMinVal: 0,
      }),
    );

    // 단지 요약표
    const sumHead = [
        '단지명',
        '거리',
        '준공',
        '세대수',
        '층수',
        '84㎡ 건수',
        '84㎡ 중위가',
        '84㎡ 평당가',
        '59㎡ 건수',
        '59㎡ 중위가',
        '59㎡ 평당가',
        '공급/전용',
        '기간',
      ].map(t => TH(t, /^(84|59)㎡/.test(t) ? GOLD : NAVY)),
      sumW = [2.4, 0.7, 0.6, 0.75, 0.9, 0.7, 0.95, 0.95, 0.7, 0.95, 0.95, 0.9, 0.78];
    const sumRows = pick.map(r => {
      const a84 = stOf(r, 84),
        a59 = stOf(r, 59);
      return [
        cell(`${pick.indexOf(r) + 1}. ${r.c.name}`, { align: 'left', bold: true }),
        cell(dTxt(r.d)),
        cell(r.year || '-'),
        cell(r.hh ? n(r.hh) : '-'),
        cell(r.up ? (r.dn ? `B${r.dn}/` : '') + r.up + 'F' : '-'),
        cell(a84 ? a84.cnt : '-', { fill: { color: GOLDBG } }),
        cell(a84 ? n(a84.med) : '-', { bold: true, color: NAVY, fill: { color: GOLDBG } }),
        cell(a84 ? n(a84.ppy) : '-', { fill: { color: GOLDBG } }),
        cell(a59 ? a59.cnt : '-'),
        cell(a59 ? n(a59.med) : '-', { bold: true, color: NAVY }),
        cell(a59 ? n(a59.ppy) : '-'),
        cell(r.ratio ? r.ratio.toFixed(2) : '1.32*', r.ratio ? {} : { color: WARN }),
        cell(r.tr.length ? r.span + '년' : '-'),
      ];
    });
    for (let i = 0; i < Math.max(sumRows.length, 1); i += 16) {
      const m84 = det
          .map(r => stOf(r, 84))
          .filter(Boolean)
          .map(x => x.med),
        rg = v =>
          !v.length ? '' : Math.round(Math.min(...v)) === Math.round(Math.max(...v)) ? n(v[0]) : n(Math.min(...v)) + '~' + n(Math.max(...v));
      sl = page(
        `대상 ${pick.length}개 단지 요약: ${m84.length ? '84㎡ 중위 실거래가 ' + rg(m84) + '만원' : det.length ? '평당가 ' + rg(det.map(r => sumOf(r).ppy)) + '만원' : '거래 없음'}${i ? ' (계속)' : ''}`,
        'COMPARABLE SET',
      );
      tbl(sl, [sumHead].concat(sumRows.slice(i, i + 16)), LX, 1.4, LW, sumW, 9, 0.3);
      sl.addText(
        '단위: 만원 · 전용면적은 소수점 버림(84.97㎡→84㎡, 59.98㎡→59㎡) · 평당가는 공급면적 기준(공급/전용은 K-apt 단지 평균, *는 1.32 추정) · 세대수·층수는 K-apt 또는 건축물대장',
        { x: LX, y: 6.72, w: LW, h: 0.22, fontFace: F, fontSize: 8, color: MUTE, margin: 0, isTextBox: true },
      );
    }

    // 단지별: 한 쪽에 한 단지 (왼쪽 표, 오른쪽 월별 추이)
    for (const r of det.slice(0, 20)) {
      const c = r.c,
        m = sumOf(r);
      const d84 = stOf(r, 84),
        d59 = stOf(r, 59);
      sl = page(
        d84 || d59
          ? `${c.name}: ${[d84 ? `84㎡ 중위 ${n(d84.med)}만원(평당 ${n(d84.ppy)})` : '', d59 ? `59㎡ 중위 ${n(d59.med)}만원(평당 ${n(d59.ppy)})` : ''].filter(Boolean).join(', ')}`
          : `${c.name}: 전용 ${m.type}㎡ 중위 ${n(m.med)}만원, 평당 ${n(m.ppy)}만원`,
        'COMPLEX PROFILE',
      );
      sl.addText(
        [
          r.year ? `${r.year}년 준공` : '준공연도 미확인',
          r.hh ? n(r.hh) + '세대' : '',
          r.up ? (r.dn ? `지하${r.dn}/` : '') + `지상${r.up}층` : '',
          `${c.umd} ${c.jibun}`,
          `대상지에서 ${r.d < 1000 ? Math.round(r.d) + 'm' : (r.d / 1000).toFixed(1) + 'km'}`,
          `최근 ${r.span}년 거래 ${r.tr.length}건`,
          r.ratio ? `공급/전용 ${r.ratio.toFixed(2)} (K-apt)` : '공급/전용 1.32 (추정)',
        ]
          .filter(Boolean)
          .join('  ·  '),
        { x: LX, y: 1.3, w: LW, h: 0.26, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true },
      );
      const g = new Map();
      for (const t of r.tr) {
        const kk = bk(t);
        (g.get(kk) || g.set(kk, []).get(kk)).push(t);
      }
      const pri = kk => (kk === 84 ? 0 : kk === 59 ? 1 : 2);
      const types = [...g.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .sort((a, b) => pri(a[0]) - pri(b[0]) || a[0] - b[0]);
      sl.addText(`면적타입별 요약 (최근 ${r.span}년, 만원 · 84㎡ → 59㎡ 순)`, {
        x: LX,
        y: 1.75,
        w: 7,
        h: 0.26,
        fontFace: F,
        fontSize: 11,
        bold: true,
        color: INK,
        margin: 0,
        isTextBox: true,
      });
      const st = [['전용', '공급(평)', '건수', '최고가', '최저가', '중위가', '평균가', '평당가'].map(TH)].concat(
        types.map(([kk, v]) => {
          const am = v.map(t => t[3]);
          return [
            cell(kk + '㎡'),
            cell(pyR(r, kk) + '평'),
            cell(v.length),
            cell(n(Math.max(...am))),
            cell(n(Math.min(...am))),
            cell(n(med(am)), { bold: true, color: NAVY }),
            cell(n(mean(am))),
            cell(n(med(v.map(t => ppy(r, t)))), { bold: true }),
          ];
        }),
      );
      tbl(sl, st, LX, 2.05, 7.0, [0.8, 0.85, 0.6, 0.95, 0.95, 0.95, 0.95, 0.95], 9, 0.29);
      const y1 = 2.05 + 0.29 * st.length + 0.28;
      const ga = new Map();
      for (const t of r.all) {
        const kk = bk(t);
        (ga.get(kk) || ga.set(kk, []).get(kk)).push(t);
      } // 최근 2년 전체 (최근 5건은 거래가 드문 타입도 채우려고 2년치에서 뽑는다)
      const tA = ga.has(84) ? 84 : types[0] ? types[0][0] : null,
        tB = ga.has(59) && tA !== 59 ? 59 : (types.find(x => x[0] !== tA) || [null])[0];
      const recent = k => {
        const v = (ga.get(k) || []).slice().sort((a, b) => b[0] - a[0]);
        return [['계약일', '전용 (공급 평)', '층', '거래가(만원)', '평당가(만원)'].map(TH)].concat(
          v
            .slice(0, 5)
            .map(t => [cell(ds(t[0])), cell(`${t[1]}㎡ (${pyR(r, t[1])}평)`), cell(t[2]), cell(n(t[3]), { bold: true }), cell(n(ppy(r, t)))]),
        );
      };
      sl.addText(`${tA}㎡ 최근 실거래 5건 (최근 2년 ${(ga.get(tA) || []).length}건 중)`, {
        x: LX,
        y: y1,
        w: 7,
        h: 0.26,
        fontFace: F,
        fontSize: 11,
        bold: true,
        color: INK,
        margin: 0,
        isTextBox: true,
      });
      tbl(sl, recent(tA), LX, y1 + 0.3, 7.0, [1.2, 2.0, 0.8, 1.6, 1.4], 9, 0.29);
      const cm = ms
        .map(mm => {
          const v = r.all.filter(t => Math.floor(t[0] / 100) === mm);
          return v.length ? { lab: String(mm).slice(2, 4) + '.' + String(mm).slice(4), p: Math.round(med(v.map(t => ppy(r, t)))) } : null;
        })
        .filter(Boolean);
      sl.addText('월별 중위 평당가 (최근 2년, 만원)', {
        x: 7.9,
        y: 1.75,
        w: 4.9,
        h: 0.26,
        fontFace: F,
        fontSize: 11,
        bold: true,
        color: INK,
        margin: 0,
        isTextBox: true,
      });
      if (cm.length > 1)
        sl.addChart(
          pres.ChartType.line,
          [{ name: '중위 평당가', labels: cm.map(x => x.lab), values: cm.map(x => x.p) }],
          Object.assign(chartBase(), {
            x: 7.9,
            y: 2.05,
            w: 4.88,
            h: tB ? 2.25 : 4.75,
            chartColors: [GOLD],
            lineSize: 2.25,
            lineDataSymbolSize: 6,
            catAxisLabelFontSize: 8,
          }),
        );
      else
        sl.addText('추이를 그릴 만큼 거래가 없습니다.', {
          x: 7.9,
          y: 2.15,
          w: 4.8,
          h: 0.3,
          fontFace: F,
          fontSize: 10,
          color: MUTE,
          margin: 0,
          isTextBox: true,
        });
      if (tB) {
        sl.addText(`${tB}㎡ 최근 실거래 5건 (최근 2년 ${(ga.get(tB) || []).length}건 중)`, {
          x: 7.9,
          y: 4.42,
          w: 4.88,
          h: 0.26,
          fontFace: F,
          fontSize: 11,
          bold: true,
          color: INK,
          margin: 0,
          isTextBox: true,
        });
        tbl(
          sl,
          recent(tB).map((rw, i) => (i ? [rw[0], cell(`${rw[1].text.split(' ')[0]}`), rw[2], rw[3], rw[4]] : rw)),
          7.9,
          4.72,
          4.88,
          [0.95, 1.0, 0.5, 1.2, 1.23],
          8.5,
          0.29,
        );
      }
    }

    // 주변 분양 + 분양권·입주권 실거래
    const sv = [],
      gus = new Map();
    for (const c of cand) gus.set(c.code, c.gu);
    gus.set(code5, d2);
    await Promise.all(
      [...SILVG.values()]
        .filter(g => codes.has(g.code) || [...codes].some(c => (LEGACY[c] || []).includes(g.code)))
        .map(async g => {
          const tr = g.trades.filter(t => t[0] >= cut2);
          if (!tr.length) return;
          const p = await geocodeAddr(
            `${SIDO_OF[g.code.slice(0, 2)] || ''} ${gus.get(g.code) || g.sgg || ''} ${g.umd} ${g.jibun}`.replace(/\s+/g, ' ').trim(),
          );
          if (!p) return;
          const dd = hav(S.center.lat, S.center.lon, p[0], p[1]);
          if (dd <= radUsed) sv.push({ name: g.name, addr: g.umd + ' ' + g.jibun, d: dd, tr });
        }),
    );
    for (const r of rows) {
      const tr = (SILVC.get(r.c.id) || []).filter(t => t[0] >= cut2);
      if (tr.length) sv.push({ name: r.c.name, addr: r.c.umd + ' ' + r.c.jibun, d: r.d, tr });
    }
    // 분양 사례의 대표 주택형 분양가(청약홈 공급면적 기준 평당가)와 1순위 경쟁률
    const ymNow = S.asOf.getFullYear() * 100 + S.asOf.getMonth() + 1,
      saleRows = [];
    for (const x of sales) {
      const r0 = x.r0;
      let top = '-',
        pp = '-',
        cr = '-';
      try {
        const [mdl, cmp] = await (saleExtra(String(r0.HOUSE_MANAGE_NO)), SALEX.get(String(r0.HOUSE_MANAGE_NO)));
        if (Array.isArray(mdl) && mdl.length && mdl[0].LTTOT_TOP_AMOUNT !== undefined) {
          const byS = (a, b) => (+b.SUPLY_HSHLDCO || 0) - (+a.SUPLY_HSHLDCO || 0),
            m84 = mdl.filter(z => Math.floor(parseFloat(z.HOUSE_TY) + 1e-6) === 84).sort(byS)[0],
            m0 = m84 || mdl.slice().sort(byS)[0],
            amt = +String(m0.LTTOT_TOP_AMOUNT).replace(/,/g, ''),
            su = parseFloat(m0.SUPLY_AR);
          if (amt) {
            const ty = String(m0.HOUSE_TY || ''),
              tn = parseFloat(ty);
            top = `${isNaN(tn) ? ty : Math.floor(tn + 1e-6) + ty.replace(/^[\d.]+/, '') + '㎡'} · ${n(amt)}`;
            if (su > 0) pp = n(amt / (su / PY));
          }
        }
        if (Array.isArray(cmp) && cmp.length && cmp[0].REQ_CNT !== undefined) {
          const c1 = cmp.filter(z => String(z.SUBSCRPT_RANK_CODE) === '1'),
            req = c1.reduce((a, z) => a + (+String(z.REQ_CNT).replace(/,/g, '') || 0), 0),
            ty = new Map();
          for (const z of c1) ty.set(z.HOUSE_TY, +z.SUPLY_HSHLDCO || 0);
          const sup = [...ty.values()].reduce((a, z) => a + z, 0);
          if (sup > 0) cr = (req / sup).toFixed(2) + ' : 1';
        }
      } catch (e) {}
      const ym =
        parseInt(
          String(r0.MVN_PREARNGE_YM || '')
            .replace(/\D/g, '')
            .slice(0, 6),
          10,
        ) || 0;
      saleRows.push([
        cell(String.fromCharCode(65 + saleRows.length), { bold: true, color: 'E8710A' }),
        cell(r0.RCRIT_PBLANC_DE || '-'),
        cell(r0.HOUSE_NM || '', { align: 'left', bold: true }),
        cell(
          String(r0.HSSPLY_ADRES || '')
            .replace(/^\S+(특별시|광역시|도)\s*/, '')
            .replace(/\(.*?\)/g, '')
            .trim(),
          { align: 'left' },
        ),
        cell((x.approx ? '~' : '') + dTxt(x.d)),
        cell(n(+r0.TOT_SUPLY_HSHLDCO)),
        cell(r0.MVN_PREARNGE_YM || '-'),
        cell(ym ? (ym >= ymNow ? '입주 전' : '입주 후') : '-', ym >= ymNow ? { bold: true, color: 'E8710A' } : {}),
        cell(top),
        cell(pp, { bold: true, color: NAVY }),
        cell(cr),
      ]);
    }
    sl = page(
      `반경 ${saleFar ? '밖 ' : saleRTxt + ' 내 '}최근 2년 분양 ${sales.length}건${
        sales.some(x => {
          const m = parseInt(String(x.r0.MVN_PREARNGE_YM || '').slice(0, 6), 10) || 0;
          return m >= ymNow;
        })
          ? ` (입주 전 ${sales.filter(x => (parseInt(String(x.r0.MVN_PREARNGE_YM || '').slice(0, 6), 10) || 0) >= ymNow).length}건)`
          : ''
      } · 반경 ${radTxt} 분양권·입주권 거래 ${sv.reduce((a, g) => a + g.tr.length, 0)}건`,
      'NEW SUPPLY & PRE-SALE RIGHTS',
    );
    sl.addText(
      `주변 분양 사례 (청약홈 · 위치도의 알파벳 · ${saleFar ? '반경 ' + saleRTxt + ' 안에는 없어 같은 시·군 가까운 순 ' + sales.length + '건' : '반경 ' + saleRTxt + ' 이내 가까운 순'} · 분양가·평당가는 84㎡ 주택형 최고가(없으면 공급세대가 가장 많은 주택형), 청약홈 공급면적 기준, 만원)`,
      { x: LX, y: 1.4, w: LW, h: 0.26, fontFace: F, fontSize: 10.5, bold: true, color: INK, margin: 0, isTextBox: true },
    );
    let y = 1.7;
    if (saleRows.length) {
      tbl(
        sl,
        [
          ['', '모집공고일', '단지명', '공급위치', '거리', '세대', '입주예정', '상태', '분양가 (84㎡ 우선)', '평당가', '1순위 경쟁률'].map(TH),
        ].concat(saleRows),
        LX,
        y,
        LW,
        [0.4, 0.95, 2.1, 2.3, 0.65, 0.6, 0.8, 0.7, 1.6, 0.85, 1.28],
        8.5,
        0.28,
      );
      y += 0.28 * (saleRows.length + 1) + 0.3;
      const nt = [
        sales.some(x => x.approx) ? '~ 표시는 지구·동 중심 기준의 개략 거리' : '',
        noGeo.length ? `위치를 찾지 못해 제외한 분양 공고 ${noGeo.length}건` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (nt) sl.addText(nt, { x: LX, y: y - 0.3, w: LW, h: 0.2, fontFace: F, fontSize: 8, color: WARN, margin: 0, isTextBox: true });
    } else {
      sl.addText(saleNote || '조건에 맞는 분양 단지가 없습니다.', {
        x: LX,
        y,
        w: LW,
        h: 0.28,
        fontFace: F,
        fontSize: 10,
        color: MUTE,
        margin: 0,
        isTextBox: true,
      });
      y += 0.55;
    }
    sl.addText('분양권·입주권 실거래 (최근 2년, 만원)', {
      x: LX,
      y,
      w: LW,
      h: 0.26,
      fontFace: F,
      fontSize: 11,
      bold: true,
      color: INK,
      margin: 0,
      isTextBox: true,
    });
    y += 0.3;
    if (sv.length) {
      const maxR = Math.max(1, Math.min(8, Math.floor((6.6 - y) / 0.28) - 1));
      tbl(
        sl,
        [['단지명', '소재지', '거리', '건수', '주력 전용', '중위가', '최고가', '최저가', '최근 거래'].map(TH)].concat(
          sv
            .sort((a, b) => b.tr.length - a.tr.length)
            .slice(0, maxR)
            .map(g => {
              const b = dominant(g.tr, true),
                am = b.v.map(t => t[3]);
              return [
                cell(g.name, { align: 'left', bold: true }),
                cell(g.addr, { align: 'left' }),
                cell(dTxt(g.d)),
                cell(g.tr.length),
                cell(b.k + '㎡'),
                cell(n(med(am)), { bold: true, color: NAVY }),
                cell(n(Math.max(...am))),
                cell(n(Math.min(...am))),
                cell(ds(Math.max(...g.tr.map(t => t[0])))),
              ];
            }),
        ),
        LX,
        y,
        LW,
        [3.0, 2.4, 0.7, 0.7, 1.0, 1.1, 1.1, 1.1, 1.13],
        8.5,
        0.28,
      );
    } else
      sl.addText(
        X.err.length ? '분양권 자료를 조회하지 못했습니다: ' + X.err.join(' / ') : `반경 ${radTxt} 안 최근 2년 분양권·입주권 거래가 없습니다.`,
        { x: LX, y, w: LW, h: 0.28, fontFace: F, fontSize: 10, color: MUTE, margin: 0, isTextBox: true },
      );

    let premOut = [];
    // 분양가 vs 분양권 전매가, 신축·구축 가격 격차
    {
      const lcs = (a, b) => {
        let best = 0;
        const dp = Array(b.length + 1).fill(0);
        for (let i = 1; i <= a.length; i++) {
          let prev = 0;
          for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
            if (dp[j] > best) best = dp[j];
            prev = tmp;
          }
        }
        return best;
      };
      const pool = [];
      for (const g of SILVG.values()) {
        if (codes.has(g.code) || [...codes].some(c => (LEGACY[c] || []).includes(g.code)))
          pool.push({ name: g.name, umd: g.umd, tr: g.trades.filter(t => t[0] >= cut2) });
      }
      for (const r of rows) {
        const tr = (SILVC.get(r.c.id) || []).filter(t => t[0] >= cut2);
        if (tr.length) pool.push({ name: r.c.name, umd: String(r.c.umd).split(' ').pop(), tr });
      }
      const matchSv = (nm, adr) => {
        const a = nn(nm);
        let best = null,
          bs = 0;
        for (const g of pool) {
          if (!g.tr.length) continue;
          const b = nn(g.name),
            sameDong = g.umd && String(adr).includes(g.umd),
            L = a && b ? (a.includes(b) || b.includes(a) ? Math.min(a.length, b.length) : lcs(a, b)) : 0;
          if (L >= 4 && (sameDong || L >= 6) && (L > bs || (L === bs && g.tr.length > (best ? best.tr.length : 0)))) {
            best = g;
            bs = L;
          }
        }
        return best;
      };
      const prem = [];
      for (const x of sales) {
        const r0 = x.r0;
        let ty = '',
          amt = 0,
          su = 0;
        try {
          const [mdl] = await (saleExtra(String(r0.HOUSE_MANAGE_NO)), SALEX.get(String(r0.HOUSE_MANAGE_NO)));
          if (Array.isArray(mdl) && mdl.length && mdl[0].LTTOT_TOP_AMOUNT !== undefined) {
            const byS = (a, b) => (+b.SUPLY_HSHLDCO || 0) - (+a.SUPLY_HSHLDCO || 0),
              m84 = mdl.filter(z => Math.floor(parseFloat(z.HOUSE_TY) + 1e-6) === 84).sort(byS)[0],
              m0 = m84 || mdl.slice().sort(byS)[0];
            amt = +String(m0.LTTOT_TOP_AMOUNT).replace(/,/g, '');
            ty = Math.floor(parseFloat(m0.HOUSE_TY) + 1e-6);
            su = parseFloat(m0.SUPLY_AR) || 0;
          }
        } catch (e) {}
        const g = matchSv(r0.HOUSE_NM, r0.HSSPLY_ADRES),
          v = g && ty ? g.tr.filter(t => bk(t) === ty) : [];
        const m = v.length ? med(v.map(t => t[3])) : 0;
        prem.push({
          r0,
          d: x.d,
          approx: x.approx,
          ty,
          amt,
          su,
          g,
          v,
          m,
          pr: m && amt ? m - amt : null,
          pct: m && amt ? (m / amt - 1) * 100 : null,
          last: v.length ? Math.max(...v.map(t => t[0])) : 0,
        });
      }
      // 신축·구축 가격 격차 (반경 내 전체 단지, 같은 전용 84㎡·59㎡, 최근 1년)
      const grp = (test, k) => {
        const ps = rows.filter(r => r.year && test(Y - r.year)).flatMap(r => r.tr.filter(t => t[0] >= cut1 && bk(t) === k).map(t => [r, t]));
        return {
          n: ps.length,
          cx: new Set(ps.map(([r]) => r.c.id)).size,
          m: ps.length ? med(ps.map(([r, t]) => t[3])) : 0,
          pp: ps.length ? med(ps.map(([r, t]) => ppy(r, t))) : 0,
        };
      };
      const isNew = a => a <= 5,
        isOld = a => a > 10,
        K = [84, 59];
      const gap = K.map(k => {
        const a = grp(isNew, k),
          b = grp(isOld, k);
        return { k, a, b, ok: a.n >= 3 && b.n >= 3, x: a.m && b.m ? a.m / b.m : 0, xp: a.pp && b.pp ? a.pp / b.pp : 0 };
      });
      premOut = prem;
      const g0 = gap.find(z => z.ok) || null,
        withTr = prem.filter(z => z.v.length),
        pv = withTr.filter(z => z.pr != null);
      sl = page(
        g0
          ? `반경 ${radTxt} 신축(5년 이내)은 구축(10년 초과)의 ${g0.x.toFixed(2)}배 · ${g0.k}㎡ 중위 실거래가 기준`
          : '신축·구축 가격 격차는 표본이 부족해 계산하지 못했습니다',
        'NEW VS OLD · PRESALE PREMIUM',
      );
      const kg2 = 0.21,
        kw2 = (LW - kg2 * 2) / 3;
      gap.forEach((z, i) => {
        kpi(
          sl,
          LX + (kw2 + kg2) * i,
          1.4,
          kw2,
          `${z.k}㎡ 신축 / 구축 중위 실거래가`,
          z.ok ? `${n(z.a.m)} / ${n(z.b.m)}만원` : '표본 부족',
          z.ok
            ? `신축 ${z.a.n}건·${z.a.cx}개 단지 / 구축 ${z.b.n}건·${z.b.cx}개 단지 · 평당가 ${z.xp.toFixed(2)}배${z.a.cx < 3 ? ' · 신축 단지 적음(참고용)' : ''}`
            : `신축 ${z.a.n}건 / 구축 ${z.b.n}건 (각 3건 이상 필요)`,
        );
      });
      {
        const pm = pv.length ? med(pv.map(z => z.pr)) : null;
        kpi(
          sl,
          LX + (kw2 + kg2) * 2,
          1.4,
          kw2,
          '분양권 전매 프리미엄 중위',
          pm == null ? '-' : `${pm >= 0 ? '+' : ''}${n(pm)}만원`,
          pv.length ? `분양 ${prem.length}건 중 ${pv.length}건에서 전매 확인` : '전매 거래가 확인된 분양 단지 없음',
        );
      }
      sl.addText(`분양가 대비 분양권 전매가 (분양 사례의 ${prem[0] && prem[0].ty ? '대표 주택형' : '주택형'} 최고 분양가 대비 · 만원)`, {
        x: LX,
        y: 2.75,
        w: LW,
        h: 0.26,
        fontFace: F,
        fontSize: 11,
        bold: true,
        color: INK,
        margin: 0,
        isTextBox: true,
      });
      if (prem.length) {
        const rr = prem.map((z, i) => [
          cell(String.fromCharCode(65 + i), { bold: true, color: 'E8710A' }),
          cell(z.r0.HOUSE_NM || '', { align: 'left', bold: true }),
          cell(z.r0.RCRIT_PBLANC_DE || '-'),
          cell(z.r0.MVN_PREARNGE_YM || '-'),
          cell(z.ty ? z.ty + '㎡' : '-'),
          cell(z.amt ? n(z.amt) : '-'),
          cell(z.v.length ? z.v.length : z.g ? '0' : '-'),
          cell(z.m ? n(z.m) : '-', z.m ? { bold: true, color: NAVY } : {}),
          cell(z.pr != null ? (z.pr >= 0 ? '+' : '') + n(z.pr) : '-', z.pr != null ? { bold: true, fill: { color: GOLDBG } } : {}),
          cell(z.pct != null ? (z.pct >= 0 ? '+' : '') + z.pct.toFixed(1) + '%' : '-'),
          cell(z.last ? ds(z.last) : '-'),
          cell(z.v.length ? '' : z.g ? '같은 타입 거래 없음' : '전매 거래 없음/미확인', { align: 'left' }),
        ]);
        tbl(
          sl,
          [
            ['', '단지명', '모집공고일', '입주예정', '타입', '최고 분양가', '전매 건수', '전매 중위가', '프리미엄', '%', '최근 전매', '비고'].map(
              TH,
            ),
          ].concat(rr.slice(0, 9)),
          LX,
          3.05,
          LW,
          [0.4, 2.45, 0.95, 0.85, 0.65, 1.05, 0.75, 1.05, 0.95, 0.7, 0.85, 1.12],
          8.5,
          0.3,
        );
      } else
        sl.addText(saleNote || '비교할 분양 사례가 없습니다.', {
          x: LX,
          y: 3.1,
          w: LW,
          h: 0.28,
          fontFace: F,
          fontSize: 10,
          color: MUTE,
          margin: 0,
          isTextBox: true,
        });
      sl.addText(
        [
          '보는 법: 프리미엄 = 같은 전용면적대 분양권 전매 중위가 − 청약홈 최고 분양가. 최고가는 고층 기준이라 실제 분양가보다 높아, 프리미엄은 실제보다 작게 나올 수 있습니다. 발코니 확장·옵션 비용은 분양가에 포함되지 않아 전매가와 섞일 수 있습니다. 전매가 제한되는 지역·단지는 전매 거래가 없을 수 있습니다.',
          '분양권 단지는 국토부 신고명과 청약홈 단지명이 달라, 같은 동에서 이름이 4자 이상 겹치는 것을 같은 단지로 보았습니다. 맞는 단지를 못 찾았거나 시군구 자료가 없으면 "전매 거래 없음/미확인"으로 표시했습니다.',
          `신축·구축 격차는 반경 ${radTxt} 안 전체 단지 중 준공연도를 확인한 단지만 썼고, 대상지와 생활권(학군·역·경계)이 다른 단지가 섞일 수 있어 지도로 확인이 필요합니다.${pv.length ? '' : ' 이번 자료는 프리미엄을 계산할 전매 거래가 없었습니다.'}`,
        ].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
        {
          x: LX,
          y: 5.95,
          w: LW,
          h: 1.0,
          fontFace: F,
          fontSize: 8.5,
          color: MUTE,
          margin: 0,
          valign: 'top',
          paraSpaceAfter: 3,
          isTextBox: true,
          fit: 'shrink',
        },
      );
    }

    if (detail) {
      // 분양가 포지션 (상세자료 마지막 쪽): 주변 시세·분양가·전매가로 잡은 참고 밴드
      const r10 = v => Math.round(v / 10) * 10,
        eok = v => (v / 10000).toFixed(1) + '억';
      const bandOf = k => {
        const ps = pairs1.filter(([r, t]) => bk(t) === k);
        if (ps.length < 3) return null;
        const ref = med(ps.map(([r, t]) => ppy(r, t)));
        const inR = premOut.filter(z => z.ty === k && z.amt && z.su > 0),
          near = inR.filter(z => z.d <= radUsed),
          use = near.length ? near : inR,
          sp = use.map(z => z.amt / (z.su / PY));
        const pyN = Math.round(use.length ? med(use.map(z => z.su / PY)) : med(ps.map(([r, t]) => (t[1] * (r.ratio || 1.32)) / PY))); // 세대당 금액의 공급평수: 분양 사례 공급면적 우선, 없으면 비교 단지 거래 기준
        const rs = premOut.filter(z => z.ty === k && z.su > 0 && z.v.length >= 3 && z.d <= radUsed).map(z => z.m / (z.su / PY));
        return {
          k,
          n: ps.length,
          ref,
          pyN,
          sale: sp.length ? med(sp) : null,
          saleN: sp.length,
          resale: rs.length ? med(rs) : null,
          resaleN: rs.length,
        };
      };
      const B84 = bandOf(84),
        B59 = bandOf(59);
      const pick3 = (B, B84x) => {
        if (!B) return null;
        let lo = B.ref,
          mid = B.sale,
          hi = B.resale,
          via = [];
        if (B84x && B84x !== B) {
          const f = B84x.ref ? B.ref / B84x.ref : 0;
          if (mid == null && B84x.sale) {
            mid = B84x.sale * f;
            via.push('기준');
          }
          if (hi == null && B84x.resale) {
            hi = B84x.resale * f;
            via.push('높음');
          }
        }
        return { lo, mid, hi, via };
      };
      const P84 = pick3(B84),
        P59 = B59 ? pick3(B59, B84) : null;
      sl = page(
        P84 && P84.mid
          ? `84㎡ 참고 분양가 밴드: 평당 ${n(r10(P84.lo))}~${n(r10(P84.mid))}만원 (세대당 약 ${eok(r10(P84.lo) * B84.pyN)}~${eok(r10(P84.mid) * B84.pyN)}원)`
          : P84
            ? `84㎡ 입주 단지 실거래는 평당 ${n(r10(P84.lo))}만원이며, 주변 분양가 자료가 없어 밴드의 상단은 계산하지 못했습니다`
            : '분양가 밴드는 비교 표본이 부족해 계산하지 못했습니다',
        'PRICING BAND · REFERENCE',
      );
      const row = (nm, v, B, note) => [
        cell(nm, { bold: true, color: NAVY }),
        cell(v ? n(r10(v)) : '-', v ? { bold: true } : {}),
        cell(v ? n(r10(v) * B.pyN) : '-', v ? { bold: true, fill: { color: GOLDBG } } : {}),
        cell(note, { align: 'left' }),
      ];
      const mk = (P, B, ttl) => [
        [ttl, '평당가(만원)', `세대당(만원, ${B.pyN}평)`, '기준 근거'].map(TH),
        row('낮음', P.lo, B, `반경 ${radTxt} 신축 ${B.k}㎡ 최근 1년 중위 평당가 (${B.n}건)`),
        row(
          '기준',
          P.mid,
          B,
          P.via.includes('기준')
            ? `${B.k}㎡ 분양가 자료가 없어 84㎡ 안의 비율을 적용`
            : B.saleN
              ? `주변 분양 ${B.saleN}건의 ${B.k}㎡ 최고 분양가 평당가 중위`
              : '-',
        ),
        row(
          '높음',
          P.hi,
          B,
          P.via.includes('높음')
            ? `${B.k}㎡ 전매 자료가 없어 84㎡ 안의 비율을 적용`
            : B.resaleN
              ? `분양권 전매 중위가 평당가 (${B.resaleN}개 단지, 전매 3건 이상)`
              : '반경 안에 전매 3건 이상인 분양 단지가 없어 계산 불가',
        ),
      ];
      let yy = 1.4;
      if (P84) {
        sl.addText('84㎡ (국민평형)', {
          x: LX,
          y: yy,
          w: LW,
          h: 0.26,
          fontFace: F,
          fontSize: 11,
          bold: true,
          color: INK,
          margin: 0,
          isTextBox: true,
        });
        tbl(sl, mk(P84, B84, '84㎡'), LX, yy + 0.3, LW, [1.1, 1.4, 1.9, 7.78], 10, 0.34);
        yy += 2.0;
      }
      if (P59) {
        sl.addText('59㎡ (참고)', { x: LX, y: yy, w: LW, h: 0.26, fontFace: F, fontSize: 11, bold: true, color: INK, margin: 0, isTextBox: true });
        tbl(sl, mk(P59, B59, '59㎡'), LX, yy + 0.3, LW, [1.1, 1.4, 1.9, 7.78], 10, 0.34);
        yy += 2.0;
      }
      sl.addText(
        [
          '낮음은 입주한 신축 단지의 실거래 수준, 기준은 반경 안 최근 분양가 수준, 높음은 분양권 전매가 수준입니다. 높음은 전매 프리미엄을 미리 얹은 값이라 도전 구간으로 보고, 낮음~기준을 참고 밴드로 제시했습니다.',
          '대상지의 상품·브랜드·세대수·분양 시기와 층·향 차이는 반영하지 않았고, 분양가는 청약홈 최고 분양가(고층 기준)라 실제 평균보다 높을 수 있습니다. 비교 시점이 서로 다른 값(입주 단지 시세와 분양 당시 가격)이라 사업 개요가 정해지면 다시 산정이 필요합니다.',
          '세대당 금액은 평당가에 공급평수(분양 사례의 공급면적, 없으면 비교 단지 거래 기준)를 곱한 값입니다.',
        ].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
        {
          x: LX,
          y: Math.min(yy, 5.7),
          w: LW,
          h: 1.2,
          fontFace: F,
          fontSize: 9,
          color: MUTE,
          margin: 0,
          valign: 'top',
          paraSpaceAfter: 4,
          isTextBox: true,
          fit: 'shrink',
        },
      );
    }

    // 기준과 한계
    sl = page('이 자료의 기준과 한계', 'METHODOLOGY');
    sl.addShape(pres.ShapeType.rect, { x: LX - 0.12, y: 1.3, w: LW + 0.24, h: 5.62, fill: { color: BG }, line: { color: BG, width: 0 } });
    sl.addText(
      [
        `조사 범위는 대상지 반경 ${radTxt} 안의 아파트 ${cand.length}개 단지입니다. 선택 반경 ${radAsk}에서 시작해 준공 5년 이내 단지가 3개 이상 잡힐 때까지 최대 3km로 넓혔고, 준공 5년 이내 → 10년 이내 → 전체 순으로 3개 이상인 첫 구간만 넣었습니다 (이번 자료: ${tier}, ${pick.length}개${cutN ? `, 가까운 30개만 사용` : ''}).`,
        `주변 분양은 청약홈 최근 2년 공고 중 반경 ${saleRTxt} 이내(없으면 같은 시·군 가까운 순 3건)를 넣었습니다. 분양 단지 위치는 공급위치 주소(없으면 단지명·지구명·동)를 지도 좌표로 바꾼 값이라 실제와 다소 다를 수 있고(~ 표시는 개략 위치),${noGeo.length ? ` 위치를 찾지 못한 ${noGeo.length}건은 제외했으며,` : ''} '입주 전'은 입주예정월이 기준월 이후인 단지입니다.`,
        unmN
          ? `단지 목록(K-apt 기준)에 없어 매칭하지 못해 빠진 최근 1년 거래 ${unmN}건이 있습니다 (반경 내 동 기준, 소규모·도시형·최근 입주 단지 등): ${unmEx}`
          : '',
        noYear && tier !== '전체 연차' ? `준공연도를 확인하지 못한 ${noYear}개 단지는 연차 구간 선정에서 제외됐습니다.` : '',
        '실거래는 국토교통부 신고 자료이며 해제된 거래는 뺐습니다. 최근 두 달은 신고 기한(계약 후 30일) 때문에 건수가 더 늘 수 있습니다.',
        `평당가는 공급면적 기준입니다. 실거래 자료에는 전용면적만 있어, 기존 단지는 K-apt의 단지 평균 공급/전용 비율을 곱했고(같은 단지 안에서도 타입별로 2~3% 차이가 날 수 있음), 비율이 없는 ${estN}개 단지는 1.32로 추정했습니다. 분양 사례는 청약홈의 주택형별 공급면적을 썼습니다.`,
        noTr.length
          ? `최근 2년 거래가 없어 상세에서 뺀 단지: ${noTr
              .slice(0, 15)
              .map(r => r.c.name)
              .join(', ')}${noTr.length > 15 ? ' 외' : ''}`
          : '',
        det.length > 20 ? `단지별 상세는 20개까지만 넣었습니다 (전체 ${det.length}개는 요약표 참조).` : '',
        '분양 자료는 청약홈 아파트 분양공고 기준이며, 오피스텔·도시형생활주택과 무순위·임의공급 별도 공고는 포함하지 않았습니다. 분양권 거래는 국토부 신고 자료입니다.',
        '분양 사례의 분양가는 84㎡ 주택형(없으면 공급세대가 가장 많은 주택형)의 최고 분양가입니다. 층별 분양가, 발코니 확장비, 중도금 조건은 모집공고문 분석이 필요합니다.',
        '신축/구축 격차 쪽: 신축은 준공 5년 이내, 구축은 준공 10년 초과로 나눠 같은 전용면적(84㎡·59㎡) 최근 1년 중위가를 비교했고, 분양가 대비 전매 프리미엄은 같은 전용면적대 전매 중위가에서 청약홈 최고 분양가를 뺀 추정값입니다.',
        detail
          ? '미분양·인허가·착공 통계는 이 자료에 없습니다. 분양가 밴드는 주변 시세만 근거로 한 참고 산정이며 대상지 상품·브랜드·세대수는 반영하지 않았습니다.'
          : '인구·세대, 미분양, 인허가 등 통계와 적정 분양가 검토는 이 자료에 없습니다.',
      ]
        .filter(Boolean)
        .map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      {
        x: LX + 0.12,
        y: 1.45,
        w: LW - 0.24,
        h: 5.35,
        fontFace: F,
        fontSize: 11,
        color: INK,
        margin: 0,
        valign: 'top',
        paraSpaceAfter: 7,
        isTextBox: true,
        fit: 'shrink',
      },
    );

    await pres.writeFile({ fileName: `시장조사 ${detail ? '상세' : '기초'}자료_${d2.replace(/\s/g, '')}_${d3}_${today.replace(/\./g, '')}.pptx` });
    status(
      `${detail ? '상세' : '기초'}자료 PPT를 만들었어요. (반경 ${radTxt} ${pick.length}개 단지, ${tier}${tierNote}, 주변 분양 ${sales.length}건)`,
    );
  } catch (e) {
    status((detail ? '상세' : '기초') + '자료 PPT를 만들지 못했어요: ' + (e.message || e.msg || e), true);
  }
  btn.disabled = false;
  if (btn2) btn2.disabled = false;
  recompute();
}
