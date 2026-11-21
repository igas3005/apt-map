// 지도 핀, 목록·상세 화면, 주소 검색
/* ---------- 지도 ---------- */
function setCenter(lat, lon, label, o) {
  o = o || {};
  S.center = { lat, lon, label };
  S.sel = null;
  if (!noticeSel) $('#detail').hidden = true;
  xsel = null;
  X.silv = [];
  renderExtraPins();
  $('#maphint').style.display = 'none';
  const ll = new kakao.maps.LatLng(lat, lon);
  if (!centerMarker) centerMarker = new kakao.maps.Marker({ position: ll, map });
  else {
    centerMarker.setPosition(ll);
    centerMarker.setMap(map);
  }
  if (!circle)
    circle = new kakao.maps.Circle({
      center: ll,
      radius: S.rad,
      strokeWeight: 2,
      strokeColor: '#4655d6',
      strokeOpacity: 0.85,
      strokeStyle: 'dashed',
      fillColor: '#4655d6',
      fillOpacity: 0.06,
      map,
    });
  else {
    circle.setPosition(ll);
    circle.setRadius(S.rad);
    circle.setMap(map);
  }
  map.setCenter(ll);
  refresh(!o.keepView);
}
function renderPins() {
  S.ov.forEach(o => o.setMap(null));
  S.ov = [];
  clearLCPins();
  if (S.asset === 'offi') {
    renderOffiPins();
    return;
  }
  OF.ov.forEach(o => o.setMap(null));
  OF.ov = [];
  if (isLC()) {
    renderLCPins();
    return;
  }
  if (!map) return;
  const lvl = map.getLevel(),
    items = S.list.slice(0, 300),
    dots = lvl >= 6 && items.length > 120;
  for (const it of items) {
    const c = C[it.id],
      s = S.sum.get(it.id),
      sel = S.sel === it.id,
      el = document.createElement('div');
    if (dots) el.className = 'dot' + (s ? '' : ' none') + (sel ? ' sel' : '');
    else {
      el.className = 'pin' + (s ? '' : ' none') + (sel ? ' sel' : '');
      el.innerHTML =
        (s ? `<small>${s.py}평</small><b>${eok(s.val)}</b>` : '<small>거래없음</small><b>-</b>') +
        (lvl <= 4 || sel ? `<i class="nm">${esc(c.name)}</i>` : '');
    }
    el.title = c.name;
    el.addEventListener('click', e => {
      e.stopPropagation();
      select(it.id, false);
    });
    const ov = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(c.lat, c.lon),
      content: el,
      xAnchor: dots ? 0.5 : 0.12,
      yAnchor: dots ? 0.5 : 1,
      zIndex: sel ? 20 : 1,
      clickable: true,
    });
    ov.setMap(map);
    S.ov.push(ov);
  }
}

