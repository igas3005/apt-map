#!/usr/bin/env python3
"""입주자모집공고 요약 PPT 생성 (사보이 개발사업부 양식 기반)
사용: python3 build_notice_ppt.py <양식.pptx> <출력.pptx>
공고문에서 뽑은 값은 아래 DATA에 모아 둔다. 각 항목 끝의 p.N 은 공고문 쪽수.
"""
import sys, copy
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree

FONT = 'HY헤드라인M'
NAVY, RED, BLUE, YEL, GRAY, LBLUE, WHITE, BLACK = '1F3864', 'C00000', '0000FF', 'FFF2CC', 'F2F2F2', 'DDEBF7', 'FFFFFF', '000000'
PY = 0.3025

DATA = dict(
    name='용인 고진역 대광로제비앙',
    title='용인 고진역 대광로제비앙 입주자모집공고 분석',
    made='2026/11/16 작성',
    overview=[
        ('위  치', '경기도 용인시 처인구 고림동 646-2 일원 (용인고림지구 H5BL)  [p.5]'),
        ('사업주체', '주식회사 디케이랜드, 주식회사 화인뷰  [p.59]'),
        ('시 공 사', '주식회사 대광건영  [p.59]'),
        ('자금관리', '코리아신탁(주) (자금관리 대리사무)  [p.59]'),
        ('공급규모', '지하 2층 / 지상 12~29층, 8개동, 총 860세대 및 부대복리시설  [p.5]'),
        ('주차대수', '총 1,237대 (공동주택 1,230대, 근린생활시설 7대)  [p.5]'),
        ('입주예정', '2028년 07월 예정  [p.5]'),
        ('분양보증', '주택도시보증공사(HUG), 보증금액 402,233,000천원  [p.57]'),
        ('대지·연면적', '공고문에 기재 없음 (사업계획승인 자료로 별도 확인 필요)'),
    ],
    rules=[
        ('주택유형', '민영주택 / 민간택지 (수도권 자연보전권역)'),
        ('규제지역', '비규제지역 (비투기과열지구·비청약과열지역)'),
        ('분양가상한제', '미적용'),
        ('전매제한', '당첨자 발표일로부터 6개월  [p.5]'),
        ('재당첨제한', '없음'),
        ('거주의무', '없음'),
        ('해당지역', '경기도 용인시 거주자 (기타지역: 서울·인천·경기)'),
    ],
    # 타입, 전용㎡, 공급㎡, 총세대, 특별, 일반  [p.6]
    supply=[('75A', 75.2833, 98.9725, 100, 55, 45), ('84A·84A-1', 84.8460, 111.8215, 481, 268, 213),
            ('84B', 84.9338, 110.4998, 187, 103, 84), ('110A', 110.3573, 143.4032, 92, 12, 80)],
    # 타입, 공급㎡, 확장비(원), [(층, 세대수, 공급금액 원)]  [p.8, p.36]
    price=[
        ('75A', 98.9725, 29_000_000, [('1층', 3, 584_000_000), ('2층', 3, 604_000_000), ('2층(필로티)', 2, 624_000_000), ('3층', 5, 624_000_000), ('4층', 5, 632_000_000), ('5층 이상', 82, 639_000_000)]),
        ('84A', 111.8215, 33_000_000, [('1층', 6, 659_000_000), ('2층', 6, 679_000_000), ('2층(필로티)', 12, 699_000_000), ('3층', 18, 699_000_000), ('4층', 18, 711_000_000), ('5층 이상', 332, 719_000_000)]),
        ('84A-1', 111.8215, 33_000_000, [('1층', 1, 659_000_000), ('2층', 1, 679_000_000), ('2층(필로티)', 2, 699_000_000), ('3층', 4, 699_000_000), ('4층', 4, 711_000_000), ('5층 이상', 77, 719_000_000)]),
        ('84B', 110.4998, 32_000_000, [('1층', 3, 649_000_000), ('2층', 3, 669_000_000), ('2층(필로티)', 5, 689_000_000), ('3층', 8, 689_000_000), ('4층', 8, 701_000_000), ('5층 이상', 160, 709_000_000)]),
        ('110A', 143.4032, 43_000_000, [('2층', 4, 814_000_000), ('3층', 4, 834_000_000), ('4층', 4, 854_000_000), ('5층 이상', 80, 864_000_000)]),
    ],
    total_units=860,
    pay=[
        ('계약금', '5%', '1차 계약 시 1,000만원(정액), 2차 계약 후 30일 이내 잔여분  [p.8]'),
        ('중도금', '60%', '10% × 6회 : 26.01.20 / 26.06.22 / 26.11.20 / 27.03.22 / 27.08.20 / 28.01.20  [p.8]'),
        ('잔  금', '35%', '입주지정일  [p.8]'),
        ('중도금 대출', '이자후불제', '총 분양대금의 60% 범위, 사업주체 지정 금융기관. 입주지정기간 최초일 전일까지의 이자는 사업주체가 대납하고 입주 시 계약자가 일시 납부. 대출기관은 공고일 현재 미정  [p.34]'),
        ('발코니 확장', '별도 계약', '계약금 10%(계약 시) / 잔금 90%(입주지정일), 부가세 포함, 일괄확장 조건  [p.36]'),
    ],
    options=[
        ('시스템 에어컨', '75A·84B', '2대 3,410 / 4대 5,940'),
        ('시스템 에어컨', '84A·84A-1', '2대 3,410 / 3대 4,543 / 4대 5,940 / 5대 7,128'),
        ('시스템 에어컨', '110A', '2대 3,410 / 3대 4,543 / 5대 7,128'),
        ('주방가전', '전 타입', '인덕션 1,859 / 전기오븐 968 / 식기세척기 1,980'),
        ('현관 중문', '전 타입', '3연동 990'),
    ],
    # 2025년 9월 달력 표시  [p.1]
    cal=dict(year=2025, month=9, first_wd=1, days=30,   # first_wd: 1일의 요일 (일=0)
             marks={1: ('특별공급 접수', 'G'), 2: ('일반 1순위', 'G'), 3: ('일반 2순위', 'G'), 9: ('당첨자 발표', 'Y'),
                    10: ('서류접수(~19)', 'B'), 22: ('계약', 'N'), 23: ('계약', 'N'), 24: ('계약', 'N')}),
    sched='○ 입주자모집공고 25.08.22(금)   ○ 특별공급 09.01(월) · 1순위 09.02(화) · 2순위 09.03(수)   ○ 당첨자 발표 09.09(화)\n○ 서류접수 09.10(수)~09.19(금)   ○ 계약체결 09.22(월)~09.24(수)   ○ 입주 2028년 07월 예정',
    todo=['대지면적·연면적, 시공사 도급순위는 공고문에 없어 별도 자료로 확인 필요',
          '중도금 대출기관·금리는 공고일 현재 미정 (추후 사업주체 공지 확인)',
          '청약경쟁률·계약률은 청약 종료 후 청약홈 및 현장 확인',
          '84A와 84A-1은 드레스룸 창호 차이만 있고 면적·분양가 동일  [p.6]'],
)


