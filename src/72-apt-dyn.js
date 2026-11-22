// 아파트 모드를 광역시로: 정적 단지 목록(수도권)에 없는 시군구는 최근 1년 실거래에서 단지를 모아
// '시도 시군구 동 지번'을 좌표로 바꿔 단지 목록에 더한다. 월별 실거래·좌표는 이미 저장하는 것을 재사용한다.
async function ensureDynComplexes(codes, tok) {
  const todo = [...codes].filter(c => !STATIC.has(c) && !DYN.has(c) && OSIDO[c.slice(0, 2)]);
  if (!todo.length) return false;
  for (const code of todo) {
    if (tok !== S.token) return false;
    const label = OREGN.get(code) || code,
      uniq = new Map();
    let err = null,
      k = 0;
    const jobs = [];
    for (const f of [code].concat(LEGACY[code] || [])) for (const ym of monthList(12)) jobs.push([f, ym]);
    await pool(jobs, 3, async ([f, ym]) => {
      if (err) return;
      try {
        for (const r of await cachedMonth('apt', f, ym, () => aptRows(f, ym))) {
          const key = f + '|' + r[0] + '|' + r[1] + '|' + r[2];
          if (r[1] && r[2] && !uniq.has(key)) uniq.set(key, { f, umd: r[0], jibun: r[1], name: r[2], by: r[7] });
        }
      } catch (e) {
        err = e;
      }
      status(`${label} 단지 목록을 만드는 중… 실거래 ${++k}/${jobs.length}개월 (처음 한 번만 오래 걸려요)`);
    });
    if (err) {
      S.liveErr = err;
      return false;
    }
    const list = [...uniq.values()],
      base = OREGN.get(code) || '';
    let n = 0;
    await pool(list, 4, async u => {
      if (tok !== S.token) return;
      u.p = await geocodeAddr((base + ' ' + u.umd + ' ' + u.jibun).replace(/\s+/g, ' ').trim());
      if (list.length > 20) status(`${label} 단지 위치 확인 중… ${++n}/${list.length} (처음 한 번만 오래 걸려요)`);
    });
    if (tok !== S.token) return false;
    const gu = base.split(' ').slice(1).join(' ');
    for (const u of list) {
      if (!u.p) continue;
      const c = { id: C.length, sido: OSIDO[code.slice(0, 2)] || '', gu, umd: u.umd, code: u.f, name: u.name, jibun: u.jibun, lat: u.p[0], lon: u.p[1], dyn: true };
      C.push(c);
      addIndex(c);
      if (u.by) BY.set(c.id, u.by);
    }
    DYN.add(code);
  }
  return true;
}
