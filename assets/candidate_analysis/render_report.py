"""候选人评估报告渲染器。

用法：
    from render_report import render_report
    render_report(
        meta={...},          # 报告元数据（标题、JD、关键词、市场观察等）
        candidates=[...],    # 候选人列表（每人一个 dict）
        invalid_count=0,
        invalid_reason="",
        output="report.html",
    )

或命令行：
    python render_report.py data.json report.html

candidate dict 字段（详见 SKILL.md）：
    必填: global_index, name, age, years, edu, salary, company_title,
         level (strong/rec/maybe/no), overall, one_liner, tags,
         scores (6 维), highlight, risk, interview, best_match, worst_match
    可选: timeline = [{"company": str, "months": int,
                       "tier": "big|mid|small|startup|gap"}, ...]
"""
from __future__ import annotations

import base64
import html
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

TEMPLATE_PATH = Path(__file__).parent / "report_template.html"

LEVEL_BADGE = {
    "strong": ("badge-strong", "强烈推荐"),
    "rec": ("badge-rec", "推荐"),
    "maybe": ("badge-maybe", "可考虑"),
    "no": ("badge-no", "不推荐"),
}
LEVEL_OVERALL_COLOR = {
    "strong": "green",
    "rec": "",  # 蓝色 = 默认
    "maybe": "yellow",
    "no": "gray",
}
LEVEL_DOT_COLOR = {
    "strong": "#38a169",
    "rec": "#3182ce",
    "maybe": "#dd6b20",
    "no": "#a0aec0",
}
LEVEL_ORDER = {"strong": 0, "rec": 1, "maybe": 2, "no": 3}

TIER_LABEL = {
    "big": "大厂", "mid": "中厂", "small": "小厂",
    "startup": "创业", "gap": "空窗",
}


def _esc(s: Any) -> str:
    return html.escape(str(s) if s is not None else "")


def _heat_class(v: int) -> str:
    """6 维分数热力色：≥80 绿、60~79 黄、<60 红、0 灰"""
    if v <= 0:
        return "h-zr"
    if v >= 80:
        return "h-hi"
    if v >= 60:
        return "h-md"
    return "h-lo"


def _attach_resume_images(output_path: Path, candidates: list[dict]) -> list[dict]:
    """从任务 manifest 读取候选人截图并嵌入报告，确保 HTML 可独立查看。"""
    task_root = output_path.resolve().parent
    manifest_path = task_root / "manifest.json"
    if not manifest_path.exists():
        return [dict(candidate) for candidate in candidates]
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [dict(candidate) for candidate in candidates]
    entries = manifest.get("candidates") if isinstance(manifest, dict) else None
    if not isinstance(entries, list):
        return [dict(candidate) for candidate in candidates]

    by_index = {
        entry.get("global_index") or entry.get("index") or position: entry
        for position, entry in enumerate(entries, 1)
        if isinstance(entry, dict)
    }
    enriched = []
    for position, candidate in enumerate(candidates, 1):
        value = dict(candidate)
        index = candidate.get("global_index") or position
        entry = by_index.get(index)
        images = []
        if isinstance(entry, dict):
            keyword_dir = entry.get("keyword_dir")
            candidate_dir = entry.get("dir")
            count = entry.get("screenshot_count") or entry.get("shots") or 0
            if (
                isinstance(keyword_dir, str)
                and isinstance(candidate_dir, str)
                and isinstance(count, int)
                and 0 < count <= 50
            ):
                image_dir = (task_root / keyword_dir / candidate_dir).resolve()
                if image_dir == task_root or task_root in image_dir.parents:
                    for image_index in range(1, count + 1):
                        image_path = (image_dir / f"{image_index}.png").resolve()
                        if image_path.parent != image_dir or not image_path.is_file():
                            continue
                        try:
                            encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
                        except OSError:
                            continue
                        images.append(f"data:image/png;base64,{encoded}")
        value["_resume_images"] = images
        enriched.append(value)
    return enriched


