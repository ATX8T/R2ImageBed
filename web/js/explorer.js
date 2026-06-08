/* 文件夹树 + 图片网格 + 上传 + 批量操作 */
(function () {
  'use strict';

  const treeEl = document.getElementById('folder-tree');
  const gridEl = document.getElementById('grid');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const dzTarget = document.getElementById('dz-target');
  const uploadListEl = document.getElementById('upload-list');
  const refreshBtn = document.getElementById('btn-refresh');
  const newFolderBtn = document.getElementById('btn-new-folder');
  const folderModal = document.getElementById('folder-modal-mask');
  const folderNameInput = document.getElementById('folder-name-input');
  const folderModalParent = document.getElementById('folder-modal-parent');
  const folderModalOk = document.getElementById('folder-modal-ok');
  const folderModalCancel = document.getElementById('folder-modal-cancel');
  const searchInput = document.getElementById('search-input');
  const gridMeta = document.getElementById('grid-meta');
  const gridTitle = document.getElementById('grid-title');
  const previewMask = document.getElementById('preview-modal-mask');
  const previewClose = document.getElementById('preview-close');
  const previewImg = document.getElementById('preview-img');
  const previewKey = document.getElementById('preview-key');
  const previewUrlInput = document.getElementById('preview-url');
  const previewTitle = document.getElementById('preview-title');

  // 批量操作栏
  const bulkBar = document.getElementById('bulk-bar');
  const bulkCount = document.getElementById('bulk-count');
  const bulkSize = document.getElementById('bulk-size');

  // 文件夹操作菜单
  const folderMenuWrap = document.getElementById('folder-menu-wrap');
  const folderOpsBtn = document.getElementById('btn-folder-ops');
  const folderMenuPanel = document.getElementById('folder-menu-panel');

  // 批量结果弹窗
  const bulkUrlsMask = document.getElementById('bulk-urls-mask');
  const bulkUrlsClose = document.getElementById('bulk-urls-close');
  const bulkUrlsText = document.getElementById('bulk-urls-text');
  const bulkUrlsMeta = document.getElementById('bulk-urls-meta');
  const bulkUrlsFoot = document.getElementById('bulk-urls-foot');
  const bulkUrlsCopy = document.getElementById('bulk-urls-copy');
  const bulkUrlsDownload = document.getElementById('bulk-urls-download');

  // 忙碌遮罩
  const busyMask = document.getElementById('busy-mask');
  const busyText = document.getElementById('busy-text');

  let state = {
    prefix: '',
    folders: [],
    files: [],
    selected: new Set(),
    knownFolders: new Set(),
    currentLinkMode: 'public',
    currentPreviewKey: '',
    // 批量结果
    bulkResultItems: [], // [{key, url, error?}]
    bulkResultFormat: 'url',
  };

  /* ---------- 工具 ---------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showBusy(text) {
    busyText.textContent = text || '处理中...';
    busyMask.hidden = false;
  }
  function hideBusy() { busyMask.hidden = true; }

  /* ---------- 渲染 ---------- */

  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';
    const root = document.createElement('span');
    root.className = 'crumb root' + (state.prefix === '' ? ' current' : '');
    root.textContent = '根目录';
    root.addEventListener('click', () => navigate(''));
    breadcrumbEl.appendChild(root);
    if (state.prefix) {
      const parts = state.prefix.split('/').filter(Boolean);
      let acc = '';
      parts.forEach((p, i) => {
        const sep = document.createElement('span');
        sep.className = 'crumb sep'; sep.textContent = '/';
        breadcrumbEl.appendChild(sep);
        acc += p + '/';
        const c = document.createElement('span');
        c.className = 'crumb' + (i === parts.length - 1 ? ' current' : '');
        c.textContent = p;
        const target = acc;
        c.addEventListener('click', () => navigate(target));
        breadcrumbEl.appendChild(c);
      });
    }
    dzTarget.textContent = '/' + (state.prefix || '');
  }

  function renderTree() {
    const all = Array.from(state.knownFolders).sort();
    treeEl.innerHTML = '';
    const rootEl = document.createElement('div');
    rootEl.className = 'folder-item' + (state.prefix === '' ? ' active' : '');
    rootEl.innerHTML = `<span>📁</span><span class="name">根目录</span>`;
    rootEl.addEventListener('click', () => navigate(''));
    treeEl.appendChild(rootEl);

    all.forEach((p) => {
      const depth = p.split('/').filter(Boolean).length - 1;
      const name = p.replace(/\/$/, '').split('/').pop();
      const item = document.createElement('div');
      item.className = 'folder-item' + (state.prefix === p ? ' active' : '');
      item.style.paddingLeft = (8 + depth * 16) + 'px';
      item.innerHTML = `<span>📁</span><span class="name">${escapeHtml(name)}</span><button class="del-btn" title="删除文件夹">✕</button>`;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('del-btn')) return;
        navigate(p);
      });
      item.querySelector('.del-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`确定删除文件夹「${p}」及其所有内容？此操作不可恢复。`)) return;
        try {
          showBusy(`正在删除文件夹 ${p}...`);
          const r = await API.folders.del(p);
          UI.toast(`已删除 ${r.deleted} 个对象`, 'success');
          state.knownFolders.delete(p);
          Array.from(state.knownFolders).forEach((kp) => {
            if (kp.startsWith(p)) state.knownFolders.delete(kp);
          });
          if (state.prefix.startsWith(p)) state.prefix = '';
          await loadList();
        } catch (err) {
          UI.toast('删除失败：' + err.message, 'error');
        } finally { hideBusy(); }
      });
      treeEl.appendChild(item);
    });
  }

  function renderGrid() {
    const kw = (searchInput.value || '').trim().toLowerCase();
    const inFolderFiles = state.files.filter((f) => {
      if (!kw) return true;
      return f.key.toLowerCase().includes(kw);
    });
    const inFolderFolders = state.folders.filter((p) => {
      if (!kw) return true;
      return p.toLowerCase().includes(kw);
    });

    gridEl.innerHTML = '';
    if (inFolderFolders.length === 0 && inFolderFiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = kw ? '没有匹配项' : '当前目录为空，拖入图片开始上传';
      gridEl.appendChild(empty);
    } else {
      // 文件夹卡片
      inFolderFolders.forEach((p) => {
        const name = p.replace(/\/$/, '').split('/').pop();
        const card = document.createElement('div');
        card.className = 'card folder-card';
        card.innerHTML = `
          <div class="folder-actions">
            <button class="act-btn" data-fact="copy" title="复制此文件夹所有图片链接（含子目录）">🔗</button>
            <button class="act-btn" data-fact="empty" title="清空此文件夹（保留文件夹）">🧹</button>
            <button class="act-btn danger" data-fact="del" title="删除此文件夹及全部内容">🗑</button>
          </div>
          <div class="thumb placeholder">📁</div>
          <div class="meta">
            <div class="fname">${escapeHtml(name)}/</div>
            <div class="fsize">文件夹</div>
          </div>`;
        card.addEventListener('click', (e) => {
          const fact = e.target.getAttribute('data-fact');
          if (fact === 'copy') { e.stopPropagation(); copyFolderUrls(p); return; }
          if (fact === 'empty') { e.stopPropagation(); emptyFolder(p); return; }
          if (fact === 'del') { e.stopPropagation(); deleteFolder(p); return; }
          navigate(p);
        });
        gridEl.appendChild(card);
      });

      // 图片卡片
      inFolderFiles.forEach((f) => {
        const name = f.key.split('/').pop();
        const card = document.createElement('div');
        card.className = 'card' + (state.selected.has(f.key) ? ' selected' : '');
        card.innerHTML = `
          <div class="check ${state.selected.has(f.key) ? 'checked' : ''}" data-act="check">${state.selected.has(f.key) ? '✓' : ''}</div>
          <div class="actions">
            <button class="act-btn" data-act="copy" title="复制链接">🔗</button>
            <button class="act-btn danger" data-act="del" title="删除">🗑</button>
          </div>
          <div class="thumb">
            <img loading="lazy" alt="${escapeHtml(name)}" data-key="${escapeHtml(f.key)}" onerror="this.parentNode.classList.add('placeholder'); this.remove(); this.parentNode.textContent='🖼';" />
          </div>
          <div class="meta">
            <div class="fname" title="${escapeHtml(f.key)}">${escapeHtml(name)}</div>
            <div class="fsize">${UI.fmtSize(f.size)} · ${UI.fmtTime(f.lastModified)}</div>
          </div>`;

        const img = card.querySelector('img');
        getUrlFor(f.key).then((u) => { if (u) img.src = u; }).catch(() => {});

        card.addEventListener('click', (e) => {
          const act = e.target.getAttribute('data-act');
          if (act === 'check') { toggleSelect(f.key); return; }
          if (act === 'copy') { copyLinkFor(f.key); return; }
          if (act === 'del') { deleteOne(f.key); return; }
          openPreview(f);
        });
        gridEl.appendChild(card);
      });
    }
    gridTitle.textContent = state.prefix ? `📂 ${state.prefix}` : '所有图片';
    gridMeta.textContent = `${inFolderFolders.length} 个文件夹 · ${inFolderFiles.length} 张图片`;
    renderBulkBar();
  }

  function renderBulkBar() {
    const n = state.selected.size;
    if (n === 0) { bulkBar.hidden = true; return; }
    bulkBar.hidden = false;
    bulkCount.textContent = n;
    // 计算大小（仅基于当前页已知 size）
    const sizeMap = new Map(state.files.map((f) => [f.key, f.size || 0]));
    const total = Array.from(state.selected).reduce((s, k) => s + (sizeMap.get(k) || 0), 0);
    bulkSize.textContent = UI.fmtSize(total);
  }

  /* ---------- 选择 ---------- */

  function toggleSelect(key) {
    if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.add(key);
    renderGrid();
  }

  function selectAllCurrent() {
    state.files.forEach((f) => state.selected.add(f.key));
    renderGrid();
    UI.toast(`已选中当前页 ${state.files.length} 张`, 'success');
  }

  function invertSelection() {
    const cur = new Set(state.files.map((f) => f.key));
    const next = new Set();
    cur.forEach((k) => { if (!state.selected.has(k)) next.add(k); });
    state.selected = next;
    renderGrid();
  }

  function clearSelection() {
    state.selected.clear();
    renderGrid();
  }

  async function selectAllRecursive() {
    try {
      showBusy('正在加载该目录所有图片...');
      const r = await API.objects.listKeysByPrefix(state.prefix);
      r.keys.forEach((k) => state.selected.add(k));
      UI.toast(`已选中 ${r.total} 张图片（含子目录）`, 'success');
      renderGrid();
    } catch (e) {
      UI.toast('加载失败：' + e.message, 'error');
    } finally { hideBusy(); }
  }

  /* ---------- 导航 / 列表 ---------- */

  async function navigate(prefix) {
    state.prefix = prefix || '';
    state.selected.clear();
    await loadList();
  }

  async function loadList() {
    try {
      const r = await API.objects.list(state.prefix);
      state.folders = r.folders || [];
      state.files = r.files || [];
      state.folders.forEach((p) => state.knownFolders.add(p));
      renderBreadcrumb();
      renderTree();
      renderGrid();
    } catch (e) {
      if (e.code === 'NOT_CONFIGURED') {
        gridEl.innerHTML = `<div class="empty">尚未配置 R2 凭证，请点击右上角 ⚙ 设置</div>`;
        gridTitle.textContent = '未配置';
        gridMeta.textContent = '';
      } else {
        UI.toast('加载失败：' + e.message, 'error');
      }
    }
  }

  async function getUrlFor(key) {
    try {
      const r = await API.objects.url(key);
      return r.url;
    } catch (e) { return ''; }
  }

  async function copyLinkFor(key) {
    try {
      const r = await API.objects.url(key);
      UI.copyText(r.url);
    } catch (e) {
      UI.toast('生成链接失败：' + e.message, 'error');
    }
  }

  /* ---------- 单删 ---------- */

  async function deleteOne(key) {
    if (!confirm(`确定删除「${key}」？`)) return;
    try {
      await API.objects.del(key);
      UI.toast('已删除', 'success');
      state.selected.delete(key);
      await loadList();
    } catch (e) {
      UI.toast('删除失败：' + e.message, 'error');
    }
  }

  /* ---------- 批量操作 ---------- */

  async function batchDelete() {
    const keys = Array.from(state.selected);
    if (keys.length === 0) return;
    if (!confirm(`确定删除选中的 ${keys.length} 张图片？此操作不可恢复。`)) return;
    try {
      showBusy(`正在删除 ${keys.length} 项...`);
      const r = await API.objects.del(keys);
      UI.toast(`已删除 ${r.deleted} 项`, 'success');
      state.selected.clear();
      await loadList();
    } catch (e) {
      UI.toast('批量删除失败：' + e.message, 'error');
    } finally { hideBusy(); }
  }

  async function batchCopyUrlsSelected() {
    const keys = Array.from(state.selected);
    if (keys.length === 0) return UI.toast('请先选择图片', 'warn');
    try {
      showBusy(`正在生成 ${keys.length} 条链接...`);
      const r = await API.objects.urls(keys);
      hideBusy();
      openBulkUrls(r.items, { mode: r.mode, success: r.success, failed: r.failed, total: keys.length, title: `所选图片 (${r.success}/${keys.length})` });
    } catch (e) {
      hideBusy();
      UI.toast('批量获取链接失败：' + e.message, 'error');
    }
  }

  async function copyUrlsCurrentPage() {
    const keys = state.files.map((f) => f.key);
    if (keys.length === 0) return UI.toast('当前目录没有图片', 'warn');
    try {
      showBusy(`正在生成 ${keys.length} 条链接...`);
      const r = await API.objects.urls(keys);
      hideBusy();
      openBulkUrls(r.items, { mode: r.mode, success: r.success, failed: r.failed, total: keys.length, title: `当前页 (${r.success}/${keys.length})` });
    } catch (e) {
      hideBusy();
      UI.toast('失败：' + e.message, 'error');
    }
  }

  async function copyUrlsRecursive() {
    try {
      showBusy(`正在加载并生成本目录及子目录所有图片链接...`);
      const r = await API.objects.urlsByPrefix(state.prefix);
      hideBusy();
      if (!r.items.length) return UI.toast('本目录（含子目录）没有图片', 'warn');
      openBulkUrls(r.items, { mode: r.mode, success: r.success, failed: r.failed, total: r.total, title: `${state.prefix || '根目录'} 全部 (${r.success}/${r.total})` });
    } catch (e) {
      hideBusy();
      UI.toast('失败：' + e.message, 'error');
    }
  }

  async function copyFolderUrls(folderPrefix) {
    try {
      showBusy(`正在加载 ${folderPrefix} 中所有图片链接...`);
      const r = await API.objects.urlsByPrefix(folderPrefix);
      hideBusy();
      if (!r.items.length) return UI.toast(`「${folderPrefix}」中没有图片`, 'warn');
      openBulkUrls(r.items, { mode: r.mode, success: r.success, failed: r.failed, total: r.total, title: `${folderPrefix} (${r.success}/${r.total})` });
    } catch (e) {
      hideBusy();
      UI.toast('失败：' + e.message, 'error');
    }
  }

  async function emptyFolder(folderPrefix) {
    if (!confirm(`确定清空文件夹「${folderPrefix}」？\n将删除其中所有图片与子目录，但保留文件夹本身。`)) return;
    try {
      showBusy(`正在清空 ${folderPrefix}...`);
      const r = await API.folders.empty(folderPrefix);
      UI.toast(`已清空 ${r.deleted} 个对象`, 'success');
      await loadList();
    } catch (e) {
      UI.toast('清空失败：' + e.message, 'error');
    } finally { hideBusy(); }
  }

  async function deleteFolder(folderPrefix) {
    if (!confirm(`确定删除文件夹「${folderPrefix}」及其所有内容？此操作不可恢复。`)) return;
    try {
      showBusy(`正在删除 ${folderPrefix}...`);
      const r = await API.folders.del(folderPrefix);
      UI.toast(`已删除 ${r.deleted} 个对象`, 'success');
      state.knownFolders.delete(folderPrefix);
      Array.from(state.knownFolders).forEach((kp) => {
        if (kp.startsWith(folderPrefix)) state.knownFolders.delete(kp);
      });
      if (state.prefix.startsWith(folderPrefix)) state.prefix = '';
      await loadList();
    } catch (e) {
      UI.toast('删除失败：' + e.message, 'error');
    } finally { hideBusy(); }
  }

  /* ---------- 批量链接结果弹窗 ---------- */

  function formatItems(items, format) {
    const ok = items.filter((it) => it && it.url);
    return ok.map((it) => {
      const name = it.key.split('/').pop();
      if (format === 'md') return `![${name}](${it.url})`;
      if (format === 'html') return `<img src="${it.url}" alt="${name}" />`;
      if (format === 'json') return JSON.stringify({ key: it.key, url: it.url });
      return it.url;
    }).join('\n');
  }

  function openBulkUrls(items, info) {
    state.bulkResultItems = items;
    state.bulkResultFormat = 'url';
    bulkUrlsMeta.textContent = info.title || '';
    bulkUrlsText.value = formatItems(items, 'url');
    // 重置 seg
    bulkUrlsMask.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-fmt') === 'url'));
    // 失败信息
    const failed = items.filter((it) => it && it.error);
    if (failed.length) {
      bulkUrlsFoot.innerHTML = `<span class="fail">⚠ ${failed.length} 项生成失败</span>：${failed.slice(0, 3).map((f) => escapeHtml(f.key + ': ' + f.error)).join('；')}${failed.length > 3 ? ` ...等 ${failed.length} 项` : ''}`;
    } else {
      bulkUrlsFoot.innerHTML = `<span>共 ${items.length} 条链接 · 模式：${info.mode === 'presigned' ? '预签名 URL' : '公开直链'}</span>`;
    }
    bulkUrlsMask.classList.add('open');
  }

  function closeBulkUrls() { bulkUrlsMask.classList.remove('open'); }

  bulkUrlsClose.addEventListener('click', closeBulkUrls);
  bulkUrlsMask.addEventListener('click', (e) => { if (e.target === bulkUrlsMask) closeBulkUrls(); });

  bulkUrlsMask.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      bulkUrlsMask.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const fmt = btn.getAttribute('data-fmt');
      state.bulkResultFormat = fmt;
      bulkUrlsText.value = formatItems(state.bulkResultItems, fmt);
    });
  });

  bulkUrlsCopy.addEventListener('click', () => {
    if (!bulkUrlsText.value) return UI.toast('没有可复制内容', 'warn');
    UI.copyText(bulkUrlsText.value);
  });

  bulkUrlsDownload.addEventListener('click', () => {
    if (!bulkUrlsText.value) return;
    const ext = state.bulkResultFormat === 'json' ? 'json' :
                state.bulkResultFormat === 'html' ? 'html' :
                state.bulkResultFormat === 'md'   ? 'md'   : 'txt';
    const blob = new Blob([bulkUrlsText.value], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `r2-urls-${Date.now()}.${ext}`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  /* ---------- 批量栏事件 ---------- */

  bulkBar.addEventListener('click', (e) => {
    const act = e.target.getAttribute('data-act');
    if (!act) return;
    if (act === 'select-all') selectAllCurrent();
    else if (act === 'invert') invertSelection();
    else if (act === 'clear') clearSelection();
    else if (act === 'copy-urls') batchCopyUrlsSelected();
    else if (act === 'batch-delete') batchDelete();
  });

  /* ---------- 文件夹操作菜单 ---------- */

  folderOpsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    folderMenuWrap.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!folderMenuWrap.contains(e.target)) folderMenuWrap.classList.remove('open');
  });
  folderMenuPanel.addEventListener('click', async (e) => {
    const act = e.target.getAttribute('data-act');
    if (!act) return;
    folderMenuWrap.classList.remove('open');
    if (act === 'select-all-current') selectAllCurrent();
    else if (act === 'select-all-recursive') selectAllRecursive();
    else if (act === 'copy-urls-current') copyUrlsCurrentPage();
    else if (act === 'copy-urls-recursive') copyUrlsRecursive();
    else if (act === 'empty-folder') {
      if (!state.prefix) return UI.toast('根目录不支持"清空"，请选择子文件夹', 'warn');
      emptyFolder(state.prefix);
    }
    else if (act === 'delete-folder') {
      if (!state.prefix) return UI.toast('根目录不能删除', 'warn');
      deleteFolder(state.prefix);
    }
  });

  refreshBtn.addEventListener('click', loadList);
  searchInput.addEventListener('input', renderGrid);

  /* ---------- 上传 ---------- */

  function addUploadItem(name) {
    const id = 'u_' + Math.random().toString(36).slice(2, 8);
    const div = document.createElement('div');
    div.className = 'upload-item';
    div.id = id;
    div.innerHTML = `
      <span class="filename">${escapeHtml(name)}</span>
      <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
      <span class="status">0%</span>`;
    uploadListEl.appendChild(div);
    return id;
  }
  function updateUpload(id, percent, status, cls) {
    const el = document.getElementById(id); if (!el) return;
    el.querySelector('.progress-fill').style.width = percent + '%';
    el.querySelector('.status').textContent = status;
    if (cls) el.classList.add(cls);
  }
  function removeUpload(id, delay = 3000) {
    setTimeout(() => { const el = document.getElementById(id); if (el) el.remove(); }, delay);
  }

  async function uploadFiles(files) {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) { UI.toast('请选择图片文件', 'warn'); return; }
    for (const f of arr) {
      const id = addUploadItem(f.name);
      const fd = new FormData();
      fd.append('files', f);
      fd.append('prefix', state.prefix);
      try {
        await API.objects.upload(fd, (p) => updateUpload(id, Math.round(p * 100), Math.round(p * 100) + '%'));
        updateUpload(id, 100, '✓ 完成', 'success');
        removeUpload(id, 1500);
      } catch (e) {
        updateUpload(id, 100, '✗ ' + e.message, 'error');
        removeUpload(id, 6000);
      }
    }
    await loadList();
  }

  fileInput.addEventListener('change', (e) => uploadFiles(e.target.files));

  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
  });

  ['dragover', 'drop'].forEach((ev) => {
    window.addEventListener(ev, (e) => { e.preventDefault(); }, false);
  });

  /* ---------- 新建文件夹 ---------- */

  newFolderBtn.addEventListener('click', () => {
    folderModalParent.textContent = '/' + (state.prefix || '');
    folderNameInput.value = '';
    folderModal.classList.add('open');
    setTimeout(() => folderNameInput.focus(), 50);
  });
  folderModalCancel.addEventListener('click', () => folderModal.classList.remove('open'));
  folderModal.addEventListener('click', (e) => { if (e.target === folderModal) folderModal.classList.remove('open'); });
  folderModalOk.addEventListener('click', async () => {
    const name = (folderNameInput.value || '').trim().replace(/\/+$/, '');
    if (!name) return UI.toast('请输入文件夹名', 'warn');
    const full = state.prefix + name;
    try {
      await API.folders.create(full);
      UI.toast('文件夹已创建', 'success');
      state.knownFolders.add(full.endsWith('/') ? full : full + '/');
      folderModal.classList.remove('open');
      await loadList();
    } catch (e) {
      UI.toast('创建失败：' + e.message, 'error');
    }
  });
  folderNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') folderModalOk.click(); });

  /* ---------- 预览弹窗 ---------- */

  async function openPreview(f) {
    state.currentPreviewKey = f.key;
    previewTitle.textContent = f.key.split('/').pop();
    previewKey.textContent = f.key;
    previewImg.style.display = '';
    previewImg.src = '';
    try {
      const r = await API.objects.url(f.key);
      previewImg.src = r.url;
      previewUrlInput.value = r.url;
    } catch (e) {
      previewUrlInput.value = '生成链接失败：' + e.message;
    }
    previewMask.classList.add('open');
  }
  previewClose.addEventListener('click', () => previewMask.classList.remove('open'));
  previewMask.addEventListener('click', (e) => { if (e.target === previewMask) previewMask.classList.remove('open'); });
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = previewUrlInput.value;
      const name = state.currentPreviewKey.split('/').pop();
      const type = btn.getAttribute('data-copy');
      if (type === 'url') UI.copyText(url);
      else if (type === 'md') UI.copyText(`![${name}](${url})`);
      else if (type === 'html') UI.copyText(`<img src="${url}" alt="${name}" />`);
    });
  });

  /* ---------- 暴露 ---------- */

  window.Explorer = { loadList, navigate };
  window.addEventListener('config:changed', () => loadList());
})();
