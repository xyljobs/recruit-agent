# 一键启用 Demo 拍摄所需的 AI 链路（拍摄后可用 -Disable 还原）
#
# 用法：
#   方式 A（key 经聊天窗口提供）：powershell -ExecutionPolicy Bypass -File scripts/prepare-demo-ai.ps1 -LLMApiKey "sk-xxxx"
#   方式 B（key 不经聊天窗口，推荐）：先用编辑器打开 secrets/LLM_API_KEY 粘贴保存，再运行不带参数的脚本
#   还原：powershell -ExecutionPolicy Bypass -File scripts/prepare-demo-ai.ps1 -Disable
#
# 做的事（启用时）：
#   1. 校验 secrets/LLM_API_KEY（参数优先；无参数时读文件，已是有效 key 则跳过写入）
#   2. 根目录 .env 写入 AI_EXECUTION_MODE=approved_cloud + ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS=true
#   3. docker compose up -d --no-build 重建三个容器使环境变量生效
#   4. 验证容器内环境变量 + 百炼端点连通性
param(
    [string]$LLMApiKey,
    [switch]$Disable
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

if ($Disable) {
    Write-Step "还原为 rules_only（不触碰 secrets/LLM_API_KEY）"
    Set-Content -Path .env -Value "AI_EXECUTION_MODE=rules_only", "ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS=false", "APP_URL=http://localhost:5000", "SUPABASE_URL=http://host.docker.internal:8000", "LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1", "APPROVED_CLOUD_LLM_BASE_URL=", "LLM_MODEL=qwen-plus", "RESUME_VL_MODEL=qwen-vl-max", "APPROVED_CLOUD_PROCESSORS=jd_parse,match_analysis,script_generate,resume_batch_analysis" -Encoding ascii
    docker compose up -d --no-build
    Write-Step "已还原，容器正在重建"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($LLMApiKey)) {
    # 无参数：从 secrets/LLM_API_KEY 文件读取（用户可用编辑器直接粘贴，不经聊天窗口）
    if (-not (Test-Path "secrets/LLM_API_KEY")) {
        throw "secrets/LLM_API_KEY 不存在：请用编辑器打开该文件粘贴真实 API Key 后重试，或改用 -LLMApiKey 参数"
    }
    $LLMApiKey = (Get-Content "secrets/LLM_API_KEY" -Raw).Trim()
    if ($LLMApiKey.Length -lt 20) {
        throw "secrets/LLM_API_KEY 当前为占位/无效值（$($LLMApiKey.Length) 字符），请用编辑器粘贴真实 API Key 后重试"
    }
    Write-Step "检测到 secrets/LLM_API_KEY 已是有效密钥（$($LLMApiKey.Length) 字符），跳过写入"
}
else {
    if ($LLMApiKey.Length -lt 20) {
        throw "API Key 长度异常（$($LLMApiKey.Length) 字符），请检查是否为真实密钥"
    }
    # 写入密钥（备份旧值，不回显）
    Write-Step "写入 secrets/LLM_API_KEY（旧值备份）"
    if (Test-Path "secrets/LLM_API_KEY") {
        Copy-Item "secrets/LLM_API_KEY" "secrets/LLM_API_KEY.bak" -Force
    }
    Set-Content -Path "secrets/LLM_API_KEY" -Value $LLMApiKey -NoNewline -Encoding ascii
}

# 2. 写 compose 环境变量（APP_URL/SUPABASE_URL 为 compose 必需变量；LLM 走 Coding Plan 编程套餐体系）
Write-Step "写入 .env：approved_cloud + Coding Plan 端点 + qwen3.7-plus"
Set-Content -Path .env -Value "AI_EXECUTION_MODE=approved_cloud", "ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS=true", "APP_URL=http://localhost:5000", "SUPABASE_URL=http://host.docker.internal:8000", "LLM_BASE_URL=https://coding.dashscope.aliyuncs.com/v1", "APPROVED_CLOUD_LLM_BASE_URL=https://coding.dashscope.aliyuncs.com/v1", "LLM_MODEL=qwen3.7-plus", "RESUME_VL_MODEL=qwen3.7-plus", "APPROVED_CLOUD_PROCESSORS=jd_parse,match_analysis,script_generate,resume_batch_analysis" -Encoding ascii

# 3. 重建容器（不重新构建镜像）
Write-Step "重建容器（docker compose up -d --no-build）"
docker compose up -d --no-build
if ($LASTEXITCODE -ne 0) { throw "docker compose 重建失败" }

# 4. 等待就绪并验证
Write-Step "等待应用就绪"
Start-Sleep -Seconds 10
docker exec zhipin_agent-app-1 node -e "const k=process.env;console.log('AI_EXECUTION_MODE='+(k.AI_EXECUTION_MODE||'<EMPTY>'));console.log('ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS='+(k.ALLOW_EXTERNAL_RESUME_BATCH_ANALYSIS||'<EMPTY>'))"
if ($LASTEXITCODE -ne 0) { throw "容器环境变量验证失败" }

# 5. 验证 LLM 端点连通性（用容器内密钥发最小 chat 请求，不回显 key；不用 /models 因为编程端点可能不支持）
Write-Step "验证 Coding Plan 端点连通性（qwen3.7-plus 最小 chat）"
$probe = docker exec zhipin_agent-app-1 node -e "const fs=require('fs');const key=fs.readFileSync('/run/secrets/LLM_API_KEY','utf8').trim();fetch(process.env.LLM_BASE_URL+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:process.env.LLM_MODEL,messages:[{role:'user',content:'ping'}],max_tokens:5})}).then(async r=>{const t=await r.text();console.log(r.status+' '+(t.slice(0,200).replace(/\n/g,' ')))})"
Write-Host $probe

Write-Step "完成。拍摄前剩余手工项：登录 demo@zhaopin.local + 数据源页租户审批 + 现场走全链路"