def rgb(h): return RGBColor.from_string(h)


def set_run(run, size, color=BLACK, bold=False):
    run.font.size = Pt(size); run.font.bold = bold; run.font.color.rgb = rgb(color); run.font.name = FONT
    rPr = run._r.get_or_add_rPr()
    for tag in ('a:ea',):
        el = rPr.find(qn(tag))
        if el is None: el = etree.SubElement(rPr, qn(tag))
        el.set('typeface', FONT)


def border(cell, color='7F7F7F', w=6350):
    tcPr = cell._tc.get_or_add_tcPr()
    for tag in ('a:lnL', 'a:lnR', 'a:lnT', 'a:lnB'):
        old = tcPr.find(qn(tag))
        if old is not None: tcPr.remove(old)
    for tag in ('a:lnL', 'a:lnR', 'a:lnT', 'a:lnB'):
        ln = etree.SubElement(tcPr, qn(tag)); ln.set('w', str(w)); ln.set('cmpd', 'sng')
        sf = etree.SubElement(ln, qn('a:solidFill')); c = etree.SubElement(sf, qn('a:srgbClr')); c.set('val', color)
    # 스키마 순서: 선 요소가 채우기보다 앞에 와야 한다
    for tag in ('a:solidFill', 'a:noFill'):
        f = tcPr.find(qn(tag))
        if f is not None: tcPr.remove(f); tcPr.append(f)


