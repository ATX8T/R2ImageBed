/* 日志抽屉 - 静态版 stub
 * 静态部署没有应用日志，提示用户用 `wrangler tail` 查看 Worker 日志
 */
(function () {
  'use strict';
  const drawer = document.getElementById('log-drawer');
  const openBtn = document.getElementById('btn-open-logs');
  const toggleBtn = document.getElementById('btn-toggle-logs');
  const tailLineEl = document.getElementById('log-tail-line');
  const listEl = document.getElementById('log-list');

  if (tailLineEl) tailLineEl.textContent = '静态版无应用日志，请用 `wrangler tail` 查看 Worker';
  if (listEl) listEl.innerHTML = '<div class="log-empty">静态部署模式：应用日志请在 Cloudflare Worker 控制台或本地运行 <code>wrangler tail</code> 查看。</div>';

  function open() { drawer.classList.add('open'); }
  function close() { drawer.classList.remove('open'); }

  if (openBtn) openBtn.addEventListener('click', open);
  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    if (drawer.classList.contains('open')) close(); else open();
  });
})();
