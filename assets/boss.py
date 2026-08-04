#!/usr/bin/env python3
"""Boss 直聘候选人简历爬取工具 — 单文件,五个命令。

用法:
    boss.py doctor                            检查环境
    boss.py login                             开浏览器让人扫码登录(一次性)
    boss.py search <关键词> [数量] [...]        搜索+爬取(支持多关键词)
    boss.py report <简历目录>                  启动 PyWebView 报告窗口(推荐)
    boss.py serve <简历目录>                   启动简历查看 HTTP 服务(旧, 保留兼容)
    boss.py open <简历目录> <序号> [序号...]    打开指定候选人简历
    boss.py hydrate <简历目录> [序号...]         为旧任务补采结构化简历文本

示例:
    boss.py search Java开发 5
    boss.py search "上海 Java高级开发" 8 "上海 微服务架构师" 5
    boss.py search "Java开发" 5 "微服务架构师" 3 "后端开发" 5
    boss.py report 简历/2026-06-09_194500            # 推荐：PyWebView 桌面窗口
    boss.py serve  简历/2026-06-09_194500            # 兼容：HTTP 服务（旧）
    boss.py open   简历/2026-06-09_194500 1 3 5

提示:
    关键词第一个 token 若命中城市表(如"上海"/"北京")会自动作为 city 参数,
    避免被左侧"地区"过滤器的历史选择干扰。

    report 与 serve 的区别:
    - report：弹出本地桌面窗口加载报告 HTML，按钮直接调 cloakbrowser，
              无端口、无 HTTP，关窗即退出。推荐用法。
    - serve： 起 127.0.0.1:9876 HTTP 服务，用系统浏览器打开。
              旧模式，保留兼容。
"""
from __future__ import annotations

import asyncio
import json
import math
import platform
import random
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

# ============================================================
# 常量
# ============================================================

USER_DATA_DIR = Path.home() / ".cloakbrowser_recruiter_data"
LANDING = "https://www.zhipin.com/web/chat/index"

# serve / open 模式建立"搜索结果列表"上下文用的 URL。
# 必须显式带 city=100010000（全国），强制覆盖 boss 左侧 dropdown 的会话残留，
# 否则可能被默认地区（如武汉/前端）过滤导致列表 0 卡片，整个查看简历功能就废了。
BASE_SEARCH_URL = "https://www.zhipin.com/web/chat/search?keywords=Java&city=100010000"

MAX_CONSECUTIVE_WEAK = 3
PER_CANDIDATE_TIMEOUT_S = 90

SERVE_PORT = 9876
SERVE_IDLE_TIMEOUT = 7200  # 2 小时无请求自动退出
OPEN_IDLE_TIMEOUT = 7200  # 联系窗口最多保留 2 小时

SPOOFED_SCREEN_W = 1440
SPOOFED_SCREEN_AVAIL_H = 805

# ============================================================
# 内嵌 JS — canvas 指纹 hook + 鼠标红点 overlay
# ============================================================

CANVAS_HOOK_JS = r"""
(() => {
  if (window.__canvasHookInstalled) return;
  window.__canvasHookInstalled = true;
  window.__canvasTexts = [];
  window.__canvasHookCounter = 0;
  function _ensureCanvasId(canvas) {
    if (!canvas.__hookId) { window.__canvasHookCounter++; canvas.__hookId = '_c' + window.__canvasHookCounter; }
    return canvas.__hookId;
  }
  function _record(ctx, text, x, y, isStroke) {
    try {
      if (typeof text !== 'string') text = String(text);
      if (!text || !text.trim()) return;
      const canvas = ctx.canvas, cid = _ensureCanvasId(canvas);
      let absTop = 0, absLeft = 0;
      try { const r = canvas.getBoundingClientRect(); absTop = r.top; absLeft = r.left; } catch (_) {}
      window.__canvasTexts.push({ canvasId: cid, text, x, y, absX: absLeft + x, absY: absTop + y, font: ctx.font || '', ts: Date.now(), stroke: !!isStroke });
    } catch (_) {}
  }
  const proto = CanvasRenderingContext2D.prototype;
  const origFill = proto.fillText;
  proto.fillText = function(t, x, y, mw) { _record(this, t, x, y, false); return mw !== undefined ? origFill.call(this, t, x, y, mw) : origFill.call(this, t, x, y); };
  const origStroke = proto.strokeText;
  proto.strokeText = function(t, x, y, mw) { _record(this, t, x, y, true); return mw !== undefined ? origStroke.call(this, t, x, y, mw) : origStroke.call(this, t, x, y); };
  window.__getCanvasTextsRaw = () => (window.__canvasTexts || []).slice();
  window.__getCanvasTextsAsText = function(tol) {
    if (typeof tol !== 'number') tol = 8;
    const items = (window.__canvasTexts || []).slice();
    if (!items.length) return '';
    const groups = {};
    for (const it of items) (groups[it.canvasId] = groups[it.canvasId] || []).push(it);
    const order = Object.keys(groups).sort((a, b) => (groups[a][0].absY || 0) - (groups[b][0].absY || 0));
    const secs = [];
    for (const cid of order) {
      const arr = groups[cid].slice().sort((a, b) => a.y - b.y || a.x - b.x);
      const lines = []; let row = [], cy = null;
      for (const it of arr) {
        if (cy === null || Math.abs(it.y - cy) <= tol) { row.push(it); cy = cy === null ? it.y : cy; }
        else { row.sort((a, b) => a.x - b.x); lines.push(row.map(x => x.text).join('')); row = [it]; cy = it.y; }
      }
      if (row.length) { row.sort((a, b) => a.x - b.x); lines.push(row.map(x => x.text).join('')); }
      secs.push(lines.join('\n'));
    }
    return secs.join('\n\n---\n\n');
  };
  window.__clearCanvasTexts = () => { window.__canvasTexts = []; window.__canvasHookCounter = 0; };
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (_) {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] }); } catch (_) {}
  try { if (window.chrome && typeof window.chrome === 'object' && !window.chrome.runtime) Object.defineProperty(window.chrome, 'runtime', { get: () => ({ id: undefined }) }); } catch (_) {}
  try {
    const oq = navigator.permissions && navigator.permissions.query;
    if (oq) navigator.permissions.query = (p) => p && p.name === 'notifications' ? Promise.resolve({ state: Notification.permission, onchange: null }) : oq.call(navigator.permissions, p);
  } catch (_) {}
})();
"""

CURSOR_OVERLAY_JS = r"""
(() => {
  const NS = '__cb_cursor_';
  const VERSION = 4;
  if (window.__cb_cursor_version === VERSION) return;
  try { const r0 = document.documentElement; if (r0) r0.querySelectorAll('#'+NS+'dot, #'+NS+'hud, style[data-cb-cursor]').forEach(el => el.remove()); } catch (_) {}
  window.__cb_cursor_version = VERSION;
  const isTop = (window === window.top);
  if (!isTop) {
    function ownOffset() { try { const fe = window.frameElement; if (fe) { const r = fe.getBoundingClientRect(); return {x:r.x,y:r.y}; } } catch(_){} return {x:0,y:0}; }
    function send(t, x, y, dY) { const o = ownOffset(); try { parent.postMessage({__cb:'cursor',t,x:x+o.x,y:y+o.y,deltaY:dY||0},'*'); } catch(_){} }
    document.addEventListener('mousemove', e => send('move',e.clientX,e.clientY), true);
    document.addEventListener('mousedown', e => send('down',e.clientX,e.clientY), true);
    document.addEventListener('mouseup', e => send('up',e.clientX,e.clientY), true);
    document.addEventListener('wheel', e => send('wheel',e.clientX,e.clientY,e.deltaY), {capture:true,passive:true});
    window.addEventListener('message', msg => { if (!msg||!msg.data||msg.data.__cb!=='cursor') return; const o=ownOffset(); try { parent.postMessage({__cb:'cursor',t:msg.data.t,x:msg.data.x+o.x,y:msg.data.y+o.y,deltaY:msg.data.deltaY||0},'*'); } catch(_){} });
    return;
  }
  const dot = document.createElement('div'); dot.id = NS+'dot';
  dot.style.cssText = 'position:fixed;width:16px;height:16px;left:-100px;top:-100px;background:#ff2a2a;border:2px solid #fff;border-radius:50%;pointer-events:none;z-index:2147483647;box-shadow:0 0 10px rgba(255,42,42,0.7);transition:transform 60ms ease-out,background-color 80ms;will-change:left,top';
  const hud = document.createElement('div'); hud.id = NS+'hud';
  hud.style.cssText = 'position:fixed;right:12px;bottom:12px;background:rgba(0,0,0,0.78);color:#0f0;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:4px 10px;border-radius:4px;pointer-events:none;z-index:2147483647;min-width:200px;text-align:right;border:1px solid #0f0;white-space:pre';
  hud.textContent = 'cursor: (?, ?)\nifmsg: 0'; let ifC = 0, lastF = '';
  const sty = document.createElement('style'); sty.setAttribute('data-cb-cursor','1');
  sty.textContent = '@keyframes '+NS+'fade{from{opacity:0.55;transform:scale(1)}to{opacity:0;transform:scale(0.3)}}';
  function attach() { const r = document.documentElement; if (!r) return false; r.appendChild(sty); r.appendChild(dot); r.appendChild(hud); return true; }
  if (!attach()) { const mo = new MutationObserver(() => { if (attach()) mo.disconnect(); }); mo.observe(document, {childList:true,subtree:true}); }
  let tc = 0;
  function trail(x,y) { if ((tc++%3)!==0) return; const t=document.createElement('div'); t.style.cssText='position:fixed;left:'+(x-3)+'px;top:'+(y-3)+'px;width:6px;height:6px;background:rgba(255,42,42,0.55);border-radius:50%;pointer-events:none;z-index:2147483646;animation:'+NS+'fade 700ms linear forwards'; document.documentElement.appendChild(t); setTimeout(()=>t.remove(),750); }
  function mv(x,y,f) { dot.style.left=(x-8)+'px'; dot.style.top=(y-8)+'px'; if(f)lastF=f; hud.textContent='cursor: ('+~~x+', '+~~y+') ['+(lastF||'main')+']\nifmsg: '+ifC; trail(x,y); }
  function dn() { dot.style.background='#ffeb00'; dot.style.transform='scale(1.7)'; dot.style.boxShadow='0 0 16px rgba(255,235,0,0.9)'; }
  function up() { dot.style.background='#ff2a2a'; dot.style.transform='scale(1)'; dot.style.boxShadow='0 0 10px rgba(255,42,42,0.7)'; }
  document.addEventListener('mousemove', e => mv(e.clientX,e.clientY,'main'), true);
  document.addEventListener('mousedown', dn, true); document.addEventListener('mouseup', up, true);
  document.addEventListener('wheel', e => { hud.textContent='cursor: ('+~~e.clientX+', '+~~e.clientY+') [main] D'+(e.deltaY>0?'v':'^')+Math.abs(~~e.deltaY)+'\nifmsg: '+ifC; }, {capture:true,passive:true});
  window.addEventListener('message', msg => { if(!msg||!msg.data||msg.data.__cb!=='cursor') return; ifC++; const d=msg.data; if(d.t==='move')mv(d.x,d.y,'if'); else if(d.t==='down')dn(); else if(d.t==='up')up(); });
  window.__cb_cursor_set = (x,y) => mv(x,y,'cdp'); window.__cb_cursor_down = dn; window.__cb_cursor_up = up;
})();
"""

# ============================================================
# 工具函数
# ============================================================

def _now_iso():
    return datetime.now().isoformat(timespec="seconds")


