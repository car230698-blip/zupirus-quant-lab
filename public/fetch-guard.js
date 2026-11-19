// Prevent third-party browser extensions (e.g. request interceptors) from crashing
// when attempting to overwrite a getter-only window.fetch in sandboxed environments.
(function () {
  try {
    var nativeFetch = window.fetch ? window.fetch.bind(window) : undefined;
    if (nativeFetch) {
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        enumerable: true,
        get: function () {
          return nativeFetch;
        },
        set: function (fn) {
          if (typeof fn === 'function') {
            nativeFetch = fn;
          }
        },
      });
    }
  } catch (_e) {
    // Ignore if descriptor is locked
  }

  window.addEventListener(
    'error',
    function (event) {
      if (
        event &&
        ((event.filename && event.filename.indexOf('chrome-extension://') === 0) ||
          (event.message && event.message.indexOf('Cannot set property fetch') !== -1))
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true
  );

  window.addEventListener(
    'unhandledrejection',
    function (event) {
      var reason = event && event.reason ? String(event.reason.stack || event.reason.message || event.reason) : '';
      if (reason.indexOf('chrome-extension://') !== -1 || reason.indexOf('Cannot set property fetch') !== -1) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true
  );
})();