# ============================================================
# 单卡片渲染
# ============================================================
def _render_timeline(timeline: list[dict]) -> str:
    """职业轨迹时间线。timeline=[{company,months,tier}, ...]，按时间正序传入。"""
    if not timeline:
        return ""
    total = sum(max(int(t.get("months", 0)), 0) for t in timeline) or 1
    segs = []
    for t in timeline:
        months = max(int(t.get("months", 0)), 0)
        if months <= 0:
            continue
        pct = months / total * 100
        tier = t.get("tier", "mid")
        company = t.get("company", "")
        years = months / 12
        ystr = f"{years:.1f}y" if years >= 1 else f"{months}m"
        segs.append(
            f'<div class="tl-seg t-{tier}" style="width:{pct:.2f}%" '
            f'title="{_esc(company)} · {months} 个月">{_esc(company)} {ystr}</div>'
        )
    if not segs:
        return ""
    total_year = total / 12
    legend_items = [
        ('big', '大厂'), ('mid', '中厂'), ('small', '小厂'),
        ('startup', '创业'), ('gap', '空窗'),
    ]
    used_tiers = {t.get("tier", "mid") for t in timeline if int(t.get("months", 0)) > 0}
    legend_html = " ".join(
        f'<span><i class="tl-seg t-{k}" style="opacity:1"></i>{v}</span>'
        for k, v in legend_items if k in used_tiers
    )
    return f"""
<div class="timeline-block">
  <div class="tl-title">职业轨迹时间线</div>
  <div class="tl-track">{''.join(segs)}</div>
  <div class="tl-axis"><span>从业起点</span><span>累计 {total_year:.1f} 年</span><span>当前</span></div>
  <div class="tl-legend">{legend_html}</div>
</div>
""".strip()


def _render_resume_gallery(c: dict) -> str:
    images = c.get("_resume_images")
    if not isinstance(images, list) or not images:
        return ""
    idx = c.get("global_index", 0)
    name = _esc(c.get("name") or f"候选人 {idx}")
    figures = "".join(
        f'<figure class="resume-page"><img src="{source}" '
        f'alt="{name}简历第 {position} 页" loading="lazy">'
        f'<figcaption>第 {position} 页</figcaption></figure>'
        for position, source in enumerate(images, 1)
    )
    return f"""
<details class="resume-gallery" id="resume-{idx}">
  <summary>完整简历截图 · {len(images)} 页</summary>
  <div class="resume-pages">{figures}</div>
</details>
""".strip()


def _render_card(c: dict) -> str:
    level = c.get("level", "no")
    badge_cls, badge_text = LEVEL_BADGE.get(level, LEVEL_BADGE["no"])
    overall_color = LEVEL_OVERALL_COLOR.get(level, "gray")
    scores = c.get("scores", [0] * 6)
    idx = c.get("global_index", 0)

    tags_html = "".join(f'<span class="tag">{_esc(t)}</span>' for t in c.get("tags", []))
    score_lines = []
    for label, val in zip(["硬性匹配", "技术深度", "业务经验", "职业轨迹", "稳定性", "综合潜力"], scores):
        score_lines.append(
            f'<div class="score-line"><span class="name">{label}</span>'
            f'<div class="bar"><div style="width:{val}%"></div></div>'
            f'<span class="val">{val}</span></div>'
        )

    timeline_html = _render_timeline(c.get("timeline", []))
    resume_html = _render_resume_gallery(c)

    return f"""
<div class="card" id="card-{idx}">
  <div class="card-head">
    <div>
      <span class="badge {badge_cls}">{badge_text}</span>
      <h3 class="card-title">{_esc(c.get('name'))} <span class="overall {overall_color}">{c.get('overall', 0)}</span></h3>
      <div class="meta-line">
        <span class="item">{_esc(c.get('age'))}岁 · {_esc(c.get('years'))}年 · {_esc(c.get('edu'))}</span>
        <span class="item">期望 {_esc(c.get('salary'))}</span>
        <span class="item">{_esc(c.get('company_title'))}</span>
      </div>
    </div>
    <button class="btn-open" onclick="openResume({idx}, event)">查看简历</button>
  </div>
  <div class="one-liner">{_esc(c.get('one_liner'))}</div>
  <div class="tags">{tags_html}</div>
  <div class="score-row">
    <div class="radar" id="radar-{idx}"></div>
    <div class="scores-list">{''.join(score_lines)}</div>
  </div>
  {timeline_html}
  <div class="detail">
    <p><b>亮点：</b>{_esc(c.get('highlight'))}</p>
    <p><b>风险：</b>{_esc(c.get('risk'))}</p>
    <p><b>面试重点：</b>{_esc(c.get('interview'))}</p>
    <p><b class="match">最匹配：</b>{_esc(c.get('best_match'))}</p>
    <p><b class="gap">最不匹配：</b>{_esc(c.get('worst_match'))}</p>
  </div>
  {resume_html}
</div>
""".strip()