def write_manifest(root_dir, data):
    try:
        (Path(root_dir) / "manifest.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"  ⚠️ 写 manifest 失败: {e}")


def _page_url_safe(page) -> str:
    try:
        return page.url or ""
    except Exception:
        return ""


def safe_path_segment(value, fallback="unknown", max_len=80):
    """Return a filesystem-safe path segment for Windows/macOS/Linux."""
    text = str(value or fallback).strip().replace(" ", "")
    invalid = '<>:"/\\|?*'
    cleaned = "".join("_" if ch in invalid or ord(ch) < 32 else ch for ch in text)
    cleaned = cleaned.strip(" .")
    if not cleaned:
        cleaned = fallback
    stem = cleaned.split(".", 1)[0].upper()
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    if stem in reserved:
        cleaned = f"_{cleaned}"
    return cleaned[:max_len]


def make_output_dir(keyword):
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    safe_kw = safe_path_segment(keyword.replace(" ", "_"), "keyword", 30)
    root = Path.cwd() / "简历" / f"{ts}_{safe_kw}"
    root.mkdir(parents=True, exist_ok=True)
    return root


def make_task_dir():
    """创建任务级目录（多关键词共用）。"""
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    root = Path.cwd() / "简历" / ts
    root.mkdir(parents=True, exist_ok=True)
    return root


def _parse_search_args(args):
    args = list(args)
    count = None
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-n", "--count") and i + 1 < len(args) and args[i + 1].isdigit():
            count = int(args[i + 1]); i += 2; continue
        if a.startswith("--count=") and a.split("=", 1)[1].isdigit():
            count = int(a.split("=", 1)[1]); i += 1; continue
        rest.append(a); i += 1
    if count is None and rest and rest[-1].isdigit():
        count = int(rest[-1]); rest = rest[:-1]
    if count is None:
        count = 2
    keyword = " ".join(rest).strip()
    return keyword, count


# ============================================================
# 浏览器生命周期
# ============================================================

def get_screen_size() -> tuple[int, int]:
    try:
        out = subprocess.run(
            ["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip()
        parts = [int(x.strip()) for x in out.split(",")]
        if len(parts) == 4 and parts[2] > 100 and parts[3] > 100:
            return parts[2], parts[3]
    except Exception:
        pass
    return 1440, 900


def compute_window_size() -> tuple[int, int]:
    screen_w, screen_h = get_screen_size()
    win_w = min(SPOOFED_SCREEN_W, screen_w)
    win_h = min(SPOOFED_SCREEN_AVAIL_H, screen_h - 40)
    return win_w, win_h


def sanitize_profile_prefs() -> None:
    prefs_path = USER_DATA_DIR / "Default" / "Preferences"
    if not prefs_path.exists():
        return
    try:
        data = json.loads(prefs_path.read_text(encoding="utf-8"))
        prof = data.setdefault("profile", {})
        prof["exit_type"] = "Normal"
        prof["exited_cleanly"] = True
        prefs_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


# 只保留 boss 直聘明确的引导/弹窗特征 selector，避免误伤右上角头像/消息/通知区域。
# 不要加 [aria-label=close]、.btn-close、button:has-text('关闭') 这种通用选择器，
# 它们会反复点到登录用户头像菜单里的关闭按钮，让鼠标不停打开/关闭个人区。
POPUP_CLOSE_SELECTORS = [
    ".introduction-close",
    "[class*='introduction'] [class*='close']",
    "[class*='guide'] [class*='close']",
    "[class*='dialog'] [class*='close']",
    "button:has-text('我知道了')",
    "button:has-text('知道了')",
    "button:has-text('稍后再说')",
    "button:has-text('暂不')",
]


# 鼠标安全围栏：右上角顶部条区域是登录用户的头像/消息/通知，绝对不点。
# (top 60px 范围内 + 右侧 240px 内的元素都跳过)
def _is_in_topbar_safezone(box: dict, viewport_w: int = 1440) -> bool:
    if not box:
        return False
    y = box.get("y", 0)
    x = box.get("x", 0)
    if y < 60 and x > viewport_w - 240:
        return True
    return False


async def dismiss_popups(page, rounds=3):
    try:
        vw = await page.evaluate("() => window.innerWidth") or 1440
    except Exception:
        vw = 1440
    for _ in range(rounds):
        hit = False
        for sel in POPUP_CLOSE_SELECTORS:
            try:
                loc = page.locator(sel).first
                if not await loc.is_visible(timeout=300):
                    continue
                # 安全围栏：顶部右侧不准点（登录用户头像区域）
                box = await loc.bounding_box()
                if _is_in_topbar_safezone(box, vw):
                    continue
                print(f"  [warmup] 关弹窗: {sel}", flush=True)
                # 不用 locator.click()(viewport=None 会报错),用 JS 直接点
                await loc.evaluate("el => el.click()")
                await asyncio.sleep(0.4)
                hit = True
            except Exception:
                continue
        try:
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.3)
        except Exception:
            pass
        if not hit:
            break
        await asyncio.sleep(0.5)


async def launch_browser():
    """cloakbrowser 启动浏览器并返回 (ctx, page)。
    page 上的 mouse.move/click 已被 cloakbrowser 的 humanize patch 接管 → 自动贝塞尔+人类化。"""
    import cloakbrowser

    sanitize_profile_prefs()
    win_w, win_h = compute_window_size()
    print(f"[launch] 窗口 {win_w}x{win_h}", flush=True)

    ctx = await cloakbrowser.launch_persistent_context_async(
        user_data_dir=str(USER_DATA_DIR),
        headless=False,
        humanize=False,  # 关掉 cloakbrowser 的 patch,我们自己用同款贝塞尔算法
                         # (这样我们能控制每一步 + 同步红点,iframe 里红点才跟得上)
        locale="zh-CN",
        timezone="Asia/Shanghai",
        viewport=None,
        args=[
            "--lang=zh-CN",
            "--accept-lang=zh-CN,zh;q=0.9,en;q=0.8",
            "--window-position=0,0",
            f"--window-size={win_w},{win_h}",
            "--hide-crash-restore-bubble",
            "--test-type",
        ],
    )

    await ctx.add_init_script(CANVAS_HOOK_JS)
    await ctx.add_init_script(CURSOR_OVERLAY_JS)

    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    # 给已有 frame 注入 overlay(add_init_script 只覆盖未来新文档)
    for fr in page.frames:
        try:
            await fr.evaluate(CURSOR_OVERLAY_JS)
        except Exception:
            pass

    return ctx, page


async def warmup_page(page):
    print(f"[warmup] 导航到 {LANDING}", flush=True)
    await page.goto(LANDING, wait_until="load", timeout=30000)
    await asyncio.sleep(random.uniform(2, 3))
    await dismiss_popups(page, rounds=2)
    await asyncio.sleep(random.uniform(0.5, 1.0))
    # 补注入(新 frame 可能在弹窗关闭后才出现)
    for fr in page.frames:
        try:
            await fr.evaluate(CURSOR_OVERLAY_JS)
        except Exception:
            pass
    # 初始化 CDP 真实鼠标位置到 _LAST_XY,避免第一次 mv 时从 (0,0) 瞬移到起点
    try:
        await page.mouse.move(_LAST_XY[0], _LAST_XY[1])
        await _sync_dot(page, _LAST_XY[0], _LAST_XY[1])
    except Exception:
        pass
    await asyncio.sleep(random.uniform(0.5, 1.0))
    print(f"[warmup] 就绪  URL={_page_url_safe(page)[:60]}", flush=True)


# ============================================================
# 等待 / 健康检测
# ============================================================

async def wait_until(check, *, timeout=12.0, interval=0.4, settle=0.0):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        try:
            res = check()
            if asyncio.iscoroutine(res):
                res = await asyncio.wait_for(res, timeout=max(2.0, interval * 4))
        except Exception:
            res = None
        if res:
            if settle:
                await asyncio.sleep(settle)
            return res
        if loop.time() >= deadline:
            return None
        await asyncio.sleep(interval)


LOGIN_URL_MARKERS = (
    "login.zhipin",
    "/login",
    "/user/login",
    "/web/user/",
    "ka=bticket",
    "passport",
)


def is_logged_out_url(url: str) -> bool:
    return any(marker in (url or "").lower() for marker in LOGIN_URL_MARKERS)


async def detect_logged_out(page):
    url = _page_url_safe(page)
    return is_logged_out_url(url), url


async def find_candidate_cards(page):
    for fr in page.frames:
        if "/web/frame/search" not in fr.url:
            continue
        for sel in ("li.geek-info-card", "li[class*='card']"):
            try:
                n = await fr.locator(sel).count()
            except Exception:
                n = 0
            if n > 0:
                return fr, sel, n
        return fr, None, 0
    return None, None, 0


# ============================================================
# 搜索页交互
# ============================================================
# 鼠标:抄 cloakbrowser 的贝塞尔算法(bezier + 缓动 + wobble + 突发停顿 + 终点过冲),
# 自己实现,这样每一步都能同步红点 —— iframe 里 CDP 鼠标事件不触发原生 mousemove
# 是已知限制,只能靠 evaluate 主动同步。算法保持跟 cloakbrowser 一致以保隐身水平。
# ============================================================

_LAST_XY = [640.0, 360.0]
_DOT_SYNC_EVERY = 2  # 每 2 步同步一次红点(降低 evaluate 数量,视觉仍顺滑)


async def _sync_dot(page, x, y):
    try:
        await page.evaluate(f"window.__cb_cursor_set && window.__cb_cursor_set({x:.1f}, {y:.1f})")
    except Exception:
        pass


def _bezier(p0, p1, p2, p3, t):
    u = 1 - t
    uu, uuu = u * u, u * u * u
    tt, ttt = t * t, t * t * t
    return (uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0],
            uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1])


def _ease_in_out(t):
    if t < 0.5:
        return 4 * t * t * t
    return 1 - pow(-2 * t + 2, 3) / 2


def _control_points(sx, sy, ex, ey):
    dx, dy = ex - sx, ey - sy
    dist = math.hypot(dx, dy) or 1
    px, py = -dy / dist, dx / dist
    b1 = random.uniform(-0.3, 0.3) * dist
    b2 = random.uniform(-0.3, 0.3) * dist
    return ((sx + dx * 0.25 + px * b1, sy + dy * 0.25 + py * b1),
            (sx + dx * 0.75 + px * b2, sy + dy * 0.75 + py * b2))


async def mv(page, target_x, target_y, *, jitter=(6, 3)):
    """cloakbrowser 同款贝塞尔移动 + wobble + 突发停顿 + 终点过冲 + 每步同步红点。
    总时长大概 250-400ms,接近真人移动节奏。"""
    global _LAST_XY
    end_x = target_x + random.uniform(-jitter[0], jitter[0])
    end_y = target_y + random.uniform(-jitter[1], jitter[1])
    sx, sy = _LAST_XY
    dist = math.hypot(end_x - sx, end_y - sy)
    if dist < 1:
        _LAST_XY = [end_x, end_y]
        await _sync_dot(page, end_x, end_y)
        return end_x, end_y

    steps = max(12, min(35, round(dist / 22)))
    p0 = (sx, sy)
    p3 = (end_x, end_y)
    p1, p2 = _control_points(sx, sy, end_x, end_y)

    burst_counter = 0
    burst_size = random.randint(3, 5)

    for i in range(steps + 1):
        progress = i / steps
        t = _ease_in_out(progress)
        bx, by = _bezier(p0, p1, p2, p3, t)
        wobble = math.sin(math.pi * progress) * 1.5
        wx = bx + (random.random() - 0.5) * 2 * wobble
        wy = by + (random.random() - 0.5) * 2 * wobble

        await page.mouse.move(wx, wy)
        if i % _DOT_SYNC_EVERY == 0 or i == steps:
            await _sync_dot(page, wx, wy)

        # 每步小停一下,让移动有节奏感(总时长拉到 ~300ms)
        await asyncio.sleep(random.uniform(0.005, 0.011))

        burst_counter += 1
        if burst_counter >= burst_size and i < steps:
            await asyncio.sleep(random.uniform(0.015, 0.030))
            burst_counter = 0
            burst_size = random.randint(3, 5)

    if random.random() < 0.15:
        overshoot = random.uniform(3, 6)
        angle = math.atan2(end_y - sy, end_x - sx)
        ox = end_x + math.cos(angle) * overshoot
        oy = end_y + math.sin(angle) * overshoot
        await page.mouse.move(ox, oy)
        await _sync_dot(page, ox, oy)
        await asyncio.sleep(random.uniform(0.03, 0.07))
        fx = end_x + random.uniform(-2, 2)
        fy = end_y + random.uniform(-2, 2)
        await page.mouse.move(fx, fy)
        await _sync_dot(page, fx, fy)
        end_x, end_y = fx, fy

    _LAST_XY = [end_x, end_y]
    return end_x, end_y


async def click(page, target_x, target_y, *, jitter=(6, 3)):
    """mv 到位 + 模拟人按下/抬起的微小延迟。"""
    ex, ey = await mv(page, target_x, target_y, jitter=jitter)
    await asyncio.sleep(random.uniform(0.06, 0.16))
    await page.mouse.down()
    await asyncio.sleep(random.uniform(0.04, 0.11))
    await page.mouse.up()
    await asyncio.sleep(random.uniform(0.05, 0.15))
    return ex, ey


