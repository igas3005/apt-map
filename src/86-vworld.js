// 토지: 지번이 가려진 거래를 브이월드 연속지적도의 필지 면적·지목과 대조해 지번을 추정한다.
// 같은 동에서 지목이 같고 면적이 맞는 필지가 딱 하나면 그 필지로 보고 지도에 찍고(추정), 여러 개면 후보 개수만 표시한다.
let VWKEY = '';
try {
  VWKEY = localStorage.getItem('vworld_key') || '';
} catch (e) {}
let VWN = 0;
const VWERR = { msg: '' },
  VWCODE = new Map(), // 동 키 -> 법정동코드 10자리
  VWPARC = new Map(); // 법정동코드 -> 필지 목록(이번 방문 동안 메모리 보관)
const VW_JM = {
  대: '대', 전: '전', 답: '답', 과수원: '과', 임야: '임', 목장용지: '목', 광천지: '광', 염전: '염', 공장용지: '장', 학교용지: '학', 주차장: '차',
  주유소용지: '주', 창고용지: '창', 도로: '도', 철도용지: '철', 제방: '제', 하천: '천', 구거: '구', 유지: '유', 양어장: '양', 수도용지: '수',
  공원: '공', 체육용지: '체', 유원지: '원', 종교용지: '종', 사적지: '사', 묘지: '묘', 잡종지: '잡',
};
const vwJm = k => {
  k = String(k || '').trim();
  if (VW_JM[k]) return VW_JM[k];
  for (const n in VW_JM) if (k.startsWith(n)) return VW_JM[n];
  return '';
};
function renderVwKey() {
  let el = document.getElementById('vwbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vwbox';
    el.className = 'keybox';
    $('#keybox').after(el);
  }
  if (VWKEY) {
    el.innerHTML = '<span>브이월드 인증키 저장됨 (토지 지번 추정용)</span> <button id="vwchg">변경</button>';
    $('#vwchg').onclick = () => {
      VWKEY = '';
      try {
        localStorage.removeItem('vworld_key');
      } catch (e) {}
      renderVwKey();
    };
    return;
  }
  el.innerHTML =
    '<input id="vwin" type="password" autocomplete="off" placeholder="브이월드 인증키 (선택 · 토지 가려진 지번 추정용)"><button id="vwsave" class="pri">저장</button><small>키는 이 브라우저에만 저장돼요. 발급 때 등록한 도메인과 이 사이트 주소가 같아야 해요.</small>';
  $('#vwsave').onclick = () => {
    const v = $('#vwin').value.trim();
    if (!v) return;
    VWKEY = v;
    try {
      localStorage.setItem('vworld_key', v);
    } catch (e) {}
    renderVwKey();
    if (isLC() && S.center) refresh(false);
  };
}
function vwJsonp(params) {
  return new Promise((res, rej) => {
    const cb = 'vwcb' + ++VWN,
      s = document.createElement('script');
    const done = () => {
      clearTimeout(t);
      delete window[cb];
      s.remove();
    };
    const t = setTimeout(() => {
      done();
      rej({ msg: '브이월드 응답 시간 초과' });
    }, 25000);
    window[cb] = d => {
      done();
      res(d);
    };
    s.onerror = () => {
      done();
      rej({ msg: '브이월드에 접속하지 못했어요 (인증키·도메인 등록 또는 네트워크 확인)' });
    };
    s.src = 'https://api.vworld.kr/req/data?' + new URLSearchParams(Object.assign({ callback: cb }, params));
    document.head.appendChild(s);
  });
}
// 키에 등록된 도메인 표기(도메인만 / https:// / http://)가 무엇인지 몰라서, 인증키 오류면 표기를 바꿔 다시 시도한다
let VWDOM = '';
async function vwCall(params) {
  const h = location.hostname,
    doms = VWDOM ? [VWDOM] : [h, 'https://' + h, 'http://' + h];
  let d;
  for (const dom of doms) {
    d = await vwJsonp(Object.assign({ domain: dom }, params));
    const r = d && d.response;
    if (r && r.status === 'ERROR' && /인증키|도메인|key/i.test((r.error && (r.error.text || r.error.code)) || '')) continue;
    VWDOM = dom;
    return d;
  }
  return d;
}
// 폴리곤 면적(㎡) — 필지 하나는 작아서 위도 기준 평면 근사로 충분
function vwArea(geom) {
  const rings = geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0]) : geom.type === 'Polygon' ? [geom.coordinates[0]] : [];
  let sum = 0;
  for (const r of rings) {
    const la = r[0][1],
      kx = 111320 * Math.cos((la * Math.PI) / 180),
      ky = 110574;
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * kx * (r[i + 1][1] * ky) - r[i + 1][0] * kx * (r[i][1] * ky);
    sum += Math.abs(a) / 2;
  }
  return sum;
}
const vwCenter = geom => {
  const r = (geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : geom.coordinates[0]) || [];
  let x = 0,
    y = 0;
  for (const p of r) {
    x += p[0];
    y += p[1];
  }
  return r.length ? [y / r.length, x / r.length] : null;
};
// 한 법정동의 필지 전부: [지번, 지목글자, 면적㎡, 위도, 경도]
async function vwParcels(code10) {
  if (VWPARC.has(code10)) return VWPARC.get(code10);
  const rows = await cachedMonth('vw', code10, '200001', async () => {
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const d = await vwCall({
        service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN', key: VWKEY,
        attrFilter: 'pnu:like:' + code10, size: 1000, page, format: 'json', geometry: 'true', crs: 'EPSG:4326',
      });
      const r = d && d.response;
      if (!r) throw { msg: '브이월드 응답을 읽지 못했어요' };
      if (r.status === 'NOT_FOUND') break;
      if (r.status !== 'OK') throw { msg: '브이월드 오류: ' + ((r.error && (r.error.text || r.error.code)) || r.status) + ` [키 ${VWKEY.length}자, 전송 도메인 ${location.hostname}]` };
      const fs = (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
      for (const f of fs) {
        const pr = f.properties || {},
          pnu = String(pr.pnu || ''),
          g = f.geometry;
        if (pnu.length < 19 || !g) continue;
        const bun = +pnu.slice(11, 15),
          bu = +pnu.slice(15, 19),
          jb = (pnu[10] === '2' ? '산' : '') + bun + (bu ? '-' + bu : ''),
          jm = String(pr.jibun || '').trim().slice(-1),
          c = vwCenter(g),
          ar = vwArea(g);
        if (c && ar > 0) out.push([jb, jm, Math.round(ar * 10) / 10, +c[0].toFixed(6), +c[1].toFixed(6)]);
      }
      const tot = +((r.page && r.page.total) || 1);
      if (page >= tot) return out;
      if (page === 30) throw { msg: '이 동은 필지가 너무 많아(3만 필지 초과) 지번 추정을 건너뛰었어요' };
    }
    return out;
  });
  VWPARC.set(code10, rows);
  return rows;
}
function vwDongCode(g) {
  const k = g.code + '|' + g.umd;
  if (VWCODE.has(k)) return Promise.resolve(VWCODE.get(k));
  const p = LCDONG.get(k);
  if (!p) return Promise.resolve('');
  return new Promise(res =>
    geocoder.coord2RegionCode(p[1], p[0], (r, st) => {
      const b = st === kakao.maps.services.Status.OK && (r || []).find(x => x.region_type === 'B');
      const c = b ? b.code : '';
      VWCODE.set(k, c);
      res(c);
    }),
  );
}
// 가려진 지번 패턴(예: 1**)을 정규식으로: '*'은 숫자 한 자리, 부번 유무는 모르므로 허용
function vwMaskRe(m) {
  const s = String(m || '').replace(/\s+/g, '').replace(/^산/, '');
  if (!s || !/\*/.test(s)) return null;
  const e = s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '\\d');
  return new RegExp('^산?' + e + (s.includes('-') ? '' : '(-\\d+)?') + '$');
}
// near: 반경 근처 필지 묶음들. 가려진 묶음의 거래를 필지로 옮기고 새 필지 묶음을 near에 더한다.
async function vwEstimate(kind, near, tok) {
  VWERR.msg = '';
  const st = { est: 0, cand: 0, none: 0 };
  LC.vw = st;
  if (!VWKEY || kind !== 'land') return;
  const ms = near.filter(g => g.masked && g.trades.some(t => !t.vw && !t.share && vwJm(t.kind)));
  let n = 0;
  await pool(ms, 2, async g => {
    if (tok !== S.token || VWERR.msg) return;
    try {
      const code = await vwDongCode(g);
      if (!code) return;
      const parcels = await vwParcels(code);
      const jm = new Map();
      for (const p of parcels) (jm.get(p[1]) || jm.set(p[1], []).get(p[1])).push(p);
      for (const t of g.trades.slice()) {
        if (t.vw || t.share) continue;
        const c = jm.get(vwJm(t.kind));
        if (!c) continue;
        t.vw = true;
        const re = vwMaskRe(t.jibun),
          tol = Math.max(t.area * 0.03, 2);
        let hit = c.filter(p => Math.abs(p[2] - t.area) <= tol && (!re || re.test(p[0])));
        if (!hit.length && re) hit = c.filter(p => Math.abs(p[2] - t.area) <= tol);
        if (hit.length === 1) {
          const p = hit[0],
            key = g.code + '|' + g.umd + '|' + p[0];
          let pg = LCD.land.get(key);
          if (!pg) LCD.land.set(key, (pg = { key, code: g.code, umd: g.umd, sgg: g.sgg, jibun: p[0], masked: false, est: true, trades: [], pe: [p[3], p[4]], p: undefined }));
          g.trades.splice(g.trades.indexOf(t), 1);
          t.mj = t.jibun;
          t.jibun = p[0];
          t.est = true;
          pg.trades.push(t);
          if (!near.includes(pg)) near.push(pg);
          st.est++;
        } else if (hit.length > 1) {
          t.cand = hit.length;
          t.candTxt = hit.slice(0, 6).map(p => p[0]).join(', ') + (hit.length > 6 ? ' …' : '');
          st.cand++;
        } else st.none++;
      }
    } catch (e) {
      VWERR.msg = e.msg || '브이월드 조회 실패';
    }
    status(`필지 면적 대조 중… ${++n}/${ms.length}${ms.length > 3 ? ' (처음 한 번만 오래 걸려요)' : ''}`);
  });
}
