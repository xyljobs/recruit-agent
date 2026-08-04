#!/usr/bin/env python3
"""基于 candidate-analysis 0.2.0 规范生成六维候选人评估报告。"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - 运行环境由 assets/pyproject.toml 保证
    load_dotenv = None

from candidate_analysis.render_report import render_report
from ai_execution_policy import require_ai_execution

ASSETS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ASSETS_DIR.parent

if load_dotenv:
    load_dotenv(ASSETS_DIR / ".env.worker", override=False)
    load_dotenv(PROJECT_DIR / ".env.local", override=False)

LEVELS = {"strong", "rec", "maybe", "no"}
TIERS = {"big", "mid", "small", "startup", "gap"}

TECH_TERMS = (
    "Java", "Spring Boot", "Spring Cloud", "JVM", "微服务", "RPC", "分布式",
    "熔断", "负载均衡", "分布式锁", "MySQL", "PostgreSQL", "Redis",
    "Memcached", "Kafka", "RabbitMQ", "RocketMQ", "Linux", "Shell", "Go",
    "Python", "Gin", "Beego", "Django", "Flask", "Docker", "Kubernetes",
    "CI/CD", "云原生", "API网关", "配置中心",
)
DOMAIN_TERMS = (
    "电商", "金融", "OMS", "订单", "支付", "物流", "供应链", "交易",
    "银行", "保险", "证券", "零售", "风控",
)
ARCH_TERMS = (
    "架构", "高并发", "高可用", "性能优化", "系统设计", "服务拆分",
    "容灾", "熔断", "限流", "降级", "分布式", "微服务",
)
BIG_COMPANY_TERMS = (
    "阿里", "蚂蚁", "腾讯", "字节", "百度", "京东", "美团", "网易",
    "华为", "小米", "滴滴", "拼多多", "快手", "海康", "大华",
)

CANDIDATE_SYSTEM_PROMPT = """你是资深技术招聘评估专家。请严格依据 JD 和候选人去标识化能力画像，按 candidate-analysis 0.2.0 的六维模型输出 JSON。

六维顺序固定为：硬性匹配、技术深度、业务经验、职业轨迹、稳定性、综合潜力。每维 0~100，综合分按 JD 重点动态加权，不能简单平均。
推荐等级：strong=硬性全部命中且综合>=85；rec=综合75~84且主要项命中；maybe=综合65~74；no=综合<65或硬性条件卡死。
只使用文本中明确出现的信息；缺失信息写“未明确”，禁止虚构公司、项目、年限、学历或薪资。
你收到的是在招聘方本地生成的去标识化能力画像，不包含姓名、联系方式、公司名和原始简历。不得推测候选人身份、联系方式或受保护特征；评分仅供HR人工复核，不得作为自动淘汰或录用的唯一依据。

只输出一个 JSON 对象，字段必须完整：
{
  "age": 0,
  "years": 0,
  "edu": "未明确",
  "salary": "未明确",
  "company_title": "未明确",
  "level": "strong|rec|maybe|no",
  "overall": 0,
  "one_liner": "一句话推荐结论",
  "tags": ["标签"],
  "scores": [0,0,0,0,0,0],
  "highlight": "具体亮点及依据",
  "risk": "具体风险及依据",
  "interview": "建议核验的问题",
  "best_match": "最匹配 JD 的点",
  "worst_match": "最不匹配或信息缺口",
  "timeline": [{"company":"公司","months":12,"tier":"big|mid|small|startup|gap"}]
}"""

META_SYSTEM_PROMPT = """你是招聘负责人。根据 JD 和已经完成的候选人六维评估，输出 candidate-analysis 0.2.0 报告元数据 JSON。市场观察必须具体、简洁、可执行，不得补造候选人事实。