async def goto_search_via_sidebar(page):
    """点侧边栏的'搜索'按钮，等搜索 iframe 出现。"""
    try:
        link = page.locator("text=搜索").first
        await link.wait_for(state="visible", timeout=6000)
        box = await link.bounding_box()
        if not box:
            print("  ⚠️ '搜索'链接没量到位置")
            return False
        cx = box["x"] + box["width"] / 2
        cy = box["y"] + box["height"] / 2
        await click(page, cx, cy)

        async def _search_iframe_ready():
            for fr in page.frames:
                if "/web/frame/search" in fr.url:
                    return True
            return None
        hit = await wait_until(_search_iframe_ready, timeout=15.0, interval=0.5)
        if not hit:
            print("  ⚠️ 点了'搜索'但 iframe 没加载出来")
            return False
        # 把 cursor_overlay 强制注入新 iframe
        for fr in page.frames:
            try:
                await fr.evaluate(CURSOR_OVERLAY_JS)
            except Exception:
                pass
        await asyncio.sleep(random.uniform(0.5, 1.0))
        return True
    except Exception as e:
        print(f"  ⚠️ 点'搜索'失败: {e}")
        return False


# Boss 直聘城市编码表（按 query 接口的 city 参数）
# 100010000 = 全国（不传 city 等价于全国）
# 验证方式：在 boss 网页选某城市后看 URL 的 city= 值
CITY_CODES = {
    "全国": "100010000",
    "北京": "101010100",
    "上海": "101020100",
    "广州": "101280100",
    "深圳": "101280600",
    "杭州": "101210100",
    "南京": "101190100",
    "苏州": "101190400",
    "武汉": "101200100",
    "成都": "101270100",
    "重庆": "101040100",
    "天津": "101030100",
    "西安": "101110100",
    "长沙": "101250100",
    "青岛": "101120200",
    "厦门": "101230200",
    "合肥": "101220100",
    "济南": "101120100",
    "郑州": "101180100",
    "宁波": "101210400",
    "无锡": "101190200",
    "东莞": "101281600",
    "佛山": "101280800",
    "福州": "101230100",
    "大连": "101070200",
    "沈阳": "101070100",
    "哈尔滨": "101050100",
    "长春": "101060101",
    "昆明": "101290101",
    "南宁": "101300101",
    "贵阳": "101260101",
    "海口": "101310101",
    "石家庄": "101090101",
    "太原": "101100101",
    "兰州": "101160101",
    "南昌": "101240101",
}


def parse_keyword_to_city_query(keyword: str):
    """把 '上海 前端' 拆成 (city_name, city_code, query)。
    
    规则：
    - 关键词第一个空格之前的 token 命中 CITY_CODES → 拆出来作 city
    - 否则 city=全国，整个关键词当作 query
    """
    kw = (keyword or "").strip()
    if not kw:
        return "全国", CITY_CODES["全国"], ""
    # 支持中英文空格分隔
    tokens = kw.replace("\u3000", " ").split(" ", 1)
    head = tokens[0].strip()
    if head in CITY_CODES:
        rest = tokens[1].strip() if len(tokens) > 1 else ""
        return head, CITY_CODES[head], rest
    return "全国", CITY_CODES["全国"], kw


async def ensure_search_and_query(page, keyword):
    """直接通过 URL 参数跳转到搜索结果页，绕过左侧地区/职位下拉过滤器。
    
    Boss 直聘的搜索 iframe URL 是 /web/frame/search?query=xxx&city=xxx
    这种方式不会被会话残留的下拉选择干扰，每次都是干净状态。
    """
    city_name, city_code, query = parse_keyword_to_city_query(keyword)
    print(f"  🔎 搜索 city='{city_name}'({city_code}) query='{query}'")

    # 找到 search iframe（如果当前不在搜索页，先点侧边栏切过去）
    frame = None
    for fr in page.frames:
        if "/web/frame/search" in fr.url:
            frame = fr
            break
    if frame is None:
        print("  当前不在搜索页 → 点侧边栏'搜索'")
        if not await goto_search_via_sidebar(page):
            return False
        await asyncio.sleep(0.8)
        for fr in page.frames:
            if "/web/frame/search" in fr.url:
                frame = fr
                break
        if frame is None:
            print("  ❌ 还是没拿到搜索 iframe")
            return False

    # URL 直跳：通过主 page.goto 跳到 chat/search 带参数 URL
    # （iframe.goto 会被 boss 客户端 abort；主 page 同域 navigate 不会）
    from urllib.parse import quote
    # 主 page URL（boss 客户端外壳）
    target_page_url = f"https://www.zhipin.com/web/chat/search?keywords={quote(query)}&city={city_code}"
    print(f"  📍 跳转前 page.url={page.url[:80]}")
    print(f"  ➡️  目标 page.url={target_page_url}")
    try:
        await page.goto(target_page_url, wait_until="domcontentloaded", timeout=15000)
    except Exception as e:
        print(f"  ❌ page.goto 失败: {e}")
        return False

    # 等 search iframe 重新加载
    await asyncio.sleep(random.uniform(0.8, 1.2))
    frame = None
    for fr in page.frames:
        if "/web/frame/search" in fr.url:
            frame = fr
            break
    print(f"  📍 跳转后 frame.url={frame.url[:120] if frame else 'None'}")

    await asyncio.sleep(random.uniform(0.6, 1.0))

    async def _cards_ready():
        _fr, _sel, n = await find_candidate_cards(page)
        return n if n > 0 else None

    n = await wait_until(_cards_ready, timeout=15.0, interval=0.5) or 0
    print(f"  搜索完 URL={_page_url_safe(page)[:60]}  候选人={n}")
    return True


# ============================================================
# 简历交互
# ============================================================

FIND_CLOSE_X_JS = """
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  // 安全围栏 1：右上角 240×60 是登录用户头像/通知区域，绝对不点
  const inTopBar = (r) => r.y < 60 && r.x > vw - 240;
  // 安全围栏 2：必须在"简历模态/对话框/抽屉"容器内，排除导航/头像区域
  const inModal = (el) => {
    let p = el;
    while (p) {
      const pc = ((p.className || '') + '').toString().toLowerCase();
      if (pc.includes('header') || pc.includes('topbar') || pc.includes('nav-user')
          || pc.includes('user-info') || pc.includes('avatar')) return false;
      if (pc.includes('dialog') || pc.includes('modal') || pc.includes('drawer')
          || pc.includes('geek-detail') || pc.includes('resume')) return true;
      p = p.parentElement;
    }
    return false;
  };
  const cands = document.querySelectorAll('button, a, i, svg, span, div, [role="button"]');
  let best = null, bestScore = -1;
  for (const el of cands) {
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.width > 60 || r.height < 12 || r.height > 60) continue;
    if (r.x < vw * 0.5 || r.y > vh * 0.3) continue;
    if (inTopBar(r)) continue;       // 物理坐标围栏
    if (!inModal(el)) continue;      // DOM 容器围栏
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
    const cls = (el.className || '').toString().toLowerCase();
    const txt = (el.textContent || '').trim();
    let bonus = 0;
    if (cls.includes('close')) bonus += 0.5;
    if (txt === '×' || txt === 'x' || txt === '✕') bonus += 0.3;
    const score = (r.x / vw) + (1 - r.y / vh) + bonus;
    if (score > bestScore) { bestScore = score; best = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
  }
  return best;
}
"""


async def close_resume_modal(page):
    """关闭简历浮层。判定关闭成功 = page 级 scrollable 浮层消失。

    安全策略（三层防线，避免误点登录用户头像）:
    1. 入口早退：没模态直接 return True，不做任何点击
    2. 优先 Esc：键盘事件最安全，不会触发头像菜单
    3. X 按钮：限定在简历模态容器内，且排除右上角头像区域（FIND_CLOSE_X_JS）
    """
    async def _modal_closed():
        try:
            info = await page.evaluate(FIND_SCROLLABLE_JS)
            return info is None
        except Exception:
            return False

    # 入口早退：根本没简历模态就别瞎点
    if await _modal_closed():
        return True

    # 第 1 选择：Esc 键（最安全，绝不会误点头像）
    try:
        await page.keyboard.press("Escape")
        await asyncio.sleep(random.uniform(0.8, 1.4))
        if await _modal_closed():
            return True
    except Exception:
        pass

    # 第 2 选择：找简历模态内部的 X 按钮（受 FIND_CLOSE_X_JS 双重围栏保护）
    try:
        x_btn = await page.evaluate(FIND_CLOSE_X_JS)
        if x_btn:
            cx = x_btn["x"] + x_btn["w"] / 2
            cy = x_btn["y"] + x_btn["h"] / 2
            await click(page, cx, cy)
            await asyncio.sleep(random.uniform(0.6, 1.2))
            if await _modal_closed():
                return True
    except Exception:
        pass

    # 第 3 选择：兜底点左侧空白处触发外部点击关闭
    try:
        w = 1440
        h = 805
        await click(page, w * 0.05, h * 0.5)
        await asyncio.sleep(random.uniform(1.0, 1.8))
        if await _modal_closed():
            return True
    except Exception:
        pass
    return False


async def click_candidate_silent(page, idx):
    frame, sel, n = await find_candidate_cards(page)
    if frame is None:
        print("  ❌ 没找到 search iframe")
        return False
    if n == 0 or idx >= n:
        print(f"  ❌ 只有 {n} 张候选人,无法点 idx={idx}")
        return False
    try:
        target = frame.locator(sel).nth(idx)
        try:
            await target.scroll_into_view_if_needed(timeout=4000)
        except Exception:
            pass
        box = await wait_until(lambda: target.bounding_box(), timeout=4.0, interval=0.3)
        if not box or box["width"] < 5 or box["height"] < 5:
            return False
        fel = await frame.frame_element()
        fbox = await fel.bounding_box()
        ox = fbox["x"] if fbox else 0
        oy = fbox["y"] if fbox else 0

        def _coords(b):
            return (ox + b["x"] + b["width"] / 2, oy + b["y"] + min(40, b["height"] / 2))

        cpx, cpy = _coords(box)
        await mv(page, cpx, cpy)
        box2 = await target.bounding_box()
        if box2 and box2["width"] > 5:
            nx, ny = _coords(box2)
            if abs(nx - cpx) > 6 or abs(ny - cpy) > 6:
                print(f"  坐标校正 ({cpx:.0f},{cpy:.0f})→({nx:.0f},{ny:.0f})")
            cpx, cpy = nx, ny
        await click(page, cpx, cpy)
        await asyncio.sleep(random.uniform(1.0, 1.8))
        return True
    except Exception as e:
        print(f"  ⚠️ click_candidate: {e}")
        return False


FIND_SCROLLABLE_JS = """
() => {
  const isOverlay = (el) => {
    let n = el, hops = 0;
    while (n && hops < 8) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed') return true;
      const z = parseInt(cs.zIndex, 10);
      if (!isNaN(z) && z >= 100) return true;
      n = n.parentElement; hops++;
    }
    return false;
  };
  const all = document.querySelectorAll('*');
  let best = null, bestArea = 0;
  for (const el of all) {
    const s = getComputedStyle(el);
    const oy = s.overflowY;
    if (oy !== 'auto' && oy !== 'scroll') continue;
    if (el.scrollHeight <= el.clientHeight + 30) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 300) continue;
    const area = r.width * r.height;
    if (area > bestArea) {
      bestArea = area;
      best = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
               tag: el.tagName, class: (el.className || '').toString().slice(0, 50), overlay: isOverlay(el) };
    }
  }
  return best;
}
"""

GET_SCROLLABLE_PROGRESS_JS = """
() => {
  const all = document.querySelectorAll('*');
  let best = null, bestArea = 0;
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue;
    if (el.scrollHeight <= el.clientHeight + 30) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 300) continue;
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = {top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight}; }
  }
  return best;
}
"""

RESET_SCROLL_JS = """
() => {
  const all = document.querySelectorAll('*');
  let best = null, bestArea = 0;
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue;
    if (el.scrollHeight <= el.clientHeight + 30) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 300) continue;
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = el; }
  }
  if (best) { best.scrollTop = 0; return true; }
  return false;
}
"""

EXTRACT_RESUME_TEXT_JS = r"""
() => {
  const all = document.querySelectorAll('*');
  let best = null, bestArea = 0;
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue;
    if (el.scrollHeight <= el.clientHeight + 30) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 300) continue;
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = el; }
  }
  if (!best) return null;
  const text = (best.innerText || best.textContent || '').trim();
  return {
    text,
    lineCount: text ? text.split(/\n+/).filter(Boolean).length : 0,
    scrollHeight: best.scrollHeight,
  };
}
"""


