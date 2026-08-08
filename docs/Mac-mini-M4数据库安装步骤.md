# Mac mini M4 · 自托管 Supabase 数据库安装步骤

> 独立执行手册。目标：在 Mac mini M4（Apple Silicon / ARM64）上用 Docker 自托管一套 Supabase，作为智聘Agent 私有部署的数据库。
> 装完后，智聘 Agent 应用改连这台机器即可，`@supabase/supabase-js` 业务代码零改动。

---

## 0. 前置说明

- **为什么用自托管 Supabase 而不是裸 Postgres/MySQL**：项目代码用 `supabase.from()` 走 Supabase API 网关和 PostgREST，不是直接执行 SQL。自托管整套 Supabase 才能保留现有 `@supabase/supabase-js` 查询代码。
- **机器**：Mac mini M4（ARM64），建议常开，并在路由器中为它设置 DHCP 地址保留，避免内网 IP 变化。
- **资源**：建议至少 4 核 CPU、8 GB 内存、80 GB SSD 空间。
- **端口**：Supabase 网关/Studio 使用 `8000`；PostgreSQL 默认经 Supavisor 提供会话模式 `5432` 和事务模式 `6543`，数据库容器本身默认不直接暴露。
- **当前远程维护链路**：异地管理电脑通过 FRP 公网入口 `<FRP_HOST>:<FRP_SSH_PORT>` 转发到 Mac mini 的 SSH `22` 端口；macOS 登录用户为 `<MAC_USER>`。FRP 服务端的 `root` 账号不是 Mac 的 SSH 用户。
- **已核验主机指纹**：部署时在 Mac mini 上执行 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 记录 ED25519 主机指纹，写入本文档的私有副本（不要提交到公开仓库）。首次连接或主机密钥变化时必须重新人工核对。
- **网络边界**：FRP 只保留 SSH 转发。Studio、Supabase API 和 PostgreSQL 通过 SSH 本地端口转发访问，不再直接新增 `5000/8000/5432` 公网映射。

---

## 1. 配置 Mac mini 的 SSH 密钥登录

以下步骤以 **Windows 管理电脑连接 Mac mini** 为例。私钥始终保存在 Windows 管理电脑上，不要复制到项目目录、聊天窗口或 Mac mini。

### 1.1 在 Mac mini 开启远程登录

1. 打开“系统设置 → 通用 → 共享”。
2. 打开“远程登录”，点击旁边的信息按钮。
3. “允许访问”选择“仅这些用户”，只添加负责维护智聘 Agent 的 macOS 账号。
4. 本项目不需要远程读取整块磁盘，通常不要开启“允许远程用户拥有完整磁盘访问权限”。
5. 在 Mac 终端确认用户名、内网 IP 和 SSH 主机指纹：

   ```bash
   whoami
   ipconfig getifaddr en0
   ipconfig getifaddr en1
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   ```

   `en0`/`en1` 可能分别对应 Wi-Fi 或有线网卡，以能返回内网 IP 的结果为准。记下此处显示的用户名与主机指纹，后续每次连接都必须核对一致。

### 1.2 在 Windows 生成独立密钥

在 Windows PowerShell 中执行：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -a 100 -C "zhipin-agent-mac-mini" -f "$env:USERPROFILE\.ssh\zhipin_macmini_ed25519"
```

建议设置一个密钥口令。生成后：

- `zhipin_macmini_ed25519` 是私钥，严禁发送或提交到 Git。
- `zhipin_macmini_ed25519.pub` 是公钥，可以安装到 Mac mini。

### 1.3 通过当前 FRP 链路安装公钥

先确认公钥文件存在，再用 `scp` 上传。不要使用 PowerShell 管道直接写 `authorized_keys`，以免源文件不存在或编码问题把无效内容写进去：

```powershell
Test-Path "$env:USERPROFILE\.ssh\zhipin_macmini_ed25519.pub"