def cell_set(cell, text, size=8, color=BLACK, bold=False, fill=None, align='c'):
    tf = cell.text_frame; tf.word_wrap = True
    lines = str(text).split('\n')
    for i, line in enumerate(lines):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = {'c': PP_ALIGN.CENTER, 'l': PP_ALIGN.LEFT, 'r': PP_ALIGN.RIGHT}[align]
        r = para.add_run(); r.text = line; set_run(r, size, color, bold)
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    cell.margin_left = cell.margin_right = Emu(45720); cell.margin_top = cell.margin_bottom = Emu(18000)
    if fill:
        cell.fill.solid(); cell.fill.fore_color.rgb = rgb(fill)
    else:
        cell.fill.background()
    border(cell)


def add_table(slide, x, y, w, col_w, rows, row_h, styles=None, size=8):
    """rows: [[text,...]]; styles: {(r,c) or ('row',r) or ('col',c): dict(color,bold,fill,align)}"""
    styles = styles or {}
    tot = sum(col_w)
    gf = slide.shapes.add_table(len(rows), len(col_w), Emu(x), Emu(y), Emu(w), Emu(row_h * len(rows)))
    tbl = gf.table
    tblPr = tbl._tbl.tblPr
    for a in ('firstRow', 'bandRow', 'firstCol', 'lastRow', 'lastCol', 'bandCol'): tblPr.set(a, '0')
    sid = tblPr.find(qn('a:tableStyleId'))
    if sid is not None: sid.text = '{5940675A-B579-460E-94D1-54222C63F5DA}'   # 스타일 없음, 표 눈금
    for i, cw in enumerate(col_w): tbl.columns[i].width = Emu(int(w * cw / tot))
    for r, row in enumerate(rows):
        tbl.rows[r].height = Emu(row_h)
        for c, val in enumerate(row):
            st = {}
            for k in (('col', c), ('row', r), (r, c)):
                st.update(styles.get(k, {}))
            if val is None: val = ''
            cell_set(tbl.cell(r, c), val, size=st.get('size', size), color=st.get('color', BLACK), bold=st.get('bold', False), fill=st.get('fill'), align=st.get('align', 'c'))
    return tbl


def merge(tbl, r0, c0, r1, c1):
    if (r0, c0) == (r1, c1): return
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            if (r, c) != (r0, c0):
                for para in tbl.cell(r, c).text_frame.paragraphs:
                    for run in para.runs: run.text = ''
    tbl.cell(r0, c0).merge(tbl.cell(r1, c1))


def add_text(slide, x, y, w, h, text, size=10, color=BLACK, bold=False, box=False):
    tb = slide.shapes.add_textbox(Emu(x), Emu(y), Emu(w), Emu(h)); tf = tb.text_frame; tf.word_wrap = True
    for i, line in enumerate(text.split('\n')):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        r = para.add_run(); r.text = line; set_run(r, size, color, bold)
        para.space_after = Pt(2)
    if box:
        tb.line.color.rgb = rgb(BLACK); tb.line.width = Emu(9525)
    return tb


def heading(slide, y, text): add_text(slide, 202056, y, 6400000, 246221, '■ ' + text, size=10)


