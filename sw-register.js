/* Registers the offline shell worker — #185. Web only; see `public/sw.js`.
 *
 * A separate file rather than an inline script in `app/+html.tsx`, for a
 * reason worth stating: `src/ui/__tests__/import-boundary.test.ts` bans
 * `navigator`, `window`, `caches` and friends from everything under `app/`
 * and `src/`, because reaching for a browser global there is #86 in miniature
 * — web works, the device silently does nothing. Registration genuinely needs
 * `navigator.serviceWorker`, so it belongs on the web side of that line
 * rather than smuggled past the gate as a string literal. `public/` is
 * outside the scan because everything in it is, by definition, a web artefact.
 */
(function () {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  /* The first-visit gap, and why this exists at all.
   *
   * A worker does not see the page load that installs it — those requests
   * were already in flight before it activated. So on a first visit the
   * cache would hold only the shell document `sw.js` precached, and an
   * offline reload would find the JS bundle missing and render nothing.
   *
   * The page knows what it loaded. `performance.getEntriesByType("resource")`
   * is the browser's own record of every URL this document fetched, so we
   * hand that list over and let the worker fill the cache from it. After
   * that, the worker is controlling and caches what it serves — this runs
   * once and never matters again.
   */
  function warm(worker) {
    if (!worker) return;
    var urls = [];
    try {
      var entries = performance.getEntriesByType("resource");
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i].name;
        if (name.indexOf(location.origin + "/") === 0) urls.push(name);
      }
    } catch (e) {
      /* No Performance Timeline: the worker still has the shell, and the
       * fetch handler still warms everything from the next load onward. */
    }
    urls.push(location.href);
    worker.postMessage({ type: "sceny:cache-urls", urls: urls });
  }

  function whenLoaded() {
    return new Promise(function (resolve) {
      if (document.readyState === "complete") return resolve();
      window.addEventListener("load", resolve, { once: true });
    });
  }

  whenLoaded().then(function () {
    navigator.serviceWorker.register("/sw.js").then(
      function () {
        /* `ready` resolves once there is an ACTIVE worker for this scope, so
         * the postMessage below cannot land before there is anything to
         * receive it. Waiting on the registration alone would race install. */
        navigator.serviceWorker.ready.then(function (registration) {
          warm(registration.active);
        });
      },
      function () {
        /* Registration fails on a first visit made offline, over plain HTTP
         * on a non-localhost origin, and in a browser with workers disabled.
         * All three are "no offline shell this time", none of them is
         * something the person can act on, and the console-clean gate in
         * `e2e/` treats a logged error as a defect. Stay quiet.
         */
      },
    );
  });
})();
