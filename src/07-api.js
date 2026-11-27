// 공공데이터 조회 공통: 인증키, 한 쪽 요청·오류 판정, 실거래 한 달치 읽기, 월별 조회 작업 묶음, 동시 처리
// 아파트·분양권·오피스텔·토지·상가가 모두 이 함수들을 쓴다. 요청·오류·해제 거래 처리를 고칠 때는 여기 한 곳만 고친다.

// 공공데이터포털 인증키: 인코딩 키를 넣었으면 풀어서 보낸다 (URLSearchParams가 다시 인코딩)
function apiKey() {
  try {
    return decodeURIComponent(KEY);
  } catch (e) {
    return KEY;
  }
}
// 한 쪽 요청 → { total, items: [{항목: 값}] } (JSON·XML 모두). 오류는 { kind: 'net' | 'key' | 'api', msg }
// 국토부·게이트웨이가 잠깐 실패한 경우(게이트웨이 01·04·05·23, HTTP 429·5xx)는 0.8초·2초·4초 쉬고 최대 3번 다시 요청한다.
const API_RETRY_WAIT = [800, 2000, 4000];
async function apiPageOnce(url, params, keyName) {
  let r;
  try {
    r = await fetch(url + '?' + new URLSearchParams(Object.assign({ [keyName]: apiKey() }, params)));
  } catch (e) {
    throw { kind: 'net' };
  }
  const text = await r.text().catch(() => '');
  // 게이트웨이 오류 본문(OpenAPI_ServiceResponse)이 있으면 HTTP 상태보다 그 코드를 먼저 본다
  if (/OpenAPI_ServiceResponse|returnReasonCode/.test(text)) return parseAny(text);
  if (r.status === 401 || r.status === 403) throw { kind: 'key', msg: 'HTTP ' + r.status };
  if (!r.ok) throw { kind: 'api', msg: 'HTTP ' + r.status, retry: r.status === 429 || r.status >= 500 };
  return parseAny(text);
}
async function apiPage(url, params, keyName = 'serviceKey') {
  for (let i = 0; ; i++) {
    try {
      return await apiPageOnce(url, params, keyName);
    } catch (e) {
      if (!e || !e.retry || i >= API_RETRY_WAIT.length) throw e;
      await sleep(API_RETRY_WAIT[i]);
    }
  }
}

// 실거래 한 달치: 쪽을 끝까지 넘기며 해제 거래를 빼고, 항목마다 toRow(항목)를 불러 나온 행만 모은다(빈 값이면 버림).
// 한 쪽에 거래가 있는데 하나도 못 읽었으면 응답 항목 이름이 바뀐 것이라 이름을 그대로 보여 준다.
// 시군구 한 달 거래가 RT_MAX_PAGES×1,000건을 넘으면(사실상 없음) 일부만 쓰지 않고 오류로 알린다.
const RT_MAX_PAGES = 20;
const dealCanceled = o => String(o.cdealType || '').trim().toUpperCase() === 'O' || !!String(o.cdealDay || '').trim();
const dealAmt = o => parseInt(String(o.dealAmount || '').replace(/,/g, ''), 10);
const dealArea = o => Math.round(parseFloat(o.excluUseAr) * 100) / 100;
const dealYmd = o => +o.dealYear * 10000 + +o.dealMonth * 100 + +o.dealDay;
// 기관 서버가 한 번에 1,000건 응답을 못 만들고 04 "HTTP 에러"를 내는 경우가 있어(토지·상가 서버), 다시 해도 실패하면
// 그 API는 이후 한 쪽 200건으로 줄여 처음부터 다시 받는다 (RT_ROWS에 API별로 기억).
const RT_ROWS = new Map();
async function rtMonth(url, f, ym, toRow) {
  try {
    return await rtMonthRows(url, f, ym, toRow, RT_ROWS.get(url) || 1000);
  } catch (e) {
    if (!e || e.kind !== 'api' || !e.retry || (RT_ROWS.get(url) || 1000) <= 200) throw e;
    RT_ROWS.set(url, 200);
    return rtMonthRows(url, f, ym, toRow, 200);
  }
}
async function rtMonthRows(url, f, ym, toRow, per) {
  const rows = [];
  const maxPages = RT_MAX_PAGES * Math.ceil(1000 / per);
  for (let page = 1; ; page++) {
    const out = await apiPage(url, { LAWD_CD: f, DEAL_YMD: ym, pageNo: page, numOfRows: per });
    let used = 0,
      canceled = 0;
    for (const o of out.items) {
      if (dealCanceled(o)) {
        canceled++;
        continue;
      }
      const row = toRow(o);
      if (row) {
        rows.push(row);
        used++;
      }
    }
    if (out.items.length && !used && !canceled) throw { kind: 'api', msg: '응답 항목 이름이 예상과 달라요: ' + Object.keys(out.items[0]).join(', ') };
    if (page * per >= out.total || !out.items.length) break;
    if (page >= maxPages) throw { kind: 'api', msg: `${f} ${ym} 거래가 ${RT_MAX_PAGES * 1000}건을 넘어 다 받지 못했어요` };
  }
  return rows;
}

// arr를 n개씩 동시에 처리
async function pool(arr, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < arr.length) {
        const x = arr[i++];
        await fn(x);
      }
    }),
  );
}
// 한 달치 반영을 한 번만: 다 받은 달(done)은 건너뛰고, 받는 중인 달(pend)은 그 조회를 같이 기다린다.
// (검색 중에 PPT를 누르거나 위치를 바꿔 조회가 겹쳐도 같은 달 거래가 두 번 쌓이지 않게)
function monthOnce(done, pend, key, run) {
  if (done.has(key)) return Promise.resolve();
  if (!pend.has(key))
    pend.set(
      key,
      run()
        .then(() => {
          done.add(key);
        })
        .finally(() => pend.delete(key)),
    );
  return pend.get(key);
}
// 시군구(개편 전 옛 코드 포함) × 최근 months개월 조회를 3건씩 동시에. 첫 오류에서 남은 달은 건너뛰고 그 오류를 돌려준다.
// prefix: 같은 done/pend를 여러 종류가 나눠 쓸 때 키 앞에 붙이는 글자 (토지·상가)
async function ensureMonths({ codes, months, done, pend, run, progress, prefix = '' }) {
  const jobs = [],
    seen = new Set();
  for (const c of codes)
    for (const f of [c].concat(LEGACY[c] || []))
      for (const ym of monthList(months)) {
        const k = prefix + f + '|' + ym;
        if (!done.has(k) && !seen.has(k)) {
          seen.add(k);
          jobs.push([f, ym, k]);
        }
      }
  let err = null,
    n = 0;
  await pool(jobs, 3, async ([f, ym, k]) => {
    if (err) return;
    try {
      await monthOnce(done, pend, k, () => run(f, ym));
    } catch (e) {
      err = e;
    }
    n++;
    if (!err && progress) progress(n, jobs.length);
  });
  return err;
}

// 키는 정상인데 국토부 서버가 실패했거나(e.retry) 오늘 호출 한도를 넘은(quota) 경우의 안내 문구
function rtBusyText(name, e) {
  if (e.kind === 'quota') return `오늘 ${name} 실거래 API 호출 한도를 넘었어요 (${e.msg || ''}). 내일 다시 검색하거나 조회 기간을 줄여 보세요.`;
  return `국토부 ${name} 실거래 서버가 응답을 못 했어요 (${e.msg || ''}). 인증키·활용신청은 정상이에요. 여러 번 다시 시도했지만 실패해서, 잠시 뒤 다시 검색해 보세요.`;
}
