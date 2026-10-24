/* The web build's offline shell — #185.
 *
 * WEB ONLY, and deliberately so. On iOS and Android the JS bundle is inside
 * the installed app, so "can it open without a network" is already true there
 * by construction. Only the web build fetches itself from a server on every
 * visit, and only the web build has a service worker to fix that with.
 *
 * This file is NOT bundled. It is copied verbatim from `public/` into `dist/`
 * by `npx expo export -p web`, and served from the site root by the dev server
 * too — which is what gives it a root scope (`/`) and lets the same worker be
 * the one the e2e spec exercises and the one that ships.
 *
 * It is plain ES5-ish browser JS on purpose: `public/` is outside tsconfig's
 * include, outside Metro, and outside the import-boundary gate's scan, so
 * nothing here is compiled, linted or type-checked. Keep it small enough to
 * read in one sitting.
 *
 * ── Strategy: network-first, cache as a fallback ──────────────────────────
 *
 * Every same-origin GET goes to the network first. If it succeeds, the
 * response is returned AND copied into the cache. If the network throws —
 * which is what being offline looks like from in here — the cache answers.
 *
 * Network-first rather than cache-first for one reason that outranks the
 * latency it costs: a service worker outlives any single deploy, and a
 * cache-first worker with a bug can serve a broken shell to a real person
 * forever, with no way for us to reach them. Network-first means an online
 * browser always sees the newest deploy, so the worst this can do while
 * someone has signal is nothing at all. It is also why the same worker is
 * safe to run against the Metro dev server: online, it is a pass-through, so
 * a stale bundle is never served over a fresh one.
 */

/* Bumping this name is how every cached response gets dropped: `activate`
 * deletes every cache that is not this one. Entries within a version are
 * never pruned — exported asset filenames are content-hashed, so a long-lived
 * install accumulates superseded bundles until the browser evicts under quota
 * pressure. Bounded by the browser rather than by us; noted rather than
 * solved, because an LRU here would be more code than the thing it guards. */
var CACHE = "sceny-shell-v1";

/* The document to fall back to for a navigation we have never cached. */
var SHELL = "/";

self.addEventListener("install", function (event) {
  /* Precaching the shell is what makes the FIRST offline open work. Without
   * it the cache is populated only by what the fetch handler happens to see,
   * and the fetch handler does not see the page load that installed it — the
   * worker is not controlling that navigation yet. `sw-register.js` warms the
   * rest of that first load over `postMessage`; this covers the document. */
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return cache.add(new Request(SHELL, { cache: "reload" }));
      })
      .catch(function () {
        /* A failed precache must not fail the install — a worker that never
         * activates is strictly worse than one with a cold cache, because the
         * fetch handler below would never run to warm it. */
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            return key === CACHE ? undefined : caches.delete(key);
          }),
        );
      })
      /* Claim on the very first load rather than waiting for the next
       * navigation. Everything fetched from here on goes through the handler
       * below and lands in the cache as a side effect of being used. */
      .then(function () {
        return self.clients.claim();
      }),
  );
});

/* The page tells us what it already loaded before we existed. See
 * `sw-register.js` — this is the other half of the first-visit gap. */
self.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== "sceny:cache-urls" || !Array.isArray(data.urls)) return;

  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(
        data.urls.map(function (url) {
          return cache.match(url).then(function (hit) {
            if (hit) return undefined;
            /* Each add is individually forgiving: one URL that 404s or is
             * opaque must not abandon the rest of the warm-up. */
            return cache.add(url).catch(function () {
              return undefined;
            });
          });
        }),
      );
    }),
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;

  /* GET only: a POST has no meaningful cached answer, and replaying one from
   * a cache would be a correctness bug rather than a degradation. In this app
   * that is `/api/mediator` (#146's territory, not this file's). */
  if (request.method !== "GET") return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  /* Cross-origin responses are opaque — we cannot tell success from failure,
   * so caching them would store failures indefinitely. Leave them alone. */
  if (url.origin !== self.location.origin) return;

  /* Never intercept our own script: the browser's update check has to reach
   * the network to ever see a new worker. */
  if (url.pathname === "/sw.js") return;

  event.respondWith(networkFirst(request));
});

function networkFirst(request) {
  return fetch(request).then(
    function (response) {
      /* 200 exactly, not `response.ok`: a 206 Partial Content is "ok" and
       * `cache.put` rejects on it. `basic` excludes opaque and CORS
       * responses, which we have already filtered by origin but which a
       * redirect could still produce. */
      if (response && response.status === 200 && response.type === "basic") {
        var copy = response.clone();
        caches
          .open(CACHE)
          .then(function (cache) {
            return cache.put(request, copy);
          })
          .catch(function () {
            /* Quota exceeded, or a response the cache refuses. Serving the
             * live response still succeeded, which is what the page asked
             * for — this must not surface as an error. */
          });
      }
      return response;
    },
    function (networkError) {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;

        /* A route this browser has never opened while online. The app is a
         * single bundle once hydrated, so the shell document can render it —
         * the pre-rendered markup will be the wrong route's until React
         * takes over and reads the real path. Degraded, but it opens. */
        if (request.mode === "navigate") {
          return caches.match(SHELL).then(function (shell) {
            if (shell) return shell;
            throw networkError;
          });
        }
        throw networkError;
      });
    },
  );
}
