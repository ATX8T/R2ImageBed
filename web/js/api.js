/* 全局 API 与工具 - v3.0 GitHub Pages 版
 * 改造：所有 API 调用通过 WORKER_URL 前缀转发到 Cloudflare Worker
 * 凭证（Worker URL + Access Token）保存在浏览器 localStorage
 */
(function () {
  'use strict';

  const LS_KEY = 'r2-imgbed-conf:v3';

  /** 本地配置 */
  const Conf = {
    load() {
      try {
        return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      } catch (_) { return {}; }
    },
    save(obj) {
      const cur = Conf.load();
      const next = { ...cur, ...obj };
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    },
    clear() { localStorage.removeItem(LS_KEY); },
  };

  function workerUrl() {
    return (Conf.load().workerUrl || '').replace(/\/+$/, '');
  }

  function authHeaders() {
    const t = Conf.load().accessToken;
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function request(path, options = {}) {
    const base = workerUrl();
    if (!base) {
      const err = new Error('请先配置 Worker URL（点击右上角 ⚙ 设置）');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }
    const opts = { headers: { ...authHeaders() }, ...options };
    opts.headers = { ...authHeaders(), ...(options.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    try {
      const res = await fetch(base + path, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const err = new Error(data.message || `HTTP ${res.status}`);
        err.code = data.code;
        err.status = res.status;
        throw err;
      }
      return data.data;
    } catch (err) {
      if (err.name === 'TypeError') {
        const newErr = new Error('网络错误：无法连接 Worker，请检查 URL 是否正确（应类似 https://xxx.workers.dev）');
        newErr.code = 'NETWORK';
        throw newErr;
      }
      console.error('[api]', path, err);
      throw err;
    }
  }

  function uploadWithProgress(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const base = workerUrl();
      if (!base) return reject(Object.assign(new Error('请先配置 Worker URL'), { code: 'NOT_CONFIGURED' }));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', base + path);
      const h = authHeaders();
      Object.keys(h).forEach((k) => xhr.setRequestHeader(k, h[k]));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300 && data.ok) resolve(data.data);
          else reject(Object.assign(new Error(data.message || `HTTP ${xhr.status}`), { code: data.code, status: xhr.status }));
        } catch (e) { reject(e); }
      };
      xhr.onerror = () => reject(new Error('网络错误'));
      xhr.send(formData);
    });
  }

  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function fmtTime(t) {
    if (!t) return '';
    const d = new Date(t);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function toast(msg, type = 'info', duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), duration);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板', 'success');
    } catch (_e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制', 'success'); }
      catch (_e2) { toast('复制失败，请手动复制', 'error'); }
      document.body.removeChild(ta);
    }
  }

  window.API = {
    Conf,
    config: {
      get: async () => {
        const local = Conf.load();
        // 如果 worker 可达，附加远程 health 信息
        try {
          const remote = await request('/api/config');
          return { ...local, ...remote, configured: !!local.workerUrl };
        } catch (_) {
          return { ...local, configured: !!local.workerUrl };
        }
      },
      /** 保存本地配置（workerUrl, accessToken 等） */
      save: async (body) => Conf.save(body),
      test: () => request('/api/health'),
    },
    objects: {
      list: (prefix = '', token) => {
        const q = new URLSearchParams();
        if (prefix) q.set('prefix', prefix);
        if (token) q.set('token', token);
        return request(`/api/objects?${q}`);
      },
      upload: (formData, onProgress) => uploadWithProgress('/api/objects', formData, onProgress),
      del: (keys) => request('/api/objects', { method: 'DELETE', body: Array.isArray(keys) ? { keys } : { key: keys } }),
      url: (key) => request('/api/objects/url', { method: 'POST', body: { key } }),
      urls: (keys) => request('/api/objects/urls', { method: 'POST', body: { keys } }),
      urlsByPrefix: (prefix) => request('/api/objects/urls-by-prefix', { method: 'POST', body: { prefix } }),
      listKeysByPrefix: (prefix) => request('/api/objects/list-keys-by-prefix', { method: 'POST', body: { prefix } }),
    },
    folders: {
      create: (prefix) => request('/api/folders', { method: 'POST', body: { prefix } }),
      del: (prefix) => request(`/api/folders?prefix=${encodeURIComponent(prefix)}`, { method: 'DELETE' }),
      empty: (prefix) => request('/api/folders/empty', { method: 'POST', body: { prefix } }),
    },
    /** 静态版无后端日志（保留 stub 给 logs.js 不报错） */
    logs: {
      tail: async () => ({ items: [], message: '静态部署模式：日志直接看 Worker 控制台 (wrangler tail)' }),
    },
    health: () => request('/api/health'),
  };

  window.UI = { toast, copyText, fmtSize, fmtTime };
})();