scp -P <FRP_SSH_PORT> `
  -i "$env:USERPROFILE\.ssh\zhipin_macmini_ed25519" `
  "$env:USERPROFILE\.ssh\zhipin_macmini_ed25519.pub" `
  <MAC_USER>@<FRP_HOST>:~/zhipin_macmini_ed25519.pub

ssh -p <FRP_SSH_PORT> <MAC_USER>@<FRP_HOST> "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF -f ~/zhipin_macmini_ed25519.pub ~/.ssh/authorized_keys || cat ~/zhipin_macmini_ed25519.pub >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; rm ~/zhipin_macmini_ed25519.pub"
```

第一次执行 `scp`/`ssh` 会要求输入一次 Mac 登录密码。显示主机指纹时，必须与本节开头记录的指纹完全一致，再输入 `yes`。

### 1.4 验证并配置快捷名称

先验证当前 FRP 链路上的密钥登录：

```powershell
ssh -p <FRP_SSH_PORT> -i "$env:USERPROFILE\.ssh\zhipin_macmini_ed25519" <MAC_USER>@<FRP_HOST>
```

验证成功后，在 Windows PowerShell 执行 `notepad "$env:USERPROFILE\.ssh\config"`，加入：

```sshconfig
Host zhipin-mac
    HostName <FRP_HOST>
    Port <FRP_SSH_PORT>
    User <MAC_USER>
    IdentityFile ~/.ssh/zhipin_macmini_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

之后可直接连接：

```powershell
ssh zhipin-mac
```

如果私钥设置了口令，可在“以管理员身份运行”的 PowerShell 中启用 Windows SSH Agent，再加载一次私钥：

```powershell
Set-Service ssh-agent -StartupType Automatic
Start-Service ssh-agent
ssh-add "$env:USERPROFILE\.ssh\zhipin_macmini_ed25519"
```

> 只有在新开一个终端、确认 `ssh zhipin-mac` 可以正常登录之后，才考虑关闭密码登录。日常内网部署保留密码作为本地恢复手段也可以；关键是“仅这些用户”、强密码、密钥登录和不向公网开放 22 端口。

### 1.5 通过 SSH 隧道管理数据库和应用

由于管理电脑和 Mac mini 不在同一内网，不为 Supabase 额外开放公网端口。在 Windows PowerShell 中保持下面的命令运行：

```powershell
ssh -N `
  -L 5000:127.0.0.1:5000 `
  -L 8000:127.0.0.1:8000 `
  -L 15432:127.0.0.1:5432 `
  -o ExitOnForwardFailure=yes `
  zhipin-mac
```

随后在 Windows 浏览器访问 `http://localhost:5000` 打开智聘 Agent，访问 `http://localhost:8000` 打开 Studio；需要从 Windows 连接 PostgreSQL 时使用 `127.0.0.1:15432`。关闭该 PowerShell 窗口后隧道随即关闭，不影响 Mac mini 上的应用和数据库运行。

---

## 2. 安装依赖

1. **容器运行时（推荐 Colima，纯命令行、开源免费、无商业授权顾虑）**

   Docker Desktop 偏重且公司使用有商业授权限制。Mac mini 上推荐用 **Colima**，它提供与 Docker 完全一致的 `docker` / `docker compose` 命令，全程命令行搞定。

   ```bash
   # 若无 Homebrew，先装：/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install colima docker docker-compose node pnpm

   # 让 Docker CLI 能找到 Homebrew 安装的 Compose 插件
   mkdir -p ~/.docker/cli-plugins
   ln -sfn "$(brew --prefix)/lib/docker/cli-plugins/docker-compose" \
     ~/.docker/cli-plugins/docker-compose

   # 启动虚拟机（Supabase 官方推荐 4 核、8 GB+ 内存、80 GB+ SSD）
   colima start --cpu 4 --memory 8 --disk 80

   # 首次参数保存后先正常停止，再交给登录服务启动
   colima stop
   brew services start colima

   # 验证
   colima status
   docker info
   docker compose version
   node --version
   pnpm --version
   ```

   > 备选：也可用 **OrbStack**（体验最好但商业需授权）或官方 **Docker Desktop for Mac (Apple Silicon)**。任选其一即可，后续 `docker compose` 命令完全通用。

