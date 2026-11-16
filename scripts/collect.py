#!/usr/bin/env python3
"""국토교통부 아파트 매매 실거래가 -> 단지별 JSON (사이트용)

환경변수
  DATA_GO_KR_KEY  공공데이터포털 인증키 (필수. 인코딩/디코딩 키 모두 가능)
  MONTHS          수집할 최근 개월 수 (기본 12, 현재 달 포함)
  WORKERS         동시 요청 수 (기본 4)

결과
  site/data/trades/<시군구코드>.json  {"c": {"<단지id>": [[yyyymmdd, 전용㎡, 층, 만원], ...]}}
  site/data/meta.json                 수집 기준일·건수·매칭 현황
"""
import collections
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DATA = SITE / "data"
# 활용신청한 서비스에 따라 둘 중 되는 쪽을 자동으로 사용한다 (상세 -> 일반 순서).
API_LIST = [
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
]
_api = [0]

MONTHS = int(os.environ.get("MONTHS", "12"))
WORKERS = int(os.environ.get("WORKERS", "4"))

# 2026년 행정구역 개편으로 새로 생긴 구는, 개편 전에 신고된 거래가 예전 시군구 코드로 남아 있을 수 있다.
# 그래서 새 구 코드와 함께 예전 코드도 조회하고, 읍면동+지번으로 단지를 찾는다.
LEGACY = {
    "41591": ["41590"], "41593": ["41590"], "41595": ["41590"], "41597": ["41590"],  # 화성시 4개 구
    "28125": ["28110", "28140", "28177"], "28155": ["28110"],                        # 제물포구, 영종구
    "28275": ["28260"], "28290": ["28260"],                                           # 서해구, 검단구
}


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(f"{code}: {msg}")
        self.code = code


def kst_today():
    return (dt.datetime.utcnow() + dt.timedelta(hours=9)).date()


def month_list(n):
    t = kst_today()
    y, m = t.year, t.month
    out = []
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def norm_name(s):
    s = re.sub(r"\(.*?\)", "", s or "")
    s = re.sub(r"[\s·\-_.,/]", "", s).lower()
    return s.replace("아파트", "")