def format_resume_source(source_payload):
    """把 Boss geek/info 响应转换成稳定、可搜索的纯文本简历。"""
    try:
        detail = source_payload["zpData"]["geekDetail"]
    except (KeyError, TypeError):
        return ""
    if not isinstance(detail, dict):
        return ""

    lines = []

    def add(value=""):
        text = str(value or "").strip()
        if text:
            lines.append(text)

    def section(title):
        if lines and lines[-1] != "":
            lines.append("")
        lines.append(title)

    base = detail.get("geekBaseInfo") or {}
    add(base.get("name"))
    basics = [
        base.get("ageDesc"),
        base.get("workYearDesc"),
        base.get("degreeCategory"),
        base.get("applyStatusContent"),
    ]
    add(" · ".join(str(value).strip() for value in basics if value))
    description = base.get("userDescription") or base.get("userDesc")
    if description:
        section("个人优势")
        add(description)

    expects = detail.get("geekExpectList") or []
    if expects:
        section("求职期望")
        for expect in expects:
            if not isinstance(expect, dict):
                continue
            add(" · ".join(str(value).strip() for value in (
                expect.get("locationName"), expect.get("positionName"),
                expect.get("industryDesc"), expect.get("salaryDesc"),
            ) if value))

    works = detail.get("geekWorkExpList") or []
    if works:
        section("工作经历")
        for work in works:
            if not isinstance(work, dict):
                continue
            dates = " - ".join(str(value).strip() for value in (
                work.get("startYearMonStr"), work.get("endYearMonStr"),
            ) if value)
            title = " · ".join(str(value).strip() for value in (
                work.get("company"), work.get("positionName"), work.get("department"),
            ) if value)
            add(" | ".join(value for value in (dates, title) if value))
            add(work.get("responsibility"))
            add(work.get("workPerformance"))

    projects = detail.get("geekProjExpList") or []
    if projects:
        section("项目经历")
        for project in projects:
            if not isinstance(project, dict):
                continue
            dates = " - ".join(str(value).strip() for value in (
                project.get("startYearMonStr") or project.get("startDate"),
                project.get("endYearMonStr") or project.get("endDate"),
            ) if value)
            title = " · ".join(str(value).strip() for value in (
                project.get("name"), project.get("roleName"),
            ) if value)
            add(" | ".join(value for value in (dates, title) if value))
            add(project.get("description"))
            add(project.get("performance"))

    education = detail.get("geekEduExpList") or []
    if education:
        section("教育经历")
        for item in education:
            if not isinstance(item, dict):
                continue
            dates = " - ".join(str(value).strip() for value in (
                item.get("startYearStr"), item.get("endYearStr"),
            ) if value)
            school = " · ".join(str(value).strip() for value in (
                item.get("school"), item.get("major"), item.get("degreeName"),
            ) if value)
            add(" | ".join(value for value in (dates, school) if value))
            add(item.get("eduDescription"))
            add(item.get("courseDesc"))

    professional_skill = detail.get("professionalSkill")
    if professional_skill:
        section("专业技能")
        add(professional_skill)

    for key, title in (
        ("geekCertificationList", "资格证书"),
        ("geekTrainingExpList", "培训经历"),
        ("geekHonorList", "荣誉奖项"),
    ):
        items = detail.get(key) or []
        if not items:
            continue
        section(title)
        for item in items:
            if isinstance(item, dict):
                add(" · ".join(str(value).strip() for value in item.values()
                               if isinstance(value, (str, int, float)) and str(value).strip()))
            else:
                add(item)

    return "\n".join(lines).strip()


def resume_source_identity(source_payload):
    """返回 Boss geek/info 响应中的候选人身份，用于防止过期链接串人。"""
    if not isinstance(source_payload, dict):
        return "", ""
    zp_data = source_payload.get("zpData") or {}
    detail = zp_data.get("geekDetail") or {}
    base_info = detail.get("geekBaseInfo") or {}
    name = str(base_info.get("name") or "").strip()
    expect_id = str(zp_data.get("expectId") or detail.get("expectId") or "").strip()
    return name, expect_id


def validate_resume_source(source_payload, expected_name=None, expected_id=None):
    """校验接口响应确实属于当前卡片；空字段不参与比较。"""
    source_name, source_id = resume_source_identity(source_payload)
    expected_name = str(expected_name or "").strip()
    expected_id = str(expected_id or "").strip()
    if expected_name and source_name and source_name != expected_name:
        return False, f"姓名不一致({expected_name} != {source_name})"
    if expected_id and source_id and source_id != expected_id:
        return False, f"expect_id 不一致({expected_id} != {source_id})"
    if not source_name and not source_id:
        return False, "响应中缺少候选人身份"
    return True, ""


