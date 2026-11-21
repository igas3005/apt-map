// 상가·업무 일반(통건물): 가려진 지번을 건축물대장(표제부)의 대지면적·연면적·사용승인연도와 대조해 추정한다.
// 같은 동에서 대지면적과 연면적이 모두 맞는 필지가 하나뿐이면 그 필지로 보고(추정), 여러 개면 후보 개수만 표시한다.
// 건축물대장은 동 전체를 지번 없이도 받을 수 있고(한 쪽 100건), 일반건축물만 쓴다.
const BR_PAGES = 60; // 한 동 최대 6,000건 — 넘으면 그 동은 건너뜀
async function brRows(code10) {
  return cachedMonth('brt', code10, '200001', async () => {
    let key = KEY;
    try {
      key = decodeURIComponent(KEY);
    } catch (e) {}
    const out = [];
    for (let page = 1; page <= BR_PAGES; page++) {
      let r;
      try {
        r = await fetch(BLD_API + '?' + new URLSearchParams({ serviceKey: key, sigunguCd: code10.slice(0, 5), bjdongCd: code10.slice(5), numOfRows: 100, pageNo: page, _type: 'json' }));
      } catch (e) {
        throw { msg: '건축물대장 조회에 접속하지 못했어요' };
      }
      if (r.status === 401 || r.status === 403) throw { msg: '건축물대장 조회 권한 오류 (HTTP ' + r.status + ')' };
      if (!r.ok) throw { msg: '건축물대장 조회 오류 (HTTP ' + r.status + ')' };
      let d;
      try {
        d = parseAny(await r.text());
      } catch (e) {
        throw { msg: '건축물대장 조회 오류: ' + (e.msg || '응답을 읽지 못했어요') };
      }
      for (const o of d.items) {
        if (o.regstrKindCdNm && !/일반/.test(o.regstrKindCdNm)) continue;
        const bun = parseInt(o.bun, 10) || 0,
          ji = parseInt(o.ji, 10) || 0,
          tot = num(o.totArea),
          plat = num(o.platArea);
        if (!bun || !tot || !plat) continue;
        out.push([(o.platGbCd === '1' ? '산' : '') + bun + (ji ? '-' + ji : ''), o.mainPurpsCdNm || '', tot, plat, parseInt(String(o.useAprDay || '').slice(0, 4), 10) || 0]);
      }
      if (page * 100 >= d.total || !d.items.length) return out;
      if (page === BR_PAGES) throw { msg: '이 동은 건물이 너무 많아(6천 건 초과) 통건물 위치 추정을 건너뛰었어요' };
    }
    return out;
  });
}
async function nrgEstimate(kind, near, tok) {
  if (kind !== 'nrg' || !KEY) return;
  VWERR.msg = '';
  const st = { est: 0, cand: 0, none: 0 };
  LC.vw = st;
  const ok = t => !t.bm && !t.share && t.btype.includes('일반') && t.pArea > 0 && t.bArea > 0;
  const ms = near.filter(g => g.masked && g.trades.some(ok));
  let n = 0;
  await pool(ms, 2, async g => {
    if (tok !== S.token || VWERR.msg) return;
    try {
      const code = await vwDongCode(g);
      if (!code) return;
      const rows = await brRows(code),
        par = new Map(); // 필지 -> { jb, plat, tot(합), b: [[연면적, 연도, 용도]] }
      for (const r of rows) {
        let p = par.get(r[0]);
        if (!p) par.set(r[0], (p = { jb: r[0], plat: r[3], tot: 0, b: [] }));
        p.tot += r[2];
        p.b.push([r[2], r[4], r[1]]);
      }
      const all = [...par.values()];
      for (const t of g.trades.slice()) {
        if (!ok(t)) continue;
        t.bm = true;
        const pt = Math.max(0.5, t.pArea * 0.005),
          bt = Math.max(0.5, t.bArea * 0.005),
          re = vwMaskRe(t.jibun);
        let hit = all.filter(p => Math.abs(p.plat - t.pArea) <= pt && (Math.abs(p.tot - t.bArea) <= bt || p.b.some(x => Math.abs(x[0] - t.bArea) <= bt)));
        if (!hit.length) {
          st.none++;
          continue;
        }
        if (re && hit.some(p => re.test(p.jb))) hit = hit.filter(p => re.test(p.jb));
        if (hit.length > 1 && t.by) {
          const y = hit.filter(p => p.b.some(x => x[1] && Math.abs(x[1] - t.by) <= 1));
          if (y.length) hit = y;
        }
        if (hit.length > 1) {
          const u = hit.filter(p => p.b.some(x => x[2] && t.kind && (x[2].startsWith(t.kind) || t.kind.startsWith(x[2].replace(/시설$/, '')))));
          if (u.length) hit = u;
        }
        if (hit.length === 1) {
          const jb = hit[0].jb,
            key = g.code + '|' + g.umd + '|' + jb;
          let pg = LCD.nrg.get(key);
          if (!pg) LCD.nrg.set(key, (pg = { key, code: g.code, umd: g.umd, sgg: g.sgg, jibun: jb, masked: false, est: true, trades: [], pe: undefined, p: undefined }));
          g.trades.splice(g.trades.indexOf(t), 1);
          t.mj = t.jibun;
          t.jibun = jb;
          t.est = true;
          pg.trades.push(t);
          if (!near.includes(pg)) near.push(pg);
          st.est++;
        } else {
          t.cand = hit.length;
          t.candTxt = hit.slice(0, 6).map(p => p.jb).join(', ') + (hit.length > 6 ? ' …' : '');
          st.cand++;
        }
      }
    } catch (e) {
      VWERR.msg = e.msg || '건축물대장 조회 실패';
    }
    status(`건축물대장 면적 대조 중… ${++n}/${ms.length}${ms.length > 3 ? ' (처음 한 번만 오래 걸려요)' : ''}`);
  });
}
