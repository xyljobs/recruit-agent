#!/usr/bin/env python3
"""简历 PDF + 钉钉表格 -> AI 推荐理由 -> 钉钉表格写回。"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable

import requests

from ai_execution_policy import require_ai_execution


DEFAULT_LLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_TEXT_MODEL = "qwen-plus"
DEFAULT_VISION_MODEL = "qwen-vl-max"
MIN_TEXT_CHARS = 200
MCP_SERVER_NAME = "dingtalk-resume-task"

DEFAULT_STYLE_SAMPLE = """【基本信息】男，27岁，太原师范学院书法本科，8年全域市场运营经验，手握全国高校独家渠道资源，意向杭州高校资源运营管理/校园用户增长岗
【经验&匹配】深耕全国高校+城市社区双渠道运营，完整承接APP 0-1冷启动、校园线下活动落地、KOC孵化、公私域裂变、品牌投放、数据复盘全链路工作，适配高校渠道拓展、校园资源维护、校园用户增长运营岗位。
【亮点】自有核心资源储备：覆盖全国100+高校、500+学生会/社团/KOC、社区团长、同城万人社群与校园新媒体矩阵；历任市场总监、高校渠道负责人，搭建标准化校园活动SOP，批量落地校园宣讲、开学季大型线下活动；擅长学生、上班族分层运营，定制差异化拉新、激活、留存裂变方案，搭建私域流量闭环；操盘滴滴、知乎、欧莱雅、香飘飘等品牌校园推广，单日完成5000+学生转化，2个月新增4万理工类精准高校用户；全程跟踪下载、注册、留存转化数据，迭代低成本获客玩法优化渠道成本，具备商务谈判、线下团队统筹、全域流量宣发、渠道资源整合全流程实操能力。"""

PROMPT_SKELETON = """你是资深招聘顾问。请为候选人生成一段填入推荐表“推荐理由”列的文案。

要求：
1. 严格模仿下方【参考范例】的段落结构、小标题名称与顺序、字段粒度、句式与语言风格；
2. 只模仿格式与风格，内容必须全部来自本候选人的真实简历，绝不能沿用范例里的任何具体信息；
3. 简历中没有的信息一律不写，严禁编造或推测；
4. 把【表格已知信息】中的推荐方向、工作状态、最快入职时间、推荐层级等自然融入文案；
5. 若简历背景与表格中的推荐方向明显不符，在第一段末尾用（注：...）简短提醒；
6. 输出纯文本，段落间用换行分隔，不要使用 markdown，不要添加开场语、解释或结尾语。

== 【参考范例】（仅供模仿格式与风格） ==
{style_sample}

== 【表格已知信息】 ==
{row_context}