2. **Git**（macOS 一般自带，没有则 `xcode-select --install`）
   ```bash
   git --version
   ```

---

## 3. 获取 Supabase 自托管配置

```bash
# 首次安装：创建独立的运行目录，不要直接在 Supabase 源码目录里维护生产 .env
mkdir -p ~/servers && cd ~/servers

# 拉取最新一层源码
git clone --depth 1 https://github.com/supabase/supabase

# 按官方手册复制 Docker 配置到独立目录
mkdir -p supabase-project
cp -rf supabase/docker/* supabase-project

# 复制环境变量模板
cp supabase/docker/.env.example supabase-project/.env
cd supabase-project
```

此时 `~/servers/supabase-project` 下有 `docker-compose.yml`、`run.sh`、`utils/` 和 `.env`。以上复制命令只用于首次安装，后续更新不要覆盖已配置的 `.env`。

---

## 4. 本地生成密钥并配置 `.env`

不要启动带默认密钥的 Supabase，也不要把 `JWT_SECRET` 输入任何在线生成器。全部密钥都在 Mac mini 本地生成：

```bash
cd ~/servers/supabase-project

# 生成 POSTGRES_PASSWORD、JWT_SECRET、ANON_KEY、SERVICE_ROLE_KEY 等旧版兼容密钥
sh utils/generate-keys.sh --update-env

# 生成新版 publishable/secret API keys 和非对称 JWT 密钥，并写入 .env
sh utils/add-new-auth-keys.sh --update-env
```

完成后检查 `.env`，至少确认以下变量已设置且不再是模板默认值：

| 变量 | 用途 |
|------|------|
| `POSTGRES_PASSWORD` | PostgreSQL 与 Supavisor 连接密码 |
| `JWT_SECRET` | legacy JWT 签名与兼容验证 |
| `ANON_KEY` | 当前智聘 Agent 使用的匿名 API key |
| `SERVICE_ROLE_KEY` | 当前服务端和 Worker 使用的管理 API key |
| `SUPABASE_PUBLISHABLE_KEY` | 新版客户端 API key，保留用于后续迁移 |
| `SUPABASE_SECRET_KEY` | 新版服务端 API key，严禁暴露到浏览器 |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Studio 基础认证账号 |
| `SECRET_KEY_BASE` / `VAULT_ENC_KEY` | Supabase 内部服务密钥 |
| `POOLER_TENANT_ID` | Supavisor 租户标识，建议改为固定且易识别的 `zhipin` |

本项目当前通过 SSH 隧道维护，服务与应用计划同机运行，所以保持环回地址，不填写 FRP 公网地址：

```dotenv
SUPABASE_PUBLIC_URL=http://localhost:8000
API_EXTERNAL_URL=http://localhost:8000/auth/v1
SITE_URL=http://localhost:5000
ADDITIONAL_REDIRECT_URLS=http://localhost:5000
POOLER_TENANT_ID=zhipin
```

`generate-keys.sh` 不带 `--update-env` 时只会把结果打印到终端，不会更新 `.env`，因此首次安装必须保留上面的参数。`add-new-auth-keys.sh` 需要 Node.js 16 或更高版本；第 2 步已安装 Node。生成后只检查变量是否已设置，不要把密钥值复制到聊天或普通日志。

> ⚠️ 本项目兼容注意：`add-new-auth-keys.sh` 会向 `.env` 写入 `JWT_JWKS`，使 PostgREST 改用非对称密钥集校验 JWT；而智聘 Agent 服务端 RLS 令牌当前仍以 legacy `JWT_SECRET` 做 HS256 签名，校验将失败，表现为登录后接口 401 / “用户不存在”。若运行了该脚本，必须从 `.env` 删除 `JWT_JWKS` 行（或把 `PGRST_JWT_SECRET` 显式设为 `${JWT_SECRET}`），再 `docker compose up -d rest` 生效。若不需要新版 publishable keys，可跳过 `add-new-auth-keys.sh`，只运行 `generate-keys.sh`。

