#!/usr/bin/env python3
"""
登录桥接脚本：打开浏览器让用户扫码登录，检测到 .login_done 信号文件后
优雅关闭浏览器上下文（等价于 boss.py login 的 Ctrl+C 路径），确保
Chromium 将 Cookies 数据库正常落盘。

用法:
  uv run --directory assets login_bridge.py
  用户完成登录后：创建 assets/.login_done 文件（如 `New-Item assets\.login_done`）
"""

import asyncio
import sys
from pathlib import Path

ASSETS_DIR = Path(__file__).parent
SIGNAL_FILE = ASSETS_DIR / ".login_done"

from boss import launch_browser, warmup_page  # noqa: E402


async def main():
    print("[login-bridge] 启动浏览器，请在浏览器中完成登录（扫码/验证码）。", flush=True)
    ctx, page = await launch_browser()
    await warmup_page(page)
    try:
        print("[login-bridge] 等待登录完成…（登录后请告知助手，助手将创建 .login_done 信号）", flush=True)
        while not SIGNAL_FILE.exists():
            await asyncio.sleep(2)
    finally:
        try:
            await ctx.close()
            print("[login-bridge] 浏览器已优雅关闭，登录态已保存。", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[login-bridge] 关闭浏览器时出错: {exc}", flush=True)
            return 1
    try:
        SIGNAL_FILE.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
