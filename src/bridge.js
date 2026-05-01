// bridge.js — ISOLATED WORLD
(function () {
  if (window.__ctt_bridge) return;
  window.__ctt_bridge = true;
  window.addEventListener('__ctt_record', e => {
    if (!e.detail) return;
    chrome.runtime.sendMessage({ type: 'RECORD_MESSAGE', payload: e.detail }, () => {
      void chrome.runtime.lastError;
    });
  });
  window.addEventListener('__ctt_debug', e => {
    if (!e.detail) return;
    chrome.runtime.sendMessage({ type: 'DEBUG_EVENT', payload: e.detail }, () => {
      void chrome.runtime.lastError;
    });
  });
})();
