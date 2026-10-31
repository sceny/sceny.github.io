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
          if (body && body.open === true && form.getAttribute('data-state') === 'soon') form.setAttribute('data-state', 'idle');
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
