(function () {
  window.__kwCapturedResponses = {};

  const save = (url, body) => {
    if (!url || !body) return;
    if (body[0] !== '{' && body[0] !== '[') return;
    window.__kwCapturedResponses[String(url)] = String(body).slice(0, 2_000_000);
  };

  // Use Proxy so Function.prototype.toString still returns "[native code]"
  if (window.fetch) {
    window.fetch = new Proxy(window.fetch, {
      apply(target, thisArg, args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
        return Reflect.apply(target, thisArg, args).then((response) => {
          response.clone().text().then((text) => save(url, text)).catch(() => {});
          return response;
        });
      }
    });
  }

  if (window.XMLHttpRequest) {
    window.XMLHttpRequest = new Proxy(window.XMLHttpRequest, {
      construct(Target, args) {
        const xhr = new Target(...args);
        let url = '';
        xhr.open = new Proxy(xhr.open, {
          apply(target, thisArg, xhrArgs) {
            url = xhrArgs[1] || '';
            return Reflect.apply(target, thisArg, xhrArgs);
          }
        });
        xhr.addEventListener('load', () => {
          try { save(url, xhr.responseText); } catch (_) {}
        });
        return xhr;
      }
    });
  }
})();
