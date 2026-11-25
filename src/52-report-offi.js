// 오피스텔 시장조사 PPT (기초자료·상세자료)
// 오피스텔 시장조사 기초자료 PPT: 대상지 반경 오피스텔(최근 1년, 없으면 2년 실거래) + 주변 오피스텔 분양(청약홈).
// 아파트와 달리 평당가는 '전용면적' 기준이다(오피스텔은 전용률이 낮아 공급면적 환산을 하지 않음). 면적은 전용 소수점 버림.
async function makeOffiReport(detail) {
  if (!S.center) return status('먼저 주소를 검색해 대상지를 정해 주세요.', true);
  if (!KEY) return status('국토부 인증키를 입력한 뒤 눌러 주세요.', true);
  const btn = $('#rpt'),
    btn2 = $('#rpt2');
  btn.disabled = true;
  if (btn2) btn2.disabled = true;
  try {
    status('오피스텔 기초자료 준비 중… 대상지 확인');
    const reg = await centerRegion();
    if (!reg || !reg.code) throw new Error('대상지의 행정구역을 확인하지 못했어요.');
    const code5 = String(reg.code).slice(0, 5),
      d1 = reg.region_1depth_name || '',
      d2 = reg.region_2depth_name || '',
      d3 = reg.region_3depth_name || '';
    const cut1 = ymdAgo(12),
      cut2 = ymdAgo(24),
      tok = ++S.token;
    const steps = [500, 1000, 2000, 3000].filter(v => v >= S.rad);
    if (!steps.length) steps.push(S.rad);
    let radUsed = steps[0],
      found = [];
    for (const R of steps) {
      // 비교 오피스텔이 3곳 미만이면 반경을 넓힌다 (최대 3km)
      radUsed = R;
      status(`오피스텔 기초자료 준비 중… 반경 ${radiusTxt(R)} 실거래 조회`);
      const codes = await regionsAround(S.center, R),
        err = await ensureOffi(codes, 24);
      if (err) throw new Error(offiErrText(err));
      status(`오피스텔 기초자료 준비 중… 반경 ${radiusTxt(R)} 위치 확인`);
      found = (await locateOffi(codes, tok, cut2, R)).out.filter(i => passYear(i.g));
      if (tok !== S.token) throw new Error('다른 검색이 시작돼 만들기를 멈췄어요. 다시 눌러 주세요.');
      if (found.length >= 3) break;
    }
    if (!found.length)
      throw new Error(`반경 ${radiusTxt(radUsed)} 안에 ${S.oyear ? '준공 ' + S.oyear + '년 이내 ' : ''}최근 2년 거래된 오피스텔이 없어요.`);
    let pick = found.slice().sort((a, b) => a.d - b.d);
    const cutN = pick.length > 30 ? pick.length - 30 : 0;
    pick = pick.slice(0, 30);
    await fillBld(
      pick.map(r => r.g).filter(g => BLD[obkey(g)] === undefined),
      obkey,
      async g => {
        const rc = await regionCode({ lat: g.p[0], lon: g.p[1] });
        return rc && rc.length >= 10 ? await fetchLedger(g, rc, '업무') : 0;
      },
      '오피스텔 기초자료 준비 중… 건물 정보(호수·층수)',
    );
    const rows = pick.map(it => {
      const g = it.g,
        all = g.trades.filter(t => t[0] >= cut2),
        t1 = all.filter(t => t[0] >= cut1),
        b = BLD[obkey(g)];
      return {
        g,
        d: it.d,
        all,
        tr: t1.length ? t1 : all,
        span: t1.length ? 1 : 2,
        year: (b && b[1]) || g.by || 0,
        hh: (b && b[0]) || 0,
        up: (b && b[2]) || 0,
        dn: (b && b[3]) || 0,
      };
    });
    // 주변 분양 (청약홈 오피스텔·도시형·생활숙박): 최근 2년, 반경 3km 이내 → 없으면 같은 시·군 가까운 순 3건
    status('오피스텔 기초자료 준비 중… 주변 분양 단지 확인');
    const {
      sales,
      note: saleNote,
      far: saleFar,
      noGeo,
      RTxt: saleRTxt,
    } = await nearbySales(OSIDO[code5.slice(0, 2)] || d1.slice(0, 2), d2.split(' ')[0], cut2, radUsed);
    status('오피스텔 기초자료 준비 중… PPT 작성');
    await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js');
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    pres.title = detail ? '오피스텔 시장조사 상세자료' : '오피스텔 시장조사 기초자료';
    const K0 = reportKit(pres, '국토교통부 실거래가 공개시스템, 건축물대장, 청약홈');
    const { F, FH, NAVY, INK, MUTE, LINE, BG, ACC, GOLD, GOLDBG, ZEBRA, WARN, LX, LW, today, n, mean, TH, cell, tbl, page, kpi, chartBase } = K0;
    const ppy = t => t[3] / (t[1] / PY),
      radTxt = radiusTxt(radUsed),
      radAsk = radiusTxt(S.rad),
      area = `${d1} ${d2} ${d3}`.trim();
    const shortN = s => (s.length > 14 ? s.slice(0, 14) + '…' : s);
    const pairs1 = rows.flatMap(r => r.all.filter(t => t[0] >= cut1).map(t => [r, t])),
      pairs0 = rows.flatMap(r => r.all.filter(t => t[0] < cut1).map(t => [r, t]));
    const mp1 = pairs1.length ? med(pairs1.map(([r, t]) => ppy(t))) : null,
      mp0 = pairs0.length ? med(pairs0.map(([r, t]) => ppy(t))) : null,
      chg = mp1 && mp0 ? (mp1 / mp0 - 1) * 100 : null;
    const chgTxt = chg == null ? '비교 불가' : (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%';
    const bandSt = b => {
      const v = pairs1.filter(([r, t]) => t[1] >= b.a && t[1] < b.b);
      return v.length ? { b, cnt: v.length, med: med(v.map(([r, t]) => t[3])), ppy: med(v.map(([r, t]) => ppy(t))) } : null;
    };
    const top2 = OBANDS.slice(1)
      .map(bandSt)
      .filter(Boolean)
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 2);
    const sumOf = r => {
      const b = dominant(r.tr, true),
        am = b.v.map(t => t[3]);
      return { type: b.k, cnt: b.v.length, med: med(am), max: Math.max(...am), min: Math.min(...am), ppy: med(b.v.map(ppy)) };
    };
    // 표지
    status('오피스텔 기초자료 준비 중… 위치도 작성');
    const mapPts = rows.slice(0, 30),
      salePts = sales.slice(0, 8),
      mi = await mapImage(
        S.center,
        mapPts.map(r => ({ lat: r.g.p[0], lon: r.g.p[1] })),
        1640,
        1100,
        salePts.map(x => ({ lat: x.lat, lon: x.lon })),
      );
    coverSlide(
      K0,
      mi,
      '오피스텔\n시장조사 기초자료',
      area,
      `대상지  ${S.center.label || area}\n조사 범위  반경 ${radTxt} 오피스텔 ${found.length}곳 중 ${rows.length}곳\n주변 분양  ${sales.length}건`,
    );
    let sl;
    // 요약
    const bLab = x => x.b.t.replace(/\s*\(.*\)/, '');
    sl = page(
      mp1
        ? `반경 ${radTxt} 오피스텔 ${rows.length}곳, 최근 1년 ${n(pairs1.length)}건 · 전용 평당가 중위 ${n(mp1)}만원 (직전 1년 대비 ${chgTxt})`
        : `반경 ${radTxt} 오피스텔 ${rows.length}곳, 최근 1년 실거래 없음`,
      'EXECUTIVE SUMMARY',
    );
    const kw = 2.9,
      kg = 0.21;
    kpi(sl, LX, 1.4, kw, '대상 오피스텔', `${rows.length}곳`, `반경 ${radTxt} 내 ${found.length}곳 중`);
    kpi(sl, LX + (kw + kg), 1.4, kw, '최근 1년 거래', `${n(pairs1.length)}건`, `직전 1년 ${n(pairs0.length)}건 · 평당가 ${chgTxt}`);
    for (let i = 0; i < 2; i++) {
      const x = top2[i];
      kpi(
        sl,
        LX + (kw + kg) * (2 + i),
        1.4,
        kw,
        x ? `${bLab(x)} ${x.b.t.replace(/^[^(]*/, '')} 중위가` : '다음 면적대',
        x ? `${n(x.med)}만원` : '-',
        x ? `최근 1년 ${x.cnt}건 · 전용 평당 ${n(x.ppy)}만원` : '거래 없음',
      );
    }
    const bars = rows
      .filter(r => r.tr.length)
      .map(r => ({ name: shortN(r.g.name), v: Math.round(sumOf(r).ppy) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 10)
      .reverse();
    const nAllB = rows.filter(r => r.tr.length).length,
      noT = rows.filter(r => !r.tr.length);
    const barNote =
      '건물별 주력 전용면적(거래가 가장 많은 면적)의 중위 전용 평당가입니다. 면적이 다른 건물끼리도 같은 단위로 비교하려는 기준입니다.' +
      (noT.length
        ? ` 최근 2년 거래가 없는 ${noT.length}개 건물은 제외: ${noT
            .slice(0, 4)
            .map(r => shortN(r.g.name))
            .join(', ')}${noT.length > 4 ? ' 외 ' + (noT.length - 4) + '개' : ''}.`
        : '') +
      (nAllB > 10 ? ` 상위 10개만 표시(전체 ${nAllB}개).` : '');
    barBlock(K0, sl, { title: '오피스텔별 전용 평당가 (주력 면적 중위, 만원)', name: '전용 평당가', bars, note: barNote });
    criteriaBox(K0, sl, [
      `범위: 대상지 반경 ${radTxt} 안 오피스텔 (선택 반경 ${radAsk}${radUsed > S.rad ? ', 비교 대상이 3곳 미만이라 확대' : ''})`,
      '실거래: 건물별 최근 1년, 없으면 최근 2년 (국토부 오피스텔 매매 신고 자료)',
      '면적·평당가: 전용면적 기준 (소수점 버림). 오피스텔은 전용률이 낮아 공급면적으로 환산하지 않음',
      `연차: ${S.oyear ? '준공 ' + S.oyear + '년 이내만 포함' : '준공연도 제한 없음'}`,
      `면적대: ${OBANDS.slice(1)
        .map(b => b.t)
        .join(' / ')}`,
      `차트: 주력 면적 중위 평당가${noT.length ? ', 거래 없는 ' + noT.length + '개 제외' : ''}${nAllB > 10 ? ', 상위 10개만' : ''}`,
      `분양: 청약홈 최근 2년 공고, 반경 ${saleRTxt} 이내 ${saleFar ? '없음 → 같은 시·군 가까운 순 ' : ''}${sales.length}건`,
    ]);
    // 위치도
    locationSlide(K0, {
      mi,
      pts: mapPts.map(r => ({ name: r.g.name, year: r.year, d: r.d })),
      salePts,
      noun: '오피스텔',
      unit: '곳',
      josa: '이',
      colName: '오피스텔',
      listRef: '요약표',
      restTxt: (k, m) => `${k}번 이후 ${m}곳은 요약표 참조`,
    });
    if (detail) await addDetailSlides(Object.assign({ reg, d2, d3, sido: OSIDO[code5.slice(0, 2)] }, K0));
    // 추이
    const ms = recentMonths(24);
    trendSlide(K0, {
      ms,
      vals: rows.flatMap(r => r.all.map(t => [t[0], ppy(t)])),
      pLabel: '전용 평당가',
      title: mp1
        ? `최근 12개월 중위 전용 평당가 ${n(mp1)}만원, 직전 12개월 대비 ${chgTxt} · 월평균 거래 ${(pairs1.length / 12).toFixed(1)}건`
        : '최근 2년 거래 추이',
    });
    // 오피스텔 요약표
    const sumHead = ['오피스텔', '거리', '준공', '호(실)수', '층수', '주력 전용', '건수', '중위가', '최고가', '최저가', '전용 평당가', '기간'].map(
        t => TH(t),
      ),
      sumW = [2.7, 0.7, 0.6, 0.85, 1.0, 0.9, 0.65, 1.0, 1.0, 1.0, 1.1, 0.73];
    const sumRows = rows.map((r, i) => {
      const m = sumOf(r);
      return [
        cell(`${i + 1}. ${r.g.name}`, { align: 'left', bold: true }),
        cell(distTxt(r.d)),
        cell(r.year || '-'),
        cell(r.hh ? n(r.hh) : '-'),
        cell(r.up ? (r.dn ? `B${r.dn}/` : '') + r.up + 'F' : '-'),
        cell(m.type + '㎡'),
        cell(m.cnt),
        cell(n(m.med), { bold: true, color: NAVY, fill: { color: GOLDBG } }),
        cell(n(m.max)),
        cell(n(m.min)),
        cell(n(m.ppy), { bold: true }),
        cell(r.span + '년'),
      ];
    });
    comparablePages(K0, {
      head: sumHead,
      rows: sumRows,
      colW: sumW,
      title: i => `대상 ${rows.length}곳 요약: 전용 평당가 ${rangeTxt(n, rows.map(r => sumOf(r).ppy))}만원${i ? ' (계속)' : ''}`,
      note: '단위: 만원 · 전용면적은 소수점 버림 · 주력 전용은 거래가 가장 많은 면적 · 평당가는 전용면적 기준 · 호(실)수·층수는 건축물대장(업무시설 동 합산)',
    });
    // 오피스텔별: 한 쪽에 한 곳
    for (const r of rows.slice(0, 20)) {
      const g = r.g,
        m = sumOf(r);
      sl = page(`${g.name}: 전용 ${m.type}㎡ 중위 ${n(m.med)}만원, 전용 평당 ${n(m.ppy)}만원`, 'BUILDING PROFILE');
      profileLine(K0, sl, [
        r.year ? `${r.year}년 준공` : '준공연도 미확인',
        r.hh ? n(r.hh) + '호(실)' : '',
        r.up ? (r.dn ? `지하${r.dn}/` : '') + `지상${r.up}층` : '',
        `${g.umd} ${g.jibun}`,
        `대상지에서 ${distTxt(r.d)}`,
        `최근 ${r.span}년 거래 ${r.tr.length}건`,
      ]);
      const types = [...groupByArea(r.tr).entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .sort((a, b) => a[0] - b[0]);
      const tA = types.slice().sort((a, b) => b[1].length - a[1].length)[0][0],
        tB = (types.filter(x => x[0] !== tA).sort((a, b) => b[1].length - a[1].length)[0] || [null])[0];
      profileBody(
        K0,
        sl,
        r,
        { types, ga: groupByArea(r.all), tA, tB, ms, ppy },
        {
          typeTitle: `전용면적별 요약 (최근 ${r.span}년, 만원)`,
          pyHead: '전용(평)',
          pyOf: kk => (kk / PY).toFixed(1) + '평',
          recentHead: '전용',
          recentArea: t => `${t[1]}㎡ (${(t[1] / PY).toFixed(1)}평)`,
          aPrefix: '전용 ',
          pLabel: '전용 평당가',
        },
      );
    }
    // 주변 분양
    const ymNow = S.asOf.getFullYear() * 100 + S.asOf.getMonth() + 1,
      saleRows = [];
    for (const x of sales) {
      const r0 = x.r0,
        rid = rowId(r0);
      let top = '-',
        pp = '-',
        cr = '-';
      try {
        await saleExtra(rid, true);
        const [mdl, cmp] = await SALEX.get(rid);
        if (Array.isArray(mdl) && mdl.length && mdl[0].LTTOT_TOP_AMOUNT !== undefined) {
          const m0 = mdl.slice().sort((a, b) => (+b.SUPLY_HSHLDCO || 0) - (+a.SUPLY_HSHLDCO || 0))[0],
            amt = +String(m0.LTTOT_TOP_AMOUNT).replace(/,/g, ''),
            su = parseFloat(m0.SUPLY_AR);
          if (amt) {
            top = `${m0.HOUSE_TY || ''} · ${n(amt)}`;
            if (su > 0) pp = n(amt / (su / PY));
          }
        } else if (Array.isArray(mdl) && mdl.length && mdl[0].EXCLUSE_AR !== undefined) {
          const ak = Object.keys(mdl[0]).find(k => /AMOUNT/.test(k) && !/SUBSCRPT|REQST/.test(k)),
            m0 = mdl.slice().sort((a, b) => (+b.SUPLY_HSHLDCO || 0) - (+a.SUPLY_HSHLDCO || 0))[0],
            amt = ak ? +String(m0[ak]).replace(/,/g, '') : 0,
            ex = parseFloat(m0.EXCLUSE_AR);
          if (amt && ex > 0) {
            top = `전용 ${fl2(ex)}㎡ · ${n(amt)}`;
            pp = n(amt / (ex / PY));
          }
        }
        cr = compRatio(cmp, true);
      } catch (e) {}
      const ym = saleMoveYm(r0);
      saleRows.push([
        cell(String.fromCharCode(65 + saleRows.length), { bold: true, color: 'E8710A' }),
        cell(r0.RCRIT_PBLANC_DE || '-'),
        cell(r0.HOUSE_NM || '', { align: 'left', bold: true }),
        cell(typeOf(r0) || '-'),
        cell(saleAddr(r0), { align: 'left' }),
        cell((x.approx ? '~' : '') + distTxt(x.d)),
        cell(n(+r0.TOT_SUPLY_HSHLDCO)),
        cell(r0.MVN_PREARNGE_YM || '-'),
        moveCell(K0, ym, ymNow),
        cell(top),
        cell(pp, { bold: true, color: NAVY }),
        cell(cr),
      ]);
    }
    sl = page(`반경 ${saleFar ? '밖 ' : saleRTxt + ' 내 '}최근 2년 오피스텔·도시형·생활숙박 분양 ${sales.length}건`, 'NEW SUPPLY');
    sl.addText(
      `주변 분양 사례 (청약홈 · 위치도의 알파벳 · ${saleFar ? '반경 ' + saleRTxt + ' 안에는 없어 같은 시·군 가까운 순 ' + sales.length + '건' : '반경 ' + saleRTxt + ' 이내 가까운 순'} · 분양가는 공급세대가 가장 많은 주택형의 최고가, 평당가는 분양가÷전용면적, 만원)`,
      { x: LX, y: 1.4, w: LW, h: 0.26, fontFace: F, fontSize: 10.5, bold: true, color: INK, margin: 0, isTextBox: true },
    );
    if (saleRows.length) {
      tbl(
        sl,
        [
          [
            '',
            '모집공고일',
            '단지명',
            '유형',
            '공급위치',
            '거리',
            '실수',
            '입주예정',
            '상태',
            '분양가 (주택형·최고가)',
            '전용 평당가',
            '경쟁률',
          ].map(TH),
        ].concat(saleRows),
        LX,
        1.7,
        LW,
        [0.4, 0.9, 1.9, 0.9, 1.9, 0.6, 0.55, 0.75, 0.65, 1.5, 0.9, 1.28],
        8.5,
        0.28,
      );
      const nt = [
        sales.some(x => x.approx) ? '~ 표시는 지구·동 중심 기준의 개략 거리' : '',
        noGeo.length ? `위치를 찾지 못해 제외한 분양 공고 ${noGeo.length}건` : '',
        '오피스텔은 분양권 전매 실거래 공개 자료가 없어 넣지 않았습니다',
      ]
        .filter(Boolean)
        .join(' · ');
      sl.addText(nt, {
        x: LX,
        y: 1.7 + 0.28 * (saleRows.length + 1) + 0.12,
        w: LW,
        h: 0.2,
        fontFace: F,
        fontSize: 8,
        color: WARN,
        margin: 0,
        isTextBox: true,
      });
    } else
      sl.addText(saleNote || '조건에 맞는 분양 단지가 없습니다.', {
        x: LX,
        y: 1.7,
        w: LW,
        h: 0.28,
        fontFace: F,
        fontSize: 10,
        color: MUTE,
        margin: 0,
        isTextBox: true,
      });
    // 기준과 한계
    methodSlide(K0, [
      `조사 범위는 대상지 반경 ${radTxt} 안에서 최근 2년 거래가 있는 오피스텔 ${found.length}곳입니다${radUsed > S.rad ? ` (선택 반경 ${radAsk}에서 3곳 미만이라 넓혔습니다)` : ''}${cutN ? `. 가까운 30곳만 사용했습니다` : ''}.`,
      '오피스텔은 단지 목록이 없어 실거래 신고의 (읍면동·지번·건물명)으로 건물을 묶고, 신고 지번을 지도 좌표로 바꿔 반경을 가렸습니다. 지번을 좌표로 바꾸지 못한 건물은 빠질 수 있고, 같은 건물이 신고 명칭이 달라 둘로 나뉘거나 한 지번의 다른 건물과 합쳐질 수 있습니다.',
      '실거래는 국토교통부 신고 자료이며 해제된 거래는 뺐습니다. 최근 두 달은 신고 기한(계약 후 30일) 때문에 건수가 더 늘 수 있습니다. 주거용과 업무용은 구분하지 않았습니다.',
      '면적과 평당가는 전용면적 기준입니다. 오피스텔은 전용률이 낮아(대개 50~60%대) 계약·공급면적 기준 평당가와 크게 다르며, 아파트 평당가와 직접 비교할 수 없습니다.',
      '호(실)수·층수·준공연도는 건축물대장(표제부)의 업무시설 동 기준이며, 확인하지 못한 항목은 비워 두었습니다(준공연도는 실거래 신고값으로 보충).',
      '분양은 청약홈 오피스텔·도시형생활주택·민간임대·생활숙박시설 공고 기준이며, 위치는 공급위치 주소를 좌표로 바꾼 값이라 실제와 다를 수 있습니다. 오피스텔 분양권 전매 실거래는 공개 자료가 없어 포함하지 않았습니다.',
      '전월세·임대수익률, 인구·세대, 공급(착공·준공) 물량, 적정 분양가 검토는 이 자료에 없습니다.',
    ]);
    await pres.writeFile({
      fileName: `오피스텔 시장조사 ${detail ? '상세' : '기초'}자료_${d2.replace(/\s/g, '')}_${d3}_${today.replace(/\./g, '')}.pptx`,
    });
    status(`오피스텔 ${detail ? '상세' : '기초'}자료 PPT를 만들었어요. (반경 ${radTxt} ${rows.length}곳, 주변 분양 ${sales.length}건)`);
  } catch (e) {
    status('오피스텔 ' + (detail ? '상세' : '기초') + '자료 PPT를 만들지 못했어요: ' + (e.message || e.msg || e), true);
  }
  btn.disabled = false;
  if (btn2) btn2.disabled = false;
  recomputeOffi();
}