def clear_slide(slide, title, made):
    keep = {'바닥글 개체 틀 2', 'Rectangle 1', '직사각형 30', 'TextBox 42'}
    for sh in list(slide.shapes):
        if sh.name in keep: continue
        for el in sh._element.iter():
            for att in (qn('r:embed'), qn('r:link'), qn('r:id')):
                rid = el.get(att)
                if rid and rid in slide.part.rels:
                    try: slide.part.drop_rel(rid)
                    except Exception: pass
        sh._element.getparent().remove(sh._element)
    for sh in slide.shapes:
        if sh.name == 'TextBox 42': sh.text_frame.paragraphs[0].runs[0].text = title; [r._r.getparent().remove(r._r) for r in sh.text_frame.paragraphs[0].runs[1:]]
        if sh.name == '직사각형 30': sh.text_frame.paragraphs[0].runs[0].text = made; [r._r.getparent().remove(r._r) for r in sh.text_frame.paragraphs[0].runs[1:]]


def n(v): return f'{v:,.0f}'
def r10(v): return round(v / 10) * 10      # 평당가는 양식처럼 만원 단위로 반올림(천원 표기)


def strip_branding(prs):
    """공개용: 마스터·레이아웃의 로고 그림과 회사명 글상자를 뺀다."""
    for holder in list(prs.slide_masters) + [l for m in prs.slide_masters for l in m.slide_layouts]:
        for sh in list(holder.shapes):
            txt = sh.text_frame.text if sh.has_text_frame else ''
            if sh.shape_type == 13 or '사보이' in txt or 'SAVOY' in txt.upper():
                for el in sh._element.iter():
                    rid = el.get(qn('r:embed'))
                    if rid and rid in holder.part.rels: holder.part.drop_rel(rid)
                sh._element.getparent().remove(sh._element)