只输出：
{
  "title":"职位候选人评估",
  "subtitle":"城市 · 薪资 · 经验 · 学历",
  "jd_highlights":"JD 核心要求摘要",
  "insight_supply":"供给结构",
  "insight_intent":"求职意愿",
  "insight_salary":"薪资水位",
  "insight_risk":"风险信号",
  "insight_next":"① ... ② ... ③ ..."
}"""


def _chat(messages: list[dict[str, str]], temperature: float = 0.2) -> str:
    if os.environ.get("ALLOW_EXTERNAL_RESUME_ANALYSIS", "").lower() != "true":
        raise RuntimeError("外部 AI 简历分析未获显式授权")
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("LLM_API_KEY 未配置，无法生成技能评估报告")
    base_url = os.environ.get(
        "LLM_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ).rstrip("/")
    require_ai_execution(base_url, data_classification="deidentified")
    model = os.environ.get("LLM_MODEL", "qwen-plus").strip() or "qwen-plus"
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{base_url}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"评估服务返回 HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError("无法连接评估服务") from error
    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("评估服务返回格式异常") from error


def _parse_json_object(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    start = cleaned.find("{")
    if start < 0:
        raise ValueError("响应中没有 JSON 对象")
    value, _ = json.JSONDecoder().raw_decode(cleaned[start:])
    if not isinstance(value, dict):
        raise ValueError("响应不是 JSON 对象")
    return value


def _request_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            suffix = "\n上一次输出无法解析。请只输出严格 JSON。" if attempt else ""
            return _parse_json_object(_chat([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt + suffix},
            ]))
        except (RuntimeError, ValueError) as error:
            last_error = error
            if attempt == 0:
                time.sleep(1)
    raise RuntimeError(str(last_error or "评估失败"))


def _as_int(value: Any, default: int = 0, minimum: int = 0, maximum: int = 100) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _candidate_dir(task_dir: Path, candidate: dict[str, Any]) -> Path:
    keyword_dir = candidate.get("keyword_dir")
    candidate_dir = candidate.get("dir")
    if not isinstance(keyword_dir, str) or not isinstance(candidate_dir, str):
        raise RuntimeError("候选人目录信息不完整")
    return task_dir / keyword_dir / candidate_dir


def _source_text(candidate_dir: Path) -> str:
    text_path = candidate_dir / "resume.txt"
    if text_path.exists():
        return text_path.read_text(encoding="utf-8", errors="replace")
    return ""


def _source_payload(candidate_dir: Path) -> dict[str, Any]:
    source_path = candidate_dir / "resume_source.json"
    if not source_path.exists():
        return {}
    try:
        value = json.loads(source_path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _redact_external_text(value: str) -> str:
    """删除发送给外部模型的直接标识符，仅保留招聘评估所需文本。"""
    text = value or ""
    substitutions = (
        (r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[邮箱已移除]"),
        (r"(?<!\d)1[3-9]\d{9}(?!\d)", "[手机号已移除]"),
        (r"(?<!\d)(?:\d[\s-]?){6,18}(?!\d)", "[号码已移除]"),
        (r"(?i)https?://\S+|www\.\S+", "[链接已移除]"),
        (r"(?i)(微信|wechat|wx|qq)\s*[:：]?\s*[A-Za-z0-9_-]{4,}", r"\1：[账号已移除]"),
        (r"(?i)(姓名|名字|联系方式|联系电话|手机|邮箱|住址|地址)\s*[:：][^\n]+", r"\1：[已移除]"),
    )
    for pattern, replacement in substitutions:
        text = re.sub(pattern, replacement, text)
    return text[:12000]


def _candidate_label(candidate: dict[str, Any], fallback_index: int) -> str:
    name = str(candidate.get("name") or "").strip()
    index = candidate.get("global_index") or candidate.get("index") or fallback_index
    return name or f"候选人 {index}"


def _invalid_summary(
    manifest_candidates: list[dict[str, Any]],
    skipped_candidates: list[tuple[dict[str, Any], str]],
) -> str:
    failed = [
        candidate for candidate in manifest_candidates
        if candidate.get("status") not in ("ok", "done")
    ]
    parts = []
    if failed:
        labels = "、".join(
            _candidate_label(candidate, position)
            for position, candidate in enumerate(failed[:5], 1)
        )
        suffix = "等" if len(failed) > 5 else ""
        parts.append(f"采集失败 {len(failed)} 人（{labels}{suffix}）")
    if skipped_candidates:
        labels = "、".join(
            _candidate_label(candidate, position)
            for position, (candidate, _) in enumerate(skipped_candidates[:5], 1)
        )
        suffix = "等" if len(skipped_candidates) > 5 else ""
        parts.append(f"简历文本不完整 {len(skipped_candidates)} 人（{labels}{suffix}）")
    total = len(failed) + len(skipped_candidates)
    return f"另有 {total} 人未列入评估：{'；'.join(parts)}" if total else ""


def _contains(text: str, term: str) -> bool:
    return term.casefold() in text.casefold()


def _matched_terms(text: str, terms: tuple[str, ...]) -> list[str]:
    return [term for term in terms if _contains(text, term)]


def _first_int(text: str, patterns: tuple[str, ...], default: int = 0) -> int:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return _as_int(match.group(1), default=default, maximum=100)
    return default


def _month_value(value: Any, now: datetime) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    if any(term in text for term in ("至今", "现在", "今")):
        return now.year * 12 + now.month
    match = re.search(r"(20\d{2}|19\d{2})\D*(\d{1,2})?", text)
    if not match:
        return None
    return int(match.group(1)) * 12 + int(match.group(2) or 1)


def _company_tier(company: str) -> str:
    if any(term in company for term in BIG_COMPANY_TERMS):
        return "big"
    if "集团" in company or "股份" in company:
        return "mid"
    return "small"


def _local_candidate_analysis(
    candidate_dir: Path,
    candidate: dict[str, Any],
    fallback_index: int,
    jd: str,
) -> dict[str, Any]:
    """本地规则分析：不联网、不上传简历，输出技能模板要求的六维字段。"""
    resume = _source_text(candidate_dir)
    source = _source_payload(candidate_dir)
    zp_data = source.get("zpData") if isinstance(source.get("zpData"), dict) else {}
    detail = zp_data.get("geekDetail") if isinstance(zp_data.get("geekDetail"), dict) else {}
    base = detail.get("geekBaseInfo") if isinstance(detail.get("geekBaseInfo"), dict) else {}
    expects = detail.get("geekExpectList") if isinstance(detail.get("geekExpectList"), list) else []
    works = detail.get("geekWorkExpList") if isinstance(detail.get("geekWorkExpList"), list) else []
    projects = detail.get("geekProjExpList") if isinstance(detail.get("geekProjExpList"), list) else []

    age = _first_int(str(base.get("ageDesc") or resume), (r"(\d{2})\s*岁",))
    years = _first_int(
        str(base.get("workYearDesc") or resume),
        (r"(\d+)\s*年以上", r"(\d+)\s*年"),
    )
    edu = str(base.get("degreeCategory") or "未明确")
    expect = next((item for item in expects if isinstance(item, dict)), {})
    salary = str(expect.get("salaryDesc") or "未明确")
    location = str(expect.get("locationName") or "")
    current_work = next((item for item in works if isinstance(item, dict)), {})
    company = str(current_work.get("company") or "未明确")
    position = str(current_work.get("positionName") or "未明确")

    jd_tech = _matched_terms(jd, TECH_TERMS)
    resume_tech = _matched_terms(resume, TECH_TERMS)
    tech_hits = [term for term in jd_tech if term in resume_tech]
    tech_gaps = [term for term in jd_tech if term not in resume_tech]
    tech_ratio = len(tech_hits) / max(len(jd_tech), 1)

    required_years = _first_int(
        jd,
        (
            r"(?:工作|研发|开发)?经验[^\d]{0,10}(?:大于|不少于|至少|≥)\s*(\d+)\s*年",
            r"(\d+)\s*年以上[^。；，]{0,10}(?:经验|开发)",
        ),
    )
    experience_score = 100 if not required_years else min(100, round(years / max(required_years, 1) * 100))
    education_required = next((value for value in ("博士", "硕士", "本科", "大专") if value in jd), "")
    education_rank = {"未明确": 0, "大专": 1, "本科": 2, "硕士": 3, "博士": 4}
    education_score = 75 if not education_required else (
        100 if education_rank.get(edu, 0) >= education_rank.get(education_required, 0) else 30
    )
    location_score = 100 if not location or location in jd or "杭州" not in jd else 60
    hard = round(tech_ratio * 55 + experience_score * 0.25 + education_score * 0.1 + location_score * 0.1)

    arch_hits = _matched_terms(resume, ARCH_TERMS)
    evidence_count = len(works) + len(projects)
    tech_depth = min(100, round(35 + tech_ratio * 35 + min(len(arch_hits), 5) * 4 + min(evidence_count, 5) * 2))

    jd_domains = _matched_terms(jd, DOMAIN_TERMS)
    resume_domains = _matched_terms(resume, DOMAIN_TERMS)
    domain_hits = [term for term in jd_domains if term in resume_domains]
    business = 65 if not jd_domains else round(35 + 65 * len(domain_hits) / max(len(jd_domains), 1))

    senior_hits = _matched_terms(resume, ("架构师", "技术负责人", "技术经理", "资深", "专家", "高级"))
    trajectory = min(100, 45 + min(years, 15) * 2 + min(len(projects), 5) * 4 + min(len(senior_hits), 3) * 5)

    now = datetime.now()
    timeline = []
    durations = []
    for item in reversed([work for work in works if isinstance(work, dict)]):
        start = _month_value(item.get("startYearMonStr") or item.get("startDate"), now)
        end = _month_value(item.get("endYearMonStr") or item.get("endDate") or "至今", now)
        months = max(1, end - start) if start is not None and end is not None and end >= start else 12
        durations.append(months)
        work_company = str(item.get("company") or "未明确")
        timeline.append({
            "company": work_company,
            "months": months,
            "tier": _company_tier(work_company),
        })
    average_months = sum(durations) / len(durations) if durations else 0
    short_stints = sum(1 for months in durations if months < 18)
    stability = 65 if not durations else min(95, max(35, round(55 + min(average_months, 48) * 0.8 - short_stints * 8)))

    breadth = len(resume_tech)
    cloud_hits = _matched_terms(resume, ("Docker", "Kubernetes", "CI/CD", "云原生", "Go", "Python"))
    potential = min(100, 50 + min(breadth, 15) * 2 + min(len(cloud_hits), 5) * 4)

    scores = [hard, tech_depth, business, trajectory, stability, potential]
    overall = round(sum(score * weight for score, weight in zip(scores, (0.30, 0.25, 0.15, 0.12, 0.08, 0.10))))
    hard_blocked = bool(required_years and years and years + 2 < required_years) or education_score < 50
    level = (
        "no" if hard_blocked or overall < 65
        else "strong" if overall >= 85 and hard >= 80
        else "rec" if overall >= 75
        else "maybe"
    )

    strengths = "、".join(tech_hits[:6]) or "从简历文本未识别到明确的 JD 核心技术词"
    gaps = "、".join(tech_gaps[:5]) or "未发现明显技术词缺口"
    domain_text = "、".join(domain_hits[:4]) or "业务领域证据需进一步核验"
    tags = ([f"{years}年经验"] if years else []) + tech_hits[:5] + domain_hits[:2]
    if edu != "未明确":
        tags.append(edu)

    raw = {
        "age": age,
        "years": years,
        "edu": edu,
        "salary": salary,
        "company_title": f"{company} · {position}",
        "level": level,
        "overall": overall,
        "one_liner": f"核心匹配：{strengths}；主要缺口：{gaps}。",
        "tags": tags,
        "scores": scores,
        "highlight": f"简历明确命中 {len(tech_hits)}/{len(jd_tech) or 0} 个 JD 技术要点（{strengths}）；共有 {len(works)} 段工作经历、{len(projects)} 段项目经历，业务证据为：{domain_text}。",
        "risk": f"待核验技术缺口：{gaps}。另需确认期望薪资（{salary}）、到岗时间及关键项目中的个人职责边界。",
        "interview": f"① 选取一个最复杂的项目说明架构取舍、容量指标和故障复盘；② 针对 {gaps} 核验真实掌握程度；③ 说明最近两段经历的离职原因、薪资预期和到岗时间。",
        "best_match": f"明确命中的核心能力：{strengths}。",
        "worst_match": f"简历未明确覆盖：{gaps}。",
        "timeline": timeline,
    }
    return _normalize_candidate(raw, candidate, fallback_index)


def _external_candidate_profile(
    candidate_dir: Path,
    candidate: dict[str, Any],
    fallback_index: int,
    jd: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """生成不含姓名、联系方式、公司名和原始简历的外部模型能力画像。"""
    resume = _source_text(candidate_dir)
    source = _source_payload(candidate_dir)
    local_analysis = _local_candidate_analysis(candidate_dir, candidate, fallback_index, jd)
    zp_data = source.get("zpData") if isinstance(source.get("zpData"), dict) else {}
    detail = zp_data.get("geekDetail") if isinstance(zp_data.get("geekDetail"), dict) else {}
    works = detail.get("geekWorkExpList") if isinstance(detail.get("geekWorkExpList"), list) else []
    projects = detail.get("geekProjExpList") if isinstance(detail.get("geekProjExpList"), list) else []

    roles = []
    for work in works:
        if not isinstance(work, dict):
            continue
        role = _redact_external_text(str(work.get("positionName") or "")).strip()
        if role and role not in roles:
            roles.append(role[:80])

    required_skills = _matched_terms(jd, TECH_TERMS)
    skills = _matched_terms(resume, TECH_TERMS)
    domains = _matched_terms(resume, DOMAIN_TERMS)
    architecture = _matched_terms(resume, ARCH_TERMS)
    timeline = [
        {
            "months": item.get("months"),
            "company_tier": item.get("tier"),
        }
        for item in local_analysis.get("timeline", [])
        if isinstance(item, dict)
    ]
    profile = {
        "candidate_id": f"candidate_{candidate.get('global_index') or candidate.get('index') or fallback_index}",
        "experience_years": local_analysis.get("years", 0),
        "education_level": local_analysis.get("edu", "未明确"),
        "roles": roles[:8],
        "skills": skills,
        "required_skill_matches": [skill for skill in required_skills if skill in skills],
        "required_skill_gaps": [skill for skill in required_skills if skill not in skills],
        "domain_signals": domains,
        "architecture_signals": architecture,
        "work_history": timeline,
        "work_experience_count": len(works),
        "project_count": len(projects),
        "source_limits": [
            "姓名、联系方式、公司名和原始简历未发送",
            "能力词由招聘方本地规则提取",
            "缺失信息需要面试人工核验",
        ],
    }
    return local_analysis, profile


def _normalize_candidate(
    raw: dict[str, Any],
    candidate: dict[str, Any],
    fallback_index: int,
) -> dict[str, Any]:
    scores = raw.get("scores") if isinstance(raw.get("scores"), list) else []
    scores = [_as_int(value) for value in scores[:6]]
    scores += [0] * (6 - len(scores))
    overall = _as_int(raw.get("overall"))
    level = raw.get("level") if raw.get("level") in LEVELS else (
        "strong" if overall >= 85 and scores[0] >= 80
        else "rec" if overall >= 75
        else "maybe" if overall >= 65
        else "no"
    )

    timeline = []
    if isinstance(raw.get("timeline"), list):
        for item in raw["timeline"][:12]:
            if not isinstance(item, dict):
                continue
            months = _as_int(item.get("months"), maximum=600)
            if months <= 0:
                continue
            timeline.append({
                "company": str(item.get("company") or "未明确")[:80],
                "months": months,
                "tier": item.get("tier") if item.get("tier") in TIERS else "mid",
            })

    tags = raw.get("tags") if isinstance(raw.get("tags"), list) else []
    tags = [str(tag).strip()[:30] for tag in tags if str(tag).strip()][:10]
    missing = "简历信息不足，建议人工核验"
    return {
        "global_index": candidate.get("global_index") or candidate.get("index") or fallback_index,
        "name": candidate.get("name") or f"候选人 {fallback_index}",
        "age": _as_int(raw.get("age"), maximum=100),
        "years": _as_int(raw.get("years"), maximum=60),
        "edu": str(raw.get("edu") or "未明确")[:40],
        "salary": str(raw.get("salary") or "未明确")[:40],
        "company_title": str(raw.get("company_title") or "未明确")[:160],
        "level": level,
        "overall": overall,
        "one_liner": str(raw.get("one_liner") or missing)[:500],
        "tags": tags,
        "scores": scores,
        "highlight": str(raw.get("highlight") or missing)[:2000],
        "risk": str(raw.get("risk") or missing)[:2000],
        "interview": str(raw.get("interview") or missing)[:2000],
        "best_match": str(raw.get("best_match") or missing)[:1000],
        "worst_match": str(raw.get("worst_match") or missing)[:1000],
        "timeline": timeline,
    }


def _fallback_meta(context: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, str]:
    keywords = context.get("keywords") if isinstance(context.get("keywords"), list) else []
    keyword_text = " · ".join(
        str(item.get("keyword")) for item in keywords if isinstance(item, dict) and item.get("keyword")
    )
    primary_keyword = next((
        str(item.get("keyword")).strip()
        for item in keywords
        if isinstance(item, dict) and item.get("keyword")
    ), "")
    title_hint = re.sub(r"^(北京|上海|广州|深圳|杭州|南京|苏州|成都|武汉|西安)\s*", "", primary_keyword)
    if not title_hint:
        first_line = next((
            line.strip() for line in str(context.get("jd_content") or "").splitlines() if line.strip()
        ), "职位")
        title_hint = re.split(r"[：:，,。；;]", first_line, maxsplit=1)[0]
    recommended = [candidate for candidate in candidates if candidate.get("level") in ("strong", "rec")]
    return {
        "title": f"{title_hint[:36]}候选人评估",
        "subtitle": keyword_text or "Boss 直聘候选人批次",
        "jd_highlights": str(context.get("jd_content") or "未提供")[:300],
        "keywords": keyword_text,
        "exec_time": datetime.now().strftime("%Y-%m-%d"),
        "insight_supply": f"本批共完成 {len(candidates)} 位候选人有效评估。",
        "insight_intent": "求职意愿以候选人简历当前状态为准，联系前建议再次确认到岗时间。",
        "insight_salary": "薪资分布见批次画像，未明确的数据需在首轮沟通中补充。",
        "insight_risk": "优先核验报告中标注的信息缺口、稳定性和硬性条件风险。",
        "insight_next": f"① 优先联系 {len(recommended)} 位推荐候选人；② 电话核验薪资、到岗时间和关键项目；③ 再决定面试顺序。",
    }


def _local_meta(context: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, str]:
    meta = _fallback_meta(context, candidates)
    experienced = [candidate.get("years", 0) for candidate in candidates if candidate.get("years", 0)]
    top_tags: dict[str, int] = {}
    for candidate in candidates:
        for tag in candidate.get("tags", []):
            if re.search(r"年经验|本科|硕士|博士|大专", str(tag)):
                continue
            top_tags[str(tag)] = top_tags.get(str(tag), 0) + 1
    common = "、".join(tag for tag, _ in sorted(top_tags.items(), key=lambda item: (-item[1], item[0]))[:5])
    levels = {level: sum(1 for candidate in candidates if candidate.get("level") == level) for level in LEVELS}
    meta["insight_supply"] = (
        f"本批有效评估 {len(candidates)} 人，强烈推荐 {levels['strong']} 人、推荐 {levels['rec']} 人、"
        f"可考虑 {levels['maybe']} 人；共同能力集中在 {common or '待进一步核验'}。"
    )
    if experienced:
        meta["insight_intent"] = (
            f"候选人公开简历显示从业年限约 {min(experienced)}–{max(experienced)} 年；"
            "求职状态、到岗周期和地域意愿仍应在首次联系时确认。"
        )
    salaries = [candidate.get("salary") for candidate in candidates if candidate.get("salary") not in (None, "", "未明确")]
    meta["insight_salary"] = (
        f"已识别的期望薪资为：{'；'.join(str(value) for value in salaries)}。"
        if salaries else "本批简历未形成完整薪资样本，建议首轮沟通统一确认当前薪资、期望和奖金结构。"
    )
    risks = [candidate.get("worst_match") for candidate in candidates if candidate.get("worst_match")]
    meta["insight_risk"] = "；".join(str(value) for value in risks[:3]) or "优先核验硬性条件和项目真实性。"
    return meta


def generate_report(task_dir: Path, context: dict[str, Any]) -> Path:
    manifest_path = task_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    all_candidates = manifest.get("candidates", [])
    if not isinstance(all_candidates, list):
        raise RuntimeError("任务结果清单格式异常")
    manifest_candidates = [
        candidate for candidate in all_candidates
        if isinstance(candidate, dict) and candidate.get("status") in ("ok", "done")
    ]
    if not manifest_candidates:
        raise RuntimeError("当前任务没有可评估候选人")

    jd = str(context.get("jd_content") or "")[:12000]
    mode = os.environ.get("CANDIDATE_REPORT_MODE", "local").strip().lower() or "local"
    if mode not in ("local", "external_ai"):
        raise RuntimeError("CANDIDATE_REPORT_MODE 仅支持 local 或 external_ai")
    if mode == "external_ai" and os.environ.get("ALLOW_EXTERNAL_RESUME_ANALYSIS", "").lower() != "true":
        raise RuntimeError("外部 AI 模式需要 ALLOW_EXTERNAL_RESUME_ANALYSIS=true 的显式授权")

    analyzed = []
    skipped_candidates: list[tuple[dict[str, Any], str]] = []
    for position, candidate in enumerate(manifest_candidates, 1):
        try:
            candidate_dir = _candidate_dir(task_dir, candidate)
            resume_text = _source_text(candidate_dir)
        except (OSError, RuntimeError) as error:
            skipped_candidates.append((candidate, str(error)))
            print(
                f"[report] 跳过 {_candidate_label(candidate, position)}：{error}",
                flush=True,
            )
            continue
        if not resume_text.strip():
            skipped_candidates.append((candidate, "缺少结构化简历文本"))
            print(
                f"[report] 跳过 {_candidate_label(candidate, position)}：缺少结构化简历文本",
                flush=True,
            )
            continue
        print(f"[report] 本地分析候选人 {position}/{len(manifest_candidates)}", flush=True)
        if mode == "local":
            analyzed.append(_local_candidate_analysis(candidate_dir, candidate, position, jd))
        else:
            local_analysis, privacy_profile = _external_candidate_profile(
                candidate_dir,
                candidate,
                position,
                jd,
            )
            user_prompt = (
                f"JD（已删除联系方式）：\n{_redact_external_text(jd)}\n\n"
                "候选人去标识化能力画像：\n"
                f"{json.dumps(privacy_profile, ensure_ascii=False)}"
            )
            raw = _request_json(CANDIDATE_SYSTEM_PROMPT, user_prompt)
            # 身份、公司、薪资和职业时间线只在本地恢复，不交给外部模型推断。
            for key in ("age", "years", "edu", "salary", "company_title", "timeline"):
                raw[key] = local_analysis.get(key)
            analyzed.append(_normalize_candidate(raw, candidate, position))

    if not analyzed:
        raise RuntimeError("当前任务没有完整的结构化简历文本，请先补采后再生成报告")

    compact = [{
        key: candidate.get(key)
        for key in ("global_index", "years", "edu", "level", "overall", "tags", "risk")
    } for candidate in analyzed]
    normalized_meta = _local_meta(context, analyzed)
    if mode == "external_ai":
        meta_prompt = f"JD：\n{jd}\n\n候选人评估：\n{json.dumps(compact, ensure_ascii=False)}"
        try:
            meta = _request_json(META_SYSTEM_PROMPT, meta_prompt)
        except RuntimeError:
            meta = {}
        for key in (
            "title", "subtitle", "jd_highlights", "insight_supply", "insight_intent",
            "insight_salary", "insight_risk", "insight_next",
        ):
            if meta.get(key):
                normalized_meta[key] = str(meta[key])[:2000]

    invalid_count = len(all_candidates) - len(analyzed)
    invalid_reason = _invalid_summary(
        [candidate for candidate in all_candidates if isinstance(candidate, dict)],
        skipped_candidates,
    )
    excluded_candidates = [
        {
            "global_index": candidate.get("global_index") or candidate.get("index"),
            "name": _candidate_label(candidate, position),
            "reason": reason,
        }
        for position, (candidate, reason) in enumerate(skipped_candidates, 1)
    ]
    analysis_path = task_dir / "analysis.json"
    analysis_path.write_text(json.dumps({
        "schema_version": "candidate-analysis/0.2.0",
        "analysis_mode": mode,
        "privacy": {
            "raw_resume_sent_to_external_ai": False,
            "profile_type": "deidentified_capability_profile" if mode == "external_ai" else "local_only",
            "human_review_required": True,
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "meta": normalized_meta,
        "candidates": analyzed,
        "invalid_count": invalid_count,
        "invalid_reason": invalid_reason,
        "coverage": {
            "total_candidates": len(all_candidates),
            "evaluated_candidates": len(analyzed),
            "excluded_candidates": invalid_count,
        },
        "excluded_candidates": excluded_candidates,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    report_path = render_report(
        meta=normalized_meta,
        candidates=analyzed,
        invalid_count=invalid_count,
        invalid_reason=invalid_reason,
        output=task_dir / "report.html",
    )
    manifest["analysis_file"] = analysis_path.name
    manifest["report_file"] = report_path.name
    manifest["report_generator"] = f"candidate-analysis/0.2.0/{mode}"
    manifest["analysis_privacy"] = {
        "raw_resume_sent_to_external_ai": False,
        "profile_type": "deidentified_capability_profile" if mode == "external_ai" else "local_only",
        "human_review_required": True,
    }
    manifest["report_generated_at"] = datetime.now().isoformat(timespec="seconds")
    manifest["report_coverage"] = {
        "total_candidates": len(all_candidates),
        "evaluated_candidates": len(analyzed),
        "excluded_candidates": invalid_count,
        "excluded_reason": invalid_reason,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def main() -> int:
    if len(sys.argv) != 3:
        print("用法: candidate_report.py <任务目录> <任务上下文.json>")
        return 1
    task_dir = Path(sys.argv[1]).resolve()
    context_path = Path(sys.argv[2]).resolve()
    try:
        context = json.loads(context_path.read_text(encoding="utf-8"))
        report_path = generate_report(task_dir, context)
        print(f"[report] 技能报告已生成: {report_path}")
        return 0
    except Exception as error:
        print(f"[report] 生成失败: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
