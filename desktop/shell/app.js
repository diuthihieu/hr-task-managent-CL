// Reachability check, then navigate the window to the web app. Opaque
// ("no-cors") requests succeed whenever the server answers at all, which is
// all we need to know; a network failure rejects.
(function () {
  var config = window.BASEWORK_CONFIG || {};
  var serverUrl = config.serverUrl;
  var statusEl = document.getElementById("status");
  var retryEl = document.getElementById("retry");
  var serverEl = document.getElementById("server");
  var timer = null;

  if (!serverUrl) {
    statusEl.textContent = "This build has no server configured.";
    return;
  }
  serverEl.textContent = serverUrl;

  function offline(message) {
    statusEl.textContent = message;
    retryEl.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(connect, 10000);
  }

  function connect() {
    clearTimeout(timer);
    retryEl.hidden = true;
    statusEl.textContent = "Connecting…";
    if (!navigator.onLine) return offline("You are offline. woli needs an internet connection - your data lives on the server.");
    var controller = new AbortController();
    var abort = setTimeout(function () { controller.abort(); }, 8000);
    fetch(serverUrl + "/login", { mode: "no-cors", cache: "no-store", signal: controller.signal })
      .then(function () {
        clearTimeout(abort);
        window.location.replace(serverUrl + "/");
      })
      .catch(function () {
        clearTimeout(abort);
        offline("Can't reach the woli server. Retrying automatically…");
      });
  }

  retryEl.addEventListener("click", connect);
  window.addEventListener("online", connect);
  connect();
})();