可以在 Mac mini 本机用下面的命令查看应用需要的凭证，但它会同时显示 PostgreSQL、Dashboard、API 和 S3 的有效凭据。只逐项写入目标配置文件，不要整段复制、截图，或把输出粘贴到聊天、工单和日志中：

```bash
sh run.sh secrets
```

如果输出曾离开受控终端，应把其中出现的所有凭据视为已暴露：API/JWT 和 S3 密钥需要重新生成，Dashboard 密码需要更换；已初始化的 PostgreSQL 不能只改 `.env`，还必须同步更新数据库内部角色密码并重建容器。

> 智聘 Agent 当前仍读取 `ANON_KEY` / `SERVICE_ROLE_KEY` 对应的 legacy key。Supabase 当前版本同时兼容 legacy 和新版 API keys，因此暂不需要改业务代码。

---

## 5. Apple Silicon（ARM）兼容说明

Supabase 核心镜像可在 Apple Silicon 上运行。当前默认 Docker 配置不启用 Logs & Analytics，因此不需要预先手工注释 `analytics` 或 `vector`。

若以后主动运行 `sh run.sh config add logs` 启用日志组件，并遇到 ARM 镜像或资源问题，可用下面的命令撤销该可选配置：

```bash
sh run.sh config remove logs
sh run.sh recreate
```

macOS 容器 bind mount 对扩展属性和权限的支持可能影响 Supabase Storage。智聘 Agent 当前数据库核心功能不依赖 Storage；若以后启用文件上传，应按 Supabase 官方 macOS Storage 指南改为 named volume 后再验收。

---

## 6. 启动

```bash
cd ~/servers/supabase-project
docker compose pull       # 首次拉取镜像时间较长
sh run.sh start           # 等待服务进入 healthy 状态
docker compose ps
```

### 6.1 Docker Hub 在当前网络超时时

Supabase 官方 Compose 的镜像默认来自 Docker Hub。部分网络出口实测 Docker Hub 超时，但 GitHub Container Registry（GHCR）和 AWS Public ECR 可访问。若下面的测试超时，说明是出口限制，并非 Colima 或 Compose 安装失败：

```bash
curl --max-time 15 https://registry-1.docker.io/v2/
```

本项目提供 `scripts/docker-compose.official-registries.yml`，把相同版本号的镜像切换到各项目的官方 GHCR 地址；Kong 使用 AWS Public ECR 中的 Docker Official Image。所有条目均已核对包含 ARM64 架构。先在 Windows 项目根目录上传该文件：

```powershell
scp scripts/docker-compose.official-registries.yml `
  zhipin-mac:~/servers/supabase-project/docker-compose.official-registries.yml
```

再登录 Mac mini 启用覆盖配置并拉取：

```bash
cd ~/servers/supabase-project
sh run.sh config add official-registries
docker compose config --images
docker compose pull
```

覆盖文件不修改 Supabase 官方 `docker-compose.yml`。以后升级 Supabase 时，必须同步比较官方的新镜像版本并更新覆盖文件，不能长期沿用旧标签。

如果 GHCR 或 Public ECR 以后也不可用，优先使用公司已有的出站代理或受控的企业镜像仓库。不要从搜索结果随意选择匿名公共镜像站。取得可信的 `<mirror-url>` 后执行：

```bash
colima stop
colima start --edit
```

把配置文件中的 `docker: {}` 改为：

```yaml
docker:
  registry-mirrors:
    - <mirror-url>
