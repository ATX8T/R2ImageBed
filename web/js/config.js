/* 配置抽屉 - v3.0 (GitHub Pages 版)
 * 只需配置：Worker URL + Access Token；R2 凭证由 Worker 端 Cloudflare 环境变量管理
 */
(function () {
  'use strict';

  const drawer = document.getElementById('settings-drawer');
  const mask = document.getElementById('drawer-mask');
  const openBtn = document.getElementById('btn-open-settings');
  const closeBtn = document.getElementById('btn-close-settings');
  const form = document.getElementById('config-form');
  const testBtn = document.getElementById('btn-test-conn');
  const saveBtn = document.getElementById('btn-save-conf');
  const toggleSecretBtn = document.getElementById('btn-toggle-secret');
  const secretInput = document.getElementById('secret-input');
  const bucketNameEl = document.getElementById('bucket-name');
  const connStatus = document.getElementById('conn-status');
  const linkModeTopSel = document.getElementById('link-mode-select');

  function open() { drawer.classList.add('open'); mask.classList.add('open'); }
  function close() { drawer.classList.remove('open'); mask.classList.remove('open'); }
  openBtn.addEventListener('click', () => { fillForm().then(open); });
  closeBtn.addEventListener('click', close);
  mask.addEventListener('click', close);

  toggleSecretBtn.addEventListener('click', () => {
    if (secretInput.type === 'password') { secretInput.type = 'text'; toggleSecretBtn.textContent = '隐藏'; }
    else { secretInput.type = 'password'; toggleSecretBtn.textContent = '显示'; }
  });

  async function fillForm() {
    const cfg = await API.config.get();
    Object.entries(cfg).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el) el.value = v == null ? '' : v;
    });
    updateTopBar(cfg);
  }

  function readForm() {
    const data = {};
    Array.from(form.elements).forEach((el) => {
      if (el.name) data[el.name] = el.value;
    });
    return data;
  }

  function updateTopBar(cfg) {
    bucketNameEl.textContent = cfg.workerUrl ? 'Worker 已配置' : '未配置';
    if (linkModeTopSel) linkModeTopSel.style.display = 'none'; // v3 静态版只支持公开直链
    setStatus(cfg.configured ? 'configured' : 'unconfigured');
  }

  function setStatus(state, text) {
    const dot = connStatus.querySelector('.dot');
    const txt = connStatus.querySelector('.status-text');
    dot.className = 'dot';
    if (state === 'ok') { dot.classList.add('dot-green'); txt.textContent = text || '已连接'; }
    else if (state === 'error') { dot.classList.add('dot-red'); txt.textContent = text || '连接错误'; }
    else if (state === 'configured') { dot.classList.add('dot-warn'); txt.textContent = text || '已配置（未测试）'; }
    else { dot.classList.add('dot-gray'); txt.textContent = text || '未配置'; }
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = '保存中...';
    try {
      const data = readForm();
      if (!data.workerUrl) {
        UI.toast('请先填写 Worker URL', 'warn');
        saveBtn.disabled = false; saveBtn.textContent = '保存';
        return;
      }
      const cfg = await API.config.save(data);
      UI.toast('配置已保存（仅保存在浏览器本地）', 'success');
      updateTopBar({ ...cfg, configured: true });
      window.dispatchEvent(new CustomEvent('config:changed', { detail: cfg }));
      close();
    } catch (e) {
      UI.toast('保存失败：' + e.message, 'error');
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '保存';
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true; testBtn.textContent = '测试中...';
    try {
      const data = readForm();
      // 临时保存以便 API.config.test 用最新值
      API.Conf.save(data);
      const r = await API.config.test();
      if (r && r.bucket === 'NOT_BOUND') {
        UI.toast('Worker 可达，但未绑定 R2 桶', 'warn', 4000);
        setStatus('error', '未绑定桶');
      } else {
        UI.toast('Worker 连接成功 ✓ (桶已绑定)', 'success');
        setStatus('ok');
      }
    } catch (e) {
      UI.toast(`连接失败：${e.code || ''} ${e.message}`, 'error', 4000);
      setStatus('error', e.code || '错误');
    } finally {
      testBtn.disabled = false; testBtn.textContent = '测试连接';
    }
  });

  window.ConfigUI = { fillForm, setStatus, open, close, updateTopBar };
})();
