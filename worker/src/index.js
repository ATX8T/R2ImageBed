/**
 * R2 ImageBed - Cloudflare Worker 后端
 *
 * 职责：
 *   1. 用 Cloudflare R2 Binding（无需 S3 凭证，直接桶绑定）操作 R2
 *   2. 提供列表 / 上传 / 删除 / 文件夹管理 / 链接生成 等 API
 *   3. 通过简单 Bearer Token 鉴权（避免 Worker 公网被滥用）
 *   4. CORS 全开放，方便 GitHub Pages 调用
 *
 * 配置（在 wrangler.toml + GitHub Secrets / Cloudflare Dashboard 中设置）：
 *   - R2 binding 名称：BUCKET
 *   - 环境变量：
 *       ACCESS_TOKEN     - 前端访问 Worker 时需带 Bearer，留空则关闭鉴权（不推荐）
 *       PUBLIC_BASE_URL  - 公开域名（如 https://pub-xxx.r2.dev），用于生成图片直链
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Prefix',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...CORS, ...extra },
  });
}

function ok(data) { return json({ ok: true, data }); }
function err(message, code = 'ERROR', status = 400) {
  return json({ ok: false, message, code }, status);
}

/** 简单 Bearer Token 鉴权 */
function checkAuth(request, env) {
  if (!env.ACCESS_TOKEN) return true; // 未设置则关闭鉴权
  const h = request.headers.get('Authorization') || '';
  return h === `Bearer ${env.ACCESS_TOKEN}`;
}

/** 规范化前缀（确保 / 结尾或为空） */
function normPrefix(p) {
  if (!p) return '';
  let s = String(p).replace(/^\/+/, '').replace(/\/+/g, '/');
  if (s && !s.endsWith('/')) s += '/';
  return s;
}