def _render_matrix_row(c: dict) -> str:
    level = c.get("level", "no")
    badge_cls, badge_text = LEVEL_BADGE.get(level, LEVEL_BADGE["no"])
    overall_color = LEVEL_OVERALL_COLOR.get(level, "gray")
    overall = c.get("overall", 0)
    scores = c.get("scores", [0] * 6)
    idx = c.get("global_index", 0)
    score_cells = "".join(
        f'<td><span class="heat {_heat_class(s)}">{s}</span></td>' for s in scores
    )
    return f"""
<tr data-idx="{idx}">
  <td class="name-cell">{_esc(c.get('name'))}<span class="meta-tiny">{_esc(c.get('years'))}年 · {_esc(c.get('company_title'))}</span></td>
  <td><span class="badge-mini {badge_cls}">{badge_text}</span></td>
  <td class="overall-cell" style="color:var(--{overall_color or 'brand'})">{overall}</td>
  {score_cells}
  <td><button class="btn-mini" onclick="openResume({idx}, event)">查看</button></td>
</tr>
""".strip()


def _render_dist_segments(candidates: list[dict]) -> str:
    n = len(candidates) or 1
    counts = {k: sum(1 for c in candidates if c.get("level") == k) for k in LEVEL_BADGE}
    segs = []
    for level in ("strong", "rec", "maybe", "no"):
        cnt = counts[level]
        if cnt == 0:
            continue
        pct = cnt / n * 100
        _, text = LEVEL_BADGE[level]
        segs.append(
            f'<div class="dist-seg {level}" style="width:{pct:.1f}%" title="{text} {cnt} 人">{text} {cnt}</div>'
        )
    return "".join(segs) or '<div class="dist-seg no" style="width:100%">无数据</div>'


# ============================================================
# 批次画像（数据聚合 + 渲染，AI 不需要多填字段）
# ============================================================
def _bucket_years(years_list: list[int]) -> list[tuple[str, int]]:
    """把年限分成 6 档，返回 [(label, count), ...]"""
    buckets = [
        ("0-3", lambda y: y < 3),
        ("3-5", lambda y: 3 <= y < 5),
        ("5-8", lambda y: 5 <= y < 8),
        ("8-10", lambda y: 8 <= y < 10),
        ("10-15", lambda y: 10 <= y < 15),
        ("15+", lambda y: y >= 15),
    ]
    return [(lbl, sum(1 for y in years_list if cond(y))) for lbl, cond in buckets]


def _render_hist_years(candidates: list[dict]) -> str:
    years = [int(c.get("years", 0) or 0) for c in candidates]
    buckets = _bucket_years(years)
    max_v = max((c for _, c in buckets), default=0) or 1
    cols = []
    axis = []
    for lbl, cnt in buckets:
        h = (cnt / max_v) * 76 if cnt else 0  # 留 14px 给数字
        cols.append(
            f'<div class="bar-col"><div class="v">{cnt or ""}</div>'
            f'<div class="b" style="height:{h:.1f}px" title="{lbl} 年: {cnt} 人"></div></div>'
        )
        axis.append(f'<span>{lbl}</span>')
    return f'<div class="hist">{"".join(cols)}</div><div class="axis">{"".join(axis)}</div>'


