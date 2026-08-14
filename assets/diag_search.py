"""诊断脚本：打开 Boss 搜索页，检查候选人卡片、登录态与验证码特征。"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from boss import launch_browser, warmup_page  # noqa: E402

SEARCH_URL = (
    "https://www.zhipin.com/web/chat/search?"
    "keywords=%E7%94%B5%E6%B0%94%E5%B7%A5%E7%A8%8B%E5%B8%88&city=100010000"
)


async def main():
    ctx, page = await launch_browser()
    await warmup_page(page)
    print("[diag] 导航到搜索页…", flush=True)
    await page.goto(SEARCH_URL, wait_until="load", timeout=30000)
    await asyncio.sleep(8)
    print(f"[diag] 页面 URL: {page.url}", flush=True)
    print(f"[diag] 页面标题: {await page.title()}", flush=True)

    for fr in page.frames:
        if "frame/search" in fr.url:
            print(f"[diag] 搜索 iframe: {fr.url}", flush=True)
            for sel in ("li.geek-info-card", "li[class*='card']"):
                try:
                    n = await fr.locator(sel).count()
                except Exception:
                    n = 0
                print(f"[diag] 选择器 {sel}: {n} 个", flush=True)
            try:
                body_text = await fr.locator("body").inner_text()
                print(f"[diag] iframe body: {body_text[:300]!r}", flush=True)
            except Exception as exc:
                print(f"[diag] iframe body 读取失败: {exc}", flush=True)

    try:
        body_text = await page.locator("body").inner_text()
        print(f"[diag] 主页面 body: {body_text[:200]!r}", flush=True)
    except Exception as exc:
        print(f"[diag] 主页面 body 读取失败: {exc}", flush=True)

    captcha_selectors = [
        "iframe[src*='captcha']",
        "div[class*='captcha']",
        "img[src*='captcha']",
        "div[class*='verify']",
        "div[class*='geetest']",
        "div[class*='slider']",
    ]
    for sel in captcha_selectors:
        try:
            cnt = await page.locator(sel).count()
            if cnt > 0:
                print(f"[diag] ⚠️ 检测到验证码特征: {sel} x{cnt}", flush=True)
        except Exception:
            pass

    await ctx.close()
    print("[diag] 完成", flush=True)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