== 【候选人简历内容】 ==
{resume_text}
"""

CROSS_ORG_HINT = (
    "处理办法：使用表格所属组织的钉钉账号在 mcp.dingtalk.com 生成钉钉表格 MCP URL，"
    "然后由管理员将该组织凭证添加到系统。"
)


class PipelineError(RuntimeError):
    """可向用户展示的流水线错误。"""


def resolve_llm_config(overrides: dict[str, str] | None = None) -> dict[str, str]:
    values = overrides or {}

    def pick(key: str, env_names: tuple[str, ...], default: str = "") -> str:
        override = str(values.get(key) or "").strip()
        if override:
            return override
        for env_name in env_names:
            value = os.environ.get(env_name, "").strip()
            if value:
                return value
        return default

    text_model = pick("text_model", ("LLM_MODEL",), DEFAULT_TEXT_MODEL)
    tenant_endpoint = bool(str(values.get("base_url") or "").strip())
    return {
        "api_key": pick(
            "api_key",
            () if tenant_endpoint else ("LLM_API_KEY", "DASHSCOPE_API_KEY"),
        ),
        "base_url": pick(
            "base_url",
            ("LLM_BASE_URL",),
            DEFAULT_LLM_BASE_URL,
        ).rstrip("/"),
        "text_model": text_model,
        "vision_model": pick(
            "vision_model",
            ("RESUME_VL_MODEL", "VL_MODEL"),
            DEFAULT_VISION_MODEL,
        ),
    }


def build_prompt(style_sample: str | None, row_context: str, resume_text: str) -> str:
    return PROMPT_SKELETON.format(
        style_sample=(style_sample or "").strip() or DEFAULT_STYLE_SAMPLE,
        row_context=row_context,
        resume_text=resume_text,
    )


def col_letter(index: int) -> str:
    result = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def locate_columns(header: list[Any], log: Callable[[str], None]) -> tuple[int, int]:
    name_column = None
    target_column = None
    for index, cell in enumerate(header):
        text = str(cell or "")
        if name_column is None and "姓名" in text:
            name_column = index
        if target_column is None and "推荐理由" in text:
            target_column = index
    if name_column is None:
        raise PipelineError("表头未找到含“姓名”的列")
    if target_column is None:
        target_column = 7
        log("[警告] 表头未找到“推荐理由”列，默认写入 H 列")
    return name_column, target_column


def _mcporter_command() -> list[str]:
    if os.name != "nt":
        executable = shutil.which("mcporter")
        if not executable:
            raise PipelineError("找不到 mcporter，请先安装：pnpm add -g mcporter")
        return [executable]

    node = shutil.which("node")
    if not node:
        raise PipelineError("找不到 Node.js")
    configured_cli = os.environ.get("MCPORTER_CLI", "").strip()
    candidates = [Path(configured_cli)] if configured_cli else []
    command = shutil.which("mcporter") or shutil.which("mcporter.cmd")
    if command:
        candidates.append(
            Path(command).parent / "node_modules" / "mcporter" / "dist" / "cli.js"
        )
    app_data = os.environ.get("APPDATA", "")
    if app_data:
        candidates.append(
            Path(app_data) / "npm" / "node_modules" / "mcporter" / "dist" / "cli.js"
        )
    cli_path = next((candidate for candidate in candidates if candidate.is_file()), None)
    if not cli_path:
        raise PipelineError("找不到 mcporter，请先安装：pnpm add -g mcporter")
    return [node, str(cli_path)]


def mcp_call(server: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    command = _mcporter_command() + [
        "call",
        server,
        tool,
        "--args",
        json.dumps(arguments, ensure_ascii=False),
    ]
    process = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )
    output = ((process.stdout or "") + (process.stderr or "")).strip()
    match = re.search(r"\{.*\}", output, re.S)
    if not match:
        raise PipelineError(f"{tool} 没有返回 JSON：{output[:500]}")
    try:
        result = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise PipelineError(f"{tool} 返回了无效 JSON：{output[:500]}") from error
    if result.get("success") is False:
        code = str(result.get("errorCode") or "")
        message = str(result.get("errorMsg") or result.get("errorMessage") or "")
        if code == "forbidden.accessDenied":
            raise PipelineError(
                f"[跨组织受限] {message}\n{CROSS_ORG_HINT}"
            )
        raise PipelineError(f"{tool} 调用失败：{code} {message}".strip())
    return result


def load_sheet(
    server: str,
    node_id: str,
    worksheet_id: str | None,
    log: Callable[[str], None],
) -> tuple[str, list[list[Any]]]:
    selected_id = worksheet_id
    if not selected_id:
        result = mcp_call(server, "get_all_sheets", {"nodeId": node_id})
        sheets = result.get("sheets") or []
        if not sheets:
            raise PipelineError("钉钉表格中没有工作表")
        selected_id = str(sheets[0]["sheetId"])
        log(f"[信息] 使用工作表：{sheets[0].get('name', selected_id)}")
    result = mcp_call(
        server,
        "get_range",
        {"nodeId": node_id, "sheetId": selected_id},
    )
    values = result.get("values") or []
    if not values:
        raise PipelineError("钉钉表格为空")
    return selected_id, values


def extract_pdf_text(pdf_path: Path) -> str:
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages).strip()


def pdf_pages_to_base64(
    pdf_path: Path,
    dpi: int = 120,
    max_pages: int = 4,
) -> list[str]:
    import fitz

    images: list[str] = []
    with fitz.open(pdf_path) as document:
        for page in document[:max_pages]:
            pixmap = page.get_pixmap(dpi=dpi)
            images.append(base64.b64encode(pixmap.tobytes("png")).decode("ascii"))
    return images


def llm_chat(
    model: str,
    messages: list[dict[str, Any]],
    api_key: str,
    base_url: str,
) -> str:
    require_ai_execution(base_url, data_classification="raw_resume")
    try:
        response = requests.post(
            base_url.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": messages},
            timeout=300,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
    except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as error:
        raise PipelineError(f"模型调用失败：{error}") from error
    if not isinstance(content, str) or not content.strip():
        raise PipelineError("模型没有返回推荐理由")
    return content.strip()


def ocr_resume_by_vision(pdf_path: Path, llm: dict[str, str]) -> str:
    content: list[dict[str, Any]] = [{
        "type": "text",
        "text": "请完整转录这份简历图片中的全部文字内容，保持原有结构，不要遗漏，不要评论。",
    }]
    for image in pdf_pages_to_base64(pdf_path):
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{image}"},
        })
    return llm_chat(
        llm["vision_model"],
        [{"role": "user", "content": content}],
        llm["api_key"],
        llm["base_url"],
    )


def run_pipeline(
    folder: Path,
    sheet: str,
    worksheet_id: str | None = None,
    overwrite: bool = False,
    dry_run: bool = False,
    log: Callable[[str], None] = print,
    server: str = MCP_SERVER_NAME,
    llm_config: dict[str, str] | None = None,
    workers: int | None = None,
    style_sample: str | None = None,
) -> dict[str, Any]:
    llm = resolve_llm_config(llm_config)
    require_ai_execution(llm["base_url"], data_classification="raw_resume")
    if not llm["api_key"]:
        raise PipelineError("未配置 LLM_API_KEY")
    if not folder.is_dir():
        raise PipelineError(f"简历目录不存在：{folder}")
    if workers is None:
        try:
            workers = int(os.environ.get("PIPELINE_WORKERS", "8"))
        except ValueError as error:
            raise PipelineError("PIPELINE_WORKERS 必须是 1-32 的整数") from error
    workers = max(1, min(32, workers))

    selected_worksheet_id, values = load_sheet(server, sheet, worksheet_id, log)
    header = values[0]
    name_column, target_column = locate_columns(header, log)
    log(
        f"[信息] 姓名列={col_letter(name_column)} "
        f"推荐理由列={col_letter(target_column)} 数据行数={len(values) - 1}"
    )

    row_by_name: dict[str, int] = {}
    for row_index in range(1, len(values)):
        row = values[row_index]
        name = str(row[name_column] if name_column < len(row) else "").strip()
        if name:
            row_by_name[name] = row_index + 1

    pdf_by_name = {
        path.stem.strip(): path
        for path in folder.iterdir()
        if path.is_file() and path.suffix.lower() == ".pdf"
    }
    matched: list[tuple[str, int, Path]] = []
    unmatched_rows: list[str] = []
    matched_paths: set[Path] = set()
    for name, row_number in row_by_name.items():
        pdf_path = pdf_by_name.get(name)
        if not pdf_path:
            candidates = [
                candidate
                for stem, candidate in pdf_by_name.items()
                if name in stem
            ]
            pdf_path = candidates[0] if len(candidates) == 1 else None
        if pdf_path:
            matched.append((name, row_number, pdf_path))
            matched_paths.add(pdf_path)
        else:
            unmatched_rows.append(name)

    unmatched_files = [
        path.name for path in pdf_by_name.values() if path not in matched_paths
    ]
    log(
        f"[信息] 匹配到 {len(matched)} 人；"
        f"未匹配 PDF {len(unmatched_files)} 份；表中缺少 PDF {len(unmatched_rows)} 人"
    )
    if not matched:
        raise PipelineError("没有 PDF 文件名能与表格“姓名”列匹配")

    report: dict[str, Any] = {
        "processed": [],
        "written": [],
        "skipped": [],
        "failed": [],
        "unmatched": unmatched_rows,
        "unmatched_files": unmatched_files,
        "generated": [],
        "worksheet_id": selected_worksheet_id,
        "dry_run": dry_run,
    }

    tasks: list[tuple[str, int, Path, str]] = []
    for name, row_number, pdf_path in matched:
        cell_address = f"{col_letter(target_column)}{row_number}"
        row = values[row_number - 1]
        existing = row[target_column] if target_column < len(row) else ""
        if str(existing).strip() and not overwrite:
            log(f"[跳过] {name}：{cell_address} 已有内容")
            report["skipped"].append(name)
            continue
        tasks.append((name, row_number, pdf_path, cell_address))

    log(f"[信息] 待处理 {len(tasks)} 人，并发数 {workers}")
    generation_started = time.monotonic()

    def generate_one(task: tuple[str, int, Path, str]) -> str:
        name, row_number, pdf_path, _ = task
        resume_text = extract_pdf_text(pdf_path)
        if len(resume_text) < MIN_TEXT_CHARS:
            log(f"[处理] {name} 文本仅 {len(resume_text)} 字符，切换视觉模型识别")
            resume_text = ocr_resume_by_vision(pdf_path, llm)
        row = values[row_number - 1]
        row_context = "；".join(
            f"{str(header[index]).strip()}:{str(row[index]).strip()}"
            for index in range(min(len(header), len(row)))
            if str(header[index]).strip()
            and str(row[index]).strip()
            and index != target_column
        )
        return llm_chat(
            llm["text_model"],
            [{
                "role": "user",
                "content": build_prompt(style_sample, row_context, resume_text[:12000]),
            }],
            llm["api_key"],
            llm["base_url"],
        )

    generated: list[tuple[int, str, str, str]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(generate_one, task): task for task in tasks}
        for future in as_completed(futures):
            name, row_number, _, cell_address = futures[future]
            try:
                generated.append((row_number, name, cell_address, future.result()))
                log(f"[生成] {name} 完成（{len(generated)}/{len(tasks)}）")
            except Exception as error:
                message = str(error)
                log(f"[失败] {name}：{message}")
                report["failed"].append({"name": name, "error": message})

    generated.sort(key=lambda item: item[0])
    report["processed"] = [item[1] for item in generated]
    report["generated"] = [
        {
            "name": name,
            "cell": cell_address,
            "summary": summary,
            "written": False,
        }
        for _, name, cell_address, summary in generated
    ]
    generated_by_cell = {item["cell"]: item for item in report["generated"]}
    log(f"[信息] 生成阶段耗时 {time.monotonic() - generation_started:.1f}s")

    if dry_run:
        log(f"[试运行] 已生成 {len(generated)} 份推荐理由，未写入钉钉")
    elif generated:
        write_started = time.monotonic()
        column = col_letter(target_column)
        runs: list[list[tuple[int, str, str, str]]] = []
        current_run = [generated[0]]
        for item in generated[1:]:
            if item[0] == current_run[-1][0] + 1:
                current_run.append(item)
            else:
                runs.append(current_run)
                current_run = [item]
        runs.append(current_run)
        log(f"[写表] {len(generated)} 个单元格合并为 {len(runs)} 次调用")

        for run in runs:
            range_address = f"{column}{run[0][0]}:{column}{run[-1][0]}"
            try:
                mcp_call(server, "update_range", {
                    "nodeId": sheet,
                    "sheetId": selected_worksheet_id,
                    "rangeAddress": range_address,
                    "values": [[item[3]] for item in run],
                    "wordWrap": "autoWrap",
                })
                for _, name, cell_address, _ in run:
                    report["written"].append(name)
                    generated_by_cell[cell_address]["written"] = True
                log(f"[写表] {range_address} 已写入 {len(run)} 行")
            except Exception as batch_error:
                log(
                    f"[信息] {range_address} 批量写入失败"
                    f"（{str(batch_error)[:80]}），回退逐格写入"
                )
                for _, name, cell_address, summary in run:
                    try:
                        mcp_call(server, "update_range", {
                            "nodeId": sheet,
                            "sheetId": selected_worksheet_id,
                            "rangeAddress": f"{cell_address}:{cell_address}",
                            "values": [[summary]],
                            "wordWrap": "autoWrap",
                        })
                        report["written"].append(name)
                        generated_by_cell[cell_address]["written"] = True
                        log(f"[写表] {name} 已写入 {cell_address}")
                    except Exception as cell_error:
                        message = str(cell_error)
                        log(f"[失败] {name} 写表失败：{message}")
                        report["failed"].append({"name": name, "error": message})
        log(f"[信息] 写表阶段耗时 {time.monotonic() - write_started:.1f}s")

    log(
        "===== 完成 ===== "
        f"处理 {len(report['processed'])} | "
        f"写入 {len(report['written'])} | "
        f"跳过 {len(report['skipped'])} | "
        f"失败 {len(report['failed'])}"
    )
    return report
