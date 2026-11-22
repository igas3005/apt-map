// 토지·상가 거래 엑셀 내보내기 — 지금 화면의 반경·기간·필터에 맞는 거래를 ExcelJS로 만든다.
// 평(면적)·평당가·공시지가 배율·요약 통계는 값이 아니라 수식이라, 엑셀에서 고쳐 쓰면 같이 바뀐다.
function loadExcelLib() {
  return new Promise((res, rej) => {
    if (window.ExcelJS) return res();
    const el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    el.onload = res;
    el.onerror = () => rej(new Error('엑셀 라이브러리를 불러오지 못했어요.'));
    document.head.appendChild(el);
  });
}
const XL_FONT = { name: '맑은 고딕', size: 10 },
  XL_NAVY = 'FF1F3A5F',
  XL_LINE = { style: 'thin', color: { argb: 'FFBFC5CE' } };
const xlBorder = { top: XL_LINE, left: XL_LINE, bottom: XL_LINE, right: XL_LINE };
function xlHead(row) {
  row.eachCell(c => {
    c.font = Object.assign({}, XL_FONT, { bold: true, color: { argb: 'FFFFFFFF' } });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_NAVY } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = xlBorder;
  });
  row.height = 28;
}
const xlDate = ymd => new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100)); // 엑셀은 UTC 자정이어야 날짜가 하루 밀리지 않는다
async function exportLC() {
  const btn = $('#lcxl'),
    land = S.asset === 'land',
    kd = lcKind();
  const items = LC.list.filter(it => LC.sum.get(it.g.key));
  if (!items.length) return;
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '만드는 중…';
    }
    await loadExcelLib();
    const wb = new ExcelJS.Workbook();
    wb.creator = '수도권 단지 시세 지도';
    const ws = wb.addWorksheet('거래내역', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = land
      ? [['No', 6], ['계약일', 11], ['시군구', 11], ['읍면동', 14], ['지번', 11], ['지번 구분', 14], ['지목', 9], ['용도지역', 14], ['거래면적(㎡)', 11], ['거래면적(평)', 11], ['거래금액(만원)', 13], ['평당가(만원)', 12], ['지분거래', 8], ['대상지 거리(m)', 11], ['개별공시지가(원/㎡)', 14], ['공시지가 배율', 10]]
      : [['No', 6], ['계약일', 11], ['시군구', 11], ['읍면동', 14], ['지번', 11], ['지번 구분', 14], ['유형', 7], ['건물주용도', 14], ['용도지역', 14], ['건물면적(㎡)', 11], ['대지면적(㎡)', 11], ['기준면적(평)', 11], ['층', 6], ['사용승인연도', 9], ['거래금액(만원)', 13], ['평당가(만원)', 12], ['대상지 거리(m)', 11], ['개별공시지가(원/㎡)', 14], ['공시지가 배율', 10]];
    ws.columns = cols.map(c => ({ width: c[1] }));
    xlHead(ws.addRow(cols.map(c => c[0])));
    const rows = [];
    for (const it of items)
      for (const t of LC.sum.get(it.g.key).arr) rows.push({ g: it.g, d: it.d, t });
    rows.sort((a, b) => b.t.ymd - a.t.ymd || a.d - b.d);
    const gb = r => (r.g.masked ? (r.t.cand ? `비공개(후보 ${r.t.cand}필지)` : '비공개(동 단위)') : r.g.est ? '추정' : '공개');
    rows.forEach((r, i) => {
      const n = i + 2,
        t = r.t,
        jg = r.g.jiga ? r.g.jiga.v : null;
      const vals = land
        ? [i + 1, xlDate(t.ymd), r.g.sgg, r.g.umd, r.g.masked ? t.jibun : r.g.jibun, gb(r), t.kind, t.zone, t.area, { formula: `I${n}/${PY}`, result: t.area / PY }, t.amt, { formula: `K${n}/J${n}`, result: lcUnit(t) }, t.share ? '지분' : '', Math.round(r.d), jg, jg ? { formula: `K${n}*10000/I${n}/O${n}`, result: lcRatio(t, r.g) } : null]
        : [i + 1, xlDate(t.ymd), r.g.sgg, r.g.umd, r.g.masked ? t.jibun : r.g.jibun, gb(r), t.btype.includes('일반') ? '일반' : '집합', t.kind, t.zone, t.bArea, t.pArea || null, { formula: `${LC.opt.nrg === 'gen' ? 'K' : 'J'}${n}/${PY}`, result: lcBasis(t) / PY }, t.floor || null, t.by || null, t.amt, { formula: `O${n}/L${n}`, result: lcUnit(t) }, Math.round(r.d), jg, jg && LC.opt.nrg === 'gen' ? { formula: `O${n}*10000/K${n}/R${n}`, result: lcRatio(t, r.g) } : null];
      const row = ws.addRow(vals);
      row.eachCell({ includeEmpty: true }, c => {
        c.font = XL_FONT;
        c.border = xlBorder;
        c.alignment = { vertical: 'middle' };
      });
      const num = (idx, fmt) => (row.getCell(idx).numFmt = fmt);
      row.getCell(2).numFmt = 'yyyy-mm-dd';
      if (land) {
        num(9, '#,##0.0');
        num(10, '#,##0.0');
        num(11, '#,##0');
        num(12, '#,##0');
        num(14, '#,##0');
        num(15, '#,##0');
        num(16, '0.0"배"');
      } else {
        num(10, '#,##0.0');
        num(11, '#,##0.0');
        num(12, '#,##0.0');
        num(15, '#,##0');
        num(16, '#,##0');
        num(17, '#,##0');
        num(18, '#,##0');
        num(19, '0.0"배"');
      }
    });
    const last = rows.length + 1,
      pc = land ? 'L' : 'P', // 평당가 열
      gc = 'F'; // 지번 구분 열
    ws.autoFilter = { from: 'A1', to: ws.getRow(1).getCell(cols.length).address };
    // 요약 시트 — 거래내역을 수식으로 집계
    const sm = wb.addWorksheet('요약', { views: [{ showGridLines: false }] });
    sm.columns = [{ width: 24 }, { width: 22 }, { width: 50 }];
    const title = sm.addRow([`${kd.name} 실거래 조회 요약`]);
    title.font = Object.assign({}, XL_FONT, { bold: true, size: 14 });
    sm.addRow([]);
    const meta = [
      ['대상지', (S.center && S.center.label) || '선택한 위치'],
      ['반경', S.rad >= 1000 ? S.rad / 1000 + 'km' : S.rad + 'm'],
      ['기간', '최근 ' + yrsTxt()],
      ['조건', lcFilterTxt()],
      ['기준일', new Date().toISOString().slice(0, 10)],
    ];
    for (const m of meta) {
      const r = sm.addRow(m);
      r.getCell(1).font = Object.assign({}, XL_FONT, { bold: true });
      r.getCell(2).font = XL_FONT;
    }
    sm.addRow([]);
    xlHead(sm.addRow(['항목', '값', '비고']));
    const rng = c => `거래내역!${c}2:${c}${last}`;
    const stat = [
      ['거래 건수', { formula: `COUNT(${rng(pc)})` }, '필터에 맞는 거래'],
      ['중위 평당가(만원)', { formula: `MEDIAN(${rng(pc)})` }, land ? '거래금액 ÷ 거래면적(평)' : LC.opt.nrg === 'gen' ? '거래금액 ÷ 대지면적(평)' : '거래금액 ÷ 전용면적(평)'],
      ['평균 평당가(만원)', { formula: `AVERAGE(${rng(pc)})` }, ''],
      ['최고 평당가(만원)', { formula: `MAX(${rng(pc)})` }, ''],
      ['최저 평당가(만원)', { formula: `MIN(${rng(pc)})` }, ''],
      ['지번 추정 거래 건수', { formula: `COUNTIF(${rng(gc)},"추정")` }, '면적 대조로 지번을 추정한 거래'],
      ['지번 비공개 거래 건수', { formula: `COUNTIF(${rng(gc)},"비공개*")` }, '동 단위로만 알 수 있는 거래'],
    ];
    for (const s of stat) {
      const r = sm.addRow(s);
      r.eachCell(c => {
        c.font = XL_FONT;
        c.border = xlBorder;
      });
      r.getCell(2).numFmt = '#,##0';
    }
    sm.addRow([]);
    const notes = [
      '출처: 국토교통부 실거래가 공개자료' + (land ? ', 브이월드 연속지적도(개별공시지가)' : '') + (land ? '' : ', 건축물대장(추정 지번)'),
      '지번이 가려진 거래는 지목·면적 등을 대조해 필지를 추정한 값이며 실제와 다를 수 있습니다 (지번 구분 열 참고).',
      '지분거래는 ' + (land && LC.opt.land === 'incl' ? '포함' : '제외') + '했습니다. 해제된 거래는 제외했습니다.',
      '평·평당가·공시지가 배율·요약 값은 수식입니다.',
    ];
    for (const n of notes) {
      const r = sm.addRow([n]);
      r.getCell(1).font = Object.assign({}, XL_FONT, { color: { argb: 'FF555B66' } });
    }
    // 필지별 시트
    const pj = wb.addWorksheet('필지별', { views: [{ state: 'frozen', ySplit: 1 }] });
    pj.columns = [{ width: 14 }, { width: 14 }, { width: 14 }, { width: 8 }, { width: 14 }, { width: 12 }, { width: 14 }];
    xlHead(pj.addRow(['읍면동', '지번', '지번 구분', '건수', '중위 평당가(만원)', '최근 거래일', '대상지 거리(m)']));
    items
      .slice()
      .sort((a, b) => a.d - b.d)
      .forEach(it => {
        const s = LC.sum.get(it.g.key),
          row = pj.addRow([it.g.umd, it.g.masked ? '(비공개)' : it.g.jibun, it.g.masked ? '비공개(동 단위)' : it.g.est ? '추정' : '공개', s.n, Math.round(s.med), xlDate(s.latest), Math.round(it.d)]);
        row.eachCell(c => {
          c.font = XL_FONT;
          c.border = xlBorder;
        });
        row.getCell(5).numFmt = '#,##0';
        row.getCell(6).numFmt = 'yyyy-mm-dd';
        row.getCell(7).numFmt = '#,##0';
      });
    const buf = await wb.xlsx.writeBuffer(),
      a = document.createElement('a'),
      lab = ((S.center && S.center.label) || '대상지').replace(/[\\/:*?"<>|]/g, '').slice(0, 24);
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `${kd.name}_실거래_${lab}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    status('엑셀을 만들지 못했어요: ' + (e.message || e), true);
  } finally {
    const b = $('#lcxl');
    if (b) {
      b.disabled = false;
      b.textContent = '엑셀 내려받기';
    }
  }
}
