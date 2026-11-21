// 화면 구성·이벤트 연결·카카오 지도 불러오기·시작
/* ---------- 초기화 ---------- */
function bind() {
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  tabs.innerHTML =
    '<button data-tab="trade" class="on">실거래 (매매·분양권·입주권)</button><button data-tab="sale">분양정보 (청약홈·분석)</button>';
  const mkAssets = cls => {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = '<button data-asset="apt" class="on">아파트</button><button data-asset="offi">오피스텔</button><button data-asset="land">토지</button><button data-asset="nrg">상가·업무</button>';
    d.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) setAsset(b.dataset.asset);
    });
    return d;
  };
  $('.sbox').before(tabs);
  tabs.before(mkAssets('assets'));
  $('#map').appendChild(mkAssets('mapassets'));
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) setTab(b.dataset.tab);
  });
  $('#band').innerHTML = BANDS.map(b => `<option value="${b.k}">${b.t}</option>`).join('');
  $('#rad').onchange = () => {
    S.rad = +$('#rad').value;
    if (circle) circle.setRadius(S.rad);
    refresh(true);
  };
  $('#mon').onchange = () => {
    S.months = +$('#mon').value;
    if (S.center) refresh(false);
  };
  $('#band').onchange = () => {
    S.band = $('#band').value;
    S.dtype = null;
    recompute();
  };
  $('#metric').onchange = () => {
    S.metric = $('#metric').value;
    recompute();
  };
  $('#sort').onchange = () => {
    S.sort = $('#sort').value;
    recompute();
  };
  {
    const yl = document.createElement('label');
    yl.id = 'ylab';
    yl.style.display = 'none';
    yl.innerHTML =
      'PPT 준공연도<select id="oyear"><option value="0">제한 없음</option><option value="3">3년 이내</option><option value="5">5년 이내</option><option value="10">10년 이내</option></select>';
    yl.style.gridColumn = '1/-1';
    yl.dataset.pending = '1';
    $('.ctrl').appendChild(yl);
    $('#oyear').onchange = () => {
      S.oyear = +$('#oyear').value;
    };
  }
  $('#go').onclick = () => doSearch(true);
  const rb = document.createElement('button');
  rb.id = 'rpt';
  rb.textContent = '이 위치의 반경 기준 시장조사 기초자료 PPT 만들기';
  rb.style.cssText = 'grid-column:1/-1;padding:7px';
  $('.ctrl').appendChild(rb);
  rb.onclick = () => (S.asset === 'offi' ? makeOffiReport(false) : makeReport(false));
  const rb2 = document.createElement('button');
  rb2.id = 'rpt2';
  rb2.textContent = '상세자료 PPT 만들기 (입지환경·인구·연령·입주예정 포함, 1~2분 더 걸려요)';
  rb2.style.cssText = 'grid-column:1/-1;padding:7px';
  $('.ctrl').appendChild(rb2);
  rb2.onclick = () => (S.asset === 'offi' ? makeOffiReport(true) : makeReport(true));
  {
    const fl = document.createElement('label');
    fl.id = 'rfl';
    fl.style.cssText = 'grid-column:1/-1';
    fl.innerHTML =
      'PPT 글꼴 <select id="rfont"><option value="ns">나눔스퀘어</option><option value="kp">KoPubWorld돋움</option><option value="mg">맑은 고딕</option></select> <small style="color:#6b7785">보는 PC에 설치된 글꼴만 적용돼요</small>';
    $('.ctrl').appendChild(fl);
    try {
      $('#rfont').value = localStorage.getItem('rfont') || 'ns';
    } catch (e) {}
    $('#rfont').onchange = () => {
      try {
        localStorage.setItem('rfont', $('#rfont').value);
      } catch (e) {}
    };
  }
  $('#q').addEventListener('input', () => {
    clearTimeout(deb);
    const q = $('#q').value.trim();
    if (q.length < 2) {
      $('#sug').style.display = 'none';
      return;
    }
    deb = setTimeout(() => doSearch(false), 300);
  });
  $('#q').addEventListener('keydown', e => {
    const n = sugItems.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sugOn = Math.min(n - 1, sugOn + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sugOn = Math.max(0, sugOn - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sugOn >= 0 && n) choose(sugOn);
      else doSearch(true);
      return;
    } else if (e.key === 'Escape') {
      $('#sug').style.display = 'none';
      return;
    } else return;
    [...$('#sug').children].forEach((d, k) => d.classList.toggle('on', k === sugOn));
  });
  $('#sug').addEventListener('mousedown', e => {
    const d = e.target.closest('[data-k]');
    if (d) {
      e.preventDefault();
      choose(+d.dataset.k);
    }
  });
  $('#q').addEventListener('blur', () =>
    setTimeout(() => {
      $('#sug').style.display = 'none';
    }, 150),
  );
  $('#list').addEventListener('click', e => {
    const d = e.target.closest('.item');
    if (!d) return;
    if (d.dataset.lid) openLC(d.dataset.lid, true);
    else if (d.dataset.oid) openOffi(d.dataset.oid, true);
    else if (d.dataset.nid) openNotice(d.dataset.nid, true);
    else if (d.dataset.sid) openSale(d.dataset.sid);
    else if (d.dataset.vid) openSilv(d.dataset.vid);
    else select(+d.dataset.id, true);
  });
}
function loadKakao() {
  return new Promise((res, rej) => {
    const url =
      cfg.SDK_URL || `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(cfg.KAKAO_JS_KEY)}&libraries=services&autoload=false`;
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => kakao.maps.load(res);
    s.onerror = () => rej(new Error('카카오 지도 스크립트를 불러오지 못했어요.'));
    document.head.appendChild(s);
  });
}
function renderKey() {
  let el = $('#keybox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'keybox';
    el.className = 'keybox';
    $('.ctrl').after(el);
  }
  if (KEY) {
    el.innerHTML = '<span>국토부 인증키 저장됨 (이 브라우저에만)</span> <button id="kchg">변경</button>';
    $('#kchg').onclick = () => {
      KEY = '';
      S.hasData = false;
      renderKey();
    };
    return;
  }
  el.innerHTML =
    '<input id="kin" type="password" autocomplete="off" placeholder="국토부 실거래가 인증키 붙여넣기"><button id="ksave" class="pri">저장</button><small>키는 이 브라우저에만 저장되고 사이트나 저장소에는 올라가지 않아요.</small>';
  $('#ksave').onclick = () => {
    const v = $('#kin').value.trim();
    if (!v) return;
    KEY = v;
    try {
      localStorage.setItem('molit_key', v);
    } catch (e) {}
    S.hasData = true;
    apiIdx = 0;
    apiLocked = false;
    bldErr = null;
    kaptErr = null;
    renderKey();
    if (S.tab === 'sale') loadSaleTab();
    if (S.center) refresh(false);
    else status('주소를 검색하면 시세가 표시돼요.');
  };
}
async function init() {
  bind();
  renderKey();
  renderVwKey();
  renderList();
  await loadCaches();
  try {
    await loadComplexes();
  } catch (e) {
    status('단지 데이터를 불러오지 못했어요: ' + e.message, true);
    return;
  }
  if (!cfg.KAKAO_JS_KEY && !cfg.SDK_URL) {
    status('카카오 JavaScript 키가 설정되지 않았어요. (저장소 Settings > Variables 에 KAKAO_JS_KEY 등록 후 다시 배포)', true);
    return;
  }
  try {
    await loadKakao();
  } catch (e) {
    status(e.message + ' 카카오 개발자 콘솔에 이 사이트 주소가 등록돼 있는지 확인하세요.', true);
    return;
  }
  map = new kakao.maps.Map($('#map'), { center: new kakao.maps.LatLng(37.5665, 126.978), level: 8 });
  map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  map.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT);
  geocoder = new kakao.maps.services.Geocoder();
  places = new kakao.maps.services.Places();
  kakao.maps.event.addListener(map, 'zoom_changed', () => renderPins());
  loadNotices();
  kakao.maps.event.addListener(map, 'click', ev => {
    const ll = ev.latLng,
      lat = ll.getLat(),
      lon = ll.getLng();
    setCenter(lat, lon, '지도에서 선택한 위치', { keepView: true });
    geocoder.coord2Address(lon, lat, (r, st) => {
      if (st === kakao.maps.services.Status.OK && r[0]) {
        const a = (r[0].address && r[0].address.address_name) || '';
        if (a && S.center && S.center.lat === lat) {
          S.center.label = a;
          renderList();
        }
      }
    });
  });
  if (!S.hasData) status('아래에 국토부 인증키를 입력하면 시세가 표시돼요.');
}
init();