def _parse_salary_mid(salary: str) -> float | None:
    """从'25-50K'或'30k'里抽出中位数（千元/月）。无法解析返回 None。"""
    if not salary:
        return None
    s = str(salary).lower().replace('，', ',').replace(' ', '')
    nums = re.findall(r'\d+\.?\d*', s)
    if not nums:
        return None
    vals = [float(x) for x in nums[:2]]
    return sum(vals) / len(vals)


def _render_scatter(candidates: list[dict]) -> str:
    """期望薪资 × 经验年限散点图。"""
    pts = []
    for c in candidates:
        y = int(c.get("years", 0) or 0)
        s = _parse_salary_mid(c.get("salary", ""))
        if s is None:
            continue
        pts.append((y, s, c.get("level", "no"), c.get("name", ""), c.get("global_index", 0)))
    if not pts:
        return '<div style="font-size:12px;color:#a0aec0;text-align:center;padding:30px 0;">暂无可解析的薪资数据</div>'

    W, H = 360, 180
    pad_l, pad_r, pad_t, pad_b = 36, 14, 14, 24
    plot_w, plot_h = W - pad_l - pad_r, H - pad_t - pad_b
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x_min, x_max = 0, max(max(xs), 5)
    y_min, y_max = 0, max(max(ys), 30)
    # 整理刻度
    x_max = ((x_max // 5) + 1) * 5
    y_max = ((int(y_max) // 10) + 1) * 10

    def sx(x): return pad_l + (x - x_min) / (x_max - x_min) * plot_w
    def sy(y): return pad_t + plot_h - (y - y_min) / (y_max - y_min) * plot_h

    grid = ""
    x_ticks = list(range(0, x_max + 1, max(x_max // 5, 1)))
    y_ticks = list(range(0, y_max + 1, max(y_max // 4, 1)))
    for tx in x_ticks:
        x = sx(tx)
        grid += f'<line class="grid-line" x1="{x}" y1="{pad_t}" x2="{x}" y2="{H - pad_b}"/>'
        grid += f'<text class="axis-label" x="{x}" y="{H - pad_b + 12}" text-anchor="middle">{tx}y</text>'
    for ty in y_ticks:
        y = sy(ty)
        grid += f'<line class="grid-line" x1="{pad_l}" y1="{y}" x2="{W - pad_r}" y2="{y}"/>'
        grid += f'<text class="axis-label" x="{pad_l - 4}" y="{y + 3}" text-anchor="end">{ty}K</text>'
    # 坐标轴
    grid += f'<line class="axis-line" x1="{pad_l}" y1="{H - pad_b}" x2="{W - pad_r}" y2="{H - pad_b}"/>'
    grid += f'<line class="axis-line" x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{H - pad_b}"/>'

    dots = ""
    for x, y, lvl, name, idx in pts:
        cx, cy = sx(x), sy(y)
        color = LEVEL_DOT_COLOR.get(lvl, "#a0aec0")
        dots += (
            f'<circle class="dot" cx="{cx:.1f}" cy="{cy:.1f}" r="5" '
            f'fill="{color}" fill-opacity=".75" stroke="{color}" stroke-width="1" '
            f'onclick="document.getElementById(\'card-{idx}\')?.scrollIntoView({{behavior:\'smooth\'}})">'
            f'<title>{_esc(name)} · {x}年 · {y:.0f}K · {LEVEL_BADGE.get(lvl, ("","?"))[1]}</title>'
            f'</circle>'
        )

    return (
        f'<svg class="scatter" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">'
        f'{grid}{dots}</svg>'
    )


def _render_stack_tier(candidates: list[dict]) -> str:
    """公司层次堆叠条。优先用 timeline 末尾的 tier；没有则按 company_title 关键词粗判。"""
    big_kw = ("阿里", "腾讯", "字节", "百度", "美团", "京东", "华为", "网易", "小米", "拼多多",
              "蚂蚁", "滴滴", "B站", "哔哩哔哩", "Google", "Microsoft", "Amazon", "Meta",
              "Apple", "Oracle", "IBM", "Intel", "Nvidia")
    mid_kw = ("银行", "保险", "证券", "中信", "平安", "招商", "工商", "建设", "农业", "中国",
              "国企", "上市", "集团", "股份")
    startup_kw = ("创业", "初创", "Startup")

    def classify(c: dict) -> str:
        tl = c.get("timeline", [])
        if tl:
            # 取最后一段（最近）
            last = tl[-1]
            tier = last.get("tier")
            if tier in ("big", "mid", "small", "startup"):
                return tier
        title = str(c.get("company_title", ""))
        if any(k in title for k in big_kw):
            return "big"
        if any(k in title for k in mid_kw):
            return "mid"
        if any(k in title for k in startup_kw):
            return "startup"
        return "small"

    counter = Counter(classify(c) for c in candidates)
    n = sum(counter.values()) or 1
    tier_color = {
        "big": "#2c5282", "mid": "#3182ce",
        "small": "#63b3ed", "startup": "#d69e2e",
    }
    rows = []
    for tier in ("big", "mid", "small", "startup"):
        cnt = counter.get(tier, 0)
        pct = cnt / n * 100
        rows.append(
            f'<div class="row"><span class="lbl">{TIER_LABEL[tier]}</span>'
            f'<div class="track"><div style="width:{pct:.1f}%;background:{tier_color[tier]}"></div></div>'
            f'<span class="cnt">{cnt}</span></div>'
        )
    return f'<div class="stack">{"".join(rows)}</div>'


def _render_tag_rank(candidates: list[dict]) -> str:
    """高频 Tag Top 10。"""
    counter = Counter()
    for c in candidates:
        for t in c.get("tags", []) or []:
            t = str(t).strip()
            if t:
                counter[t] += 1
    top = counter.most_common(10)
    if not top:
        return '<div style="font-size:12px;color:#a0aec0;text-align:center;padding:30px 0;">暂无标签数据</div>'
    max_v = top[0][1] or 1
    rows = []
    for tag, cnt in top:
        pct = cnt / max_v * 100
        rows.append(
            f'<div class="row"><span class="lbl" title="{_esc(tag)}">{_esc(tag)}</span>'
            f'<div class="track"><div style="width:{pct:.1f}%"></div></div>'
            f'<span class="cnt">{cnt}</span></div>'
        )
    return f'<div class="tagrank">{"".join(rows)}</div>'


# ============================================================
# 主入口
# ============================================================
def render_report(
    meta: dict,
    candidates: list[dict],
    invalid_count: int = 0,
    invalid_reason: str = "",
    output: str | Path = "report.html",
    top_n: int = 3,
) -> Path:
    """生成 HTML 报告，返回输出路径。

    meta 字段（可选项给空字符串就好）：
        title, subtitle, jd_highlights, keywords, exec_time,
        insight_supply, insight_intent, insight_salary, insight_risk, insight_next
    candidate 字段：
        必填: global_index, name, age, years, edu, salary, company_title,
             level (strong/rec/maybe/no), overall, one_liner, tags,
             scores (6 维), highlight, risk, interview, best_match, worst_match
        可选: timeline = [{"company": str, "months": int,
                          "tier": "big|mid|small|startup|gap"}, ...]
    """
    output_path = Path(output)
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    candidates_with_images = _attach_resume_images(output_path, candidates)

    # 排序：等级 → 综合分降序
    sorted_cands = sorted(
        candidates_with_images,
        key=lambda c: (LEVEL_ORDER.get(c.get("level", "no"), 99), -c.get("overall", 0)),
    )

    # Top = strong+rec 前 top_n 个
    top_cands = [c for c in sorted_cands if c.get("level") in ("strong", "rec")][:top_n]
    top_ids = {c.get("global_index") for c in top_cands}
    rest_strong_rec = [c for c in sorted_cands
                       if c.get("level") in ("strong", "rec") and c.get("global_index") not in top_ids]
    maybe_cands = [c for c in sorted_cands if c.get("level") == "maybe"]
    no_cands = [c for c in sorted_cands if c.get("level") == "no"]

    matrix_html = "\n".join(_render_matrix_row(c) for c in sorted_cands)
    top_html = "\n".join(_render_card(c) for c in top_cands) \
               or '<div style="color:#718096;font-size:13px;padding:14px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;">本批暂无达到“推荐”或“强烈推荐”标准的候选人，请查看完整列表。</div>'
    maybe_html = "\n".join(_render_card(c) for c in (rest_strong_rec + maybe_cands)) \
                 or '<div style="color:#a0aec0;font-size:13px;padding:10px 0;">（无）</div>'
    no_html = "\n".join(_render_card(c) for c in no_cands) \
              or '<div style="color:#a0aec0;font-size:13px;padding:10px 0;">（无）</div>'
    dist_html = _render_dist_segments(sorted_cands)

    # 失效说明
    if invalid_count > 0:
        msg = invalid_reason or f"另有 {invalid_count} 人简历不全或爬取失败，未列入评估"
        invalid_block = f'<div class="invalid-note">{_esc(msg)}</div>'
    else:
        invalid_block = ""

    # KPI
    kpi_total = len(candidates) + invalid_count
    kpi_valid = len(candidates)
    kpi_top = sum(1 for c in candidates if c.get("level") in ("strong", "rec"))
    kpi_maybe = sum(1 for c in candidates if c.get("level") == "maybe")
    kpi_no = sum(1 for c in candidates if c.get("level") == "no") + invalid_count

    # 雷达图数据
    radar_js = json.dumps(
        {c.get("global_index"): c.get("scores", [0] * 6) for c in candidates},
        ensure_ascii=False,
    )

    # 批次画像
    hist_years = _render_hist_years(candidates)
    scatter_sal = _render_scatter(candidates)
    stack_tier = _render_stack_tier(candidates)
    tag_rank = _render_tag_rank(candidates)

    replacements = {
        "__TITLE__": _esc(meta.get("title", "候选人评估报告")),
        "__SUBTITLE__": _esc(meta.get("subtitle", "")),
        "__JD_HIGHLIGHTS__": _esc(meta.get("jd_highlights", "")),
        "__KPI_TOTAL__": str(kpi_total),
        "__KPI_VALID__": str(kpi_valid),
        "__KPI_TOP__": str(kpi_top),
        "__KPI_MAYBE__": str(kpi_maybe),
        "__KPI_NO__": str(kpi_no),
        "__KEYWORDS__": _esc(meta.get("keywords", "")),
        "__EXEC_TIME__": _esc(meta.get("exec_time", "")),
        "__DIST_SEGMENTS__": dist_html,
        "__INVALID_NOTE_BLOCK__": invalid_block,
        "__HIST_YEARS__": hist_years,
        "__SCATTER_SAL__": scatter_sal,
        "__STACK_TIER__": stack_tier,
        "__TAG_RANK__": tag_rank,
        "__MATRIX_ROWS__": matrix_html,
        "__TOP_CARDS__": top_html,
        "__MAYBE_CARDS__": maybe_html,
        "__NO_CARDS__": no_html,
        "__INSIGHT_SUPPLY__": _esc(meta.get("insight_supply", "")),
        "__INSIGHT_INTENT__": _esc(meta.get("insight_intent", "")),
        "__INSIGHT_SALARY__": _esc(meta.get("insight_salary", "")),
        "__INSIGHT_RISK__": _esc(meta.get("insight_risk", "")),
        "__INSIGHT_NEXT__": _esc(meta.get("insight_next", "")),
        "__RADAR_DATA__": radar_js,
    }

    out = template
    for k, v in replacements.items():
        out = out.replace(k, v)

    output_path.write_text(out, encoding="utf-8")
    return output_path


# ============================================================
# CLI
# ============================================================
def _cli():
    if len(sys.argv) < 3:
        print("用法: python render_report.py <data.json> <output.html>")
        print("data.json 结构: {\"meta\": {...}, \"candidates\": [...], "
              "\"invalid_count\": 0, \"invalid_reason\": \"\"}")
        sys.exit(1)
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = render_report(
        meta=data.get("meta", {}),
        candidates=data.get("candidates", []),
        invalid_count=data.get("invalid_count", 0),
        invalid_reason=data.get("invalid_reason", ""),
        output=sys.argv[2],
    )
    print(f"✅ 报告已生成: {out}")


if __name__ == "__main__":
    _cli()