```

保存退出并确认 `colima status` 正常。若继续使用登录自启，先停止当前前台实例，再重新交给服务启动：

```bash
colima stop
brew services restart colima
docker info
docker compose pull
```

镜像加速地址属于运维配置，只写入 Mac mini 的 Colima 配置，不提交到项目仓库。阿里云个人镜像加速器可能不再同步最新标签；生产环境更适合受控代理或 ACR 制品订阅。

如果有服务没有进入 healthy 状态，先运行官方诊断脚本，再查看具体服务日志：

```bash
sh tests/test-container-logs.sh
sh run.sh logs db
sh run.sh logs kong
```

---

## 7. 验证访问

- **Studio 管理界面**：浏览器打开 `http://localhost:8000`
  - 用 `.env` 里设的 `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` 登录。
- **异地管理电脑**：先按 1.5 节建立 SSH 隧道，再访问 `http://localhost:8000`。
- **现场可信局域网**：确有需要时才使用 `http://<mac-mini内网IP>:8000`；macOS 防火墙只允许可信网段访问，不要通过关闭整个防火墙来长期解决问题。

> 当前版本把 `GET /rest/v1/` 的 OpenAPI 根路由限制为 `admin`，所以用 anon 或 publishable key 请求该地址返回 `403` 是预期行为，不代表 REST 故障。匿名权限应使用实际业务表接口验证；数据库尚未迁移时，也可请求一个不存在的表，收到 PostgREST 的 `404/PGRST205` 即表示请求已通过 Kong 的 key 与 ACL 校验。

仅建议在本机或可信局域网使用明文 HTTP。当前跨网络管理统一走 SSH 隧道；若以后要给终端用户公开服务，再单独配置域名、HTTPS 反向代理和访问控制。

---

## 8. 初始化智聘 Agent 的表结构与数据

项目已有迁移 SQL、一次性组织管理员初始化命令和演示数据脚本。

**方式一：用 Studio SQL Editor（最简单）**
1. Studio → SQL Editor → New query。
2. 把项目 `scripts/migrate.sql` 全文粘贴进去 → Run。
3. 按 `.env.example` 临时注入 `BOOTSTRAP_*` 变量，执行 `pnpm admin:bootstrap`，成功后立即删除这些 Secret。
4. 应用侧再跑 `pnpm seed:demo`（需先配好应用 `.env.local`，见第 9 步）。

**方式二：使用项目迁移命令（推荐自动化部署使用）**

```bash
cd <智聘Agent项目目录>
pnpm db:migrate
pnpm admin:bootstrap
pnpm seed:demo
```

`pnpm db:migrate` 读取第 9 步 `.env.local` 中的 `PGDATABASE_URL`。如果只想手动使用 `psql`，默认应通过 Supavisor 会话模式连接：

```bash
cd <智聘Agent项目目录>
psql -h localhost -p 5432 -U "postgres.<POOLER_TENANT_ID>" -d postgres -f scripts/migrate.sql
```

按提示输入 `POSTGRES_PASSWORD`。`POOLER_TENANT_ID=zhipin` 时用户名就是 `postgres.zhipin`。

> `boss_search_tasks` 已包含在 `scripts/migrate.sql` 中；应用启动时 `src/instrumentation.ts` 也会使用 `PGDATABASE_URL` 做幂等检查。

---

## 9. 应用和 Worker 连接配置

在智聘 Agent 项目目录中复制模板：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少配置：

```dotenv
# 应用与 Supabase 同机时用 localhost；异机用 Mac mini 内网 IP
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=<第4步生成的 ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<第4步生成的 SERVICE_ROLE_KEY>

# Worker 生成的结构化简历目录；standalone 生产进程必须使用绝对路径
BOSS_RESUME_DIR=/Users/<MAC_USER>/servers/zhipin-agent/assets/简历

# Supavisor 会话模式，POOLER_TENANT_ID=zhipin
PGDATABASE_URL=postgresql://postgres.zhipin:<URL编码后的POSTGRES_PASSWORD>@localhost:5432/postgres
```

若密码包含 URL 保留字符，必须先进行百分号编码；或者按第 8 步使用交互式 `psql`，避免把密码直接写进命令行。应用还需要按 `.env.example` 配置 LLM 和三个彼此独立的应用安全密钥：

