// 모집공고 분석 요약 (data/notices) 지도 표시·상세
/* ---------- 분양 분석 (모집공고 요약) ---------- */
// data/notices/index.json 에 올라온 단지를 지도에 표시하고, 누르면 요약과 PPT 내려받기를 보여 준다.
let NOTICES = [],
  NOV = [],
  noticeSel = null;
const NJSON = new Map();
async function loadNotices() {
  try {
    NOTICES = await getJSON('data/notices/index.json');
  } catch (e) {
    NOTICES = [];
  }
  await Promise.all(
    NOTICES.map(
      n =>
        new Promise(res => {
          if (n.lat && n.lon) return res();
          geocoder.addressSearch(n.addr, (r, st) => {
            if (st === kakao.maps.services.Status.OK && r[0]) {
              n.lat = +r[0].y;
              n.lon = +r[0].x;
            }
            res();
          });
        }),
    ),
  );
  renderNoticePins();
  renderList();
  renderSaleList();
}
function renderNoticePins() {
  NOV.forEach(o => o.setMap(null));
  NOV = [];
  if (S.asset === 'offi') return;
  for (const n of NOTICES) {
    if (!n.lat) continue;
    const el = document.createElement('div');
    el.className = 'pin npin' + (noticeSel === n.id ? ' sel' : '');
    el.innerHTML = `<small>분양 분석</small><b>${esc(n.name)}</b>`;
    el.title = n.name + ' 모집공고 요약';
    el.addEventListener('click', e => {
      e.stopPropagation();
      openNotice(n.id, false);
    });
    const ov = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(n.lat, n.lon),
      content: el,
      xAnchor: 0.12,
      yAnchor: 1,
      zIndex: 30,
      clickable: true,
    });
    ov.setMap(map);
    NOV.push(ov);
  }
}
async function openNotice(id, pan) {
  const n = NOTICES.find(x => x.id === id);
  if (!n) return;
  noticeSel = id;
  S.sel = null;
  xsel = null;
  renderPins();
  renderNoticePins();
  renderExtraPins();
  if (pan && n.lat) {
    map.setLevel(5);
    map.panTo(new kakao.maps.LatLng(n.lat, n.lon));
  }
  const el = $('#detail');
  el.hidden = false;
  el.innerHTML = '<div class="note">요약 불러오는 중…</div>';
  el.scrollIntoView({ block: 'nearest' });
  let d = NJSON.get(id);
  if (!d) {
    try {
      d = await getJSON(n.json);
      NJSON.set(id, d);
    } catch (e) {
      el.innerHTML = '<div class="note">요약을 불러오지 못했어요.</div>';
      return;
    }
  }
  if (noticeSel !== id) return;
  const num = v => Number(v).toLocaleString('ko-KR'),
    kv = rows => '<table class="kvt">' + rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('') + '</table>';
  let h = `<button class="x" id="dx">닫기</button><h2>${esc(d.name)}</h2><div class="ad">${esc(d.addr)} · 모집공고 ${esc(d.noticeDate)} · ${num(d.units)}세대 · 입주 ${esc(d.moveIn)}</div>`;
  h += `<a class="dl" href="${esc(d.file)}" download="${esc(d.name)} 모집공고 분석.pptx">분석 PPT 내려받기</a>`;
  h += `<div class="kv"><div><small>평균 평당가(확장 전)</small><b>${num(d.all.avgPy)}천원</b></div><div><small>확장 포함</small><b>${num(d.all.avgExtPy)}천원</b></div><div><small>평균 분양가</small><b>${eokFull(d.all.avg / 10)}</b></div></div>`;
  h +=
    '<div class="sec">타입별 분양가 (천원, 세대수 가중평균)</div><table><tr><th>타입</th><th>세대</th><th>평균 분양가</th><th>평당가</th><th>확장비</th><th>확장 포함 평당</th></tr>' +
    d.price
      .map(
        p =>
          `<tr><td>${esc(p.type)}<br><small style="color:var(--mute)">${p.py}평</small></td><td>${num(p.units)}</td><td>${num(p.avg)}</td><td>${num(p.avgPy)}</td><td>${num(p.ext)}</td><td><b>${num(p.avgExtPy)}</b></td></tr>`,
      )
      .join('') +
    '</table>';
  h +=
    '<details><summary>층별 분양가 보기</summary><table><tr><th>타입·층</th><th>세대</th><th>분양가</th><th>평당가</th><th>확장 포함</th></tr>' +
    d.price
      .map(p =>
        p.floors
          .map(
            f =>
              `<tr><td>${esc(p.type)} ${esc(f.f)}</td><td>${num(f.n)}</td><td>${num(f.amt)}</td><td>${num(f.py)}</td><td>${num(f.amtExt)}</td></tr>`,
          )
          .join(''),
      )
      .join('') +
    '</table></details>';
  h += '<div class="sec">납부 조건</div>' + kv(d.pay.map(r => [r[0] + ' ' + r[1], r[2]]));
  h +=
    '<div class="sec">공급 세대</div><table><tr><th>타입</th><th>전용㎡</th><th>총</th><th>특별</th><th>일반</th></tr>' +
    d.supply
      .map(
        x =>
          `<tr><td>${esc(x.type)}</td><td>${x.ex.toFixed(2)}</td><td>${num(x.total)}</td><td>${num(x.special)}</td><td>${num(x.general)}</td></tr>`,
      )
      .join('') +
    '</table>';
  h += '<div class="sec">유상 옵션 (천원)</div>' + kv(d.options.map(r => [r[0] + ' · ' + r[1], r[2]]));
  h += '<div class="sec">사업개요</div>' + kv(d.overview) + '<div class="sec">청약·규제 조건</div>' + kv(d.rules);
  h += `<div class="sec">청약 일정</div><div class="note" style="white-space:pre-line">${esc(d.sched)}</div>`;
  h += '<div class="sec">확인 필요 사항</div><div class="note">' + d.todo.map(t => '· ' + esc(t)).join('<br>') + '</div>';
  h += `<div class="note">${esc(d.made)} · 입주자모집공고문에서 발췌·계산한 내용이며 [p.N]은 공고문 쪽수입니다. 참고용입니다.</div>`;
  h += '<div id="sx"></div>';
  el.innerHTML = h;
  $('#dx').onclick = () => {
    noticeSel = null;
    el.hidden = true;
    renderNoticePins();
  };
  if (KEY) {
    const ex = await saleExtra(id);
    const sx = document.getElementById('sx');
    if (sx && noticeSel === id) sx.innerHTML = ex;
  }
}
