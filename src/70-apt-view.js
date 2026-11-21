// 아파트 모드: 반경 안 단지 목록 갱신·정렬
/* ---------- 주변 단지 ---------- */
function nearby(lat, lon, rad) {
  const dl = (rad / 111320) * 1.05,
    dn = dl / Math.cos((lat * Math.PI) / 180),
    out = [];
  for (const c of C) {
    if (Math.abs(c.lat - lat) > dl || Math.abs(c.lon - lon) > dn) continue;
    const d = hav(lat, lon, c.lat, c.lon);
    if (d <= rad) out.push({ id: c.id, d });
  }
  return out.sort((a, b) => a.d - b.d);
}
async function refresh(fit) {
  if (!S.center) return;
  if (S.asset === 'offi') return refreshOffi(fit);
  const tok = ++S.token;
  S.list = nearby(S.center.lat, S.center.lon, S.rad);
  renderList();
  if (S.hasData) {
    status('실거래 조회 중…');
    await ensureTrades(new Set(S.list.map(i => C[i.id].code)));
    if (tok !== S.token) return;
    if (S.liveErr) status(liveErrText(S.liveErr), true);
    else status('');
  } else status('아래에 국토부 인증키를 입력하면 시세가 표시돼요.');
  recompute();
  if (fit && circle) map.setBounds(circle.getBounds());
  loadBld(tok);
  loadExtras(tok);
}
function recompute() {
  if (S.asset === 'offi') return recomputeOffi();
  S.sum = new Map(S.list.map(i => [i.id, summarize(i.id)]));
  const key = i => {
    const s = S.sum.get(i.id);
    return s ? s : null;
  };
  if (S.sort === 'price') S.list.sort((a, b) => (key(b) || { val: -1 }).val - (key(a) || { val: -1 }).val);
  else if (S.sort === 'cnt') S.list.sort((a, b) => (key(b) || { n: -1 }).n - (key(a) || { n: -1 }).n);
  else S.list.sort((a, b) => a.d - b.d);
  renderList();
  renderPins();
  if (S.sel != null) renderDetail();
}