/* ---------- 목록 / 상세 ---------- */
function renderList() {
  const el = $('#list');
  if (S.asset === 'offi') {
    renderOffiList();
    return;
  }
  if (isLC()) {
    renderLCList();
    return;
  }
  if (S.tab === 'sale') {
    renderSaleList();
    return;
  }
  const nl = '';
  if (!S.center) {
    el.innerHTML = '<div class="empty">주소를 검색하거나 지도를 클릭하면<br>반경 안의 단지와 시세가 여기에 나와요.</div>' + nl;
    return;
  }
  const n = S.list.length;
  let h = `<div class="lh"><b>${esc(S.center.label || '선택한 위치')}</b> 반경 ${S.rad >= 1000 ? S.rad / 1000 + 'km' : S.rad + 'm'} · 단지 ${n.toLocaleString('ko-KR')}개${n > 300 ? ' (가까운 300개 표시)' : ''}</div>`;
  if (!n) h += '<div class="empty">이 반경에 등록된 단지가 없어요.<br>반경을 넓혀 보세요.</div>';
  h += S.list
    .slice(0, 300)
    .map(it => {
      const c = C[it.id],
        s = S.sum.get(it.id),
        inf = infoLine(c);
      const px = s
        ? `<div class="px"><b>${eok(s.val)}</b><small>${s.py}평 · ${s.cnt}건</small></div>`
        : S.hasData
          ? '<div class="px"><small>거래 없음</small></div>'
          : '';
      return `<div class="item${S.sel === it.id ? ' sel' : ''}" data-id="${it.id}"><div class="n"><div class="nm">${esc(c.name)}</div><div class="ad">${esc(c.umd)} ${esc(c.jibun)} · ${it.d < 1000 ? Math.round(it.d) + 'm' : (it.d / 1000).toFixed(2) + 'km'}</div>${inf ? `<div class="inf">${inf}</div>` : ''}</div>${px}</div>`;
    })
    .join('');
  if (X.silv.length)
    h +=
      `<div class="lh"><b>분양권·입주권 거래 단지</b> ${X.silv.length}곳 (입주 전)</div>` +
      X.silv
        .map(g => {
          const b = silvBest(g.trades);
          return `<div class="item" data-vid="${esc(g.key)}"><div class="n"><div class="nm">${esc(g.name)}</div><div class="ad">${esc(g.addr)} · ${Math.round(g.d)}m</div></div><div class="px"><b>${eok(b.val)}</b><small>${b.py}평 · ${b.n}건</small></div></div>`;
        })
        .join('');
  el.innerHTML = h + nl;
}
function select(id, pan) {
  if (noticeSel) {
    noticeSel = null;
    renderNoticePins();
  }
  if (xsel) {
    xsel = null;
    renderExtraPins();
  }
  S.sel = id;
  S.dtype = null;
  renderDetail();
  renderPins();
  renderList();
  if (pan) map.panTo(new kakao.maps.LatLng(C[id].lat, C[id].lon));
  const it = document.querySelector(`.item[data-id="${id}"]`);
  if (it) it.scrollIntoView({ block: 'nearest' });
}
function chart(arr) {
  const W = 360,
    H = 130,
    pl = 36,
    pb = 18,
    pt = 6,
    pr = 4,
    ms = [];
  for (let k = S.months - 1; k >= 0; k--) {
    const d = new Date(S.asOf.getFullYear(), S.asOf.getMonth() - k, 1);
    ms.push(d.getFullYear() * 100 + d.getMonth() + 1);
  }
  const vals = ms.map(m => {
    const v = arr.filter(t => Math.floor(t[0] / 100) === m).map(t => t[3]);
    return v.length ? { m, v: med(v), n: v.length } : { m, v: null, n: 0 };
  });
  const all = vals.filter(x => x.v != null).map(x => x.v);
  if (!all.length) return '';
  const mx = Math.max(...all) * 1.08,
    bw = (W - pl - pr) / ms.length,
    ih = H - pt - pb;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="월별 중위 거래가">`;
  for (let k = 0; k <= 3; k++) {
    const y = pt + ih - (ih * k) / 3;
    s += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl - 4}" y="${y + 3.5}" font-size="10" text-anchor="end" fill="var(--mute)">${((mx * k) / 3 / 10000).toFixed(mx >= 100000 ? 0 : 1)}억</text>`;
  }
  vals.forEach((o, k) => {
    const x = pl + k * bw + bw * 0.15,
      w = bw * 0.7,
      last = k >= vals.length - 2;
    if (o.v != null) {
      const h = (ih * o.v) / mx;
      s += `<rect x="${x}" y="${pt + ih - h}" width="${w}" height="${h}" rx="2" fill="var(--accent)" ${last ? 'opacity=".4"' : ''}><title>${String(o.m).slice(2, 4)}.${String(o.m).slice(4)} 중위 ${eokFull(o.v)} (${o.n}건)</title></rect>`;
    }
    if (k % (ms.length > 8 ? 2 : 1) === 0)
      s += `<text x="${x + w / 2}" y="${H - 5}" font-size="10" text-anchor="middle" fill="var(--mute)">${String(o.m).slice(2, 4)}.${String(o.m).slice(4)}</text>`;
  });
  return s + '</svg>';
}
function renderDetail() {
  const el = $('#detail'),
    c = C[S.sel];
  if (!c) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const cut = cutoff(),
    all = tradesOf(S.sel).filter(t => t[0] >= cut);
  const types = new Map();
  for (const t of all) {
    const k = Math.round(t[1]);
    types.set(k, (types.get(k) || 0) + 1);
  }
  const dom = dominant(all.filter(t => t[1] >= bandOf().a && t[1] < bandOf().b)) || dominant(all);
  if (S.dtype == null) S.dtype = dom ? dom.k : 'all';
  const arr = S.dtype === 'all' ? all : all.filter(t => Math.round(t[1]) === S.dtype);
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(c.name)}</h2><div class="ad">${esc(c.sido)} ${esc(c.gu)} ${esc(c.umd)} ${esc(c.jibun)}${infoLine(c) ? '<br>' + infoLine(c) : ''}</div>`;
  if (!S.hasData) h += '<div class="note">국토부 인증키를 입력하면 시세가 표시돼요.</div>';
  else if (!all.length)
    h += `<div class="note">최근 ${S.months}개월 거래가 없어요. 기간을 늘리거나, 실거래 신고 단지명이 달라 매칭되지 않았을 수 있어요.</div>`;
  else {
    h +=
      '<div class="chips">' +
      [...types.keys()]
        .sort((a, b) => a - b)
        .map(k => `<button data-t="${k}" class="${S.dtype === k ? 'on' : ''}">${k}㎡ (${pyeong(k)}평) ${types.get(k)}</button>`)
        .join('') +
      `<button data-t="all" class="${S.dtype === 'all' ? 'on' : ''}">전체 ${all.length}</button></div>`;
    const am = arr.map(t => t[3]);
    h += `<div class="kv"><div><small>거래 ${arr.length}건 중위</small><b>${eokFull(med(am))}</b></div><div><small>최고</small><b>${eokFull(Math.max(...am))}</b></div><div><small>최저</small><b>${eokFull(Math.min(...am))}</b></div></div>`;
    const ch = chart(arr);
    if (ch) h += `<div class="sec">월별 중위 거래가</div>${ch}`;
    h +=
      `<div class="sec">최근 거래</div><table><tr><th>계약일</th><th>전용</th><th>층</th><th>거래가</th></tr>` +
      arr
        .slice()
        .sort((a, b) => b[0] - a[0])
        .slice(0, 15)
        .map(t => `<tr><td>${ds(t[0])}</td><td>${t[1]}㎡ (${pyeong(t[1])}평)</td><td>${t[2]}</td><td><b>${eokFull(t[3])}</b></td></tr>`)
        .join('') +
      '</table>' +
      '<div class="note">연한 막대는 신고 기한(계약 후 30일) 때문에 아직 집계 중일 수 있는 최근 두 달이에요. 평형은 전용면적 기준 추정치(공급면적 ≈ 전용 × 1.32)입니다.</div>';
  }
  const sv = (SILVC.get(S.sel) || []).filter(t => t[0] >= cut);
  if (sv.length) h += `<div class="sec">분양권·입주권 실거래 (${sv.length}건)</div>` + silvTable(sv);
  el.innerHTML = h;
  $('#dx').onclick = () => {
    S.sel = null;
    el.hidden = true;
    renderPins();
    renderList();
  };
  el.querySelectorAll('.chips button').forEach(
    b =>
      (b.onclick = () => {
        S.dtype = b.dataset.t === 'all' ? 'all' : +b.dataset.t;
        renderDetail();
      }),
  );
}

/* ---------- 검색 ---------- */
let sugItems = [],
  sugOn = -1,
  deb = 0;
function search(q, cb) {
  const m = q.match(/^(-?\d{2}\.\d+)\s*[, ]\s*(-?\d{2,3}\.\d+)$/);
  if (m) return cb([{ label: `좌표 ${m[1]}, ${m[2]}`, sub: '입력한 좌표', lat: +m[1], lon: +m[2] }]);
  const out = [];
  let pending = 2;
  const OK = kakao.maps.services.Status.OK;
  const done = () => {
    if (--pending === 0) cb(out);
  };
  geocoder.addressSearch(q, (r, st) => {
    if (st === OK)
      r.slice(0, 5).forEach(x =>
        out.push({
          label: x.address_name + (x.road_address && x.road_address.address_name ? ` (${x.road_address.address_name})` : ''),
          sub: '주소',
          lat: +x.y,
          lon: +x.x,
        }),
      );
    done();
  });
  places.keywordSearch(q, (r, st) => {
    if (st === OK) r.slice(0, 5).forEach(x => out.push({ label: x.place_name, sub: x.address_name, lat: +x.y, lon: +x.x }));
    done();
  });
}
function showSug(items) {
  sugItems = items;
  sugOn = -1;
  const sg = $('#sug');
  if (!items.length) {
    sg.innerHTML = '<div style="cursor:default">검색 결과가 없어요. 주소를 더 자세히 쓰거나 지도를 클릭해 보세요.</div>';
    sg.style.display = 'block';
    return;
  }
  sg.innerHTML = items.map((s, k) => `<div data-k="${k}">${esc(s.label)}<small>${esc(s.sub)}</small></div>`).join('');
  sg.style.display = 'block';
}
function choose(k) {
  const s = sugItems[k];
  if (!s) return;
  $('#sug').style.display = 'none';
  $('#q').value = s.label;
  setCenter(s.lat, s.lon, s.label);
}
function doSearch(pick) {
  const q = $('#q').value.trim();
  if (!q) return;
  search(q, items => {
    showSug(items);
    if (pick && items.length) choose(0);
  });
}
