// Auto-recover from stale chunks when a new release is deployed
window.addEventListener('vite:preloadError', function () {
  window.location.reload();
});
window.addEventListener('error', function (e) {
  if (e && e.target && e.target.tagName === 'SCRIPT' && !sessionStorage.getItem('__zupirus_reloaded__')) {
    sessionStorage.setItem('__zupirus_reloaded__', Date.now().toString());
    window.location.reload();
  }
}, true);
