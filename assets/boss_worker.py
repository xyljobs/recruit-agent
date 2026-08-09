#!/usr/bin/env python3
"""
历史实验性外部招聘平台 Worker（默认禁用）
========================================
轮询 Supabase 中的 boss_search_tasks 表，认领 pending 任务并执行 boss.py search。

该能力不属于 GOAI 参赛交付。默认配置下 Worker 在连接数据库前退出。

使用方式:
  cd assets
  uv run boss_worker.py            # 持续轮询模式
  uv run boss_worker.py --once     # 只处理一个任务后退出
  uv run boss_worker.py --interval 5  # 自定义轮询间隔（秒）

环境变量（从 .env.worker 读取）:
  WORKER_SUPABASE_URL    - Supabase 项目 URL
  WORKER_SUPABASE_KEY    - Supabase service role key（需写权限）
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env.worker")
except ImportError:
    pass

try:
    from supabase import create_client
except ImportError:
    print("❌ 需要安装 supabase-py: uv add supabase")
    sys.exit(1)


# ── Config ──────────────────────────────────────────────

SUPABASE_URL = os.environ.get("WORKER_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("WORKER_SUPABASE_KEY", "")
WORKER_ID = f"worker-{uuid.uuid4().hex[:8]}"
LEASE_MINUTES = 10
CONTACT_SESSION_TIMEOUT_SECONDS = 7200
ASSETS_DIR = Path(__file__).parent
RESUME_DIR = ASSETS_DIR / "简历"

try:
    load_dotenv(ASSETS_DIR.parent / ".env.local", override=False)
except NameError:
    pass


def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ 请配置 WORKER_SUPABASE_URL 和 WORKER_SUPABASE_KEY")
        print("   复制 .env.worker.example 为 .env.worker 并填入值")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Doctor check ────────────────────────────────────────

def run_doctor() -> tuple[bool, str]:
    """运行 boss.py doctor 检查环境"""
    try:
        result = subprocess.run(
            [sys.executable, "boss.py", "doctor"],
            cwd=str(ASSETS_DIR),
            capture_output=True,
            text=True,
            timeout=30,
        )
        output = result.stdout + result.stderr
        if result.returncode == 0:
            return True, "环境就绪"
        if "没找到登录态" in output or "login" in output.lower():
            return False, "需要扫码登录 Boss 直聘"
        return False, "本机运行环境检查未通过，请联系管理员"
    except Exception as e:
        return False, f"doctor 执行失败: {e}"


# ── Task claim ──────────────────────────────────────────

def claim_task(supabase) -> dict | None:
    """按创建时间认领一个 pending 任务，并用状态条件避免并发重复认领。"""
    now = datetime.now(timezone.utc).isoformat()
    lease_until = (datetime.now(timezone.utc) + timedelta(minutes=LEASE_MINUTES)).isoformat()

    pending_result = supabase.table("boss_search_tasks").select("*").eq(
        "status", "pending"
    ).order("created_at", desc=False).limit(1).execute()

    if not pending_result.data:
        return None

    task_id = pending_result.data[0]["id"]

    # 仅当任务仍为 pending 时更新；并发 Worker 最多只有一个能命中。
    result = supabase.table("boss_search_tasks").update({
        "status": "running",
        "worker_id": WORKER_ID,
        "lease_until": lease_until,
        "started_at": now,
        "updated_at": now,
    }).eq("id", task_id).eq("status", "pending").execute()

    if not result.data:
        return None

    task = result.data[0]

    # 二次确认：确保是我们认领的（防止并发竞争）
    if task.get("worker_id") != WORKER_ID:
        return None

    return task


def update_task(supabase, task_id: str, updates: dict):
    """更新任务状态"""
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    supabase.table("boss_search_tasks").update(updates).eq("id", task_id).execute()


# ── Search execution ────────────────────────────────────

def run_search(keywords: list) -> tuple[int, str, str]:
    """
    执行 boss.py search，返回 (exit_code, stdout, stderr)
    """
    args = [sys.executable, "boss.py", "search"]
    for kw in keywords:
        args.append(kw["keyword"])
        args.append(str(kw["count"]))

    print(f"  执行: {' '.join(args)}")
    result = subprocess.run(
        args,
        cwd=str(ASSETS_DIR),
        capture_output=True,
        text=True,
        timeout=600,  # 10 分钟超时
    )
    return result.returncode, result.stdout, result.stderr


def parse_batch_result(stdout: str) -> dict | None:
    """从输出中解析最后一段 BATCH_RESULT_JSON（即多关键词统一结果）。"""
    marker_start = "===BATCH_RESULT_JSON==="
    marker_end = "===BATCH_RESULT_END==="
    idx_start = stdout.rfind(marker_start)
    if idx_start == -1:
        return None
    idx_end = stdout.find(marker_end, idx_start)
    if idx_end == -1:
        # 尝试取到末尾
        json_text = stdout[idx_start + len(marker_start):]
    else:
        json_text = stdout[idx_start + len(marker_start):idx_end]

    json_text = json_text.strip()
    if not json_text:
        return None

    try:
        return json.loads(json_text)
    except json.JSONDecodeError:
        return None


def result_task_dir_name(batch_result: dict | None) -> str | None:
    """从统一结果中取得本次任务目录，避免误读其他任务的最新目录。"""
    if not isinstance(batch_result, dict):
        return None
    task_dir = batch_result.get("task_dir")
    if not isinstance(task_dir, str) or not task_dir.strip():
        return None
    return Path(task_dir).name


def search_error_message(batch_result: dict | None, stderr: str, exit_code: int) -> str:
    """优先返回搜索器给出的业务错误，而不是只有退出码。"""
    if isinstance(batch_result, dict):
        error = batch_result.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()[:500]
    if stderr.strip():
        return stderr.strip()[-500:]
    return f"搜索失败，退出码: {exit_code}"


def find_latest_task_dir() -> str | None:
    """找到最新的任务目录名"""
    if not RESUME_DIR.exists():
        return None
    entries = sorted(RESUME_DIR.iterdir(), reverse=True)
    for entry in entries:
        if entry.is_dir() and (entry / "manifest.json").exists():
            return entry.name
    return None


def read_manifest(task_dir_name: str) -> dict | None:
    """读取 manifest.json"""
    manifest_path = RESUME_DIR / task_dir_name / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Report generation ───────────────────────────────────

def generate_candidate_report(task: dict) -> tuple[bool, dict | None, str]:
    """按 candidate-analysis 0.2.0 规范生成六维 HTML 评估报告。"""
    task_dir_name = task.get("task_dir")
    if not task_dir_name:
        return False, None, "任务没有本地结果目录"

    task_dir = RESUME_DIR / task_dir_name
    manifest_path = task_dir / "manifest.json"
    if not manifest_path.exists():
        return False, None, "找不到任务结果"

    context_path = task_dir / "task_context.json"
    context_path.write_text(json.dumps({
        "task_id": task.get("id"),
        "jd_content": task.get("jd_content") or "",
        "keywords": task.get("keywords") or [],
        "expected_count": task.get("expected_count") or 0,
        "created_at": task.get("created_at"),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        result = subprocess.run(
            [sys.executable, "candidate_report.py", str(task_dir), str(context_path)],
            cwd=str(ASSETS_DIR),
            capture_output=True,
            text=True,
            timeout=1800,
        )
    except subprocess.TimeoutExpired:
        return False, None, "候选人评估超时"
    except Exception as error:
        return False, None, f"候选人评估启动失败: {error}"

    if result.returncode != 0:
        message = (result.stderr or result.stdout or "技能报告生成失败").strip()
        return False, None, message[-500:]

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as error:
        return False, None, f"技能报告已生成，但结果清单读取失败: {error}"
    return True, manifest, ""


def report_excluded_count(manifest: dict | None, fallback: int = 0) -> int:
    if not isinstance(manifest, dict):
        return fallback
    coverage = manifest.get("report_coverage")
    if not isinstance(coverage, dict):
        return fallback
    value = coverage.get("excluded_candidates")
    return value if isinstance(value, int) and value >= 0 else fallback


# ── Report handling ─────────────────────────────────────

def handle_report_request(supabase, task: dict):
    """如果任务请求了报告，生成网页可访问的技能报告。"""
    if not task.get("report_requested"):
        return

    report_status = task.get("report_status")
    if report_status in ("opened", "opening"):
        return  # 已经在处理

    task_dir = task.get("task_dir")
    if not task_dir:
        return

    update_task(supabase, task["id"], {"report_status": "generating"})
    success, manifest, error = generate_candidate_report(task)
    if success:
        update_task(supabase, task["id"], {
            "report_status": "generated",
            "invalid_count": report_excluded_count(manifest, task.get("invalid_count") or 0),
            "manifest": manifest,
        })
        print(f"  ✓ 技能报告已生成: {task_dir}")
    else:
        update_task(supabase, task["id"], {
            "report_status": "error",
            "error_message": error,
        })


# ── Main worker loop ────────────────────────────────────

def process_task(supabase, task: dict) -> bool:
    """
    处理单个任务，返回是否成功。
    """
    task_id = task["id"]
    keywords = task.get("keywords", [])
    print(f"\n{'='*60}")
    print(f"📋 任务 {task_id}")
    print(f"   关键词: {keywords}")

    # 1. 环境检查
    ok, msg = run_doctor()
    if not ok:
        if "login" in msg.lower():
            update_task(supabase, task_id, {
                "status": "login_required",
                "error_message": "需要在本机重新扫码登录 Boss 直聘",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  ⚠️ {msg}")
        else:
            update_task(supabase, task_id, {
                "status": "error",
                "error_message": msg,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  ❌ {msg}")
        return False

    print(f"  ✓ 环境就绪")

    # 2. 执行搜索
    exit_code, stdout, stderr = run_search(keywords)
    batch_result = parse_batch_result(stdout)
    result_dir_name = result_task_dir_name(batch_result)
    task_dir_name = result_dir_name or (find_latest_task_dir() if exit_code == 0 else None)
    manifest = read_manifest(task_dir_name) if task_dir_name else None

    if exit_code != 0:
        # 检查是否登录过期
        combined = stdout + stderr
        if "login_expired" in combined:
            update_task(supabase, task_id, {
                "status": "login_required",
                "error_message": "Boss 直聘登录已过期，需要重新扫码登录",
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  ⚠️ 登录过期")
        else:
            update_task(supabase, task_id, {
                "status": "error",
                "task_dir": task_dir_name,
                "manifest": batch_result or manifest,
                "error_message": search_error_message(batch_result, stderr, exit_code),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  ❌ 搜索失败 (exit={exit_code})")
        return False

    # 3. 解析结果
    # 从 manifest 或 batch_result 提取统计
    candidates = []
    total = 0
    invalid = 0

    source = batch_result or manifest
    if source:
        if isinstance(source, dict):
            candidates = source.get("candidates", [])
            total = source.get("total_candidates", len(candidates))
            invalid = source.get("failed", 0)
            # 如果 manifest 中有 succeeded/failed
            if "succeeded" in source:
                invalid = source.get("failed", 0)
        elif isinstance(source, list):
            candidates = source
            total = len(candidates)
            invalid = sum(1 for c in candidates if c.get("status") not in ("ok", "done"))

    # 统计无效数
    if not invalid:
        invalid = sum(1 for c in candidates if c.get("status") not in ("ok", "done"))

    valid_candidates = [
        candidate for candidate in candidates
        if candidate.get("status") in ("ok", "done")
    ]
    if not valid_candidates:
        update_task(supabase, task_id, {
            "status": "error",
            "task_dir": task_dir_name,
            "total_candidates": 0,
            "invalid_count": invalid,
            "manifest": source,
            "error_message": search_error_message(source, stderr, 2),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        })
        print("  ❌ 搜索未返回有效候选人")
        return False

    total = len(valid_candidates)

    # 4. 生成 candidate-analysis 技能报告
    task_for_report = {
        **task,
        "task_dir": task_dir_name,
    }
    update_task(supabase, task_id, {
        "report_status": "generating",
        "lease_until": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
    })
    report_ok, report_manifest, report_error = generate_candidate_report(task_for_report)
    final_manifest = report_manifest or source
    invalid = report_excluded_count(report_manifest, invalid)

    # 5. 更新任务为完成
    update_task(supabase, task_id, {
        "status": "done",
        "task_dir": task_dir_name,
        "total_candidates": total,
        "invalid_count": invalid,
        "manifest": final_manifest,
        "report_status": "generated" if report_ok else "error",
        "result_summary": {
            "total": total,
            "valid": total,
            "invalid": invalid,
            "keywords": keywords,
            "report_error": report_error or None,
        },
        "finished_at": datetime.now(timezone.utc).isoformat(),
    })

    report_note = "技能报告已生成" if report_ok else f"报告待处理: {report_error}"
    print(f"  ✓ 完成: {total} 候选人, {invalid} 失败, {report_note}, 目录: {task_dir_name}")
    return True


def check_report_requests(supabase):
    """检查已完成的任务是否有报告请求"""
    result = supabase.table("boss_search_tasks").select("*").eq(
        "report_requested", True
    ).eq("report_status", "requested").eq("status", "done").execute()

    for task in (result.data or []):
        print(f"\n📄 处理报告请求: {task['id']}")
        handle_report_request(supabase, task)


def _contact_candidate(task: dict, candidate_index: int) -> dict | None:
    manifest = task.get("manifest")
    if not isinstance(manifest, dict):
        return None
    candidates = manifest.get("candidates")
    if not isinstance(candidates, list):
        return None
    for position, candidate in enumerate(candidates, 1):
        if not isinstance(candidate, dict):
            continue
        index = candidate.get("global_index") or position
        if index == candidate_index and candidate.get("status") in ("ok", "done"):
            return candidate
    return None


def _contact_output_dir(task: dict, candidate: dict) -> tuple[Path, int]:
    task_dir = task.get("task_dir")
    keyword_dir = candidate.get("keyword_dir")
    candidate_index = candidate.get("index")
    if (
        not isinstance(task_dir, str)
        or Path(task_dir).name != task_dir
        or not isinstance(keyword_dir, str)
        or Path(keyword_dir).name != keyword_dir
        or not isinstance(candidate_index, int)
        or candidate_index < 1
    ):
        raise RuntimeError("候选人Boss定位信息不完整")

    resume_root = RESUME_DIR.resolve()
    output_dir = (resume_root / task_dir / keyword_dir).resolve()
    if not output_dir.is_relative_to(resume_root) or not output_dir.is_dir():
        raise RuntimeError("候选人本地结果目录不存在")
    return output_dir, candidate_index


def _stop_contact_process(process: subprocess.Popen | None):
    if process is None or process.poll() is not None:
        return
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def handle_contact_request(supabase, contact_request: dict):
    """独占浏览器资料目录，在Mac桌面打开候选人并等待用户关闭窗口。"""
    request_id = contact_request["id"]
    task_id = contact_request["task_id"]
    candidate_index = contact_request["candidate_index"]
    process = None
    now = datetime.now(timezone.utc).isoformat()
    claimed = supabase.table("boss_contact_requests").update({
        "status": "opening",
        "error_message": None,
        "updated_at": now,
    }).eq("id", request_id).eq("status", "requested").execute()
    if not claimed.data:
        return

    try:
        task_result = supabase.table("boss_search_tasks").select("*").eq(
            "id", task_id
        ).single().execute()
        task = task_result.data
        if not task or task.get("status") != "done":
            raise RuntimeError("搜索任务尚未完成")
        candidate = _contact_candidate(task, candidate_index)
        if not candidate:
            raise RuntimeError("候选人不存在或采集未完成")
        output_dir, local_index = _contact_output_dir(task, candidate)

        print(f"\n💬 打开联系窗口: task={task_id} candidate={candidate_index}")
        process = subprocess.Popen(
            [sys.executable, "boss.py", "open", str(output_dir), str(local_index)],
            cwd=str(ASSETS_DIR),
        )
        time.sleep(8)
        return_code = process.poll()
        if return_code is not None:
            raise RuntimeError(f"Boss候选人窗口启动失败，退出码: {return_code}")

        update_time = datetime.now(timezone.utc).isoformat()
        supabase.table("boss_contact_requests").update({
            "status": "opened",
            "opened_at": update_time,
            "updated_at": update_time,
        }).eq("id", request_id).execute()
        print("  ✓ 候选人已在Mac mini的Boss窗口打开，等待用户关闭窗口")

        try:
            return_code = process.wait(timeout=CONTACT_SESSION_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            _stop_contact_process(process)
            return_code = 0

        finished_at = datetime.now(timezone.utc).isoformat()
        if return_code == 0:
            supabase.table("boss_contact_requests").update({
                "status": "closed",
                "closed_at": finished_at,
                "updated_at": finished_at,
            }).eq("id", request_id).execute()
            print("  ✓ Boss联系窗口已关闭")
        else:
            raise RuntimeError(f"Boss联系窗口异常退出，退出码: {return_code}")
    except KeyboardInterrupt:
        _stop_contact_process(process)
        finished_at = datetime.now(timezone.utc).isoformat()
        supabase.table("boss_contact_requests").update({
            "status": "closed",
            "closed_at": finished_at,
            "updated_at": finished_at,
        }).eq("id", request_id).execute()
        raise
    except Exception as error:
        _stop_contact_process(process)
        finished_at = datetime.now(timezone.utc).isoformat()
        supabase.table("boss_contact_requests").update({
            "status": "error",
            "error_message": str(error)[:500],
            "closed_at": finished_at,
            "updated_at": finished_at,
        }).eq("id", request_id).execute()
        print(f"  ❌ 联系候选人失败: {error}")


def check_contact_requests(supabase) -> bool:
    result = supabase.table("boss_contact_requests").select("*").eq(
        "status", "requested"
    ).order("created_at", desc=False).limit(1).execute()
    if not result.data:
        return False
    handle_contact_request(supabase, result.data[0])
    return True


def recover_interrupted_contact_requests(supabase):
    now = datetime.now(timezone.utc).isoformat()
    result = supabase.table("boss_contact_requests").update({
        "status": "error",
        "error_message": "Worker重启导致联系会话中断，请重新打开",
        "closed_at": now,
        "updated_at": now,
    }).in_("status", ["opening", "opened"]).execute()
    if result.data:
        print(f"  ♻️ 标记了 {len(result.data)} 个中断的联系会话")


def recover_stuck_tasks(supabase):
    """恢复租约过期的任务"""
    now = datetime.now(timezone.utc).isoformat()
    result = supabase.table("boss_search_tasks").update({
        "status": "pending",
        "worker_id": None,
        "lease_until": None,
        "error_message": "前一个 Worker 超时，任务已自动恢复",
    }).eq("status", "running").lt("lease_until", now).execute()

    if result.data:
        print(f"  ♻️ 恢复了 {len(result.data)} 个超时任务")


def main():
    parser = argparse.ArgumentParser(description="Boss 搜索本地 Worker")
    parser.add_argument("--once", action="store_true", help="只处理一个任务后退出")
    parser.add_argument("--interval", type=int, default=5, help="轮询间隔（秒）")
    parser.add_argument("--report-task", help="为指定的已完成任务重新生成技能报告")
    args = parser.parse_args()

    if os.environ.get("ENABLE_BOSS_SEARCH", "").strip().lower() != "true":
        print(
            "[disabled] 外部平台浏览器自动化默认关闭。"
            "仅在取得目标平台书面授权并完成法律审查后，才可设置 ENABLE_BOSS_SEARCH=true。"
        )
        return 2

    print(f"🤖 Boss Worker 启动 (ID: {WORKER_ID})")
    print(f"   Supabase: {SUPABASE_URL[:30]}..." if SUPABASE_URL else "   ⚠️ 未配置 Supabase")

    supabase = get_supabase()

    if args.report_task:
        result = supabase.table("boss_search_tasks").select("*").eq(
            "id", args.report_task
        ).single().execute()
        task = result.data
        if not task:
            print("❌ 任务不存在")
            return
        update_task(supabase, task["id"], {"report_status": "generating"})
        ok, manifest, error = generate_candidate_report(task)
        update_task(supabase, task["id"], {
            "report_status": "generated" if ok else "error",
            "invalid_count": report_excluded_count(manifest, task.get("invalid_count") or 0),
            "manifest": manifest or task.get("manifest"),
            "error_message": None if ok else error,
        })
        print("✅ 技能报告已重新生成" if ok else f"❌ {error}")
        return 0

    # 启动时恢复超时任务
    recover_stuck_tasks(supabase)
    recover_interrupted_contact_requests(supabase)

    while True:
        try:
            # 联系请求独占Boss浏览器资料目录，处理期间暂停新搜索
            if check_contact_requests(supabase):
                continue

            # 检查报告请求
            check_report_requests(supabase)

            # 认领任务
            task = claim_task(supabase)

            if task:
                process_task(supabase, task)
                if args.once:
                    print("\n✅ --once 模式：任务处理完毕，退出。")
                    break
                # 处理完立即检查下一个
                continue
            else:
                # 恢复超时任务
                recover_stuck_tasks(supabase)

        except KeyboardInterrupt:
            print("\n\n👋 Worker 已停止。")
            break
        except Exception as e:
            print(f"\n❌ Worker 异常: {e}")
            import traceback
            traceback.print_exc()

        if args.once:
            print("\nℹ️ 无待处理任务，--once 模式退出。")
            break

        time.sleep(args.interval)

    print("Worker 退出。")


if __name__ == "__main__":
    sys.exit(main() or 0)