def build(template, out, plain=False):
    D = DATA
    prs = Presentation(template)
    if plain: strip_branding(prs)
    slides = list(prs.slides)
    for s in slides[:3]: clear_slide(s, D['title'], D['made'])
    X, W = 300000, 6258000
    HDR = dict(fill=NAVY, color=WHITE)

    # ---------- 1쪽: 사업개요 / 공급세대 / 공급조건 ----------
    s = slides[0]
    heading(s, 620000, '사업개요')
    rows = [['구  분', '내   용']] + [list(r) for r in D['overview']]
    add_table(s, X, 880000, W, [1.1, 6], rows, 250000, {('row', 0): HDR, ('col', 0): dict(fill=GRAY), ('col', 1): dict(align='l'), (0, 1): dict(fill=NAVY, color=WHITE, align='c'), (0, 0): HDR}, size=8.5)

    heading(s, 3560000, '공급 세대 (특별공급 51% / 일반공급 49%)  [p.6]')
    rows = [['타 입', '전용면적(㎡)', '공급면적(㎡)', '공급면적(평)', '총 세대', '특별공급', '일반공급', '세대 비중']]
    ts = sp = ge = 0
    for t, ex, su, tot, spc, gen in D['supply']:
        rows.append([t, f'{ex:.4f}', f'{su:.4f}', f'{su * PY:.2f}', n(tot), n(spc), n(gen), f'{tot / D["total_units"] * 100:.1f}%'])
        ts += tot; sp += spc; ge += gen
    assert ts == D['total_units'], ts
    rows.append(['합 계', '', '', '', n(ts), n(sp), n(ge), '100.0%'])
    tb = add_table(s, X, 3820000, W, [1.3, 1.2, 1.2, 1.2, 1, 1, 1, 1], rows, 250000, {('row', 0): HDR, ('col', 0): dict(fill=GRAY), ('row', len(rows) - 1): dict(fill=YEL, color=RED), (0, 0): HDR}, size=8.5)
    merge(tb, len(rows) - 1, 0, len(rows) - 1, 3)

    heading(s, 5480000, '청약·규제 조건  [p.1, p.5]')
    rows = [['구  분', '내   용']] + [list(r) for r in D['rules']]
    add_table(s, X, 5740000, W, [1.1, 6], rows, 250000, {('row', 0): HDR, ('col', 0): dict(fill=GRAY), ('col', 1): dict(align='l'), (0, 1): dict(fill=NAVY, color=WHITE, align='c'), (0, 0): HDR}, size=8.5)
    add_text(s, X, 7860000, W, 620000, '※ 본 자료는 입주자모집공고문(주택관리번호 2025-000378, 59쪽)에서 발췌·계산한 내용임. 각 항목의 [p.N]은 공고문 쪽수이며, 공고문에 없는 항목(대지·연면적, 도급순위, 위치도)은 넣지 않았음.', size=8, color='595959')

    # ---------- 2쪽: 분양가 테이블 ----------
    s = slides[1]
    heading(s, 600000, '분양가 테이블 (단위 : 천원, 평당가는 공급면적 기준)  [p.8, p.36]')
    head = ['타입', '층', '세대수', '공급면적\n(평)', '공급금액\n(확장 전)', '평당가\n(확장 전)', '발코니\n확장비', '공급금액\n(확장 포함)', '평당가\n(확장 포함)']
    rows = [head]; styles = {('row', 0): dict(fill=NAVY, color=WHITE, size=7.5)}; merges = []; summ = []
    g_units = g_amt = g_ext = g_py = 0
    for t, su, ext, floors in D['price']:
        py = su * PY; start = len(rows); u = sum(f[1] for f in floors); amt = sum(f[1] * f[2] for f in floors)
        for fl, cnt, a in floors:
            rows.append([t, fl, n(cnt), f'{py:.2f}', n(a / 1000), n(r10(a / 1000 / py)), n(ext / 1000), n((a + ext) / 1000), n(r10((a + ext) / 1000 / py))])
        merges.append((start, 0, len(rows) - 1, 0)); merges.append((start, 3, len(rows) - 1, 3)); merges.append((start, 6, len(rows) - 1, 6))
        avg = amt / u
        rows.append([f'{t} 소계', '', n(u), f'{py:.2f}', n(avg / 1000), n(r10(avg / 1000 / py)), n(ext / 1000), n((avg + ext) / 1000), n(r10((avg + ext) / 1000 / py))])
        styles[('row', len(rows) - 1)] = dict(fill=YEL, color=RED); merges.append((len(rows) - 1, 0, len(rows) - 1, 1))
        summ.append((t, u, py, avg, ext)); g_units += u; g_amt += amt; g_ext += ext * u; g_py += py * u
    assert g_units == D['total_units'], g_units
    styles[('col', 0)] = dict(fill=GRAY)
    tb = add_table(s, X, 850000, W, [0.9, 1.25, 0.75, 0.9, 1.25, 1.1, 1, 1.3, 1.15], rows, 147000, styles, size=7.5)
    tb.rows[0].height = Emu(290000)
    for m in merges: merge(tb, *m)

    y2 = 850000 + 290000 + 147000 * (len(rows) - 1) + 150000
    heading(s, y2, '분양가 요약 (세대수 가중평균, 단위 : 천원)')
    rows = [['타입', '세대수', '평균 공급금액\n(확장 전)', '평당가\n(확장 전)', '발코니\n확장비', '평균 공급금액\n(확장 포함)', '평당가\n(확장 포함)', '5층 이상\n(기준층) 분양가']]
    for (t, u, py, avg, ext), (_, _, _, floors) in zip(summ, D['price']):
        rows.append([t, n(u), n(avg / 1000), n(r10(avg / 1000 / py)), n(ext / 1000), n((avg + ext) / 1000), n(r10((avg + ext) / 1000 / py)), n(floors[-1][2] / 1000)])
    rows.append(['전체', n(g_units), n(g_amt / g_units / 1000), n(r10(g_amt / 1000 / g_py)), n(g_ext / g_units / 1000), n((g_amt + g_ext) / g_units / 1000), n(r10((g_amt + g_ext) / 1000 / g_py)), '-'])
    add_table(s, X, y2 + 260000, W, [0.9, 0.8, 1.3, 1.1, 1, 1.3, 1.1, 1.3], rows, 215000,
              {('row', 0): dict(fill=NAVY, color=WHITE, size=7.5), ('col', 0): dict(fill=GRAY), ('row', len(rows) - 1): dict(fill=YEL, color=RED), ('col', 6): dict(color=BLUE), (0, 6): dict(fill=NAVY, color=WHITE), (len(rows) - 1, 6): dict(fill=YEL, color=RED)}, size=8).rows[0].height = Emu(300000)
    y3 = y2 + 260000 + 300000 + 215000 * (len(rows) - 1) + 60000
    add_text(s, X, y3, W, 420000, f'※ 총 분양가(확장 전) {g_amt / 1e8:,.0f}억원, 발코니 확장 전 세대 선택 시 {(g_amt + g_ext) / 1e8:,.0f}억원. 전체 평당가는 총액 ÷ 총 공급면적(평)으로 계산.\n※ 110A는 공급금액에 부가가치세 포함(전용 85㎡ 초과). 평 환산은 공고문 기준 공급면적 × 0.3025.', size=7.5, color='595959')

    # ---------- 3쪽: 납부조건 / 옵션 / 일정 / 확인사항 ----------
    s = slides[2]
    heading(s, 600000, '분양대금 납부 조건')
    rows = [['구 분', '비율·방식', '내   용']] + [list(r) for r in D['pay']]
    tb = add_table(s, X, 850000, W, [1.1, 1, 5.2], rows, 255000, {('row', 0): HDR, ('col', 0): dict(fill=GRAY), ('col', 2): dict(align='l'), (0, 2): dict(fill=NAVY, color=WHITE, align='c'), (0, 0): HDR, (4, 1): dict(color=RED, bold=True)}, size=8)
    tb.rows[4].height = Emu(520000)

    t, su, ext, floors = D['price'][1]; a = floors[-1][2]
    heading(s, 2640000, f'자금 계획 예시 ({t} 5층 이상, 발코니 확장 선택 시 / 단위 : 천원)')
    rows = [['구 분', '분양대금', '발코니 확장', '합 계', '비 고'],
            ['계약 시', n(10_000), n(ext * 0.1 / 1000), n((10_000_000 + ext * 0.1) / 1000), '계약금 1차(정액) + 확장 계약금'],
            ['계약 후 30일', n((a * 0.05 - 10_000_000) / 1000), '-', n((a * 0.05 - 10_000_000) / 1000), '계약금 2차 (5% 잔여분)'],
            ['중도금 (6회)', n(a * 0.6 / 1000), '-', n(a * 0.6 / 1000), f'회당 {n(a * 0.1 / 1000)}, 대출 시 이자후불'],
            ['입주 시 잔금', n(a * 0.35 / 1000), n(ext * 0.9 / 1000), n((a * 0.35 + ext * 0.9) / 1000), '중도금 대출 이자 일시 납부 별도'],
            ['합 계', n(a / 1000), n(ext / 1000), n((a + ext) / 1000), '유상옵션·취득세 등 제외']]
    add_table(s, X, 2890000, W, [1.2, 1.1, 1.1, 1.1, 2.8], rows, 220000, {('row', 0): HDR, ('col', 0): dict(fill=GRAY), ('col', 4): dict(align='l'), (0, 4): dict(fill=NAVY, color=WHITE, align='c'), (0, 0): HDR, ('row', 5): dict(fill=YEL, color=RED), (5, 4): dict(fill=YEL, color=RED, align='l')}, size=8)

    heading(s, 4290000, '유상 옵션 (단위 : 천원, 부가세 포함 / 계약금 10%, 잔금 90%)  [p.37]')
    rows = [['품 목', '적용 타입', '선택안별 금액']] + [list(r) for r in D['options']]
    tb = add_table(s, X, 4540000, W, [1.3, 1.3, 4.7], rows, 205000, {('row', 0): HDR, ('col', 0): dict(fill=GRAY), ('col', 2): dict(align='l'), (0, 2): dict(fill=NAVY, color=WHITE, align='c'), (0, 0): HDR}, size=8)
    merge(tb, 1, 0, 3, 0)

    cal = D['cal']
    heading(s, 5840000, f'청약 일정 ({cal["year"]}년 {cal["month"]}월)  [p.1]')
    rows = [['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']]; styles = {('row', 0): dict(fill=NAVY, color=WHITE, size=7.5), (0, 0): dict(fill='F4B6B6', color=RED, size=7.5)}
    cmap = {'G': ('A9D18E', BLACK), 'Y': ('FFFF00', RED), 'B': (LBLUE, BLACK), 'N': (NAVY, WHITE)}
    day = 1 - cal['first_wd']; r = 1
    while day <= cal['days']:
        row = []
        for c in range(7):
            d = day + c
            if 1 <= d <= cal['days']:
                mk = cal['marks'].get(d)
                row.append(f'{d}\n{mk[0]}' if mk else f'{d}\n')
                if mk: styles[(r, c)] = dict(fill=cmap[mk[1]][0], color=cmap[mk[1]][1])
                elif c == 0: styles[(r, c)] = dict(color=RED)
            else: row.append('')
        rows.append(row); day += 7; r += 1
    tb = add_table(s, X, 6090000, W, [1] * 7, rows, 310000, styles, size=7.5)
    tb.rows[0].height = Emu(170000)
    yc = 6090000 + 170000 + 310000 * (len(rows) - 1) + 70000
    add_text(s, X, yc, W, 700000, '■ 확인 필요 사항\n' + '\n'.join(' - ' + t for t in D['todo']), size=8)

    # 양식에 남은 4번째 이후 슬라이드 제거
    sldIdLst = prs.slides._sldIdLst
    for sid in list(sldIdLst)[3:]:
        prs.part.drop_rel(sid.get(qn('r:id'))); sldIdLst.remove(sid)
    prs.save(out)
    D['_calc'] = dict(total=g_amt, total_ext=g_amt + g_ext, py=g_py, units=g_units)
    return dict(units=g_units, total=g_amt, total_ext=g_amt + g_ext, summ=[(t, u, round(avg), ext) for t, u, py, avg, ext in summ])


