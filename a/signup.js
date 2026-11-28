(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var from = new URLSearchParams(location.search).get('from');

  function show(form, state) {
    form.setAttribute('data-state', state);
    var target = state === 'done' ? form.querySelector('.done') : state === 'invalid' || state === 'error' ? form.querySelector('input[name=email]') : null;
    if (target) target.focus();
  }

  // On sceny.github.io the forms post to another origin (the publish step writes the absolute action).
  // That copy is static, so it cannot know whether the list is open: it asks the action's URL, and a
  // closed list keeps the "opens soon" card. The submit is the browser's own form POST, which needs
  // no CORS; the Function answers it with a redirect to its own page.
  function crossOrigin(form) {
    return new URL(form.getAttribute('action'), location.href).origin !== location.origin;
  }

  // The "app" state, as site/functions/lib/forms.js serves it: no field, no label and no line about an
  // email is left, the card's link points into the app at `origin`, and the lines outside the forms that
  // say when the beta opens take their data-app-text.
  function toApp(form, origin) {
    Array.prototype.forEach.call(form.querySelectorAll('label, .row, .hp, input, .msg, .done, .signup > .fine'), function (el) {
      el.remove();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-app-text]'), function (el) {
      el.textContent = el.getAttribute('data-app-text');
      el.removeAttribute('data-app-text');
    });
    Array.prototype.forEach.call(form.querySelectorAll('a[data-app]'), function (a) {
      a.setAttribute('href', origin + a.getAttribute('data-app'));
      a.removeAttribute('data-app');
    });
    form.setAttribute('data-state', 'app');
  }

  Array.prototype.forEach.call(document.querySelectorAll('form.signup'), function (form) {
    if (crossOrigin(form)) {
      if (from && !form.querySelector('input[name=from]')) {
        var hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'from';
        hidden.value = from;
        form.appendChild(hidden);
      }
      fetch(form.action, { headers: { accept: 'application/json' } })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (body) {
          if (!body || form.getAttribute('data-state') !== 'soon') return;
          if (body.open === true) form.setAttribute('data-state', 'idle');
          else if (typeof body.app === 'string' && /^https:\/\/[a-z0-9.-]+$/.test(body.app)) toApp(form, body.app);
        })
        .catch(function () {});
      form.addEventListener('submit', function (event) {
        var email = form.querySelector('input[name=email]');
        if (!EMAIL.test(String(email && email.value).trim())) {
          event.preventDefault();
          show(form, 'invalid');
        }
      });
      return;
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (form.getAttribute('data-state') === 'sending') return;
      var fields = {};
      new FormData(form).forEach(function (value, key) {
        fields[key] = value;
      });
      if (!fields.from && from) fields.from = from;
      if (!EMAIL.test(String(fields.email || '').trim())) return show(form, 'invalid');
      form.setAttribute('data-state', 'sending');
      fetch('/api/beta', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(fields),
      }).then(
        function (res) {
          show(form, res.ok ? 'done' : res.status === 400 ? 'invalid' : 'error');
        },
        function () {
          show(form, 'error');
        },
      );
    });
  });
})();