function sanitizeFilename(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

/** 拼接公开直链 */
function publicUrl(env, key) {
  const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encoded}`;
}

/* ===================== Handlers ===================== */

/** GET /api/health */
async function handleHealth(request, env) {
  return ok({
    ok: true,
    bucket: env.BUCKET ? 'bound' : 'NOT_BOUND',
    publicBase: env.PUBLIC_BASE_URL || '',
    authEnabled: !!env.ACCESS_TOKEN,
    timestamp: new Date().toISOString(),
  });
}

/** GET /api/config (公开信息：让前端知道公开域名) */
async function handleConfig(request, env) {
  return ok({
    publicBase: env.PUBLIC_BASE_URL || '',
    authEnabled: !!env.ACCESS_TOKEN,
  });
}

/** GET /api/objects?prefix=&token= */
async function handleListObjects(request, env, url) {
  const prefix = normPrefix(url.searchParams.get('prefix') || '');
  const cursor = url.searchParams.get('token') || undefined;

  const res = await env.BUCKET.list({
    prefix,
    delimiter: '/',
    limit: 1000,
    cursor,
  });

  const folders = (res.delimitedPrefixes || []);
  const files = (res.objects || [])
    .filter((o) => !o.key.endsWith('/'))
    .map((o) => ({
      key: o.key,
      size: o.size,
      lastModified: o.uploaded,
      etag: o.etag,
    }));

  return ok({
    folders,
    files,
    nextToken: res.truncated ? res.cursor : undefined,
  });
}

/** POST /api/objects?prefix=  (multipart/form-data: files=...) */
async function handleUpload(request, env, url) {
  const form = await request.formData();
  const files = form.getAll('files');
  if (!files.length) return err('未收到文件', 'NO_FILE', 400);

  const prefix = normPrefix(form.get('prefix') || url.searchParams.get('prefix') || '');
  const uploaded = [];

  for (const f of files) {
    if (!(f instanceof File)) continue;
    if (!f.type || !f.type.startsWith('image/')) {
      return err(`非图片文件被拒绝: ${f.name}`, 'INVALID_MIME', 400);
    }
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safeName = sanitizeFilename(f.name);
    const key = `${prefix}${ts}_${rand}_${safeName}`;

    await env.BUCKET.put(key, f.stream(), {
      httpMetadata: { contentType: f.type || 'application/octet-stream' },
    });

    uploaded.push({
      key,
      size: f.size,
      contentType: f.type,
      originalName: f.name,
      url: publicUrl(env, key),
    });
  }

  return ok({ uploaded });
}

/** DELETE /api/objects  body: {key} 或 {keys: [...]} */
async function handleDelete(request, env) {
  const body = await request.json().catch(() => ({}));
  const { key, keys } = body || {};

  if (key) {
    await env.BUCKET.delete(key);
    return ok({ key, deleted: true });
  }
  if (Array.isArray(keys) && keys.length) {
    // R2 binding 的 delete 支持数组（每次最多 1000）
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const slice = keys.slice(i, i + 1000);
      await env.BUCKET.delete(slice);
      deleted += slice.length;
    }
    return ok({ deleted });
  }
  return err('缺少 key/keys', 'INVALID_ARGUMENT', 400);
}

/** POST /api/objects/url  body: {key} */
async function handleSingleUrl(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body.key) return err('缺少 key', 'INVALID_ARGUMENT', 400);
  const u = publicUrl(env, body.key);
  if (!u) return err('Worker 未配置 PUBLIC_BASE_URL', 'NO_PUBLIC_DOMAIN', 400);
  return ok({ mode: 'public', url: u });
}

/** POST /api/objects/urls  body: {keys: [...]} */
async function handleBatchUrls(request, env) {
  const body = await request.json().catch(() => ({}));
  const { keys } = body || {};
  if (!Array.isArray(keys) || !keys.length) {
    return err('缺少 keys', 'INVALID_ARGUMENT', 400);
  }
  if (keys.length > 5000) return err('单次最多 5000 个 key', 'TOO_MANY_KEYS', 400);
  if (!env.PUBLIC_BASE_URL) return err('Worker 未配置 PUBLIC_BASE_URL', 'NO_PUBLIC_DOMAIN', 400);

  const items = keys.map((k) => ({ key: k, url: publicUrl(env, k) }));
  return ok({ items, success: items.length, failed: 0, mode: 'public' });
}

/** POST /api/objects/urls-by-prefix  body: {prefix} */
async function handleUrlsByPrefix(request, env) {
  const body = await request.json().catch(() => ({}));
  const prefix = normPrefix(body.prefix || '');
  if (!env.PUBLIC_BASE_URL) return err('Worker 未配置 PUBLIC_BASE_URL', 'NO_PUBLIC_DOMAIN', 400);

  // 递归列出所有 key（排除文件夹占位）
  const keys = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, limit: 1000, cursor });
    res.objects.forEach((o) => {
      if (!o.key.endsWith('/')) keys.push(o.key);
    });
    cursor = res.truncated ? res.cursor : undefined;
    if (keys.length > 5000) return err(`该目录对象超过 5000 个`, 'TOO_MANY_KEYS', 400);
  } while (cursor);

  const items = keys.map((k) => ({ key: k, url: publicUrl(env, k) }));
  return ok({ items, success: items.length, failed: 0, mode: 'public', total: items.length });
}

/** POST /api/objects/list-keys-by-prefix  body: {prefix} */
async function handleListKeysByPrefix(request, env) {
  const body = await request.json().catch(() => ({}));
  const prefix = normPrefix(body.prefix || '');
  const keys = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, limit: 1000, cursor });
    res.objects.forEach((o) => { if (!o.key.endsWith('/')) keys.push(o.key); });
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return ok({ keys, total: keys.length });
}

/** POST /api/folders  body: {prefix} */
async function handleCreateFolder(request, env) {
  const body = await request.json().catch(() => ({}));
  const prefix = normPrefix(body.prefix || '');
  if (!prefix) return err('文件夹名不能为空', 'INVALID_ARGUMENT', 400);
  await env.BUCKET.put(prefix, '', {
    httpMetadata: { contentType: 'application/x-directory' },
  });
  return ok({ prefix });
}

/** DELETE /api/folders?prefix=foo/   彻底删除（含所有对象） */
async function handleDeleteFolder(request, env, url) {
  const prefix = normPrefix(url.searchParams.get('prefix') || '');
  if (!prefix) return err('prefix 不能为空', 'INVALID_ARGUMENT', 400);

  const allKeys = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, limit: 1000, cursor });
    res.objects.forEach((o) => allKeys.push(o.key));
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);

  let deleted = 0;
  for (let i = 0; i < allKeys.length; i += 1000) {
    const slice = allKeys.slice(i, i + 1000);
    await env.BUCKET.delete(slice);
    deleted += slice.length;
  }
  return ok({ deleted });
}

/** POST /api/folders/empty  body: {prefix}  清空内容但保留文件夹 */
async function handleEmptyFolder(request, env) {
  const body = await request.json().catch(() => ({}));
  const prefix = normPrefix(body.prefix || '');
  if (!prefix) return err('prefix 不能为空', 'INVALID_ARGUMENT', 400);

  const keys = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, limit: 1000, cursor });
    res.objects.forEach((o) => { if (o.key !== prefix) keys.push(o.key); });
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);

  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const slice = keys.slice(i, i + 1000);
    await env.BUCKET.delete(slice);
    deleted += slice.length;
  }
  // 补回文件夹占位
  await env.BUCKET.put(prefix, '', {
    httpMetadata: { contentType: 'application/x-directory' },
  });
  return ok({ deleted });
}

/* ===================== Router ===================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 处理 CORS 预检
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // 不需要鉴权的路由
    if (path === '/' || path === '/api/health') {
      return handleHealth(request, env);
    }
    if (path === '/api/config' && method === 'GET') {
      return handleConfig(request, env);
    }

    // 其余 API 需鉴权
    if (path.startsWith('/api/')) {
      if (!checkAuth(request, env)) {
        return err('未授权，请在前端配置正确的 Access Token', 'UNAUTHORIZED', 401);
      }
      if (!env.BUCKET) {
        return err('Worker 未绑定 R2 Bucket，请在 wrangler.toml 中配置', 'NO_BUCKET', 500);
      }

      try {
        if (path === '/api/objects' && method === 'GET') return handleListObjects(request, env, url);
        if (path === '/api/objects' && method === 'POST') return handleUpload(request, env, url);
        if (path === '/api/objects' && method === 'DELETE') return handleDelete(request, env);
        if (path === '/api/objects/url' && method === 'POST') return handleSingleUrl(request, env);
        if (path === '/api/objects/urls' && method === 'POST') return handleBatchUrls(request, env);
        if (path === '/api/objects/urls-by-prefix' && method === 'POST') return handleUrlsByPrefix(request, env);
        if (path === '/api/objects/list-keys-by-prefix' && method === 'POST') return handleListKeysByPrefix(request, env);
        if (path === '/api/folders' && method === 'POST') return handleCreateFolder(request, env);
        if (path === '/api/folders' && method === 'DELETE') return handleDeleteFolder(request, env, url);
        if (path === '/api/folders/empty' && method === 'POST') return handleEmptyFolder(request, env);
      } catch (e) {
        return err(`服务异常：${e.message}`, 'INTERNAL', 500);
      }
    }

    return err('Not Found', 'NOT_FOUND', 404);
  },
};
