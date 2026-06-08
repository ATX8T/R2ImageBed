/* 应用入口 - v3.0 静态版 */
(function () {
  'use strict';

  async function init() {
    try {
      const cfg = await API.config.get();
      ConfigUI.updateTopBar(cfg);
      if (cfg.configured) {
        await Explorer.loadList();
        // 后台健康检查更新连接状态
        try {
          const h = await API.health();
          if (h && h.bucket === 'bound') ConfigUI.setStatus('ok');
          else if (h && h.bucket === 'NOT_BOUND') ConfigUI.setStatus('error', '未绑定 R2 桶');
        } catch (_e) { ConfigUI.setStatus('error', '无法连接 Worker'); }
      } else {
        ConfigUI.open();
        UI.toast('请先配置 Worker URL', 'warn', 3000);
      }
    } catch (e) {
      UI.toast('初始化失败：' + e.message, 'error');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