```bash
# 分别执行三次，将三个不同结果填入 ENCRYPTION_KEY、HMAC_KEY、JWT_SECRET
openssl rand -hex 32
```

应用的 `JWT_SECRET` 与 Supabase 运行目录中的 `JWT_SECRET` 用途不同，不要复用。另将 Supabase 运行目录中的 `JWT_SECRET` 原样写入应用的 `SUPABASE_JWT_SECRET`；该变量仅用于服务端签发短期 RLS 令牌。应用侧统一使用 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 变量名。

若使用百炼 Coding Plan，配置必须与套餐端点匹配，并注意模型 ID 区分大小写：

```dotenv
LLM_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
LLM_MODEL=qwen3.7-plus
```

`Qwen3.7-plus`（大写 `Q`）会被接口判定为不支持；可用模型名以[阿里云百炼 Coding Plan 官方列表](https://help.aliyun.com/zh/model-studio/coding-plan)为准。

配置 Boss Worker：

```bash
cp assets/.env.worker.example assets/.env.worker
```

编辑 `assets/.env.worker`：

```dotenv
WORKER_SUPABASE_URL=http://localhost:8000
WORKER_SUPABASE_KEY=<第4步生成的 SERVICE_ROLE_KEY>
```

`SERVICE_ROLE_KEY` 可以绕过 RLS，只能保存在服务端 `.env.local` 和 Worker 的 `.env.worker`，不能发送给浏览器或提交到 Git。

Mac mini 首次准备 Worker：

```bash
brew install uv
cd ~/servers/zhipin-agent/assets
uv sync --frozen
uv run --frozen boss.py doctor
uv run --frozen boss.py login
```

最后一条命令会首次下载约 400 MB 的 Chromium 并打开窗口，需要在 Mac mini 屏幕前完成 Boss 登录。登录完成前不要启动后台 Worker。

Worker 默认使用 `CANDIDATE_REPORT_MODE=local` 在 Mac mini 本地生成 `candidate-analysis 0.2.0` 六维报告，不把完整简历发送给外部模型。只有完成候选人隐私和服务商合规评估后，才可同时配置 `CANDIDATE_REPORT_MODE=external_ai` 与 `ALLOW_EXTERNAL_RESUME_ANALYSIS=true`。结构化简历、报告和其他实现方案详见 `docs/Boss结构化简历与candidate-analysis报告方案.md`。

---

## 10. 开机自启与运维

- **开机自启**：首次执行带资源参数的 `colima start` 后，先运行 `colima stop`，再运行 `brew services start colima`。这样 Homebrew 登录服务会稳定接管 Colima；不要在一个已经手工运行的实例上重复启动该服务。
- **智聘 Agent 自启**：应用安装在 `~/servers/zhipin-agent`，launchd 标签为 `com.zhipin.agent`，仅监听 `127.0.0.1:5000`。常用检查与重启命令：
  ```bash
  launchctl print gui/$(id -u)/com.zhipin.agent
  launchctl kickstart -k gui/$(id -u)/com.zhipin.agent
  tail -f ~/Library/Logs/zhipin-agent.log
  tail -f ~/Library/Logs/zhipin-agent.error.log
  ```
- **Boss Worker 自启**：完成 `boss.py login` 后，Worker 由 launchd 标签 `com.zhipin.worker` 持续轮询任务队列。常用检查与重启命令：
  ```bash
  launchctl print gui/$(id -u)/com.zhipin.worker
  launchctl kickstart -k gui/$(id -u)/com.zhipin.worker
  tail -f ~/Library/Logs/zhipin-worker.log
  tail -f ~/Library/Logs/zhipin-worker.error.log
  ```
- **停止/重启**：
  ```bash
  cd ~/servers/supabase-project
  sh run.sh stop
  sh run.sh start
  sh run.sh restart db
  ```
- **备份数据库**（定期）：
  ```bash
  cd ~/servers/supabase-project
  mkdir -p ~/backups/zhipin
  docker compose exec -T db pg_dump -U postgres -d postgres -Fc > ~/backups/zhipin/postgres_$(date +%Y%m%d_%H%M%S).dump
  ```
- **备份要求**：把备份再复制到 Mac mini 之外的受保护存储，并定期在独立测试环境做恢复演练；只生成文件但从未验证恢复，不算有效备份。
- **数据目录**：数据库和 Storage 数据位于运行目录下的 `volumes/db/data`、`volumes/storage` 等路径。删除普通容器通常不会删除这些目录，但 `sh reset.sh` 会清理数据库和 Storage 数据。
- **危险命令**：不要在生产目录执行 `sh reset.sh`、`docker compose down -v` 或 `colima delete`，除非已确认备份并明确要清空数据。
- **密钥备份**：Supabase `.env`、应用 `.env.local` 和 Worker `.env.worker` 应保存到受控的密码库或秘密管理系统，不要提交到 Git。
- **升级**：更新镜像或 Supabase 配置前先备份，阅读官方 self-hosted changelog，再使用 `sh run.sh pull` 和 `sh run.sh recreate [service]` 分服务更新。

---

## 11. 验收清单

- [ ] 管理电脑执行 `ssh zhipin-mac` 可通过 `<FRP_HOST>:<FRP_SSH_PORT>` 使用密钥登录，主机指纹已核验
- [ ] Windows 建立 SSH 隧道后，`http://localhost:8000` 可访问且未新增 8000/5432 公网映射
- [x] `docker compose ps` 所有核心服务 running/healthy
- [x] `http://localhost:8000` Studio 能用自设账号登录
- [ ] 局域网 `http://<mac-mini-ip>:8000` 可访问
- [ ] 防火墙仅允许可信局域网访问所需端口，公网未直接暴露 `22/5000/8000/5432`
- [x] `scripts/migrate.sql` 执行成功，8 张表就位
- [x] 应用 `.env.local` 填好 URL + anon + service_role + PGDATABASE_URL
- [x] 应用由 launchd 后台启动，仅监听 `127.0.0.1:5000`
- [ ] 已通过一次性 CLI 创建管理员、完成首次改密，看板和百炼 AI 请求验证通过
- [x] `boss_worker.py` 的 `.env.worker` 指向同一套 Supabase，登录态有效且 launchd 空队列轮询正常
- [ ] 使用一个真实 JD 完成首次 Boss 搜索任务的端到端验收
- [ ] 已生成离机备份，并完成至少一次独立恢复验证

---

## 附：数据库方案说明（非当前安装步骤）

若后续想去掉整套 Supabase、只跑一个原生 Postgres：

```bash
brew install postgresql@16
brew services start postgresql@16
```

但这需要把应用和 Python Worker 的数据层从 Supabase/PostgREST 改为 PostgreSQL 驱动，并重新验证查询、鉴权、迁移和任务队列逻辑，当前不采用。

**不建议改用 MySQL**：Supabase 的数据库必须是 PostgreSQL，项目 Schema 也使用 `drizzle-orm/pg-core`、`JSONB`、`ILIKE`、PostgREST 过滤和 Supabase upsert 语义。改成 MySQL 不是替换连接串，而是一次完整的数据层迁移，当前没有足够收益。

---

## 官方参考

- [Supabase：Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase：New API Keys and Asymmetric Authentication](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)
- [Colima：配置 Docker registry mirror](https://github.com/abiosoft/colima/blob/main/docs/FAQ.md#how-to-customize-docker-config-eg-adding-insecure-registries-or-registry-mirrors)
- [阿里云 ACR：Docker Hub 镜像拉取与加速说明](https://help.aliyun.com/zh/acr/user-guide/accelerate-the-pulls-of-docker-official-images)
- [Apple：允许远程电脑访问你的 Mac](https://support.apple.com/zh-cn/guide/mac-help-cn/mchlp1066/mac)
