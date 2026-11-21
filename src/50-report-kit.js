// 시장조사 PPT 공통: 위치도 이미지, 글꼴·색·표·KPI(reportKit), 표지, 상세자료 공통 쪽
/* ---------- 시장조사 기초자료 PPT (브라우저에서 바로 생성) ---------- */
// 범위: 대상지 반경(화면에서 고른 반경에서 시작, 준공 5년 이내 단지가 3개 미만이면 최대 3km까지 자동 확대). 준공 5년 이내 → 10년 이내 → 전체.
// 분양: 청약홈 공고 중 최근 2년·반경 3km 이내(없으면 같은 시·군 가까운 순 3건)를 단지 요약과 함께 위치도·분양 슬라이드에 넣는다.
// 실거래: 단지별 최근 1년, 1년 내 거래가 없으면 최근 2년. 단지별 면적타입 요약(최고·최저·중위·평균)과 최근 5건.
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.PptxGenJS) return res();
    const el = document.createElement('script');
    el.src = src;
    el.onload = res;
    el.onerror = () => rej(new Error('PPT 라이브러리를 불러오지 못했어요.'));
    document.head.appendChild(el);
  });
}
// 위치도: OpenStreetMap 배경 위에 대상지와 비교 단지를 번호로 찍어 이미지로 만든다. 배경을 못 받으면 배경 없이 위치 관계만 그린다.
async function mapImage(center, pts, W, H, pts2) {
  pts2 = pts2 || [];
  const X0 = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z,
    Y0 = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 256 * 2 ** z;
  const all = [center].concat(pts, pts2);
  let z = 17;
  for (; z > 8; z--) {
    const xs = all.map(p => X0(p.lon, z)),
      ys = all.map(p => Y0(p.lat, z));
    if (Math.max(...xs) - Math.min(...xs) <= W - 260 && Math.max(...ys) - Math.min(...ys) <= H - 220) break;
  }
  const xs = all.map(p => X0(p.lon, z)),
    ys = all.map(p => Y0(p.lat, z)),
    ox = (Math.min(...xs) + Math.max(...xs)) / 2 - W / 2,
    oy = (Math.min(...ys) + Math.max(...ys)) / 2 - H / 2;
  const draw = async withTiles => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#EEF1F5';
    g.fillRect(0, 0, W, H);
    let got = 0;
    if (withTiles) {
      const jobs = [];
      for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++)
        for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++)
          jobs.push(
            new Promise(res => {
              const im = new Image();
              im.crossOrigin = 'anonymous';
              const to = setTimeout(() => res(), 9000);
              im.onload = () => {
                clearTimeout(to);
                try {
                  g.drawImage(im, Math.round(tx * 256 - ox), Math.round(ty * 256 - oy));
                  got++;
                } catch (e) {}
                res();
              };
              im.onerror = () => {
                clearTimeout(to);
                res();
              };
              im.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
            }),
          );
      if (jobs.length > 60) return null;
      await Promise.all(jobs);
      g.fillStyle = 'rgba(255,255,255,.28)';
      g.fillRect(0, 0, W, H);
    } else {
      g.strokeStyle = '#DDE2E9';
      g.lineWidth = 1;
      for (let x = 0; x < W; x += 80) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
      for (let y = 0; y < H; y += 80) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    pts.forEach((p, i) => {
      const x = X0(p.lon, z) - ox,
        y = Y0(p.lat, z) - oy;
      g.beginPath();
      g.arc(x, y, 26, 0, 6.283);
      g.fillStyle = '#12263F';
      g.fill();
      g.lineWidth = 3.5;
      g.strokeStyle = '#fff';
      g.stroke();
      g.fillStyle = '#fff';
      g.font = 'bold 26px sans-serif';
      g.fillText(String(i + 1), x, y + 2);
    });
    pts2.forEach((p, i) => {
      const x = X0(p.lon, z) - ox,
        y = Y0(p.lat, z) - oy;
      g.fillStyle = '#E8710A';
      g.fillRect(x - 24, y - 24, 48, 48);
      g.lineWidth = 3.5;
      g.strokeStyle = '#fff';
      g.strokeRect(x - 24, y - 24, 48, 48);
      g.fillStyle = '#fff';
      g.font = 'bold 26px sans-serif';
      g.fillText(String.fromCharCode(65 + i), x, y + 2);
    });
    const cx = X0(center.lon, z) - ox,
      cy = Y0(center.lat, z) - oy;
    g.beginPath();
    g.arc(cx, cy, 20, 0, 6.283);
    g.fillStyle = '#D93025';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#fff';
    g.stroke();
    g.font = 'bold 28px sans-serif';
    const tw = g.measureText('대상지').width + 26;
    g.fillStyle = '#D93025';
    g.fillRect(cx - tw / 2, cy - 70, tw, 40);
    g.fillStyle = '#fff';
    g.fillText('대상지', cx, cy - 49);
    // 축척 막대
    const mpp = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** z,
      steps = [100, 200, 500, 1000, 2000, 5000],
      sm = steps.find(v => v / mpp >= 110) || 5000,
      sw = sm / mpp;
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.fillRect(18, H - 54, sw + 24, 38);
    g.fillStyle = '#1B2430';
    g.fillRect(30, H - 28, sw, 4);
    g.font = '17px sans-serif';
    g.textAlign = 'left';
    g.fillText(sm >= 1000 ? sm / 1000 + 'km' : sm + 'm', 30, H - 40);
    if (withTiles) {
      g.font = '15px sans-serif';
      const t = '© OpenStreetMap contributors',
        w2 = g.measureText(t).width + 16;
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillRect(W - w2 - 8, H - 32, w2, 24);
      g.fillStyle = '#333';
      g.fillText(t, W - w2, H - 20);
    }
    try {
      return { data: withTiles && got > 0 ? cv.toDataURL('image/jpeg', 0.88) : cv.toDataURL('image/png'), tiles: withTiles && got > 0 };
    } catch (e) {
      return null;
    }
  };
  let r = null;
  try {
    r = await draw(true);
  } catch (e) {}
  if (!r || !r.tiles) r = await draw(false);
  return r;
}
const ymdAgo = m => ymdOf(new Date(S.asOf.getFullYear(), S.asOf.getMonth() - m, S.asOf.getDate()));
// PPT 공통 부품: 글꼴·색·표·KPI·쪽 머리글. 아파트·오피스텔 PPT가 같이 쓴다. src는 각 쪽 하단 출처 문구의 앞부분.
function reportKit(pres, src) {
  // 글꼴: 나눔스퀘어(기본) / KoPubWorld돋움 / 맑은 고딕 — 파일에 글꼴은 포함되지 않으므로 보는 PC에 설치돼 있어야 한다 (없으면 PowerPoint가 대체 글꼴로 표시)
  const FONTS = {
    ns: ['나눔스퀘어', '나눔스퀘어 ExtraBold'],
    kp: ['KoPubWorld돋움체 Medium', 'KoPubWorld돋움체 Bold'],
    mg: ['맑은 고딕', '맑은 고딕'],
  };
  let fk = 'ns';
  try {
    fk = localStorage.getItem('rfont') || 'ns';
  } catch (e) {}
  const [F, FH] = FONTS[fk] || FONTS.ns;
  const NAVY = '0B1F3A',
    INK = '1F2937',
    MUTE = '6B7280',
    LINE = 'DDD8CC',
    BG = 'F5F2EB',
    ACC = 'B08D57',
    GOLD = '9A7B45',
    GOLDBG = 'F3EBDD',
    ZEBRA = 'F9F7F2',
    WARN = 'C2410C',
    LX = 0.55,
    LW = 12.23;
  const today = S.asOf.getFullYear() + '.' + String(S.asOf.getMonth() + 1).padStart(2, '0') + '.' + String(S.asOf.getDate()).padStart(2, '0');
  const n = v => (v == null || isNaN(v) ? '-' : Math.round(v).toLocaleString('ko-KR')),
    mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const TH = (t, f) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: typeof f === 'string' ? f : NAVY }, align: 'center' } });
  const cell = (t, o) => ({ text: String(t), options: Object.assign({ align: 'center' }, o || {}) });
  const tbl = (sl, data, x, y, w, colW, fs, rowH) => {
    data.forEach((rw, ri) => {
      if (ri && ri % 2 === 0)
        rw.forEach(c => {
          if (c && c.options && !c.options.fill) c.options.fill = { color: ZEBRA };
        });
    });
    return sl.addTable(data, {
      x,
      y,
      w,
      colW,
      fontFace: F,
      fontSize: fs || 9,
      border: { type: 'solid', pt: 0.5, color: LINE },
      valign: 'middle',
      margin: [2, 5, 2, 5],
      rowH: rowH || 0.28,
      color: INK,
    });
  };
  let pageNo = 1;
  const page = (headline, tag) => {
    const sl = pres.addSlide();
    pageNo++;
    sl.background = { color: 'FFFFFF' };
    sl.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.12, fill: { color: NAVY }, line: { color: NAVY, width: 0 } });
    sl.addShape(pres.ShapeType.rect, { x: LX, y: 0.43, w: 0.3, h: 0.04, fill: { color: ACC }, line: { color: ACC, width: 0 } });
    sl.addText(tag, { x: LX + 0.42, y: 0.31, w: 8, h: 0.26, fontFace: FH, fontSize: 9, color: GOLD, charSpacing: 2, margin: 0, isTextBox: true });
    sl.addText(headline, {
      x: LX,
      y: 0.62,
      w: LW,
      h: 0.6,
      fontFace: FH,
      fontSize: 18,
      color: NAVY,
      margin: 0,
      valign: 'middle',
      isTextBox: true,
      fit: 'shrink',
    });
    sl.addShape(pres.ShapeType.rect, { x: LX, y: 7.02, w: LW, h: 0.01, fill: { color: LINE }, line: { color: LINE, width: 0 } });
    sl.addText(`출처: ${src}, 지도 © OpenStreetMap · 기준일 ${today} · 해제 거래 제외 · 참고용`, {
      x: LX,
      y: 7.08,
      w: 10.5,
      h: 0.22,
      fontFace: F,
      fontSize: 8,
      color: MUTE,
      margin: 0,
      isTextBox: true,
    });
    sl.addText(String(pageNo), {
      x: 12.08,
      y: 7.08,
      w: 0.7,
      h: 0.22,
      fontFace: FH,
      fontSize: 8,
      color: GOLD,
      align: 'right',
      margin: 0,
      isTextBox: true,
    });
    return sl;
  };
  const kpi = (sl, x, y, w, label, value, sub) => {
    sl.addShape(pres.ShapeType.rect, { x, y, w, h: 1.15, fill: { color: 'FFFFFF' }, line: { color: LINE, width: 0.75 } });
    sl.addShape(pres.ShapeType.rect, { x, y, w: 0.07, h: 1.15, fill: { color: ACC }, line: { color: ACC, width: 0 } });
    sl.addText(label, { x: x + 0.22, y: y + 0.12, w: w - 0.34, h: 0.24, fontFace: F, fontSize: 9.5, color: MUTE, margin: 0, isTextBox: true });
    sl.addText(value, {
      x: x + 0.22,
      y: y + 0.36,
      w: w - 0.34,
      h: 0.48,
      fontFace: FH,
      fontSize: 24,
      color: NAVY,
      margin: 0,
      isTextBox: true,
      fit: 'shrink',
    });
    sl.addText(sub || '', {
      x: x + 0.22,
      y: y + 0.84,
      w: w - 0.34,
      h: 0.22,
      fontFace: F,
      fontSize: 8.5,
      color: MUTE,
      margin: 0,
      isTextBox: true,
      fit: 'shrink',
    });
  };
  const chartBase = () => ({
    catAxisLabelFontFace: F,
    valAxisLabelFontFace: F,
    catAxisLabelFontSize: 9,
    valAxisLabelFontSize: 9,
    catAxisLabelColor: MUTE,
    valAxisLabelColor: MUTE,
    valGridLine: { color: 'E6E9EE', size: 0.5 },
    catGridLine: { style: 'none' },
    showLegend: false,
    dataLabelFontFace: F,
    dataLabelFontSize: 8.5,
    dataLabelColor: INK,
    valAxisLabelFormatCode: '#,##0',
    dataLabelFormatCode: '#,##0',
  });
  return { pres, F, FH, NAVY, INK, MUTE, LINE, BG, ACC, GOLD, GOLDBG, ZEBRA, WARN, LX, LW, today, n, mean, TH, cell, tbl, page, kpi, chartBase };
}
// 상세자료에만 들어가는 쪽: 입지환경·인구·연령·입주예정. 아파트·오피스텔 PPT가 같이 쓴다.
// K: reportKit 결과 + { reg(법정동 코드 정보), d2(시군구), d3(읍면동), sido }
async function addDetailSlides(K) {
  const { pres, page, kpi, tbl, cell, TH, chartBase, F, LX, LW, NAVY, INK, MUTE, GOLD, GOLDBG, n, reg, d3 } = K;
  let sl;
  // 입지환경 (카카오 지도 검색)
  status('기초자료 준비 중… 입지환경 조회');
  {
    const env = await locEnv(S.center),
      er = envRows(env);
    sl = page(er.head, 'LOCATION ENVIRONMENT');
    const mk = rows =>
      [['구분', '시설', '이름', '거리', '도보'].map(TH)].concat(
        rows.map(r => r.map((t, i) => cell(t, i === 0 ? { bold: true, color: NAVY } : i === 2 ? { align: 'left' } : {}))),
      );
    tbl(sl, mk(er.L), LX, 1.45, 6.0, [0.75, 1.55, 2.25, 0.8, 0.65], 9, 0.34);
    tbl(sl, mk(er.R), LX + 6.25, 1.45, 5.9, [0.75, 1.5, 2.2, 0.8, 0.65], 9, 0.34);
    sl.addText(
      [
        '거리는 대상지에서 직선거리이고, 도보 시간은 80m/분으로 환산한 추정입니다(실제 경로·고저차와 다릅니다).',
        '카카오맵 장소 검색 결과 기준이며, 개수는 최대 45곳까지만 집계됩니다. 학교 배정(학구도)은 따로 확인해야 합니다.',
        '버스·광역교통(GTX 등)과 개발계획은 이 쪽에 포함하지 않았습니다.',
      ].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      { x: LX + 6.25, y: 4.7, w: 5.9, h: 1.6, fontFace: F, fontSize: 9, color: MUTE, margin: 0, valign: 'top', paraSpaceAfter: 4, isTextBox: true },
    );
  }
  // 인구·세대 (행정안전부 주민등록)
  let popRes = null;
  status('기초자료 준비 중… 인구·세대 조회');
  {
    let pd = null,
      perr = '';
    try {
      pd = await popData(reg);
      popRes = pd;
    } catch (e) {
      perr = e.message || '조회하지 못했습니다';
    }
    const lab = ym => `'${String(ym).slice(2, 4)}.${String(ym).slice(4)}`,
      pct = (a, b) => (b ? (a / b - 1) * 100 : null),
      pt = v => (v == null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
    if (!pd || pd.ser.length < 2 || !pd.ser[pd.ser.length - 1].s) {
      sl = page('인구·세대 자료를 불러오지 못했습니다', 'DEMAND · POPULATION');
      sl.addText(perr || '조회 결과가 없습니다.', {
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
    } else {
      const ser = pd.ser,
        A = ser[0],
        Z = ser[ser.length - 1],
        yrs = Math.round((Z.ym - A.ym) / 100),
        pop = ser.map(x => (x.s ? x.s.pop : 0)),
        hhs = ser.map(x => (x.s ? x.s.hh : 0));
      const gp = pct(Z.s.pop, A.s.pop),
        gh = pct(Z.s.hh, A.s.hh),
        per = Z.s.hh ? Z.s.pop / Z.s.hh : 0,
        per0 = A.s.hh ? A.s.pop / A.s.hh : 0;
      const mine = Z.d.find(x => x.name === d3) || null,
        mine0 = mine ? A.d.find(x => x.name === d3) : null;
      sl = page(
        `${pd.sggName} 인구 ${n(Z.s.pop)}명(${yrs}년 ${pt(gp)}), 세대수 ${n(Z.s.hh)}세대(${pt(gh)}) · 세대당 ${per.toFixed(2)}명`,
        'DEMAND · POPULATION',
      );
      const kg = 0.21,
        kw3 = (LW - kg * 2) / 3;
      kpi(sl, LX, 1.4, kw3, `${pd.sggName} 주민등록 인구`, `${n(Z.s.pop)}명`, `${lab(A.ym)} 대비 ${pt(gp)} (${n(Z.s.pop - A.s.pop)}명)`);
      kpi(
        sl,
        LX + kw3 + kg,
        1.4,
        kw3,
        `${pd.sggName} 세대수`,
        `${n(Z.s.hh)}세대`,
        `${lab(A.ym)} 대비 ${pt(gh)} · 세대당 ${per0.toFixed(2)} → ${per.toFixed(2)}명`,
      );
      kpi(
        sl,
        LX + (kw3 + kg) * 2,
        1.4,
        kw3,
        mine ? `${d3} 인구 · 세대수` : '대상지 동',
        mine ? `${n(mine.pop)}명 · ${n(mine.hh)}세대` : '-',
        mine && mine0
          ? `${lab(A.ym)} 대비 인구 ${pt(pct(mine.pop, mine0.pop))}, 세대수 ${pt(pct(mine.hh, mine0.hh))}`
          : mine
            ? '비교 시점 자료 없음'
            : '대상지 동을 목록에서 찾지 못함',
      );
      sl.addText(`${pd.sggName} 인구 (명)`, {
        x: LX,
        y: 2.75,
        w: 3.7,
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
        [{ name: '인구', labels: ser.map(x => lab(x.ym)), values: pop }],
        Object.assign(chartBase(), {
          x: LX,
          y: 3.05,
          w: 3.75,
          h: 3.1,
          barDir: 'col',
          chartColors: [NAVY],
          showValue: true,
          dataLabelFormatCode: '#,##0',
          dataLabelFontSize: 7.5,
          barGapWidthPct: 45,
          valAxisMinVal: Math.floor((Math.min(...pop) * 0.9) / 1000) * 1000,
        }),
      );
      sl.addText(`${pd.sggName} 세대수 (세대)`, {
        x: LX + 3.95,
        y: 2.75,
        w: 3.7,
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
        [{ name: '세대수', labels: ser.map(x => lab(x.ym)), values: hhs }],
        Object.assign(chartBase(), {
          x: LX + 3.95,
          y: 3.05,
          w: 3.75,
          h: 3.1,
          barDir: 'col',
          chartColors: [GOLD],
          showValue: true,
          dataLabelFormatCode: '#,##0',
          dataLabelFontSize: 7.5,
          barGapWidthPct: 45,
          valAxisMinVal: Math.floor((Math.min(...hhs) * 0.9) / 1000) * 1000,
        }),
      );
      sl.addText(`읍면동별 (${lab(Z.ym)} · ${lab(A.ym)} 대비)`, {
        x: LX + 7.95,
        y: 2.75,
        w: 4.2,
        h: 0.26,
        fontFace: F,
        fontSize: 11,
        bold: true,
        color: INK,
        margin: 0,
        isTextBox: true,
      });
      const rowsD = Z.d
        .slice()
        .sort((a, b) => b.pop - a.pop)
        .slice(0, 10)
        .map(x => {
          const o = A.d.find(y => y.name === x.name),
            me = x.name === d3,
            st = me ? { bold: true, fill: { color: GOLDBG } } : {};
          return [
            cell(x.name, Object.assign({ align: 'left' }, st)),
            cell(n(x.pop), st),
            cell(n(x.hh), st),
            cell(x.hh ? (x.pop / x.hh).toFixed(2) : '-', st),
            cell(o ? pt(pct(x.pop, o.pop)) : '-', st),
          ];
        });
      tbl(
        sl,
        [['동', '인구', '세대수', '세대당', `인구 ${yrs}년`].map(TH)].concat(rowsD),
        LX + 7.95,
        3.05,
        4.2,
        [1.15, 0.85, 0.85, 0.6, 0.75],
        8.5,
        0.29,
      );
      sl.addText(
        [
          `행정안전부 주민등록 인구 및 세대현황(법정동 기준, 매년 ${String(pd.ym0).slice(4).replace(/^0/, '')}월 말 기준, 2022.10 이후만 조회 가능). 거주자·거주불명자·재외국민을 포함합니다.`,
          '주민등록 기준이라 실거주 인구와 다를 수 있고, 전입전출(인구 이동)은 포함하지 않았습니다. 연령 구성은 다음 쪽에 있습니다.',
        ].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
        { x: LX, y: 6.3, w: LW, h: 0.62, fontFace: F, fontSize: 8.5, color: MUTE, margin: 0, valign: 'top', paraSpaceAfter: 3, isTextBox: true },
      );
    }
  }
  status('기초자료 준비 중… 연령 구성 조회');
  await addAgeSlide(K, popRes);
  status('기초자료 준비 중… 입주예정 조회');
  await addSupplySlide(K, popRes);
}
// 표지: 왼쪽 제목·요약, 오른쪽 위치도(배경지도를 못 받으면 도형으로 대체)
function coverSlide(K, mi, title, area, info) {
  const { pres, F, FH, NAVY, ACC, today } = K;
  const sl = pres.addSlide();
  sl.background = { color: NAVY };
  if (mi && mi.tiles) {
    sl.addImage({ data: mi.data, x: 7.3, y: 0, w: 6.033, h: 7.5, sizing: { type: 'cover', w: 6.033, h: 7.5 } });
    sl.addShape(pres.ShapeType.rect, { x: 7.3, y: 0, w: 6.033, h: 7.5, fill: { color: NAVY, transparency: 38 }, line: { color: NAVY, width: 0 } });
  } else {
    sl.addShape(pres.ShapeType.rect, { x: 7.3, y: 0, w: 6.033, h: 7.5, fill: { color: '10294A' }, line: { color: '10294A', width: 0 } });
    for (let k = 0; k < 4; k++)
      sl.addShape(pres.ShapeType.ellipse, {
        x: 8.2 + k * 0.45,
        y: 1.6 + k * 0.45,
        w: 5 - k * 0.9,
        h: 5 - k * 0.9,
        fill: { color: '10294A' },
        line: { color: '24406B', width: 1 },
      });
  }
  sl.addShape(pres.ShapeType.rect, { x: 7.3, y: 0, w: 0.06, h: 7.5, fill: { color: ACC }, line: { color: ACC, width: 0 } });
  sl.addText('MARKET SNAPSHOT', {
    x: 0.8,
    y: 1.55,
    w: 6,
    h: 0.3,
    fontFace: FH,
    fontSize: 11,
    color: ACC,
    charSpacing: 4,
    margin: 0,
    isTextBox: true,
  });
  sl.addText(title, {
    x: 0.8,
    y: 2.0,
    w: 6.4,
    h: 1.9,
    fontFace: FH,
    fontSize: 36,
    color: 'FFFFFF',
    margin: 0,
    valign: 'top',
    isTextBox: true,
    paraSpaceAfter: 2,
  });
  sl.addShape(pres.ShapeType.rect, { x: 0.8, y: 4.1, w: 0.9, h: 0.05, fill: { color: ACC }, line: { color: ACC, width: 0 } });
  sl.addText(area, { x: 0.8, y: 4.35, w: 6.4, h: 0.45, fontFace: FH, fontSize: 18, color: 'FFFFFF', margin: 0, isTextBox: true });
  sl.addText(info, {
    x: 0.8,
    y: 4.95,
    w: 6.4,
    h: 1.2,
    fontFace: F,
    fontSize: 10.5,
    color: 'C3CCD9',
    margin: 0,
    isTextBox: true,
    valign: 'top',
    paraSpaceAfter: 4,
  });
  sl.addText(today, { x: 0.8, y: 6.75, w: 4, h: 0.3, fontFace: FH, fontSize: 11, color: ACC, margin: 0, isTextBox: true });
}