def export_json(path, meta):
    """사이트 표시용 요약 JSON (build() 뒤에 호출)"""
    import json
    D = DATA; c = D['_calc']; price = []
    for t, su, ext, floors in D['price']:
        py = su * PY; u = sum(f[1] for f in floors); avg = sum(f[1] * f[2] for f in floors) / u
        price.append(dict(type=t, py=round(py, 2), ext=ext // 1000, units=u, avg=round(avg / 1000), avgPy=r10(avg / 1000 / py), avgExt=round((avg + ext) / 1000), avgExtPy=r10((avg + ext) / 1000 / py),
                          floors=[dict(f=fl, n=cnt, amt=a // 1000, py=r10(a / 1000 / py), amtExt=(a + ext) // 1000, pyExt=r10((a + ext) / 1000 / py)) for fl, cnt, a in floors]))
    out = dict(meta, title=D['title'], made=D['made'], overview=D['overview'], rules=D['rules'],
               supply=[dict(type=t, ex=ex, su=su, py=round(su * PY, 2), total=tot, special=sp, general=ge) for t, ex, su, tot, sp, ge in D['supply']],
               price=price, all=dict(units=c['units'], avg=round(c['total'] / c['units'] / 1000), avgPy=r10(c['total'] / 1000 / c['py']), avgExt=round(c['total_ext'] / c['units'] / 1000), avgExtPy=r10(c['total_ext'] / 1000 / c['py'])),
               pay=D['pay'], options=D['options'], sched=D['sched'], todo=D['todo'])
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    plain = '--plain' in sys.argv; a = [x for x in sys.argv[1:] if not x.startswith('--')]
    print(build(a[0], a[1], plain=plain))
    if len(a) > 2:
        export_json(a[2], dict(id='2025000378', name=DATA['name'], addr='경기 용인시 처인구 고림동 646-2', noticeDate='2025-08-22', units=860, moveIn='2028-07', file='data/notices/2025000378.pptx'))
