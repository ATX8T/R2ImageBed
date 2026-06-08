# 🌩 R2 ImageBed v3.0 - GitHub Pages 版

> 把 Cloudflare R2 当图床用，**静态前端托管在 GitHub Pages，后端跑在 Cloudflare Worker**。
> 凭证全部由 Cloudflare 端管理，前端只保存一个 Worker URL，更安全、更便宜（全程免费）。

🎯 在线演示：https://atx8t.github.io/R2ImageBed/ （Pages 部署后生效）

---

## 🏗️ 架构

```
浏览器 (atx8t.github.io/R2ImageBed)
   │  Bearer Token
   ▼
Cloudflare Worker (r2-imgbed.xxx.workers.dev)
   │  R2 Binding（无需 S3 SDK / Secret Key）
   ▼
Cloudflare R2 Bucket (tuchuang)
   │
   ▼
Public Development URL (pub-xxx.r2.dev)  ← 浏览器直链显示
```

| 层 | 技术 | 部署方式 | 计费 |
|---|---|---|---|
| 前端 | 原生 HTML/CSS/JS（无依赖） | GitHub Pages | 完全免费 |
| API 后端 | Cloudflare Worker (Node 兼容) | `wrangler deploy` | 每天 10 万请求免费 |
| 存储 | Cloudflare R2 | R2 控制台创建桶 | 10 GB 存储 / 月免费 |

---

## 📁 仓库结构

```
R2ImageBed/
├── web/                       前端（GitHub Pages 直接发布的目录）
│   ├── index.html
│   ├── css/app.css
│   └── js/{api,config,explorer,logs,app}.js
├── worker/                    Cloudflare Worker 后端
│   ├── src/index.js
│   ├── wrangler.toml          ⚠ 改桶名、公开域名
│   └── package.json
├── .github/workflows/
│   └── deploy.yml             自动部署 Worker + Pages
└── README.md
```

---

## 🚀 部署（首次）

### 第 1 步：创建 R2 桶 + 开启公共开发 URL

1. Cloudflare 控制台 → R2 → 创建桶（如名为 `tuchuang`）
2. 进入桶 → 设置 → **公共开发 URL** → 启用
3. 记下两个值：
   - **桶名**：`tuchuang`
   - **公开域名**：`https://pub-xxxxxxxxxxxx.r2.dev`

### 第 2 步：修改 `worker/wrangler.toml`

```toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "tuchuang"          # ← 改成你的桶名

[vars]
PUBLIC_BASE_URL = "https://pub-xxxxxxxxxxxx.r2.dev"   # ← 改成你的公开域名
```

### 第 3 步：在 GitHub 配置 Secrets

到 `Settings → Secrets and variables → Actions → New repository secret`：

| Secret 名 | 值 | 获取方式 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **必填** | [生成令牌](https://dash.cloudflare.com/profile/api-tokens) → 模板「Edit Cloudflare Workers」 |
| `CLOUDFLARE_ACCOUNT_ID` | **必填** | Cloudflare 首页右下角「Account ID」 |
| `ACCESS_TOKEN` | **强烈建议**填一个随机字符串 | 自己生成 32+ 位随机串（用于前端访问 Worker 鉴权） |

> 不设置 `ACCESS_TOKEN` 则 Worker 公网无鉴权，**会被滥用**，强烈推荐设置。

### 第 4 步：启用 GitHub Pages

`Settings → Pages → Source: GitHub Actions`

### 第 5 步：推送代码触发部署

```bash
git add . && git commit -m "init: r2-imgbed v3" && git push
```

Actions 会自动：
1. 部署 Worker → 输出 URL（形如 `https://r2-imgbed.<你的子域>.workers.dev`）
2. 部署 Pages → `https://<用户名>.github.io/R2ImageBed/`

### 第 6 步：在前端配置 Worker URL

打开 Pages 地址，点右上角 ⚙ 设置：
- **Worker URL**：填上一步部署得到的 Worker URL
- **Access Token**：填 GitHub Secret 中设置的 `ACCESS_TOKEN`（必须完全一致）

保存 → 测试连接 → 成功 ✓

---

## 🛠 本地开发

### Worker 本地调试

```bash
cd worker
npm install
# 使用 Cloudflare 账号登录（首次）
npx wrangler login
# 启动本地开发服务器（默认 8787）
npm run dev
```

### 前端本地预览

任何静态服务器都可以，例如 Python：

```bash
cd web
python3 -m http.server 8080
# 浏览器打开 http://127.0.0.1:8080
# 设置 Worker URL 为 http://127.0.0.1:8787
```

---

## 🆚 与 v2.0（Docker 版）对比

| 维度 | v2.0 Docker | v3.0 GitHub Pages |
|---|---|---|
| 部署 | 自建服务器 + Docker | GitHub Pages + Cloudflare Worker |
| 月费 | VPS 至少 ~$5 | **全免费**（在 Cloudflare 免费额度内） |
| 凭证 | 前端填 S3 Access Key | 仅填 Worker URL（凭证留在 Cloudflare 端） |
| 安全 | 凭证存服务器 config.json | 凭证存 Cloudflare 环境变量，前端完全不接触 |
| 维护 | 监控服务器、续费、备份 | 零维护 |
| 自定义域名 | 自己买 + Nginx + 证书 | GitHub Pages 自带 CNAME 支持 |

---

## 📝 功能清单

✅ 拖拽 / 点击上传图片（多文件、按文件夹组织、实时进度）
✅ 文件夹管理：创建 / 清空 / 递归删除 / 面包屑导航
✅ 批量选择 / 全选 / 反选 / 批量删除 / 批量复制链接
✅ 链接生成：URL / Markdown / HTML / JSON 四种格式
✅ 批量下载链接 .txt
✅ 缩略图预览 / 大图预览 / 目录搜索

---

## ⚠️ 关于「预签名 URL」

v2.0 支持公开直链 + 预签名两种模式。v3.0 **暂不支持预签名**——因为 Worker 的 R2 Binding 不直接提供预签名 API，需要再额外接 S3 SDK 才能做。
所有图片访问统一通过你的 R2「公共开发 URL」，桶必须设为公开。

如果你的桶不公开，又想分享，方案：
- 在 Worker 中加 `/api/proxy/<key>` 路由，直接代理读取 R2 对象内容返回
- 或单独部署一个 S3 SDK 版的子 Worker 做预签名

后续如有需求可加。

---

## 🔧 故障排查

| 现象 | 排查 |
|---|---|
| 设置连接测试失败 | Worker URL 写错；网络问题；CLOUDFLARE_API_TOKEN 没权限 |
| 401 Unauthorized | 前端 Access Token 与 Worker 端 ACCESS_TOKEN 不一致 |
| 500 NO_BUCKET | wrangler.toml 中没绑定 R2 桶；Worker 未重新部署 |
| 图片显示不出来 | 桶没开「公共开发 URL」；PUBLIC_BASE_URL 配错 |
| 上传 CORS 错误 | Worker 必须返回 CORS 头（已内置） |

查看 Worker 实时日志：
```bash
cd worker && npx wrangler tail
```

---

## 📜 License

MIT