def parse_items(content):
    root = ET.fromstring(content)
    if root.tag.startswith("OpenAPI") or root.find(".//cmmMsgHeader") is not None:
        raise ApiError("KEY", (root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg") or "인증 오류").strip())
    rc = (root.findtext(".//resultCode") or "").strip()
    if rc not in ("00", "000"):
        raise ApiError(rc or "?", (root.findtext(".//resultMsg") or "").strip())
    total = int((root.findtext(".//totalCount") or "0").strip() or 0)
    rows = []
    for it in root.findall(".//item"):
        rows.append({c.tag: (c.text or "").strip() for c in it})
    return total, rows


def fetch_rows(key, code, ym):
    """한 시군구·한 달의 전체 거래(여러 페이지)를 가져온다."""
    import requests
    out, page = [], 1
    while True:
        last = None
        for attempt in range(4):
            try:
                r = requests.get(API_LIST[_api[0]], params={"serviceKey": key, "LAWD_CD": code, "DEAL_YMD": ym,
                                                            "pageNo": page, "numOfRows": 1000}, timeout=40)
                r.raise_for_status()
                total, rows = parse_items(r.content)
                break
            except ApiError as e:
                if e.code == "KEY" and _api[0] + 1 < len(API_LIST):
                    _api[0] += 1  # 이 서비스에 활용신청이 안 된 키일 수 있어 다음 서비스로 전환
                    print(f"  서비스 전환 -> {API_LIST[_api[0]].split('/')[-1]} ({e})", flush=True)
                    last = e
                    continue
                if e.code in ("KEY", "30", "31", "22", "20"):  # 인증·한도 오류는 재시도 무의미
                    raise
                last = e
            except Exception as e:  # 네트워크·XML 오류
                last = e
            time.sleep(1.5 * (attempt + 1))
        else:
            raise last
        out.extend(rows)
        if page * 1000 >= total or not rows:
            return out
        page += 1


def build_index(cx):
    """단지 목록 -> (시군구코드, 읍면동, 지번) / (시군구코드, 읍면동, 정규화 단지명) 색인"""
    L, R = cx["L"], cx["R"]
    idx1, idx2, info = collections.defaultdict(list), collections.defaultdict(list), []
    for i, (li, name, jibun, lat, lon) in enumerate(R):
        sido, gu, umd, code = L[li].split("|")
        last = umd.split()[-1]
        n = norm_name(name)
        info.append((code, n))
        for c in [code] + LEGACY.get(code, []):
            idx1[(c, last, jibun)].append(i)
            idx2[(c, last, n)].append(i)
    return idx1, idx2, info


def match(idx1, idx2, info, fcode, row):
    umd, jibun = row.get("umdNm", ""), row.get("jibun", "")
    n = norm_name(row.get("aptNm", ""))
    cand = idx1.get((fcode, umd, jibun))
    if cand:
        if len(cand) == 1:
            return cand[0]
        exact = [i for i in cand if info[i][1] == n]
        part = [i for i in cand if info[i][1] and (info[i][1] in n or n in info[i][1])]
        pick = exact or part
        return pick[0] if len(pick) == 1 or exact else None
    cand = idx2.get((fcode, umd, n))
    return cand[0] if cand and len(cand) == 1 else None


def to_trade(row):
    """API 한 건 -> [yyyymmdd, 전용㎡, 층, 만원] (해제 건은 None)"""
    if row.get("cdealType", "").strip().upper() == "O" or row.get("cdealDay", "").strip():
        return None
    try:
        amt = int(row["dealAmount"].replace(",", "").strip())
        ymd = int(row["dealYear"]) * 10000 + int(row["dealMonth"]) * 100 + int(row["dealDay"])
        area = round(float(row["excluUseAr"]), 2)
        floor = int(row.get("floor") or 0)
    except (KeyError, ValueError):
        return None
    return [ymd, area, floor, amt]


def main():
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        print("ERROR: DATA_GO_KR_KEY 가 설정되지 않았습니다. (저장소 Settings > Secrets and variables > Actions)", file=sys.stderr)
        return 1
    key = urllib.parse.unquote(key)

    cx = json.load(open(DATA / "complexes.json", encoding="utf-8"))
    idx1, idx2, info = build_index(cx)
    own_codes = sorted({s.split("|")[3] for s in cx["L"]})
    fetch_codes = sorted(set(own_codes) | {c for v in LEGACY.values() for c in v})
    months = month_list(MONTHS)
    jobs = [(c, ym) for c in fetch_codes for ym in months]
    print(f"조회 대상 시군구 {len(fetch_codes)}개 x {len(months)}개월 = {len(jobs)}건", flush=True)

    out = {c: collections.defaultdict(list) for c in own_codes}
    stat = collections.Counter()
    unmatched = collections.Counter()
    failed = []

    def work(job):
        c, ym = job
        return job, fetch_rows(key, c, ym)

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        for n, f in enumerate(as_completed(futs), 1):
            try:
                (c, ym), rows = f.result()
            except ApiError as e:
                if e.code in ("KEY", "30", "31"):
                    print(f"FATAL 인증키 오류: {e}", file=sys.stderr)
                    for g in futs:
                        g.cancel()
                    return 1
                failed.append(f"{e}")
                continue
            except Exception as e:
                failed.append(str(e)[:120])
                continue
            for row in rows:
                stat["rows"] += 1
                t = to_trade(row)
                if t is None:
                    stat["cancelled_or_bad"] += 1
                    continue
                i = match(idx1, idx2, info, c, row)
                if i is None:
                    stat["unmatched"] += 1
                    unmatched[(c, row.get("umdNm", ""), row.get("aptNm", ""))] += 1
                    continue
                stat["matched"] += 1
                out[info[i][0]][i].append(t)
            if n % 100 == 0:
                print(f"  진행 {n}/{len(jobs)}", flush=True)

    if failed and len(failed) > len(jobs) // 2:
        print(f"ERROR: 요청 {len(failed)}/{len(jobs)}건 실패. 예: {failed[:3]}", file=sys.stderr)
        return 1

    tdir = DATA / "trades"
    tdir.mkdir(parents=True, exist_ok=True)
    for c in own_codes:
        comp = {}
        for i, arr in out[c].items():
            seen, uniq = set(), []
            for t in sorted(arr, key=lambda x: -x[0]):
                k = tuple(t)
                if k in seen:  # 같은 달이 중복 조회된 경우 방지
                    continue
                seen.add(k)
                uniq.append(t)
            comp[str(i)] = uniq
        json.dump({"c": comp}, open(tdir / f"{c}.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    meta = {
        "asOf": kst_today().isoformat(),
        "months": MONTHS,
        "requests": len(jobs),
        "failed_requests": len(failed),
        "rows": stat["rows"],
        "matched": stat["matched"],
        "unmatched": stat["unmatched"],
        "cancelled_or_bad": stat["cancelled_or_bad"],
    }
    json.dump(meta, open(DATA / "meta.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False))
    if unmatched:
        print("매칭 안 된 상위 단지(시군구코드, 읍면동, 단지명, 건수):")
        for (c, u, n), k in unmatched.most_common(15):
            print(f"  {c} {u} {n} x{k}")
    if failed:
        print(f"실패한 요청 {len(failed)}건, 예: {failed[:3]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
