(function () {
  'use strict';

  // Matches backend/src/routes/admin.router.ts:
  //   GET  /api/admin/auth              -> reads the admin-auth cookie against User.authKey
  //                                        200 { auth: true, user: { id, email, firstName, lastName, isAdmin } }
  //                                        200 { auth: false, reason: 'no_cookie' }
  //                                        400 { auth: false, reason: 'not_found' }
  //   POST /api/admin/login             -> body { username, password } (username is the admin's email)
  //                                        200 { auth: true, user: { id, email, firstName, lastName } }
  //                                        400/401/503 { error: string }
  //   POST /api/admin/create-user       -> requireAdminAuth, body { email, firstName, lastName }
  //                                        201 { id, email, firstName, lastName }
  //                                        400/409/401/403/500 { error: string }
  //   POST /api/admin/register-onboarding -> requireAdminAuth, body { userId, ttl, location, cc?, bcc?, extraContent? }
  //                                        location: OfficeLocation enum - 'gurugram' | 'gift_city' | 'dubai'
  //                                        201 { id, onboardingKey, userId, ttl, location }
  //                                        400 { error, validLocations? } / 404/401/403/500 { error: string }
  //   GET  /api/admin/get-user-list     -> requireAdminAuth
  //                                        200 [{ id, email, firstName, lastName, createdAt }, ...]
  //                                        (isAdmin: false users only, authKey never exposed)
  var API_BASE = 'https://api-nk.vercel.app/api/admin';

  // Secure fetch wrapper - only sends credentials to our API
  function apiFetch(url, options) {
    options = options || {};
    // Only include credentials if request is to our API
    if (url.indexOf('https://api-nk.vercel.app') === 0) {
      options.credentials = 'include';
    }
    return fetch(url, options);
  }

  function parseJson(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { status: res.status, data: data };
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var panels = Array.prototype.slice.call(document.querySelectorAll('.admin-panel'));

    function showPanel(panelId) {
      panels.forEach(function (panel) { panel.hidden = panel.id !== panelId; });
    }

    function showDashboard() {
      showPanel('admin-dashboard-panel');
    }

    // ---- Action card modals (Create User / Register Onboarding) ----

    var openModal = null;

    // Locking body alone isn't enough here - the site's global CSS sets
    // `html { overflow-x: hidden }`, an explicit non-visible value that
    // breaks the browser's usual "body's overflow controls the viewport"
    // propagation, leaving <html> independently scrollable behind the modal.
    function closeModal() {
      if (!openModal) return;
      openModal.hidden = true;
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      openModal = null;
    }

    function showModal(modalId) {
      closeModal();
      var modal = document.getElementById(modalId);
      if (!modal) return;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      openModal = modal;
    }

    Array.prototype.forEach.call(document.querySelectorAll('.admin-modal:not(#markdown-preview-modal) [data-modal-close]'), function (el) {
      el.addEventListener('click', closeModal);
    });

    // The markdown preview stacks on top of an already-open modal (e.g.
    // Register Onboarding) rather than replacing it, so it gets its own
    // open/close outside the single-modal openModal/closeModal tracking above.
    var markdownPreviewModal = document.getElementById('markdown-preview-modal');

    function closeMarkdownPreview() {
      if (markdownPreviewModal) markdownPreviewModal.hidden = true;
    }

    if (markdownPreviewModal) {
      Array.prototype.forEach.call(markdownPreviewModal.querySelectorAll('[data-modal-close]'), function (el) {
        el.addEventListener('click', closeMarkdownPreview);
      });
    }

    // ---- Toast notifications (top-right) ----

    var toastContainer = document.getElementById('toast-container');
    var TOAST_VISIBLE_MS = 5000;

    function showToast(message, type) {
      if (!toastContainer) return;

      var toast = document.createElement('div');
      toast.className = 'toast' + (type === 'success' ? ' is-success' : '');
      toast.textContent = message;
      toastContainer.appendChild(toast);

      requestAnimationFrame(function () { toast.classList.add('is-visible'); });

      var dismissed = false;
      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        toast.classList.remove('is-visible');
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 250);
      }

      toast.addEventListener('click', dismiss);
      setTimeout(dismiss, TOAST_VISIBLE_MS);
    }

    var createUserCard = document.getElementById('admin-create-user-card');
    if (createUserCard) {
      createUserCard.addEventListener('click', function () {
        var form = document.getElementById('admin-create-user-form');
        if (form) form.reset();
        clearFormStatus(document.getElementById('admin-create-user-status'));
        showModal('admin-create-user-modal');
      });
    }

    var userIdSelect = document.getElementById('ro-user-id');

    function setUserSelectMessage(message) {
      userIdSelect.innerHTML = '';
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = message;
      opt.disabled = true;
      opt.selected = true;
      userIdSelect.appendChild(opt);
    }

    function populateUserOptions(users) {
      if (!users || !users.length) {
        setUserSelectMessage('No users available');
        return;
      }

      userIdSelect.innerHTML = '';
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a user…';
      placeholder.disabled = true;
      placeholder.selected = true;
      userIdSelect.appendChild(placeholder);

      users.forEach(function (user) {
        var opt = document.createElement('option');
        opt.value = user.id;
        var name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
        opt.textContent = name ? name + ' — ' + user.email : user.email;
        userIdSelect.appendChild(opt);
      });
    }

    function loadUserList() {
      setUserSelectMessage('Loading users…');

      apiFetch(API_BASE + '/get-user-list', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (isSessionExpired(result.status)) {
            closeModal();
            checkAuth();
            return;
          }
          if (result.status !== 200 || !Array.isArray(result.data)) {
            setUserSelectMessage('Could not load users');
            return;
          }
          populateUserOptions(result.data);
        })
        .catch(function (err) {
          console.error('[admin] get-user-list failed:', err);
          setUserSelectMessage('Could not load users');
        });
    }

    var registerOnboardingCard = document.getElementById('admin-register-onboarding-card');
    if (registerOnboardingCard) {
      registerOnboardingCard.addEventListener('click', function () {
        showModal('admin-register-onboarding-modal');
        loadUserList();
      });
    }

    function checkAuth() {
      showPanel('admin-loading-panel');

      apiFetch(API_BASE + '/auth', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.data && result.data.auth) {
            showDashboard(result.data.user);
          } else {
            showPanel('admin-login-panel');
          }
        })
        .catch(function (err) {
          console.error('[admin] auth check failed:', err);
          showPanel('admin-error-panel');
        });
    }

    var retryBtn = document.getElementById('admin-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', checkAuth);

    // requireAdminAuth returns 401 (no cookie / user not found) or 403 (not an
    // admin) on the two dashboard actions below - either way the session is no
    // longer usable, so drop back to the login form instead of showing a
    // confusing per-field error.
    function isSessionExpired(status) {
      return status === 401 || status === 403;
    }

    function setFormStatus(el, message, type) {
      el.textContent = message;
      el.classList.remove('is-success', 'is-error');
      el.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
    }

    function clearFormStatus(el) {
      el.classList.remove('is-visible', 'is-success', 'is-error');
      el.textContent = '';
    }

    // register-onboarding's cc/bcc accept a single address string or an array -
    // let the admin type a comma/semicolon-separated list either way.
    function parseEmailListInput(value) {
      if (!value) return undefined;
      var list = value.split(/[,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!list.length) return undefined;
      return list.length === 1 ? list[0] : list;
    }

    // Full CommonMark + GFM markdown -> HTML for the extra-message field, via
    // the vendored marked.js (js/vendor/marked.js) - headings, lists,
    // blockquotes, code blocks, tables, strikethrough, links, etc. Note:
    // unlike the old hand-rolled version, marked does NOT escape raw HTML the
    // admin types - this field is requireAdminAuth-protected, so that's a
    // trusted-input tradeoff, not an anonymous-user XSS surface.
    // Email clients (Gmail especially) strip <style> tags and only reliably
    // honor inline styles, so the spacing/typography that makes the admin
    // preview look right (scoped to .markdown-preview-body in this page's own
    // <style> block) would NOT carry over to the actual email. Inlining every
    // tag's style here means the backend needs no CSS-inlining step of its
    // own - it can drop extraContent into the email as-is.
    var EMAIL_INLINE_STYLES = {
      H1: 'margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#1a1a1a;',
      H2: 'margin:16px 0 10px;font-family:Georgia,serif;font-size:19px;color:#1a1a1a;',
      H3: 'margin:14px 0 8px;font-family:Georgia,serif;font-size:17px;color:#1a1a1a;',
      H4: 'margin:12px 0 8px;font-family:Georgia,serif;font-size:15px;color:#1a1a1a;',
      H5: 'margin:12px 0 8px;font-size:14px;color:#1a1a1a;',
      H6: 'margin:12px 0 8px;font-size:13px;color:#1a1a1a;',
      P: 'margin:0 0 12px;',
      UL: 'margin:0 0 12px;padding-left:22px;',
      OL: 'margin:0 0 12px;padding-left:22px;',
      LI: 'margin:0 0 6px;',
      BLOCKQUOTE: 'margin:0 0 12px;padding-left:14px;border-left:3px solid #ddd;color:#666;',
      PRE: 'margin:0 0 12px;padding:12px;background:#f4f4f4;border-radius:4px;overflow-x:auto;',
      CODE: 'background:#f4f4f4;border-radius:3px;padding:2px 5px;font-size:0.9em;',
      HR: 'border:none;border-top:1px solid #ddd;margin:16px 0;',
      TABLE: 'border-collapse:collapse;width:100%;margin:0 0 12px;',
      TH: 'border:1px solid #ddd;padding:6px 10px;text-align:left;',
      TD: 'border:1px solid #ddd;padding:6px 10px;'
    };

    function markdownToHtml(markdown) {
      if (!markdown || typeof marked === 'undefined') return '';
      var html = marked.parse(markdown.trim(), { breaks: true, gfm: true });

      var container = document.createElement('div');
      container.innerHTML = html;

      Array.prototype.forEach.call(container.querySelectorAll('*'), function (el) {
        var style = EMAIL_INLINE_STYLES[el.tagName];
        if (style) el.setAttribute('style', style);
      });
      // A <code> inside a <pre> already inherits the block's background -
      // undo the standalone inline-code styling so it isn't doubled up.
      Array.prototype.forEach.call(container.querySelectorAll('pre code'), function (el) {
        el.setAttribute('style', 'background:none;padding:0;');
      });
      Array.prototype.forEach.call(container.querySelectorAll('a'), function (el) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
        el.setAttribute('style', 'color:#1a3080;');
      });

      return container.innerHTML;
    }

    // ---- Markdown toolbar + preview popup for the extra-message field ----

    var extraContentInput = document.getElementById('ro-extra-content');
    var markdownPreviewBody = document.getElementById('markdown-preview-body');
    var WRAP_SYNTAX = { bold: '**', italic: '*' };
    var LINE_PREFIX = { heading: '## ', ul: '- ', ol: '1. ', quote: '> ' };

    var previewBtn = document.getElementById('ro-preview-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', function () {
        markdownPreviewBody.innerHTML = markdownToHtml(extraContentInput.value);
        if (markdownPreviewModal) markdownPreviewModal.hidden = false;
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.markdown-toolbar-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.dataset.md;
        var start = extraContentInput.selectionStart;
        var end = extraContentInput.selectionEnd;
        var value = extraContentInput.value;
        var selected = value.slice(start, end);
        var text, cursor;

        if (type === 'link') {
          var inserted = '[' + (selected || 'link text') + '](https://example.com)';
          text = value.slice(0, start) + inserted + value.slice(end);
          cursor = start + inserted.length;
        } else if (type === 'code') {
          var codeInserted = selected.indexOf('\n') !== -1
            ? '```\n' + selected + '\n```'
            : '`' + (selected || 'code') + '`';
          text = value.slice(0, start) + codeInserted + value.slice(end);
          cursor = start + codeInserted.length;
        } else if (WRAP_SYNTAX[type]) {
          var wrap = WRAP_SYNTAX[type];
          var wrapped = wrap + (selected || (type === 'bold' ? 'bold text' : 'italic text')) + wrap;
          text = value.slice(0, start) + wrapped + value.slice(end);
          cursor = start + wrapped.length;
        } else if (LINE_PREFIX[type]) {
          var prefix = LINE_PREFIX[type];
          var lineStart = value.lastIndexOf('\n', start - 1) + 1;
          text = value.slice(0, lineStart) + prefix + value.slice(lineStart);
          cursor = start + prefix.length;
        } else {
          return;
        }

        extraContentInput.value = text;
        extraContentInput.focus();
        extraContentInput.setSelectionRange(cursor, cursor);
        extraContentInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    var loginForm = document.getElementById('admin-login-form');
    var usernameInput = document.getElementById('admin-username');
    var passwordInput = document.getElementById('admin-password');
    var loginSubmitBtn = document.getElementById('admin-login-submit');
    var loginStatus = document.getElementById('admin-login-status');

    function showLoginError(message) {
      loginStatus.textContent = message;
      loginStatus.classList.add('is-visible', 'is-error');
    }

    function clearLoginError() {
      loginStatus.classList.remove('is-visible', 'is-error');
      loginStatus.textContent = '';
    }

    if (loginForm) {
      loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearLoginError();

        var username = usernameInput.value.trim();
        var password = passwordInput.value;
        if (!username || !password) {
          showLoginError('Please enter both email and password.');
          return;
        }

        var originalText = loginSubmitBtn.textContent;
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = 'Signing in…';

        apiFetch(API_BASE + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username, password: password })
        })
          .then(parseJson)
          .then(function (result) {
            if (result.status === 200 && result.data && result.data.auth) {
              passwordInput.value = '';
              showDashboard(result.data.user);
              return;
            }

            showLoginError((result.data && result.data.error) || 'Something went wrong. Please try again.');
          })
          .catch(function (err) {
            console.error('[admin] login failed:', err);
            showLoginError('Something went wrong while signing in. Please try again.');
          })
          .finally(function () {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = originalText;
          });
      });
    }

    var createUserForm = document.getElementById('admin-create-user-form');
    var createUserSubmitBtn = document.getElementById('admin-create-user-submit');
    var createUserStatus = document.getElementById('admin-create-user-status');

    if (createUserForm) {
      createUserForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(createUserStatus);

        var email = document.getElementById('cu-email').value.trim();
        var firstName = document.getElementById('cu-first-name').value.trim();
        var lastName = document.getElementById('cu-last-name').value.trim();
        if (!email || !firstName || !lastName) {
          setFormStatus(createUserStatus, 'Please fill in email, first name and last name.', 'error');
          return;
        }

        var originalText = createUserSubmitBtn.textContent;
        createUserSubmitBtn.disabled = true;
        createUserSubmitBtn.textContent = 'Creating…';

        apiFetch(API_BASE + '/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, firstName: firstName, lastName: lastName })
        })
          .then(parseJson)
          .then(function (result) {
            if (isSessionExpired(result.status)) {
              checkAuth();
              return;
            }

            if (result.status === 201 && result.data && result.data.id) {
              createUserForm.reset();
              closeModal();
              showToast('User created successfully.', 'success');
              return;
            }

            setFormStatus(createUserStatus, (result.data && result.data.error) || 'Something went wrong. Please try again.', 'error');
          })
          .catch(function (err) {
            console.error('[admin] create-user failed:', err);
            setFormStatus(createUserStatus, 'Something went wrong while creating the user. Please try again.', 'error');
          })
          .finally(function () {
            createUserSubmitBtn.disabled = false;
            createUserSubmitBtn.textContent = originalText;
          });
      });
    }

    var registerOnboardingForm = document.getElementById('admin-register-onboarding-form');
    var registerOnboardingSubmitBtn = document.getElementById('admin-register-onboarding-submit');
    var registerOnboardingStatus = document.getElementById('admin-register-onboarding-status');

    if (registerOnboardingForm) {
      registerOnboardingForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(registerOnboardingStatus);

        var userId = document.getElementById('ro-user-id').value.trim();
        var location = document.getElementById('ro-location').value.trim();
        var ttl = parseInt(document.getElementById('ro-ttl').value, 10);
        if (!userId || !location || !ttl || ttl <= 0) {
          setFormStatus(registerOnboardingStatus, 'Please select a user, a location, and enter a positive TTL in seconds.', 'error');
          return;
        }

        var cc = parseEmailListInput(document.getElementById('ro-cc').value);
        var bcc = parseEmailListInput(document.getElementById('ro-bcc').value);
        var extraContentRaw = document.getElementById('ro-extra-content').value.trim();

        var payload = { userId: userId, location: location, ttl: ttl };
        if (cc) payload.cc = cc;
        if (bcc) payload.bcc = bcc;
        // Sent as already-safe HTML (markdown converted client-side) - see
        // markdownToHtml() above for why this is safe to embed as-is.
        if (extraContentRaw) payload.extraContent = markdownToHtml(extraContentRaw);

        var originalText = registerOnboardingSubmitBtn.textContent;
        registerOnboardingSubmitBtn.disabled = true;
        registerOnboardingSubmitBtn.textContent = 'Registering…';

        apiFetch(API_BASE + '/register-onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(parseJson)
          .then(function (result) {
            if (isSessionExpired(result.status)) {
              checkAuth();
              return;
            }

            if (result.status === 201 && result.data && result.data.onboardingKey) {
              var link = window.location.origin + '/verify-onboarding.html?id=' + encodeURIComponent(result.data.onboardingKey);
              registerOnboardingForm.reset();
              registerOnboardingStatus.textContent = '';
              registerOnboardingStatus.appendChild(document.createTextNode('Onboarding link ready:'));
              registerOnboardingStatus.appendChild(document.createElement('br'));
              var linkEl = document.createElement('span');
              linkEl.className = 'admin-result-value';
              linkEl.textContent = link;
              registerOnboardingStatus.appendChild(linkEl);
              registerOnboardingStatus.classList.remove('is-error');
              registerOnboardingStatus.classList.add('is-visible', 'is-success');
              return;
            }

            setFormStatus(registerOnboardingStatus, (result.data && result.data.error) || 'Something went wrong. Please try again.', 'error');
          })
          .catch(function (err) {
            console.error('[admin] register-onboarding failed:', err);
            setFormStatus(registerOnboardingStatus, 'Something went wrong while registering onboarding. Please try again.', 'error');
          })
          .finally(function () {
            registerOnboardingSubmitBtn.disabled = false;
            registerOnboardingSubmitBtn.textContent = originalText;
          });
      });
    }

    checkAuth();
  });
})();