async def collect_resume_text(page, save_dir, source_payload=None):
    """保存可搜索的简历文本和 Boss 原始结构化响应，截图仅作为回退。"""
    save_dir.mkdir(parents=True, exist_ok=True)
    result = {
        "resume_text_file": None,
        "resume_text_chars": 0,
        "resume_source_file": None,
    }

    try:
        extracted = await asyncio.wait_for(page.evaluate(EXTRACT_RESUME_TEXT_JS), timeout=5.0)
        text = (extracted or {}).get("text", "").strip()
        source_text = format_resume_source(source_payload)
        if len(source_text) > len(text):
            text = source_text
        if text:
            text_path = save_dir / "resume.txt"
            text_path.write_text(text, encoding="utf-8")
            result["resume_text_file"] = text_path.name
            result["resume_text_chars"] = len(text)
            print(f"     📝 结构化文本 {len(text)} 字", flush=True)
    except Exception as e:
        print(f"     [warn] 简历文本提取失败: {e}", flush=True)

    if source_payload is not None:
        try:
            source_path = save_dir / "resume_source.json"
            source_path.write_text(
                json.dumps(source_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            result["resume_source_file"] = source_path.name
            print("     💾 已保存原始结构化响应", flush=True)
        except Exception as e:
            print(f"     [warn] 原始响应保存失败: {e}", flush=True)

    return result


async def collect_resume_screenshots(page, save_dir, max_shots=15):
    """返回 (shots, opened)。opened=简历浮层是否确认打开。

    每个 Playwright 调用都加 timeout，避免 hang 住整个流程；
    每一步都打日志，hang 住时终端最后一行就能看出卡在哪。
    """
    save_dir.mkdir(parents=True, exist_ok=True)
    shots = []

    print(f"     [step] 等简历浮层出现…", flush=True)
    info = await wait_until(lambda: page.evaluate(FIND_SCROLLABLE_JS), timeout=8.0, interval=0.4)
    if not info:
        print("     ❌ 简历未打开(没找到简历浮层)", flush=True)
        return shots, False
    print(f"     [step] 浮层就绪 size={info.get('w')}x{info.get('h')}", flush=True)

    mouse_x = info['x'] + min(info['w'] * 0.4, info['w'] - 200)
    mouse_y = info['y'] + info['h'] * 0.5
    await mv(page, mouse_x, mouse_y)
    await asyncio.sleep(random.uniform(0.2, 0.45))

    try:
        await asyncio.wait_for(page.evaluate(RESET_SCROLL_JS), timeout=3.0)
    except Exception as e:
        print(f"     [warn] reset scroll: {e}", flush=True)
    await asyncio.sleep(random.uniform(0.2, 0.45))

    idx = 1
    p = save_dir / f"{idx}.png"
    try:
        print(f"     [step] 截图 1…", flush=True)
        await asyncio.wait_for(page.screenshot(path=str(p)), timeout=10.0)
        shots.append(p)
        print(f"     📸 {p.name}", flush=True)
    except asyncio.TimeoutError:
        print(f"     ⚠️ shot 1 超时(>10s) → 浏览器可能挂起", flush=True)
        return shots, True  # 浮层是开的，但截图失败
    except Exception as e:
        print(f"     ⚠️ shot 1: {e}", flush=True)

    last_top = -999
    same_count = 0
    while idx < max_shots:
        try:
            await asyncio.wait_for(page.mouse.wheel(0, random.randint(420, 820)), timeout=5.0)
        except asyncio.TimeoutError:
            print(f"     ⚠️ wheel 超时(>5s) → 退出滚动", flush=True)
            break
        except Exception:
            break
        await asyncio.sleep(random.uniform(0.3, 0.7))

        cur = None
        try:
            cur = await asyncio.wait_for(page.evaluate(GET_SCROLLABLE_PROGRESS_JS), timeout=3.0)
        except asyncio.TimeoutError:
            print(f"     ⚠️ 进度查询超时(>3s)", flush=True)
        except Exception:
            pass
        if not cur:
            cur = {"top": last_top if last_top > 0 else 0, "height": 999999, "client": 999}

        cur_top = cur["top"]
        max_top = max(0, cur["height"] - cur["client"])

        idx += 1
        p = save_dir / f"{idx}.png"
        try:
            await asyncio.wait_for(page.screenshot(path=str(p)), timeout=10.0)
            shots.append(p)
            print(f"     📸 {p.name}  scrollTop={cur_top}/{max_top}", flush=True)
        except asyncio.TimeoutError:
            print(f"     ⚠️ shot {idx} 超时(>10s) → 中断滚动", flush=True)
            break
        except Exception:
            pass

        if max_top > 0 and cur_top >= max_top - 10:
            break
        if abs(cur_top - last_top) < 5:
            same_count += 1
            if same_count >= 2:
                break
        else:
            same_count = 0
        last_top = cur_top

    return shots, True


# ============================================================
# 批量执行
# ============================================================

async def run_batch(page, keyword, count, output_dir):
    manifest = {
        "tool": "boss.py search",
        "keyword": keyword,
        "requested": count,
        "output_dir": str(output_dir),
        "started_at": _now_iso(),
        "finished_at": None,
        "status": "running",
        "succeeded": 0,
        "failed": 0,
        "candidates": [],
    }
    write_manifest(output_dir, manifest)
    print(f"\n=== search: keyword={keyword!r}  count={count}  → {output_dir} ===\n")

    def finalize(entry):
        if entry["status"] == "ok":
            manifest["succeeded"] += 1
        else:
            manifest["failed"] += 1
        manifest["candidates"].append(entry)
        write_manifest(output_dir, manifest)
        if entry["status"] == "ok":
            extra = f" — {entry['reason']}" if entry.get("reason") else ""
            print(f"[progress] {entry['index']}/{count} ✅ ok ({entry['shots']} 张){extra}")
        else:
            print(f"[progress] {entry['index']}/{count} ❌ {entry['reason']}")

    def emit_result():
        print("\n===BATCH_RESULT_JSON===")
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        print("===BATCH_RESULT_END===")

    def stop(status, msg):
        manifest["status"] = status
        manifest["last_url"] = _page_url_safe(page)
        if msg:
            manifest["error"] = f"{msg}  URL={manifest['last_url']}"
        manifest["finished_at"] = _now_iso()
        write_manifest(output_dir, manifest)
        print(f"⛔ [{status}] {msg or ''}")
        emit_result()
        return manifest

    # 初始检查
    lo, url = await detect_logged_out(page)
    if lo:
        return stop("login_expired", "登录失效(URL 命中登录页)")

    print("[init] 搜索")
    if not await ensure_search_and_query(page, keyword):
        lo, url = await detect_logged_out(page)
        if lo:
            return stop("login_expired", f"登录失效(URL={url})")
        return stop("error", "搜索跳转失败(URL 直跳未生效或 iframe 未加载)")

    _fr, _sel, ncards = await find_candidate_cards(page)
    if ncards == 0:
        lo, _ = await detect_logged_out(page)
        return stop("login_expired" if lo else "error",
                     "登录失效" if lo else "搜索后 0 候选人(无结果/被风控)")

    # 提取所有候选人卡片的 ID + 摘要,存进 manifest(后面 open 命令靠这个精确定位)
    card_meta = []
    if _fr:
        try:
            card_meta = await _fr.evaluate("""(sel) => {
                const cards = document.querySelectorAll(sel);
                return Array.from(cards).map((c, i) => {
                    const a = c.querySelector('a[data-expect]');
                    const lines = (c.innerText || '').split('\\n').map(s=>s.trim()).filter(Boolean);
                    return {
                        expect_id: a ? a.getAttribute('data-expect') : null,
                        jid: a ? a.getAttribute('data-jid') : null,
                        name: lines[0] || null,
                        summary: lines.slice(0, 4),
                    };
                });
            }""", _sel)
        except Exception:
            pass
    manifest["card_meta"] = card_meta[:count]

    def _make_cand_dir(i, meta):
        """生成候选人文件夹名:01_曹某某_1525577703(序号_名字_expectID)"""
        idx = f"{i + 1:02d}"
        name = safe_path_segment(meta.get("name") or "未知", "未知", 10)
        eid = safe_path_segment(meta.get("expect_id") or "no_id", "no_id", 64)
        return f"{idx}_{name}_{eid}"

    async def _view_one(i, cand_dir):
        # 注册请求监听，捕获 geek/info URL（含 securityId）
        captured_urls = []
        captured_sources = []
        response_tasks = []

        def _on_geek_request(request):
            if "geek/info" in request.url:
                captured_urls.append(request.url)

        def _on_geek_response(response):
            if "geek/info" not in response.url:
                return

            async def _read_response():
                try:
                    captured_sources.append(await response.json())
                except Exception:
                    pass

            response_tasks.append(asyncio.create_task(_read_response()))

        page.on("request", _on_geek_request)
        page.on("response", _on_geek_response)

        try:
            # === 关键健壮性：点卡片 + 等浮层，最多重试 3 次 ===
            # 用户经验：boss 偶尔点了没反应（页面慢了或网络抖动），
            # 不是浏览器死锁。像人一样再点一次就好了。
            opened_info = None
            for attempt in range(1, 4):
                if not await click_candidate_silent(page, i):
                    if attempt < 3:
                        print(f"     [retry {attempt}/3] 点卡片失败，等一下重试…", flush=True)
                        await asyncio.sleep(random.uniform(0.8, 1.5))
                        continue
                    return "failed", 0, "点候选人失败", None, {}

                await asyncio.sleep(random.uniform(0.6, 1.2))

                # 等简历浮层出现：最多 2 秒，每 0.2 秒查一次
                # 一旦浮层出现立刻继续，正常情况下 <1s 就退出循环
                opened_info = await wait_until(
                    lambda: page.evaluate(FIND_SCROLLABLE_JS),
                    timeout=2.0, interval=0.2
                )
                if opened_info:
                    if attempt > 1:
                        print(f"     ✓ 第 {attempt} 次点击成功", flush=True)
                    break

                # 没等到浮层——可能上次点击没生效，先按 Esc 清场再重点
                if attempt < 3:
                    print(f"     [retry {attempt}/3] 2s 没等到简历浮层，再点一次…", flush=True)
                    try:
                        await page.keyboard.press("Escape")
                    except Exception:
                        pass
                    await asyncio.sleep(random.uniform(0.5, 1.0))

            geek_url = captured_urls[-1] if captured_urls else None

            if not opened_info:
                return "failed", 0, "简历没打开(点了 3 次都没浮层)", geek_url, {}

            if response_tasks:
                try:
                    await asyncio.wait_for(asyncio.gather(*response_tasks, return_exceptions=True), timeout=5.0)
                except asyncio.TimeoutError:
                    pass

            source_payload = captured_sources[-1] if captured_sources else None
            if source_payload:
                meta = card_meta[i] if i < len(card_meta) else {}
                identity_ok, identity_error = validate_resume_source(
                    source_payload,
                    meta.get("name"),
                    meta.get("expect_id"),
                )
                if not identity_ok:
                    return "failed", 0, f"候选人身份校验失败: {identity_error}", geek_url, {}

            artifacts = await collect_resume_text(
                page,
                cand_dir,
                source_payload,
            )

            shots, opened = await collect_resume_screenshots(page, cand_dir)
            if not opened:
                return "failed", len(shots), "简历没打开(没找到简历浮层)", geek_url, artifacts
            if len(shots) >= 2:
                return "ok", len(shots), None, geek_url, artifacts
            return "ok", len(shots), "简历较短(只 1 屏)", geek_url, artifacts
        finally:
            try:
                page.remove_listener("request", _on_geek_request)
            except Exception:
                pass
            try:
                page.remove_listener("response", _on_geek_response)
            except Exception:
                pass

    weak_streak = 0
    aborted = False
    login_expired = False
    for i in range(count):
        print(f"\n--- 候选人 {i + 1}/{count} ---")
        meta = card_meta[i] if i < len(card_meta) else {}
        dir_name = _make_cand_dir(i, meta)
        entry = {"index": i + 1, "dir": dir_name,
                 "expect_id": meta.get("expect_id"),
                 "name": meta.get("name"),
                 "summary": meta.get("summary", []),
                 "status": "pending", "shots": 0, "reason": None,
                 "geek_url": None, "resume_text_file": None,
                 "resume_text_chars": 0, "resume_source_file": None}

        if i > 0 and not await close_resume_modal(page):
            print("  modal 关不掉 → 重搜")
            if not await ensure_search_and_query(page, keyword):
                entry["status"] = "failed"
                entry["reason"] = "modal 关不掉且重搜失败"

        if entry["status"] != "failed":
            try:
                cand_dir = output_dir / dir_name
                st, sh, rs, gurl, artifacts = await asyncio.wait_for(
                    _view_one(i, cand_dir), timeout=PER_CANDIDATE_TIMEOUT_S
                )
                entry["status"], entry["shots"], entry["reason"] = st, sh, rs
                entry["geek_url"] = gurl
                entry.update(artifacts)
            except asyncio.TimeoutError:
                entry["status"] = "failed"
                entry["reason"] = f"超时 >{PER_CANDIDATE_TIMEOUT_S}s"
                print(f"  ⏱️ {entry['reason']}")

        finalize(entry)

        if entry["status"] != "ok":
            lo, url = await detect_logged_out(page)
            if lo:
                login_expired = True
                manifest["abort_reason"] = f"登录失效(URL={url})"
                print(f"\n⛔ {manifest['abort_reason']}")
                break

        weak = entry["status"] != "ok" or entry["shots"] <= 1
        weak_streak = weak_streak + 1 if weak else 0
        if weak_streak >= MAX_CONSECUTIVE_WEAK:
            aborted = True
            manifest["abort_reason"] = f"连续 {weak_streak} 个候选人简历未正常打开,已停止"
            print(f"\n⛔ {manifest['abort_reason']}")
            break

        if i < count - 1:
            sleep_t = random.uniform(1.2, 2.6)
            print(f"  😴 {sleep_t:.1f}s")
            await asyncio.sleep(sleep_t)

    # 关最后一个简历 modal
    await close_resume_modal(page)

    manifest["status"] = "login_expired" if login_expired else ("aborted" if aborted else "done")
    manifest["last_url"] = _page_url_safe(page)
    manifest["finished_at"] = _now_iso()
    write_manifest(output_dir, manifest)
    print(f"\n=== {manifest['status']}: 成功 {manifest['succeeded']}/{count},"
          f" 失败 {manifest['failed']} → {output_dir} ===")
    emit_result()
    return manifest


# ============================================================
# 子命令
# ============================================================

async def cmd_doctor():
    print("=== 环境检查 ===\n")
    ok = True
    try:
        import cloakbrowser
        v = getattr(cloakbrowser, "__version__", "?")
        print(f"  ✅ cloakbrowser {v}")
    except ImportError:
        print("  ❌ cloakbrowser 未安装 → pip install cloakbrowser")
        ok = False

    if ok:
        from cloakbrowser.config import get_binary_path
        bp = get_binary_path()
        if bp.exists():
            print(f"  ✅ Chromium: {bp}")
        else:
            print(f"  ⚠️ Chromium 未下载(首次 login/search 时自动下载 ~400MB)")
            ok = False

    cookies = USER_DATA_DIR / "Default" / "Cookies"
    if cookies.exists():
        print(f"  ✅ 登录态: {USER_DATA_DIR}")
    else:
        print(f"  ⚠️ 没找到登录态 → 先跑 boss.py login")
        ok = False

    print()
    return 0 if ok else 1


async def cmd_login():
    print("[login] 启动浏览器,请在浏览器中完成登录(扫码/输入验证码)。")
    print("[login] 登录完成后按 Ctrl+C 关闭浏览器。\n")
    ctx, page = await launch_browser()
    await warmup_page(page)
    try:
        i = 0
        while True:
            await asyncio.sleep(15)
            i += 1
            print(f"[login] heartbeat #{i}  URL={_page_url_safe(page)[:60]}", flush=True)
    finally:
        try:
            await ctx.close()
        except Exception:
            pass
    return 0


def _parse_output_dir(output_dir):
    """从输出目录解析 keyword 和候选人列表(从文件夹名,不依赖 manifest)。
    文件夹名格式:01_曹某某_1525577703(序号_名字_expectID)"""
    d = Path(output_dir)
    if not d.is_dir():
        return None, []
    # keyword 从父目录名提取:2026-06-09_154914_Java开发 → Java开发
    parts = d.name.split("_", 2)
    keyword = parts[2] if len(parts) >= 3 else d.name

    candidates = []
    for sub in sorted(d.iterdir()):
        if not sub.is_dir():
            continue
        segs = sub.name.split("_", 2)
        if len(segs) >= 3 and segs[0].isdigit():
            candidates.append({
                "index": int(segs[0]),
                "name": segs[1],
                "expect_id": segs[2],
                "dir": sub.name,
            })
    return keyword, candidates


async def _open_in_tab(ctx, keyword, expect_id, name):
    """在新 tab 里搜索 + 按 expect_id 打开简历。返回 (page, success)。"""
    page = await ctx.new_page()
    await page.goto("https://www.zhipin.com/web/chat/index", wait_until="load", timeout=30000)
    await asyncio.sleep(2)

    if not await ensure_search_and_query(page, keyword):
        print(f"  ❌ {name}: 搜索失败")
        return page, False

    for fr in page.frames:
        if "/web/frame/search" not in fr.url:
            continue
        found = await fr.evaluate("""(eid) => {
            const links = document.querySelectorAll('li.geek-info-card a[data-expect]');
            for (const a of links) {
                if (a.getAttribute('data-expect') === eid) {
                    a.click();
                    return true;
                }
            }
            return false;
        }""", expect_id)
        if found:
            print(f"  ✅ {name}: 简历已打开")
            return page, True
        break

    print(f"  ❌ {name}: 搜索结果中没找到")
    return page, False


async def cmd_open(output_dir, cand_nums):
    """从输出目录读候选人信息 → route 拦截方式打开简历 → 浏览器交给用户。"""
    keyword, all_cands = _parse_output_dir(output_dir)
    if keyword is None:
        print(f"❌ 目录不存在: {output_dir}")
        return 1
    if not all_cands:
        print(f"❌ 目录里没有候选人文件夹(格式:01_名字_expectID)")
        return 1

    # 找到要打开的候选人
    targets = []
    for num in cand_nums:
        found = False
        for c in all_cands:
            if c["index"] == num:
                targets.append(c)
                found = True
                break
        if not found:
            print(f"⚠️ 候选人 {num} 不存在")
    if not targets:
        avail = [f"{c['index']}:{c['name']}" for c in all_cands]
        print(f"❌ 没有可打开的候选人。可用: {avail}")
        return 1

    # 检查是否有 geek_url（从 manifest.json 读取）
    manifest_path = Path(output_dir) / "manifest.json"
    geek_urls = {}
    if manifest_path.exists():
        try:
            mdata = json.loads(manifest_path.read_text(encoding="utf-8"))
            for c in mdata.get("candidates", []):
                if c.get("geek_url") and c.get("expect_id"):
                    geek_urls[c["expect_id"]] = c["geek_url"]
        except Exception:
            pass

    # 检查目标候选人是否有 geek_url
    has_geek_url = all(geek_urls.get(t.get("expect_id")) for t in targets)

    if has_geek_url:
        # 新方式: route 拦截（一个浏览器，逐个打开）
        print(f"[open] 使用 route 拦截方式打开 {len(targets)} 个候选人")
        import cloakbrowser
        sanitize_profile_prefs()
        ctx = await cloakbrowser.launch_persistent_context_async(
            user_data_dir=str(USER_DATA_DIR), headless=False, humanize=False,
            locale="zh-CN", timezone="Asia/Shanghai", viewport=None,
            args=["--lang=zh-CN", "--window-position=0,0", "--window-size=1440,805",
                  "--hide-crash-restore-bubble", "--test-type"],
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(LANDING, wait_until="load", timeout=30000)
        await asyncio.sleep(4)

        # URL 直跳到搜索页建立 base context
        # 强制带 city=全国，覆盖左侧 dropdown 的会话残留，确保列表有候选人卡片
        await page.goto(BASE_SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(4)

        # 逐个打开
        for i, t in enumerate(targets):
            target_url = geek_urls[t["expect_id"]]
            print(f"\n[open] [{i+1}/{len(targets)}] {t['name']}...")

            # 关闭当前 modal
            if i > 0:
                await page.keyboard.press("Escape")
                await asyncio.sleep(1.5)

            # route 拦截
            async def _intercept(route, url=target_url):
                resp = await page.request.fetch(url)
                await route.fulfill(response=resp)

            await page.route("**/wapi/zpitem/web/boss/search/geek/info**", _intercept)
            for fr in page.frames:
                if "/web/frame/search" in fr.url:
                    card = fr.locator("li.geek-info-card").first
                    await card.click()
                    break
            await asyncio.sleep(5)
            await page.unroute("**/wapi/zpitem/web/boss/search/geek/info**")
            print(f"  ✅ {t['name']} 已打开")

            if i < len(targets) - 1:
                input("  按回车打开下一个...")

        print(f"\n[open] 全部打开完毕。关闭浏览器窗口即可结束联系会话。\n")
        try:
            deadline = time.monotonic() + OPEN_IDLE_TIMEOUT
            while time.monotonic() < deadline:
                if not ctx.pages or all(opened_page.is_closed() for opened_page in ctx.pages):
                    break
                await asyncio.sleep(15)
        finally:
            try:
                await ctx.close()
            except Exception:
                pass
        return 0

    else:
        # 旧方式: 重新搜索定位（向后兼容，无 geek_url 时使用）
        print(f"[open] 无 geek_url,使用旧方式(重新搜索定位)")
        print(f"[open] 关键词: {keyword}")
        ctx, first_page = await launch_browser()
        t = targets[0]
        print(f"\n[open] {t['name']}...")
        await first_page.goto(LANDING, wait_until="load", timeout=30000)
        await asyncio.sleep(2)
        if await ensure_search_and_query(first_page, keyword):
            for fr in first_page.frames:
                if "/web/frame/search" not in fr.url:
                    continue
                await fr.evaluate("""(eid) => {
                    const links = document.querySelectorAll('li.geek-info-card a[data-expect]');
                    for (const a of links) { if (a.getAttribute('data-expect') === eid) { a.click(); break; } }
                }""", t["expect_id"])
                print(f"  ✅ {t['name']}: 简历已打开")
                break
        for i, t in enumerate(targets[1:], 2):
            print(f"\n[open] {t['name']}...")
            await asyncio.sleep(1)
            await _open_in_tab(ctx, keyword, t["expect_id"], t["name"])
        print(f"\n[open] 浏览器保持打开，关闭浏览器窗口即可结束联系会话。\n")
        try:
            deadline = time.monotonic() + OPEN_IDLE_TIMEOUT
            while time.monotonic() < deadline:
                if not ctx.pages or all(opened_page.is_closed() for opened_page in ctx.pages):
                    break
                await asyncio.sleep(15)
        finally:
            try:
                await ctx.close()
            except Exception:
                pass
        return 0


async def cmd_hydrate(task_dir, cand_nums=None):
    """重新搜索并按 expect_id 精确打开候选人，为旧任务补采结构化简历。"""
    base = Path(task_dir)
    manifest_path = base / "manifest.json"
    if not manifest_path.exists():
        print(f"❌ 找不到: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    candidates = manifest.get("candidates", [])
    requested = set(cand_nums or [])
    targets = [
        candidate for candidate in candidates
        if (not requested or candidate.get("global_index") in requested)
        and candidate.get("status") in ("ok", "done")
    ]
    if not targets:
        print("❌ 没有可补采的候选人")
        return 1

    print(f"[hydrate] 准备补采 {len(targets)} 位候选人的结构化简历")
    ctx, page = await launch_browser()
    await warmup_page(page)
    await page.goto(BASE_SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(4)

    succeeded = 0
    current_keyword = None
    try:
        for position, candidate in enumerate(targets, 1):
            index = candidate.get("global_index") or candidate.get("index") or position
            name = candidate.get("name") or f"候选人 {index}"
            keyword = candidate.get("keyword")
            expect_id = str(candidate.get("expect_id") or "").strip()
            keyword_dir = candidate.get("keyword_dir")
            candidate_dir = candidate.get("dir")
            print(f"\n[hydrate] [{position}/{len(targets)}] {name}")

            if not keyword or not expect_id or not keyword_dir or not candidate_dir:
                candidate["resume_hydrate_error"] = "缺少关键词、候选人 ID 或目录信息"
                write_manifest(base, manifest)
                print("  ❌ 缺少关键词、候选人 ID 或目录信息")
                continue

            if position > 1:
                await close_resume_modal(page)
                await asyncio.sleep(random.uniform(1.0, 1.8))

            if current_keyword != keyword:
                if not await ensure_search_and_query(page, keyword):
                    candidate["resume_hydrate_error"] = "重新搜索失败"
                    write_manifest(base, manifest)
                    print("  ❌ 重新搜索失败")
                    current_keyword = None
                    continue
                current_keyword = keyword

            frame, selector, _ = await find_candidate_cards(page)
            if not frame or not selector:
                candidate["resume_hydrate_error"] = "搜索结果中未找到候选人卡片"
                write_manifest(base, manifest)
                print("  ❌ 搜索结果中未找到候选人卡片")
                continue

            target_index = await frame.evaluate("""({selector, expectId}) => {
                const cards = Array.from(document.querySelectorAll(selector));
                return cards.findIndex((card) => {
                    const link = card.querySelector('a[data-expect]');
                    return link && link.getAttribute('data-expect') === expectId;
                });
            }""", {"selector": selector, "expectId": expect_id})
            if target_index < 0:
                candidate["resume_hydrate_error"] = "原候选人已不在当前搜索结果中"
                write_manifest(base, manifest)
                print("  ❌ 原候选人已不在当前搜索结果中")
                continue

            captured_urls = []
            captured_sources = []
            response_tasks = []

            def _on_geek_request(request):
                if "geek/info" in request.url:
                    captured_urls.append(request.url)

            def _on_geek_response(response):
                if "geek/info" not in response.url:
                    return

                async def _read_response():
                    try:
                        captured_sources.append(await response.json())
                    except Exception:
                        pass

                response_tasks.append(asyncio.create_task(_read_response()))

            page.on("request", _on_geek_request)
            page.on("response", _on_geek_response)
            try:
                clicked = await click_candidate_silent(page, target_index)
                opened = clicked and await wait_until(
                    lambda: page.evaluate(FIND_SCROLLABLE_JS),
                    timeout=8.0,
                    interval=0.4,
                )
                if not opened:
                    candidate["resume_hydrate_error"] = "候选人简历未打开"
                    write_manifest(base, manifest)
                    print("  ❌ 候选人简历未打开")
                    continue

                await asyncio.sleep(0.5)
                if response_tasks:
                    try:
                        await asyncio.wait_for(
                            asyncio.gather(*response_tasks, return_exceptions=True),
                            timeout=5.0,
                        )
                    except asyncio.TimeoutError:
                        pass

                source_payload = captured_sources[-1] if captured_sources else None
                identity_ok, identity_error = validate_resume_source(
                    source_payload,
                    name,
                    expect_id,
                )
                if not identity_ok:
                    candidate["resume_hydrate_error"] = f"候选人身份校验失败: {identity_error}"
                    write_manifest(base, manifest)
                    print(f"  ❌ 候选人身份校验失败: {identity_error}")
                    continue

                save_dir = base / keyword_dir / candidate_dir
                artifacts = await collect_resume_text(page, save_dir, source_payload)
                candidate.update(artifacts)
                if captured_urls:
                    candidate["geek_url"] = captured_urls[-1]
                candidate.pop("resume_hydrate_error", None)
                if artifacts.get("resume_text_file"):
                    succeeded += 1
                    print("  ✅ 结构化简历已保存")
                else:
                    candidate["resume_hydrate_error"] = "简历已打开，但未提取到文本"
                write_manifest(base, manifest)
            finally:
                try:
                    page.remove_listener("request", _on_geek_request)
                except Exception:
                    pass
                try:
                    page.remove_listener("response", _on_geek_response)
                except Exception:
                    pass

        await close_resume_modal(page)
    finally:
        try:
            await ctx.close()
        except Exception:
            pass

    manifest["structured_resumes"] = {
        "available": sum(1 for candidate in candidates if candidate.get("resume_text_file")),
        "updated_at": _now_iso(),
    }
    write_manifest(base, manifest)
    print(f"\n[hydrate] 完成: {succeeded}/{len(targets)}")
    return 0 if succeeded == len(targets) else 2


async def cmd_search(keyword, count):
    """单关键词搜索（向后兼容）。"""
    return await cmd_search_multi([(keyword, count)])


def summarize_multi_search(keyword_results, candidates):
    """汇总多关键词搜索状态，并给 CLI/Worker 一个可靠的退出码。"""
    valid_count = sum(
        1 for candidate in candidates
        if candidate.get("status") in ("ok", "done")
    )
    failed_count = len(candidates) - valid_count
    login_expired = any(
        result.get("status") == "login_expired"
        for result in keyword_results
    )

    errors = []
    for result in keyword_results:
        message = result.get("error") or result.get("abort_reason")
        if message and message not in errors:
            errors.append(message)

    if valid_count > 0:
        status = "done"
        exit_code = 0
    elif login_expired:
        status = "login_expired"
        exit_code = 3
    else:
        status = "error"
        exit_code = 2

    error = "；".join(errors)
    if not error and valid_count == 0:
        error = "搜索未返回候选人，请检查关键词、Boss 登录状态或页面风控"

    return {
        "status": status,
        "exit_code": exit_code,
        "succeeded": valid_count,
        "failed": failed_count,
        "error": error or None,
    }


async def cmd_search_multi(keyword_counts: list):
    """多关键词搜索: 一次浏览器会话完成所有关键词。
    keyword_counts = [("Java开发", 5), ("微服务架构师", 3), ...]
    """
    print(f"[search] {len(keyword_counts)} 个关键词: {[kw for kw, _ in keyword_counts]}")

    ctx, page = await launch_browser()
    await warmup_page(page)

    # 创建任务级目录
    task_dir = make_task_dir()
    all_candidates = []
    keyword_results = []
    global_idx = 0

    for kw_i, (keyword, count) in enumerate(keyword_counts):
        print(f"\n{'='*50}")
        print(f"  [{kw_i+1}/{len(keyword_counts)}] 关键词: {keyword}  数量: {count}")
        print(f"{'='*50}")

        # 每个关键词一个子目录
        safe_kw = keyword.replace(" ", "_").replace("/", "_")[:30]
        kw_dir = task_dir / safe_kw
        kw_dir.mkdir(parents=True, exist_ok=True)

        manifest = await run_batch(page, keyword, count, kw_dir)
        keyword_results.append({
            "keyword": keyword,
            "requested": count,
            "status": manifest.get("status", "error"),
            "succeeded": manifest.get("succeeded", 0),
            "failed": manifest.get("failed", 0),
            "error": manifest.get("error"),
            "abort_reason": manifest.get("abort_reason"),
        })

        # 收集候选人并重新编号（全局递增）
        for c in manifest.get("candidates", []):
            global_idx += 1
            c["global_index"] = global_idx
            c["keyword"] = keyword
            c["keyword_dir"] = safe_kw
            all_candidates.append(c)

        if manifest.get("status") == "login_expired":
            print("\n⛔ 登录失效,停止后续关键词")
            break

        # 关键词之间休息
        if kw_i < len(keyword_counts) - 1:
            sleep_t = random.uniform(3, 6)
            print(f"\n  😴 关键词间休息 {sleep_t:.1f}s")
            await asyncio.sleep(sleep_t)

    # 非正常结束截图
    last_status = all_candidates[-1].get("status") if all_candidates else "error"
    if last_status != "ok":
        try:
            err_shot = task_dir / "error_state.png"
            await page.screenshot(path=str(err_shot))
        except Exception:
            pass

    try:
        await ctx.close()
    except Exception:
        pass
    print("\n[search] 浏览器已关闭。")

    # 写统一 manifest
    summary = summarize_multi_search(keyword_results, all_candidates)
    unified_manifest = {
        "tool": "boss.py search (multi)",
        "task_dir": str(task_dir),
        "keywords": [{"keyword": kw, "count": ct} for kw, ct in keyword_counts],
        "keyword_results": keyword_results,
        "started_at": _now_iso(),
        "status": summary["status"],
        "total_candidates": len(all_candidates),
        "succeeded": summary["succeeded"],
        "failed": summary["failed"],
        "candidates": all_candidates,
    }
    if summary["error"]:
        unified_manifest["error"] = summary["error"]
    write_manifest(task_dir, unified_manifest)

    print(f"\n===BATCH_RESULT_JSON===")
    print(json.dumps(unified_manifest, ensure_ascii=False, indent=2))
    print("===BATCH_RESULT_END===")
    print(f"\n截图保存在: {task_dir.resolve()}")
    print(f"统一 manifest: {task_dir / 'manifest.json'}")
    print(f"总候选人: {len(all_candidates)}\n")
    return summary["exit_code"]


# ============================================================
# serve 命令 — 本地 HTTP 服务，报告按钮一键打开候选人
# ============================================================

_serve_ctx = None
_serve_page = None
_serve_lock = threading.Lock()
_serve_loop = None
_serve_manifest = None
_serve_last_activity = 0


async def _serve_ensure_ready() -> str:
    """确保浏览器已启动且搜索页有卡片。浏览器懒启动,启动后复用。"""
    global _serve_ctx, _serve_page

    # 已就绪
    if _serve_ctx and _serve_page:
        try:
            _ = _serve_page.url
            return "ok"
        except Exception:
            _serve_ctx = None
            _serve_page = None

    import cloakbrowser
    sanitize_profile_prefs()
    _serve_ctx = await cloakbrowser.launch_persistent_context_async(
        user_data_dir=str(USER_DATA_DIR), headless=False, humanize=False,
        locale="zh-CN", timezone="Asia/Shanghai", viewport=None,
        args=["--lang=zh-CN", "--window-position=0,0", "--window-size=1440,805",
              "--hide-crash-restore-bubble", "--test-type"],
    )
    _serve_page = _serve_ctx.pages[0] if _serve_ctx.pages else await _serve_ctx.new_page()

    await _serve_page.goto(LANDING, wait_until="load", timeout=30000)
    await asyncio.sleep(4)

    if "login" in _serve_page.url.lower() or "user/?ka=" in _serve_page.url:
        return "login_expired"

    # URL 直跳到搜索页（强制 city=全国，避免被左侧 dropdown 残留过滤导致 0 卡片）
    await _serve_page.goto(BASE_SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(4)

    # 等搜索 iframe 和候选人卡片就绪
    for _ in range(15):
        for fr in _serve_page.frames:
            if "/web/frame/search" in fr.url:
                n = await fr.locator("li.geek-info-card").count()
                if n > 0:
                    return "ok"
        await asyncio.sleep(1)
    return "no_results"


async def _serve_recover_to_search(reason: str = ""):
    """把 _serve_page 健壮地恢复到「搜索页 + 列表里有候选人卡片」状态。
    用于 _serve_open_candidate 每次调用前的兜底。"""
    global _serve_page

    if not _serve_page:
        return "no_page"

    # 检查浏览器还活着没
    try:
        cur_url = _serve_page.url
    except Exception:
        return "page_closed"

    # 已经在搜索页且有卡片就不动
    if "/web/chat/search" in cur_url or "/web/frame/search" in cur_url:
        for fr in _serve_page.frames:
            if "/web/frame/search" in fr.url:
                try:
                    n = await fr.locator("li.geek-info-card").count()
                    if n > 0:
                        return "ok"
                except Exception:
                    pass
                break

    # 否则强制跳回搜索页（带 city=全国，确保列表有候选人卡片）
    if reason:
        print(f"  🔧 页面跑偏（{reason}，当前 URL={cur_url[:60]}），自动回搜索页", flush=True)
    try:
        await _serve_page.goto(BASE_SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)
    except Exception as e:
        return f"goto_failed: {e}"

    # 检查是不是被弹回登录页
    try:
        new_url = _serve_page.url
        if "login" in new_url.lower() or "user/?ka=" in new_url:
            return "login_expired"
    except Exception:
        return "page_closed"

    # 等候选人卡片就绪
    for _ in range(15):
        for fr in _serve_page.frames:
            if "/web/frame/search" in fr.url:
                try:
                    n = await fr.locator("li.geek-info-card").count()
                    if n > 0:
                        return "ok"
                except Exception:
                    pass
        await asyncio.sleep(1)
    return "no_results"


async def _serve_open_candidate(target_url: str) -> str:
    """在已就绪的浏览器中打开目标候选人(不重启浏览器,不重新搜索)。"""
    global _serve_page, _serve_ctx

    status = await _serve_ensure_ready()
    if status != "ok":
        return status

    # 关闭可能开着的简历 modal（不管在哪个页面）
    try:
        await _serve_page.keyboard.press("Escape")
        await asyncio.sleep(0.8)
    except Exception:
        pass

    # 健壮性检查：确保现在确实在搜索页 + 有候选人卡片
    rec = await _serve_recover_to_search(reason="进入 _serve_open_candidate 时检查")
    if rec == "page_closed":
        # 浏览器被手动关了，重启一次
        _serve_ctx = None
        _serve_page = None
        status = await _serve_ensure_ready()
        if status != "ok":
            return status
    elif rec != "ok":
        return rec

    try:
        search_frame = None
        for fr in _serve_page.frames:
            if "/web/frame/search" in fr.url:
                search_frame = fr
                break
        if not search_frame:
            return "iframe_lost"

        # route 拦截：不管点哪张卡片，geek/info 请求都被换成
        # 目标候选人的 securityId → 浮层显示的就是目标候选人
        async def _intercept(route):
            resp = await _serve_page.request.fetch(target_url)
            await route.fulfill(response=resp)

        await _serve_page.route("**/wapi/zpitem/web/boss/search/geek/info**", _intercept)
        try:
            # 用搜索流程同款的真实点击（贝塞尔鼠标移动 + 真实坐标）
            # dispatch_event 是合成事件，boss 的 Vue 组件不认
            ok = await click_candidate_silent(_serve_page, 0)
            if not ok:
                return "click_failed"

            # 等简历浮层出现。沒出现 → 点击并未生效
            # 或 boss 头什么。不能周纪性的假阳性返回 ok
            opened = await wait_until(
                lambda: _serve_page.evaluate(FIND_SCROLLABLE_JS),
                timeout=4.0, interval=0.3
            )
            if not opened:
                return "no_modal_after_click"

            return "ok"
        finally:
            try:
                await _serve_page.unroute("**/wapi/zpitem/web/boss/search/geek/info**")
            except Exception:
                pass

    except Exception as e:
        # 不再“默默重启浏览器”——重启 = 风控。直接返错误码
        # 让上层判断是否需要重试。
        return f"exception: {type(e).__name__}: {e}"


def _serve_run_open(target_url: str) -> str:
    """线程安全地在事件循环中打开候选人。"""
    future = asyncio.run_coroutine_threadsafe(_serve_open_candidate(target_url), _serve_loop)
    try:
        return future.result(timeout=90)
    except Exception as e:
        return f"error: {e}"


class _ServeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  [{self.client_address[0]}] {args[0]}", flush=True)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        global _serve_last_activity
        _serve_last_activity = time.time()
        path = urlparse(self.path).path

        # 静态文件服务（报告 HTML 等）
        if path == "/" or path == "/report" or path.endswith(".html"):
            # 在任务目录下找 HTML 文件
            task_dir = Path(_serve_manifest.get("task_dir", "."))
            if path == "/" or path == "/report":
                # 找任何 .html 文件
                html_files = list(task_dir.glob("*.html"))
                if not html_files:
                    html_files = list(task_dir.parent.glob("*.html"))
                if html_files:
                    html_path = html_files[0]
                else:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b"No report HTML found")
                    return
            else:
                html_path = task_dir / path.lstrip("/")
                if not html_path.exists():
                    html_path = task_dir.parent / path.lstrip("/")

            if html_path.exists():
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(html_path.read_bytes())
            else:
                self.send_response(404)
                self.end_headers()
            return

        if path == "/health":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
            return

        if path.startswith("/open/"):
            try:
                idx = int(path.split("/open/")[1])
            except (ValueError, IndexError):
                self.send_response(400)
                self._cors()
                self.end_headers()
                self.wfile.write(b"invalid index")
                return

            candidates = _serve_manifest.get("candidates", [])
            target = None
            for c in candidates:
                if c.get("global_index") == idx:
                    target = c
                    break
            # 向后兼容：无 global_index 时按位置索引
            if not target and 1 <= idx <= len(candidates):
                target = candidates[idx - 1]
            if not target or not target.get("geek_url"):
                self.send_response(404)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                msg = "no_geek_url" if target else "candidate_not_found"
                self.wfile.write(json.dumps({"error": msg}).encode())
                return

            print(f"  \U0001f680 打开: {target.get('name', '?')} (序号{idx})...", flush=True)
            with _serve_lock:
                result = _serve_run_open(target["geek_url"])
            print(f"  → 结果: {result}", flush=True)

            code = 200 if result == "ok" else 500
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": result, "name": target.get("name")}).encode())
            return

        if path == "/close":
            async def _close():
                global _serve_ctx, _serve_page
                if _serve_ctx:
                    try:
                        await _serve_ctx.close()
                    except Exception:
                        pass
                    _serve_ctx = None
                    _serve_page = None
            asyncio.run_coroutine_threadsafe(_close(), _serve_loop)
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"status":"closed"}')
            return

        if path == "/stop":
            async def _stop():
                global _serve_ctx, _serve_page
                if _serve_ctx:
                    try:
                        await _serve_ctx.close()
                    except Exception:
                        pass
                    _serve_ctx = None
                    _serve_page = None
            asyncio.run_coroutine_threadsafe(_stop(), _serve_loop)
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"status":"stopping"}')
            import os
            threading.Timer(1.0, lambda: os._exit(0)).start()
            return

        self.send_response(404)
        self.end_headers()


def _serve_event_loop_thread(loop):
    asyncio.set_event_loop(loop)
    loop.run_forever()


def _serve_idle_watchdog():
    """后台线程:30 分钟无请求自动退出。"""
    import os
    while True:
        time.sleep(60)
        if time.time() - _serve_last_activity > SERVE_IDLE_TIMEOUT:
            print(f"\n[serve] 空闲 {SERVE_IDLE_TIMEOUT // 60} 分钟,自动退出。")
            if _serve_ctx:
                asyncio.run_coroutine_threadsafe(_serve_ctx.close(), _serve_loop)
            os._exit(0)


def _set_macos_dock_icon():
    """在 macOS 上给 dock 画一个干净的应用图标。

    不设置的话，macOS 会给未签名的 venv python 显示默认的
    “未识别应用”黄色叹号图标（很丑）。
    这里用 pyobjc 程序化画一个蓝色圆角矩 + 白色“招”字，不需要额外资源文件。
    """
    if sys.platform != "darwin":
        return
    try:
        from AppKit import (NSApplication, NSImage, NSColor, NSBezierPath,
                            NSAttributedString, NSFont, NSFontAttributeName,
                            NSForegroundColorAttributeName)
        from Foundation import NSMakeRect, NSMakePoint, NSMakeSize

        size = 256.0
        img = NSImage.alloc().initWithSize_(NSMakeSize(size, size))
        img.lockFocus()
        try:
            # 蓝色圆角背景（与报告主色一致）
            bg = NSColor.colorWithRed_green_blue_alpha_(0.13, 0.59, 0.95, 1.0)
            bg.setFill()
            NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
                NSMakeRect(8, 8, size - 16, size - 16), 44, 44
            ).fill()

            # 白色粗体中文“招”字（boss 招聘场景，识别度高）
            font = NSFont.boldSystemFontOfSize_(150)
            attrs = {
                NSFontAttributeName: font,
                NSForegroundColorAttributeName: NSColor.whiteColor(),
            }
            text = NSAttributedString.alloc().initWithString_attributes_("招", attrs)
            ts = text.size()
            text.drawAtPoint_(NSMakePoint(
                (size - ts.width) / 2,
                (size - ts.height) / 2 - 6,
            ))
        finally:
            img.unlockFocus()

        NSApplication.sharedApplication().setApplicationIconImage_(img)
    except Exception as e:
        # 设置失败不影响主流程，静默降级
        print(f"[report] (dock 图标设置失败: {e})", flush=True)


def cmd_report(task_dir, html_path=None):
    """启动 PyWebView 桌面窗口展示报告，按钮直接调 cloakbrowser 打开候选人简历。

    与 cmd_serve 的区别：
    - 不起 HTTP 服务，没有端口冲突
    - 报告 HTML 在嵌入式 WebKit 里渲染
    - 按钮通过 pywebview.api 直接调 Python（无 fetch、无 CORS）
    - 关窗 = 自动清理 cloakbrowser，生命周期清晰

    用法:
        boss.py report <任务目录>                 # 自动找目录下首个 .html
        boss.py report <任务目录> <报告.html>     # 显式指定
    """
    global _serve_manifest, _serve_loop

    try:
        import webview
    except ImportError:
        print("❌ 缺少 pywebview，请跑: uv add pywebview")
        return 1

    base = Path(task_dir)
    if base.is_file() and base.name == "manifest.json":
        manifest_file = base
        base = base.parent
    elif base.is_dir():
        manifest_file = base / "manifest.json"
    else:
        print(f"❌ 找不到目录或 manifest: {base}")
        return 1

    if not manifest_file.exists():
        print(f"❌ 找不到: {manifest_file}")
        return 1

    _serve_manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    candidates = _serve_manifest.get("candidates", [])
    valid = sum(1 for c in candidates if c.get("geek_url"))

    # 找报告 HTML
    if html_path:
        report_path = Path(html_path)
        if not report_path.exists():
            print(f"❌ 找不到指定的 HTML: {report_path}")
            return 1
    else:
        all_html = list(base.glob("*.html")) or list(base.parent.glob("*.html"))
        # 优先含 "report"/"评估"/"候选人" 字样的
        ranked = [p for p in all_html if "report" in p.name.lower() or "评估" in p.name or "候选人" in p.name]
        report_path = (ranked or all_html or [None])[0]
        if report_path is None:
            print(f"❌ 在 {base} 找不到报告 HTML，先生成报告（详见 SKILL.md Step 6）")
            return 1

    print(f"[report] 候选人 {len(candidates)} 人 ({valid} 个有 geek_url)")
    print(f"[report] 报告: {report_path}")

    # 启动 asyncio 事件循环线程（cloakbrowser 跑在这里）
    _serve_loop = asyncio.new_event_loop()
    t = threading.Thread(target=_serve_event_loop_thread, args=(_serve_loop,), daemon=True)
    t.start()

    # === 暴露给 JS 的 API ===
    class ReportApi:
        def health(self):
            """JS 用来确认 PyWebView bridge 连通。"""
            return {"status": "ok", "candidates": len(candidates), "valid": valid}

        def open_resume(self, idx):
            """打开候选人简历。返回 HR 友好的 message（不暴露技术细节）。"""
            try:
                idx = int(idx)
            except (TypeError, ValueError):
                return {"status": "error", "message": "✗ 序号无效，请联系助手"}

            target = None
            for c in candidates:
                if c.get("global_index") == idx:
                    target = c
                    break
            if not target and 1 <= idx <= len(candidates):
                target = candidates[idx - 1]
            if not target:
                return {"status": "error", "message": "✗ 找不到该候选人，请联系助手"}
            if not target.get("geek_url"):
                return {"status": "error", "message": "✗ 链接已过期，请让助手重新搜索"}

            print(f"  🚀 打开: {target.get('name', '?')} (序号{idx})...", flush=True)
            # === 关键防风控：同一时间只允许一个打开操作。 ===
            # boss 对多 tab 极敏感，2 个请求串行成连续请求也会被推
            # 。非阻塞 acquire：抢不到锁立即返回 busy，不排队。
            if not _serve_lock.acquire(blocking=False):
                print(f"  ⏸ 已忙：拒绝 {target.get('name')} (上一个还在打开中)", flush=True)
                return {"status": "busy", "message": "上一个还在打开中…"}
            try:
                future = asyncio.run_coroutine_threadsafe(
                    _serve_open_candidate(target["geek_url"]), _serve_loop
                )
                try:
                    result = future.result(timeout=120)
                except Exception as e:
                    result = f"error: {e}"
            finally:
                _serve_lock.release()
            print(f"  → 结果: {result}", flush=True)

            # 把内部 status 翻译成 HR 能看懂的 message
            if result == "ok":
                return {"status": "ok", "message": "✓ 已打开", "name": target.get("name")}
            elif "login" in result.lower() or "expired" in result.lower():
                return {"status": "login_expired", "message": "✗ 需要重新验证身份，请让助手处理"}
            elif "403" in str(result) or "forbidden" in result.lower():
                return {"status": "expired", "message": "✗ 链接已过期，请让助手重新搜索"}
            else:
                return {"status": "error", "message": "✗ 打开失败，请让助手重新启动"}

        def stop_browser(self):
            """关闭后端 cloakbrowser（窗口仍在，可继续浏览报告）。"""
            async def _close():
                global _serve_ctx, _serve_page
                if _serve_ctx:
                    try:
                        await _serve_ctx.close()
                    except Exception:
                        pass
                    _serve_ctx = None
                    _serve_page = None
            asyncio.run_coroutine_threadsafe(_close(), _serve_loop)
            return {"status": "ok"}

    api = ReportApi()
    title = f"候选人评估报告 · {base.name}"
    window = webview.create_window(
        title,
        url=report_path.absolute().as_uri(),
        js_api=api,
        width=1280, height=900,
        min_size=(960, 600),
    )

    def on_closed():
        print("[report] 窗口关闭，清理 cloakbrowser ...")
        global _serve_ctx, _serve_page
        if _serve_ctx:
            try:
                fut = asyncio.run_coroutine_threadsafe(_serve_ctx.close(), _serve_loop)
                fut.result(timeout=5)
            except Exception:
                pass
            _serve_ctx = None
            _serve_page = None
        if _serve_loop and _serve_loop.is_running():
            _serve_loop.call_soon_threadsafe(_serve_loop.stop)
        print("[report] 已清理")

    window.events.closed += on_closed

    # macOS dock 图标：必须等窗口显示后再设（之前 webview.start 内部会覆盖）
    # 且 setApplicationIconImage_ 只能在主线程调，events.shown 是新线程
    # → 用 PyObjCTools.AppHelper.callAfter 调度回主线程
    def _on_shown():
        if sys.platform != "darwin":
            return
        try:
            from PyObjCTools import AppHelper
            AppHelper.callAfter(_set_macos_dock_icon)
        except Exception as e:
            print(f"[report] (dock 图标调度失败: {e})", flush=True)
    window.events.shown += _on_shown

    print(f"[report] 启动 PyWebView 窗口（关闭窗口即退出）")
    webview.start(debug=False)
    return 0


def cmd_serve(manifest_path):
    """启动简历查看 HTTP 服务（旧模式，保留兼容；推荐用 cmd_report）。"""
    global _serve_manifest, _serve_loop, _serve_last_activity

    path = Path(manifest_path)
    if path.is_dir():
        path = path / "manifest.json"
    if not path.exists():
        print(f"❌ 找不到: {path}")
        return 1

    _serve_manifest = json.loads(path.read_text(encoding="utf-8"))
    candidates = _serve_manifest.get("candidates", [])
    valid = sum(1 for c in candidates if c.get("geek_url"))
    print(f"[serve] 加载 {len(candidates)} 个候选人 ({valid} 个有 geek_url)")
    for i, c in enumerate(candidates):
        mark = "✅" if c.get("geek_url") else "❌"
        print(f"   {i + 1}. {c.get('name', '?')} {mark}")

    if valid == 0:
        print("❌ 没有可打开的候选人(所有人都没有 geek_url)")
        return 1

    # 启动异步事件循环
    _serve_loop = asyncio.new_event_loop()
    t = threading.Thread(target=_serve_event_loop_thread, args=(_serve_loop,), daemon=True)
    t.start()

    # 空闲超时看门狗
    _serve_last_activity = time.time()
    wd = threading.Thread(target=_serve_idle_watchdog, daemon=True)
    wd.start()

    # 启动 HTTP 服务
    server = HTTPServer(("127.0.0.1", SERVE_PORT), _ServeHandler)
    print(f"\n\U0001f310 服务启动: http://localhost:{SERVE_PORT}")
    print(f"   GET /health     → 状态检查")
    print(f"   GET /open/<序号> → 打开候选人")
    print(f"   GET /close      → 关闭浏览器")
    print(f"   GET /stop       → 停止服务")
    print(f"\n   空闲 {SERVE_IDLE_TIMEOUT // 60} 分钟自动退出。按 Ctrl+C 手动停止。\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] 服务关闭")
        if _serve_ctx:
            asyncio.run_coroutine_threadsafe(_serve_ctx.close(), _serve_loop)
        _serve_loop.call_soon_threadsafe(_serve_loop.stop)
    return 0


# ============================================================
# CLI 入口
# ============================================================

def print_usage():
    print(__doc__)


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print_usage()
        return 0

    cmd = args[0]

    if cmd == "doctor":
        return asyncio.run(cmd_doctor())

    elif cmd == "login":
        try:
            return asyncio.run(cmd_login())
        except KeyboardInterrupt:
            print("\n[login] 浏览器已关闭。登录态已保存。")
            return 0

    elif cmd == "report":
        if len(args) < 2:
            print("用法: boss.py report <任务目录> [报告.html]")
            print("例:   boss.py report 简历/2026-06-09_Java开发")
            return 1
        try:
            html_path = args[2] if len(args) >= 3 else None
            return cmd_report(args[1], html_path)
        except KeyboardInterrupt:
            print("\n[report] 用户中断")
            return 0

    elif cmd == "serve":
        if len(args) < 2:
            print("用法: boss.py serve <简历目录或manifest.json路径>")
            print("例:   boss.py serve 简历/2026-06-09_Java开发")
            return 1
        try:
            return cmd_serve(args[1])
        except KeyboardInterrupt:
            print("\n[serve] 服务关闭。")
            return 0

    elif cmd == "open":
        if len(args) < 3:
            print("用法: boss.py open <简历目录> <序号1> [序号2] [序号3] ...")
            print("例:   boss.py open 简历/2026-06-09_Java开发 3")
            print("      boss.py open 简历/2026-06-09_Java开发 1 3 5   # 同时打开 3 个 tab")
            return 1
        output_dir = args[1]
        try:
            cand_nums = [int(x) for x in args[2:]]
        except ValueError:
            print("❌ 候选人序号必须是数字")
            return 1
        try:
            return asyncio.run(cmd_open(output_dir, cand_nums))
        except KeyboardInterrupt:
            print("\n[open] 浏览器已关闭。")
            return 0

    elif cmd == "hydrate":
        if len(args) < 2:
            print("用法: boss.py hydrate <简历目录> [序号1] [序号2] ...")
            return 1
        task_dir = args[1]
        try:
            cand_nums = [int(x) for x in args[2:]] if len(args) > 2 else None
        except ValueError:
            print("❌ 候选人序号必须是数字")
            return 1
        try:
            return asyncio.run(cmd_hydrate(task_dir, cand_nums))
        except KeyboardInterrupt:
            print("\n[hydrate] 用户中断。")
            return 130

    elif cmd == "search":
        # 支持多关键词: boss.py search "Java开发" 5 "Java后端" 3
        # 也支持单关键词: boss.py search Java开发 20
        raw = args[1:]
        if not raw:
            print("用法: boss.py search <关键词1> [数量1] [<关键词2> [数量2]] ...")
            print("例:   boss.py search Java开发 5")
            print("      boss.py search \"Java开发\" 5 \"微服务架构师\" 3")
            return 1

        # 解析多关键词对: 非数字=关键词, 数字=上一个关键词的数量
        keyword_counts = []
        current_kw = None
        for token in raw:
            if token.isdigit():
                if current_kw:
                    keyword_counts.append((current_kw, int(token)))
                    current_kw = None
                else:
                    # 数字但没有前置关键词,当作关键词处理
                    current_kw = token
            else:
                if current_kw:
                    # 上一个关键词没给数量,默认 5
                    keyword_counts.append((current_kw, 5))
                current_kw = token
        if current_kw:
            keyword_counts.append((current_kw, 5))

        if not keyword_counts:
            print("❌ 无效参数")
            return 1

        try:
            return asyncio.run(cmd_search_multi(keyword_counts))
        except KeyboardInterrupt:
            print("\n[search] 用户中断。")
            return 130

    else:
        print(f"未知命令: {cmd}\n")
        print_usage()
        return 1


if __name__ == "__main__":
    sys.exit(main() or 0)
