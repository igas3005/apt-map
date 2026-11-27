// 브라우저 저장소(IndexedDB): 건축물대장·좌표·월별 실거래 저장본
/* ---------- 브라우저 저장소 (IndexedDB) ---------- */
// 건축물대장·좌표·지난달까지의 실거래를 이 브라우저에 저장해 다시 조회하지 않는다.
// 예전에는 localStorage를 썼는데 약 5MB에서 저장이 조용히 멈춰 IndexedDB로 옮겼다(처음 열 때 자동 이전).
// IndexedDB를 쓸 수 없는 환경이면 저장 없이 매번 조회한다.
const DAY = 86400000;
const IDB = (() => {
  let dbp = null;
  const open = () =>
    dbp ||
    (dbp = new Promise(res => {
      try {
        const rq = indexedDB.open('apt-map', 1);
        rq.onupgradeneeded = () => {
          const db = rq.result;
          for (const st of ['bld', 'geo', 'month', 'mtime']) if (!db.objectStoreNames.contains(st)) db.createObjectStore(st);
        };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
        rq.onblocked = () => res(null);
      } catch (e) {
        res(null);
      }
    }));
  const req = r =>
    new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const write = async (store, fn) => {
    const db = await open();
    if (!db) return;
    try {
      const tx = db.transaction(store, 'readwrite');
      fn(tx.objectStore(store));
      await new Promise(r => {
        tx.oncomplete = tx.onerror = tx.onabort = r;
      });
    } catch (e) {
      /* 저장 실패는 조회 결과에 영향이 없으므로 넘어간다 */
    }
  };
  return {
    ok: async () => !!(await open()),
    async get(store, key) {
      const db = await open();
      if (!db) return undefined;
      try {
        return await req(db.transaction(store).objectStore(store).get(key));
      } catch (e) {
        return undefined;
      }
    },
    async entries(store) {
      const db = await open();
      if (!db) return [];
      try {
        const os = db.transaction(store).objectStore(store),
          [ks, vs] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
        return ks.map((k, i) => [k, vs[i]]);
      } catch (e) {
        return [];
      }
    },
    putMany: (store, pairs) =>
      pairs.length
        ? write(store, os => {
            for (const [k, v] of pairs) os.put(v, k);
          })
        : Promise.resolve(),
    delMany: (store, keys) =>
      keys.length
        ? write(store, os => {
            for (const k of keys) os.delete(k);
          })
        : Promise.resolve(),
  };
})();
// 키-값 캐시: 화면 코드는 메모리 객체(obj)를 그대로 읽고, 값을 넣을 때만 put()을 부른다. 바뀐 값만 모아서 저장한다.
// ttl(값) 지난 항목과 max개를 넘는 오래된 항목은 시작할 때 지운다.
function kvCache(store, obj, ttl, max) {
  const dirty = new Map();
  let timer = 0;
  return {
    put(k, v) {
      obj[k] = v;
      dirty.set(k, { v, t: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => {
        const p = [...dirty];
        dirty.clear();
        IDB.putMany(store, p);
      }, 800);
    },
    async load(legacyKey, keep) {
      const now = Date.now(),
        drop = [];
      const live = (await IDB.entries(store))
        .filter(([k, r]) => {
          const ok = r && now - r.t < ttl(r.v);
          if (!ok) drop.push(k);
          return ok;
        })
        .sort((a, b) => b[1].t - a[1].t);
      live.slice(max).forEach(([k]) => drop.push(k));
      for (const [k, r] of live.slice(0, max)) obj[k] = r.v;
      IDB.delMany(store, drop);
      let old = null;
      try {
        old = JSON.parse(localStorage.getItem(legacyKey) || 'null');
      } catch (e) {
        old = null;
      }
      if (!old || typeof old !== 'object') return;
      const pairs = Object.keys(old)
        .filter(k => !(k in obj) && (!keep || keep(k)))
        .map(k => {
          obj[k] = old[k];
          return [k, { v: old[k], t: now }];
        });
      if (await IDB.ok()) {
        await IDB.putMany(store, pairs);
        try {
          localStorage.removeItem(legacyKey);
        } catch (e) {
          /* 지우지 못해도 다음에 다시 시도 */
        }
      }
    },
  };
}
// 실거래 월별 원자료: 신고 기한(계약 후 30일)과 해제 신고 때문에 이번 달·지난달은 매번 새로 받고, 그 이전 달은 저장본을 쓴다.
// 저장본은 2~3개월 전 자료면 7일, 그보다 오래된 자료면 30일이 지나면 다시 받는다.
const MONTH_MAX = 4000,
  MONTH_VER = 'v1'; // 저장 형식을 바꾸면 MONTH_VER를 올려 예전 저장본을 쓰지 않게 한다
function monthAge(ym) {
  const now = new Date();
  return (now.getFullYear() - +ym.slice(0, 4)) * 12 + (now.getMonth() + 1 - +ym.slice(4, 6));
}
// 이번 달·지난달도 저장해 두되 평소엔 쓰지 않고, 국토부 서버가 실패했을 때(밤늦게 자주 생김)만 비상용으로 쓴다.
// 만료된 저장본도 서버 실패 시에는 쓴다. 쓴 횟수와 가장 오래된 저장 시각은 RT_STALE에 모아 상태줄에 알린다.
const staleOk = e => e && (e.kind === 'net' || e.kind === 'quota' || e.retry);
async function cachedMonth(kind, f, ym, fetcher) {
  const age = monthAge(ym),
    key = MONTH_VER + '|' + kind + '|' + f + '|' + ym;
  const hit = await IDB.get('month', key);
  if (age >= 2 && hit && Date.now() - hit.t < (age <= 3 ? 7 : 30) * DAY) return hit.rows;
  let rows;
  try {
    rows = await fetcher();
  } catch (e) {
    if (hit && staleOk(e)) {
      RT_STALE.n++;
      if (!RT_STALE.t || hit.t < RT_STALE.t) RT_STALE.t = hit.t;
      return hit.rows;
    }
    throw e;
  }
  const t = Date.now();
  IDB.putMany('month', [[key, { t, rows }]]);
  IDB.putMany('mtime', [[key, t]]);
  return rows;
}
async function pruneMonths() {
  // 30일 지난 월 자료와 MONTH_MAX를 넘는 오래된 자료를 지운다 (시간표 'mtime'만 읽으므로 가볍다)
  const now = Date.now(),
    all = (await IDB.entries('mtime')).sort((a, b) => b[1] - a[1]);
  const drop = all.filter(([, t], i) => i >= MONTH_MAX || now - t >= 30 * DAY).map(([k]) => k);
  await Promise.all([IDB.delMany('month', drop), IDB.delMany('mtime', drop)]);
}
async function loadCaches() {
  // 시작할 때 한 번: 저장본 불러오기 + 예전 localStorage 캐시 이전·정리
  let ofix = true;
  try {
    ofix = !!localStorage.getItem('bld_ofix1');
  } catch (e) {
    ofix = true;
  }
  await Promise.all([BLDC.load('bld_v4', k => ofix || k.slice(0, 2) !== 'o|'), GEOC.load('geo_v1'), pruneMonths()]);
  try {
    if (!localStorage.getItem('bld_v4')) localStorage.removeItem('bld_ofix1');
  } catch (e) {
    /* 무시 */
  }
}
