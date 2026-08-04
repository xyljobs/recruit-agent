#!/usr/bin/env python3
"""从 Supabase 领取简历批处理任务并在本机执行。"""

from __future__ import annotations

import argparse
import base64
import json
import os
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
from supabase import create_client

from ai_execution_policy import require_ai_execution
from resume_batch_pipeline import (
    MCP_SERVER_NAME,
    PipelineError,
    mcp_call,
    resolve_llm_config,
    run_pipeline,
)


ASSETS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ASSETS_DIR.parent
BUCKET = "resume-batch-files"
LEASE_MINUTES = 30
ENCRYPTION_PREFIX = "enc:v1:aes256gcm:"

load_dotenv(ASSETS_DIR / ".env.worker", override=False)
load_dotenv(PROJECT_DIR / ".env.local", override=False)
WORKER_ID = os.environ.get("RESUME_WORKER_ID") or f"resume-worker-{uuid.uuid4().hex[:8]}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_supabase():
    url = (
        os.environ.get("WORKER_SUPABASE_URL")
        or os.environ.get("SUPABASE_URL")
        or ""
    ).strip()
    key = (
        os.environ.get("WORKER_SUPABASE_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    ).strip()
    if not url or not key:
        raise RuntimeError(
            "请在 assets/.env.worker 中配置 WORKER_SUPABASE_URL 和 WORKER_SUPABASE_KEY"
        )
    return create_client(url, key), url


def decrypt_field(ciphertext: str) -> str:
    if not ciphertext.startswith(ENCRYPTION_PREFIX):
        raise RuntimeError("MCP 凭证不是受支持的加密格式")
    key_hex = os.environ.get("ENCRYPTION_KEY", "").strip()
    if not key_hex or len(key_hex) != 64:
        raise RuntimeError("简历 Worker 未配置与 Web 应用一致的 ENCRYPTION_KEY")
    try:
        key = bytes.fromhex(key_hex)
        iv_b64, encrypted_b64, tag_b64 = ciphertext[len(ENCRYPTION_PREFIX):].split(":")
        iv = base64.b64decode(iv_b64)
        encrypted = base64.b64decode(encrypted_b64)
        tag = base64.b64decode(tag_b64)
        return AESGCM(key).decrypt(iv, encrypted + tag, None).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise RuntimeError("MCP 凭证解密失败，请确认 Worker 与网站使用同一加密密钥") from error


def update_task(supabase, task_id: str, updates: dict[str, Any]) -> None:
    updates["updated_at"] = now_iso()
    result = (
        supabase.table("resume_batch_tasks")
        .update(updates)
        .eq("id", task_id)
        .execute()
    )
    if not result.data:
        raise RuntimeError("任务状态更新失败")


def recover_stuck_tasks(supabase) -> None:
    current = now_iso()
    result = (
        supabase.table("resume_batch_tasks")
        .update({
            "status": "pending",
            "worker_id": None,
            "lease_until": None,
            "error_message": "前一个 Worker 租约过期，任务已重新入队",
            "updated_at": current,
        })
        .eq("status", "running")
        .lt("lease_until", current)
        .execute()
    )
    if result.data:
        print(f"♻️ 已恢复 {len(result.data)} 个超时任务", flush=True)


def claim_task(supabase) -> dict[str, Any] | None:
    pending = (
        supabase.table("resume_batch_tasks")
        .select("*")
        .eq("status", "pending")
        .order("created_at", desc=False)
        .limit(1)
        .execute()
    )
    if not pending.data:
        return None
    task_id = pending.data[0]["id"]
    current = now_iso()
    lease_until = (
        datetime.now(timezone.utc) + timedelta(minutes=LEASE_MINUTES)
    ).isoformat()
    claimed = (
        supabase.table("resume_batch_tasks")
        .update({
            "status": "running",
            "worker_id": WORKER_ID,
            "lease_until": lease_until,
            "started_at": current,
            "error_message": None,
            "updated_at": current,
        })
        .eq("id", task_id)
        .eq("status", "pending")
        .execute()
    )
    if not claimed.data or claimed.data[0].get("worker_id") != WORKER_ID:
        return None
    return claimed.data[0]


def safe_pdf_name(name: str, index: int) -> str:
    filename = Path(name.replace("\\", "/")).name.strip()
    if not filename.lower().endswith(".pdf"):
        raise RuntimeError(f"任务文件不是 PDF：{filename or index}")
    if not filename:
        return f"candidate-{index}.pdf"
    return filename


def write_mcporter_config(task_dir: Path, mcp_url: str) -> None:
    config_dir = task_dir / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "mcpServers": {
            MCP_SERVER_NAME: {
                "baseUrl": mcp_url,
            }
        }
    }
    (config_dir / "mcporter.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def task_storage_paths(task: dict[str, Any]) -> list[str]:
    files = task.get("files")
    if not isinstance(files, list):
        return []
    return [
        str(record.get("storage_path"))
        for record in files
        if isinstance(record, dict) and record.get("storage_path")
    ]


def detect_credential(
    supabase,
    task: dict[str, Any],
    task_dir: Path,
    log,
) -> str:
    organization_id = str(task.get("organization_id") or "")
    if not organization_id:
        raise RuntimeError("任务缺少组织信息")
    result = (
        supabase.table("resume_batch_credentials")
        .select("id,name,mcp_url_encrypted")
        .eq("organization_id", organization_id)
        .order("created_at")
        .execute()
    )
    if not result.data:
        raise RuntimeError("未配置任何钉钉组织凭证，请联系管理员添加")

    sheet_url = str(task.get("sheet_url") or "")
    for credential in result.data:
        name = str(credential.get("name") or "未命名凭证")
        try:
            mcp_url = decrypt_field(str(credential.get("mcp_url_encrypted") or ""))
            write_mcporter_config(task_dir, mcp_url)
            mcp_call(MCP_SERVER_NAME, "get_all_sheets", {"nodeId": sheet_url})
            update_task(supabase, str(task["id"]), {
                "credential_id": credential["id"],
            })
            log(f"[信息] 已自动识别表格所属组织，使用凭证：{name}", force=True)
            return str(credential["id"])
        except PipelineError:
            log(f"[信息] 凭证“{name}”无法访问该表格，尝试下一个")

    raise RuntimeError(
        "所有组织凭证都无法访问该表格。请检查链接、表格编辑权限，"
        "或让管理员添加表格所属组织的 MCP 凭证"
    )


def load_task_settings(supabase, organization_id: str) -> tuple[dict[str, str], int | None, str | None]:
    result = (
        supabase.table("resume_batch_settings")
        .select(
            "llm_api_key_encrypted,llm_base_url,text_model,vision_model,workers,style_sample"
        )
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        return {}, None, None

    settings = result.data[0]
    llm_config: dict[str, str] = {}
    encrypted_key = settings.get("llm_api_key_encrypted")
    if encrypted_key:
        llm_config["api_key"] = decrypt_field(str(encrypted_key))
    for source, target in (
        ("llm_base_url", "base_url"),
        ("text_model", "text_model"),
        ("vision_model", "vision_model"),
    ):
        value = str(settings.get(source) or "").strip()
        if value:
            llm_config[target] = value
    workers_value = settings.get("workers")
    workers = int(workers_value) if isinstance(workers_value, int) else None
    style_sample = str(settings.get("style_sample") or "").strip() or None
    return llm_config, workers, style_sample


def load_organization_ai_mode(supabase, organization_id: str) -> str:
    result = (
        supabase.table("organizations")
        .select("ai_execution_mode")
        .eq("id", organization_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        return "rules_only"
    mode = str(result.data[0].get("ai_execution_mode") or "").strip().lower()
    return mode if mode in {"rules_only", "private_endpoint", "approved_cloud"} else "rules_only"


def download_task_files(supabase, task: dict[str, Any], task_dir: Path) -> list[str]:
    files = task.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("任务没有可处理的 PDF")
    storage_paths: list[str] = []
    used_names: set[str] = set()
    for index, record in enumerate(files, 1):
        if not isinstance(record, dict):
            raise RuntimeError("任务文件清单格式无效")
        storage_path = str(record.get("storage_path") or "")
        if not storage_path:
            raise RuntimeError("任务文件缺少存储路径")
        filename = safe_pdf_name(str(record.get("name") or ""), index)
        normalized = filename.casefold()
        if normalized in used_names:
            raise RuntimeError(f"任务中存在重名 PDF：{filename}")
        used_names.add(normalized)
        content = supabase.storage.from_(BUCKET).download(storage_path)
        (task_dir / filename).write_bytes(content)
        storage_paths.append(storage_path)
    return storage_paths


def remove_task_files(supabase, storage_paths: list[str]) -> None:
    if storage_paths:
        supabase.storage.from_(BUCKET).remove(storage_paths)


def process_task(supabase, task: dict[str, Any]) -> None:
    task_id = str(task["id"])
    logs = [
        line for line in task.get("logs", [])
        if isinstance(line, str)
    ]
    storage_paths = task_storage_paths(task)
    last_flush = 0.0
    log_lock = threading.Lock()

    def log(message: str, force: bool = False) -> None:
        nonlocal last_flush
        with log_lock:
            line = str(message)
            logs.append(line)
            logs[:] = logs[-500:]
            print(f"[{task_id[:8]}] {line}", flush=True)
            current = time.monotonic()
            if force or current - last_flush >= 0.5:
                update_task(supabase, task_id, {
                    "logs": logs,
                    "lease_until": (
                        datetime.now(timezone.utc) + timedelta(minutes=LEASE_MINUTES)
                    ).isoformat(),
                })
                last_flush = current

    try:
        if os.environ.get("ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS", "").lower() != "true":
            raise RuntimeError(
                "未授权发送简历内容给模型；请在 .env.local 中显式设置 "
                "ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS=true"
            )
        organization_id = str(task.get("organization_id") or "")
        if not organization_id:
            raise RuntimeError("任务缺少组织信息")
        llm_config, workers, style_sample = load_task_settings(
            supabase,
            organization_id,
        )
        tenant_ai_mode = load_organization_ai_mode(supabase, organization_id)
        effective_llm_config = resolve_llm_config(llm_config)
        require_ai_execution(
            effective_llm_config["base_url"],
            data_classification="raw_resume",
            tenant_mode=tenant_ai_mode,
        )

        with tempfile.TemporaryDirectory(
            prefix=f"resume-{task_id[:8]}-",
            dir=ASSETS_DIR,
        ) as temp_dir_name:
            task_dir = Path(temp_dir_name)
            previous_cwd = Path.cwd()
            try:
                os.chdir(task_dir)
                log("正在自动识别表格所属组织…", force=True)
                detect_credential(supabase, task, task_dir, log)
                log("正在从私有存储下载 PDF…", force=True)
                download_task_files(supabase, task, task_dir)
                log(f"已下载 {len(storage_paths)} 份 PDF，开始读取钉钉表格", force=True)
                report = run_pipeline(
                    task_dir,
                    str(task.get("sheet_url") or ""),
                    worksheet_id=task.get("worksheet_id"),
                    overwrite=bool(task.get("overwrite")),
                    dry_run=bool(task.get("dry_run")),
                    log=log,
                    llm_config=llm_config,
                    workers=workers,
                    style_sample=style_sample,
                )
            finally:
                os.chdir(previous_cwd)

        remove_task_files(supabase, storage_paths)
        storage_paths = []
        log("原始 PDF 已从私有临时存储删除", force=True)
        finished = now_iso()
        update_task(supabase, task_id, {
            "status": "done",
            "logs": logs,
            "result": report,
            "error_message": None,
            "lease_until": None,
            "finished_at": finished,
        })
    except Exception as error:
        message = str(error)
        logs.append(f"[错误] {message}")
        finished = now_iso()
        update_task(supabase, task_id, {
            "status": "error",
            "logs": logs[-500:],
            "error_message": message[:1000],
            "lease_until": None,
            "finished_at": finished,
        })
        print(f"[{task_id[:8]}] ❌ {message}", flush=True)
    finally:
        if storage_paths:
            try:
                remove_task_files(supabase, storage_paths)
                logs.append("异常结束后已删除原始 PDF")
                update_task(supabase, task_id, {"logs": logs[-500:]})
            except Exception as cleanup_error:
                logs.append(f"[安全警告] 原始 PDF 清理失败：{cleanup_error}")
                update_task(supabase, task_id, {"logs": logs[-500:]})


def main() -> None:
    parser = argparse.ArgumentParser(description="简历批处理本地 Worker")
    parser.add_argument("--once", action="store_true", help="处理一个任务后退出")
    parser.add_argument("--interval", type=int, default=5, help="轮询间隔秒数")
    args = parser.parse_args()

    supabase, url = get_supabase()
    print(f"📄 简历 Worker 启动：{WORKER_ID}", flush=True)
    print(f"   Supabase：{url}", flush=True)
    recover_stuck_tasks(supabase)

    while True:
        try:
            task = claim_task(supabase)
            if task:
                process_task(supabase, task)
                if args.once:
                    break
                continue
            recover_stuck_tasks(supabase)
        except KeyboardInterrupt:
            print("\n👋 简历 Worker 已停止", flush=True)
            break
        except Exception as error:
            print(f"❌ Worker 异常：{error}", flush=True)
            if args.once:
                raise
        if args.once:
            print("没有待处理任务", flush=True)
            break
        time.sleep(max(args.interval, 1))


if __name__ == "__main__":
    main()
