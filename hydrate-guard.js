/* Client-render a document the host served for some *other* route — #232.
 *
 * A static host answers a path it has no file for with the SPA fallback:
 * `dist/index.html`, the document rendered for `/`. Cloudflare Pages does it in
 * production (`docs/deployment.md`), `scripts/serve-export.js` mirrors it, and
 * `public/sw.js` does its own version of it offline — it hands the cached `/`
 * shell to any navigation it has never seen. All three are deliberate: without
 * them `/deck/jp-vocab` would not resolve at all, because Pages matches paths
 * against files and has no idea what a `[id]` segment means.
 *
 * What none of them can do is change the markup inside the document. So the
 * browser gets Today's server-rendered HTML at `/deck/jp-vocab`, expo-router
 * routes to the deck screen, and React's hydration pass finds a tree that does
 * not match the one it was handed — `Minified React error #418`, uncaught, on
 * every direct load, reload, bookmark and shared link to a card or a deck.
 *
 * Hydrating is the wrong thing to do with a fallback document, and that is the
 * whole of the fix: when the document was rendered for a different path than
 * the one in the address bar, client-render instead. React then builds the
 * tree from scratch and the mismatch cannot arise. The wrong markup is still
 * painted for a beat before the bundle runs — that was already true, since
 * React discarded it and re-rendered anyway; what changes is that it no longer
 * throws on the way.
 *
 * ── Which path the document was rendered for ──────────────────────────────
 *
 * Nothing in an exported document said. `__EXPO_ROUTER_HYDRATE__` is a
 * hardcoded `true` in every one of them, and there was no other marker, so no
 * runtime check had anything to read. `app/+html.tsx` now stamps it as a
 * `<meta>` — expo-router renders that file inside the router, so it can ask
 * `usePathname()` for the route the export is rendering, and the answer lands
 * in the one part of the document the app actually owns.
 *
 * ── Why a separate file, and why `Object.defineProperty` ──────────────────
 *
 * Separate, rather than inline in `app/+html.tsx`, for the reason
 * `public/sw-register.js` gives next door: `src/ui/__tests__/import-boundary.test.ts`
 * bans `document` and `location` from everything under `app/` and `src/`, and
 * the answer to needing them is to write the web file on the web side of that
 * line — not to smuggle a browser global past the gate as a string literal.
 *
 * `Object.defineProperty` rather than a plain assignment because expo injects
 * `<script type="module">globalThis.__EXPO_ROUTER_HYDRATE__=true;</script>`
 * immediately before `</head>`, which is *after* this file's `<script>` tag
 * and therefore after this code runs. A plain `= false` here would be
 * overwritten a moment later. An accessor whose setter ignores what it is
 * given survives that, and survives it wherever expo chooses to inject the
 * flag — this file does not have to care about document order to be correct.
 *
 * The property is only ever forced *off*, and only on a mismatch. A document
 * being served for its own path is untouched, still hydrates, and keeps
 * whatever the server rendered.
 *
 * Plain ES5-ish browser JS, uncompiled and untyped, like everything in
 * `public/`. `e2e/console-clean.export.ts` is what proves it works, against a
 * real `npx expo export -p web` in a real browser.
 */
(function () {
  var stamp = document.querySelector('meta[name="sceny-rendered-path"]');
  if (!stamp) return;

  var rendered = stamp.getAttribute("content");
  if (rendered === null) return;

  /* Compare the two paths the way a host resolves them: percent-decoded, and
     with a trailing slash meaning the same thing as none. Over-normalising is
     the direction that costs something — two paths wrongly judged equal would
     hydrate a fallback document, which is the bug — so this stays at the two
     transforms a static host itself applies and goes no further. */
  function canonical(path) {
    var out = path;
    try {
      out = decodeURIComponent(out);
    } catch (e) {
      /* A malformed escape sequence. Leave it encoded: the comparison below
         then fails and the page client-renders, which is the safe answer. */
    }
    return out.length > 1 && out.charAt(out.length - 1) === "/" ? out.slice(0, -1) : out;
  }

  if (canonical(rendered) === canonical(location.pathname)) return;

  Object.defineProperty(globalThis, "__EXPO_ROUTER_HYDRATE__", {
    configurable: true,
    get: function () {
      return false;
    },
    set: function () {
      /* expo's own flag script assigns `true` here after this runs. Swallow
         it: this document is not the one this URL asked for. */
    },
  });
})();
