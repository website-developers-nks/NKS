(function () {
  'use strict';

  // Manage Users page (manage-users.html), reached from the "Manage Users"
  // card on administrator.html. Backed by backend/src/routes/admin.router.ts:
  //   GET  /api/admin/auth         -> same session check administrator.html does;
  //                                   anything other than { auth: true } sends the
  //                                   admin back to administrator.html to log in.
  //                                   user.permissions is what their permission
  //                                   group grants - this page renders from it
  //   GET  /api/admin/users        -> manage_users OR manage_permissions
  //                                   200 [{ id, email, firstName, lastName, isAdmin,
  //                                          permissionGroup: { id, name } | null, createdAt }, ...]
  //   POST /api/admin/create-user  -> manage_users
  //                                   body { email, firstName, lastName, isAdmin, permissionGroupId? }
  //                                   permissionGroupId is required when isAdmin is true
  //                                   201 { id, email, firstName, lastName, isAdmin }
  //   PATCH /api/admin/users/:id/permission-group -> manage_permissions
  //                                   body { permissionGroupId: string | null }
  //                                   200 { id, permissionGroup: { id, name } | null }
  //   GET  /api/admin/onboardings?userId=<id> -> view_onboarding_results OR manage_onboardings
  //                                   same payload the dashboard's View Onboardings uses,
  //                                   narrowed to one user; backs "Show Onboardings" on a row
  //   DELETE /api/admin/users/:id  -> delete_users
  //                                   409 { reason: 'has_related_data', onboardings, documents,
  //                                   queuedEmails } when anything is attached and nothing was
  //                                   touched; repeat with ?force=true to cascade through the
  //                                   onboardings, submitted data, R2 files and queued emails.
  //                                   400 when the target is your own account
  //   GET  /api/admin/users/:id/emails -> manage_users
  //                                   200 [{ id, title, subject, status, scheduledAt, sentAt,
  //                                          cancelledAt, cc, bcc, threaded, attempts,
  //                                          lastError, createdAt }, ...] newest first
  //   POST /api/admin/users/:id/emails/:emailId/cancel -> manage_users
  //                                   200 { id, cancelled: true }; 409 once it has been sent
  //   GET  /api/admin/users/:id/threads -> manage_users
  //                                   200 [{ id, company, location, subject, createdAt,
  //                                          canReply }, ...] - onboardings this user has;
  //                                   canReply is false when the invite predates threading
  //   POST /api/admin/users/:id/send-email -> manage_users
  //                                   body { title, subtitle?, content (rendered HTML),
  //                                          contentMarkdown?, cc?, bcc?, scheduledAt?,
  //                                          onboardingId? }
  //                                   no scheduledAt sends during the request; a future one
  //                                   is queued for the cron in routes/cron.router.ts.
  //                                   onboardingId threads the mail under that onboarding's
  //                                   invite (409 reason 'no_thread' if it has no Message-ID)
  //   GET  /api/admin/message-templates -> manage_onboardings OR manage_users
  //                                   200 [{ id, name, content, createdAt }, ...] - the same
  //                                   saved markdown the onboarding editor offers
  //   GET  /api/admin/permission-groups -> manage_permissions OR manage_users
  //                                   200 { permissions: [...], groups: [{ id, name,
  //                                         permissions, memberCount, createdAt }, ...] }
  //   POST /api/admin/permission-groups        -> manage_permissions, body { name, permissions }
  //   PATCH /api/admin/permission-groups/:id   -> manage_permissions, body { name?, permissions? }
  //   DELETE /api/admin/permission-groups/:id  -> manage_permissions
  //                                   409 if admins are still assigned to the group, or if it
  //                                   is the last group granting Manage Permissions
  var API_BASE = '/api/admin';

  var ADMIN_PAGE = 'administrator.html';

  // Mirrors Permission in backend/src/db/models/permission-group.model.ts.
  var PERMISSIONS = {
    manage_users: { label: 'Manage Users', hint: 'Add users to the portal' },
    email_users: { label: 'Email Users', hint: 'Send, schedule and cancel emails to users' },
    delete_users: { label: 'Delete Users', hint: 'Permanently delete users and their onboarding data' },
    manage_permissions: { label: 'Manage Permissions', hint: 'Create groups and assign them to admins' },
    manage_onboardings: { label: 'Manage Onboardings', hint: 'Register and resend onboarding links' },
    expire_onboardings: { label: 'Expire Onboardings', hint: "Kill an in-flight onboarding link - there's no undo" },
    view_onboarding_list: { label: 'View Onboarding List', hint: 'See onboardings and their progress, but not the data inside' },
    view_onboarding_results: { label: 'View Onboarding Results', hint: 'Open submitted onboarding data' },
    view_onboarding_docs: { label: 'View Onboarding Docs', hint: 'Open documents uploaded during onboarding' },
    export_onboarding_data: { label: 'Export Onboarding Data', hint: 'Download a full response, documents included' },
    manage_sheets: { label: 'Manage Google Sheets', hint: 'Add and remove the sheets onboarding data is written to' }
  };

  function permissionLabel(key) {
    return (PERMISSIONS[key] && PERMISSIONS[key].label) || key;
  }

  function parseJson(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { status: res.status, data: data };
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var panels = Array.prototype.slice.call(document.querySelectorAll('.admin-panel'));

    var myPermissions = [];
    var myUserId = null;
    var myGroupId = null;
    var usersCache = [];
    var groupsCache = [];
    var availablePermissions = Object.keys(PERMISSIONS);

    function can(permission) {
      return myPermissions.indexOf(permission) !== -1;
    }

    function showPanel(panelId) {
      panels.forEach(function (panel) { panel.hidden = panel.id !== panelId; });
    }

    function goToLogin() {
      window.location.replace(ADMIN_PAGE);
    }

    // A 401, or a 403 that says the session isn't an admin session, means the
    // session itself is gone -> back to the login form. A 403 carrying
    // 'missing_permission'/'no_permission_group' is a live session that simply
    // isn't allowed to do this, so it stays on the page and just says so.
    function handleApiFailure(result) {
      if (result.status === 401) {
        goToLogin();
        return true;
      }
      if (result.status === 403) {
        var reason = result.data && result.data.reason;
        if (reason === 'missing_permission' || reason === 'no_permission_group') {
          showToast((result.data && result.data.error) || 'You do not have permission to do this.', 'error');
          return true;
        }
        goToLogin();
        return true;
      }
      return false;
    }

    // ---- Modals (same body/html scroll lock as admin.js - the site's global
    // `html { overflow-x: hidden }` stops the usual body-to-viewport overflow
    // propagation, so <html> has to be locked explicitly too) ----

    var openModal = null;

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

    Array.prototype.forEach.call(document.querySelectorAll('.admin-modal [data-modal-close]'), function (el) {
      el.addEventListener('click', closeModal);
    });

    var logoutButtons = [
      document.getElementById('admin-logout-btn'),
      document.getElementById('admin-logout-btn-mobile')
    ].filter(Boolean);

    function showLogout(visible) {
      logoutButtons.forEach(function (btn) { btn.classList.toggle('is-visible', !!visible); });
    }

    logoutButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        logoutButtons.forEach(function (b) { b.disabled = true; });

        fetch(API_BASE + '/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        })
          .catch(function (err) { console.error('[manage-users] logout failed:', err); })
          .finally(goToLogin);
      });
    });

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

    function setFormStatus(el, message, type) {
      el.textContent = message;
      el.classList.remove('is-success', 'is-error');
      el.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
    }

    function clearFormStatus(el) {
      el.classList.remove('is-visible', 'is-success', 'is-error');
      el.textContent = '';
    }

    function setListMessage(el, message) {
      el.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'onboardings-message';
      p.textContent = message;
      el.appendChild(p);
    }

    // ---- Tabs ----

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.admin-tab'));
    var tabPanels = Array.prototype.slice.call(document.querySelectorAll('.admin-tab-panel'));

    function selectTab(name) {
      tabs.forEach(function (tab) {
        var active = tab.dataset.tab === name;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      tabPanels.forEach(function (panel) {
        panel.hidden = panel.dataset.tabPanel !== name;
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.dataset.tab); });
    });

    // ---- User list ----

    var searchInput = document.getElementById('mu-search');
    var roleFilter = document.getElementById('mu-role-filter');
    var listEl = document.getElementById('mu-list');

    function buildGroupSelect(user) {
      var select = document.createElement('select');
      select.className = 'row-select';
      select.setAttribute('aria-label', 'Permission group for ' + user.email);

      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'No group (no access)';
      select.appendChild(none);

      groupsCache.forEach(function (group) {
        var opt = document.createElement('option');
        opt.value = group.id;
        opt.textContent = group.name;
        select.appendChild(opt);
      });

      select.value = user.permissionGroup ? user.permissionGroup.id : '';

      select.addEventListener('change', function () {
        var groupId = select.value;

        if (user.id === myUserId && !window.confirm('This is your own account. Changing your group changes what you can do - continue?')) {
          select.value = user.permissionGroup ? user.permissionGroup.id : '';
          return;
        }

        var previous = user.permissionGroup ? user.permissionGroup.id : '';
        select.disabled = true;

        fetch(API_BASE + '/users/' + encodeURIComponent(user.id) + '/permission-group', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionGroupId: groupId || null })
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) {
              select.value = previous;
              return;
            }
            if (result.status !== 200) {
              showToast((result.data && result.data.error) || 'Could not update the permission group.', 'error');
              select.value = previous;
              return;
            }
            user.permissionGroup = result.data.permissionGroup;
            showToast('Permission group updated.', 'success');
            if (user.id === myUserId) {
              // Own permissions just changed - re-read them and re-render the
              // whole page from the new set.
              checkAuth();
            } else {
              // Group member counts on the other tab are now stale.
              loadGroups();
            }
          })
          .catch(function (err) {
            console.error('[manage-users] permission group update failed:', err);
            showToast('Could not update the permission group.', 'error');
            select.value = previous;
          })
          .finally(function () {
            select.disabled = false;
          });
      });

      return select;
    }

    // ---- A single user's onboardings ----
    //
    // The same row treatment the dashboard's View Onboardings uses, scoped to
    // one person. Since the user is already the subject of the popup, the rows
    // lead with what actually distinguishes them: company and location.

    var LOCATION_LABELS = { gurugram: 'Gurugram', gift_city: 'GIFT City', dubai: 'Dubai' };
    var COMPANY_LABELS = {
      nksecurities: 'NK Securities',
      'nk securities research & tech': 'NKS Research & Tech'
    };
    var EXPIRY_REASON_LABELS = {
      too_many_doc_uploads: 'Too many document uploads',
      too_many_presign_requests: 'Too many presign requests for a document',
      too_many_sync_requests: 'Too many sync requests',
      too_many_field_edits: 'Too many edits to a field',
      too_many_submit_attempts: 'Too many submission attempts',
      link_expiration_date_passed: 'Expiration date passed',
      admin_expired: 'Manually expired by admin'
    };

    var uoList = document.getElementById('uo-list');
    var uoTitle = document.getElementById('uo-title');
    var uoSubtitle = document.getElementById('uo-subtitle');

    function canViewOnboardings() {
      return can('view_onboarding_results') || can('manage_onboardings');
    }

    function renderUserOnboardingRow(item) {
      var row = document.createElement('div');
      row.className = 'onboarding-row';

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var title = document.createElement('div');
      title.className = 'onboarding-row-name';
      title.textContent = [COMPANY_LABELS[item.company] || item.company, LOCATION_LABELS[item.location] || item.location]
        .filter(Boolean).join(' · ');
      info.appendChild(title);

      var metaParts = [];
      if (item.createdAt) metaParts.push('Registered ' + new Date(item.createdAt).toLocaleDateString());
      if (item.expirationDate) metaParts.push('Expires ' + new Date(item.expirationDate).toLocaleDateString());
      if (item.status === 'expired' && item.expiredReason) {
        metaParts.push(EXPIRY_REASON_LABELS[item.expiredReason] || item.expiredReason);
      }

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = metaParts.join(' · ');
      info.appendChild(meta);

      if (item.onboardingKey) {
        var key = document.createElement('div');
        key.className = 'onboarding-row-key';
        key.textContent = 'Key: ' + item.onboardingKey;
        info.appendChild(key);
      }

      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';

      var badge = document.createElement('span');
      badge.className = 'onboarding-badge status-' + item.status;
      badge.textContent = item.status.charAt(0).toUpperCase() + item.status.slice(1);
      actions.appendChild(badge);

      row.appendChild(actions);
      return row;
    }

    function openUserOnboardings(user) {
      showModal('admin-user-onboardings-modal');

      var fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      uoTitle.textContent = (fullName || user.email) + ' — Onboardings';
      uoSubtitle.textContent = 'Every onboarding link registered for ' + user.email + '.';
      setListMessage(uoList, 'Loading onboardings…');

      fetch(API_BASE + '/onboardings?userId=' + encodeURIComponent(user.id), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            handleApiFailure(result);
            setListMessage(uoList, (result.data && result.data.error) || 'Could not load onboardings.');
            return;
          }

          uoList.innerHTML = '';
          if (!result.data.length) {
            setListMessage(uoList, 'No onboardings have been registered for this user.');
            return;
          }
          result.data.forEach(function (item) { uoList.appendChild(renderUserOnboardingRow(item)); });
        })
        .catch(function (err) {
          console.error('[manage-users] user onboardings fetch failed:', err);
          setListMessage(uoList, 'Could not load onboardings.');
        });
    }

 
    var sendEmailForm = document.getElementById('admin-send-email-form');
    var sendEmailSubmitBtn = document.getElementById('admin-send-email-submit');
    var sendEmailStatus = document.getElementById('admin-send-email-status');
    var seRecipient = document.getElementById('se-recipient');
    var seContent = document.getElementById('se-content');
    var sePreviewBody = document.getElementById('se-preview-body');
    var seTabs = Array.prototype.slice.call(document.querySelectorAll('[data-se-tab]'));
    var sePanels = Array.prototype.slice.call(document.querySelectorAll('[data-se-panel]'));
    var emailRecipient = null;

    if (window.NKSMarkdown) window.NKSMarkdown.initToolbars();

    function selectEmailTab(name) {
      seTabs.forEach(function (tab) {
        var active = tab.dataset.seTab === name;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      sePanels.forEach(function (panel) { panel.hidden = panel.dataset.sePanel !== name; });

      if (name === 'preview' && window.NKSMarkdown) {
        sePreviewBody.innerHTML = window.NKSMarkdown.toEmailHtml(seContent.value);
      }
    }

    seTabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectEmailTab(tab.dataset.seTab); });
    });

    var modeSelect = document.getElementById('se-mode');
    var threadWrap = document.getElementById('se-thread-wrap');
    var threadSelect = document.getElementById('se-onboarding');
    var THREAD_COMPANY_LABELS = {
      nksecurities: 'NK Securities',
      'nk securities research & tech': 'NKS Research & Tech'
    };
    var THREAD_LOCATION_LABELS = { gurugram: 'Gurugram', gift_city: 'GIFT City', dubai: 'Dubai' };

    function setThreadMessage(message) {
      threadSelect.innerHTML = '';
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = message;
      opt.disabled = true;
      opt.selected = true;
      threadSelect.appendChild(opt);
    }

    function loadThreads(user) {
      setThreadMessage('Loading onboardings…');

      return fetch(API_BASE + '/users/' + encodeURIComponent(user.id) + '/threads', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            handleApiFailure(result);
            setThreadMessage('Could not load onboardings');
            return;
          }

          if (!result.data.length) {
            setThreadMessage('This user has no onboardings');
            return;
          }

          threadSelect.innerHTML = '';
          var placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = 'Select an onboarding…';
          placeholder.disabled = true;
          placeholder.selected = true;
          threadSelect.appendChild(placeholder);

          result.data.forEach(function (thread) {
            var opt = document.createElement('option');
            opt.value = thread.id;
            var label = [
              THREAD_COMPANY_LABELS[thread.company] || thread.company,
              THREAD_LOCATION_LABELS[thread.location] || thread.location,
              thread.createdAt ? new Date(thread.createdAt).toLocaleDateString() : ''
            ].filter(Boolean).join(' · ');
            opt.textContent = thread.canReply ? label : label + ' — no thread to reply to';
            opt.disabled = !thread.canReply;
            threadSelect.appendChild(opt);
          });
        })
        .catch(function (err) {
          console.error('[manage-users] threads fetch failed:', err);
          setThreadMessage('Could not load onboardings');
        });
    }

    function syncThreadField() {
      var threaded = modeSelect.value === 'thread';
      threadWrap.hidden = !threaded;
      if (threaded && emailRecipient) loadThreads(emailRecipient);
    }

    if (modeSelect) modeSelect.addEventListener('change', syncThreadField);

    var templateSelect = document.getElementById('se-template');
    var templatesCache = [];

    function renderTemplateOptions() {
      if (!templateSelect) return;
      templateSelect.innerHTML = '';

      var none = document.createElement('option');
      none.value = '';
      none.textContent = templatesCache.length ? 'No template' : 'No templates saved yet';
      templateSelect.appendChild(none);

      templatesCache.forEach(function (template) {
        var opt = document.createElement('option');
        opt.value = template.id;
        opt.textContent = template.name;
        templateSelect.appendChild(opt);
      });

      templateSelect.value = '';
    }

    function loadTemplates() {
      if (!templateSelect) return Promise.resolve();

      return fetch(API_BASE + '/message-templates', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            console.error('[manage-users] templates fetch failed:', result.status);
            return;
          }
          templatesCache = result.data;
          renderTemplateOptions();
        })
        .catch(function (err) {
          console.error('[manage-users] templates fetch failed:', err);
        });
    }

    if (templateSelect) {
      templateSelect.addEventListener('change', function () {
        var template = templatesCache.filter(function (t) { return t.id === templateSelect.value; })[0];
        if (!template) return;

        // Only ask when there is actually something to lose.
        var current = seContent.value.trim();
        if (current && current !== template.content.trim() &&
            !window.confirm('Replace the current message with the "' + template.name + '" template?')) {
          templateSelect.value = '';
          return;
        }

        seContent.value = template.content;
        selectEmailTab('editor');
      });
    }

  
    var saveTemplateBtn = document.getElementById('se-save-template-btn');
    var saveTemplateRow = document.getElementById('se-save-template-row');
    var templateNameInput = document.getElementById('se-template-name');
    var saveTemplateConfirmBtn = document.getElementById('se-save-template-confirm');
    var saveTemplateCancelBtn = document.getElementById('se-save-template-cancel');

    function hideTemplateSaveRow() {
      if (!saveTemplateRow) return;
      saveTemplateRow.hidden = true;
      templateNameInput.value = '';
    }

    if (saveTemplateBtn) {
      saveTemplateBtn.addEventListener('click', function () {
        if (!seContent.value.trim()) {
          showToast('There is nothing to save - write a message first.', 'error');
          return;
        }
        saveTemplateRow.hidden = false;
        templateNameInput.focus();
      });
    }

    if (saveTemplateCancelBtn) saveTemplateCancelBtn.addEventListener('click', hideTemplateSaveRow);

    function saveTemplate() {
      var name = templateNameInput.value.trim();

      if (!name) {
        showToast('Please name the template.', 'error');
        templateNameInput.focus();
        return;
      }

      var originalText = saveTemplateConfirmBtn.textContent;
      saveTemplateConfirmBtn.disabled = true;
      saveTemplateConfirmBtn.textContent = 'Saving…';

      fetch(API_BASE + '/message-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, content: seContent.value })
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) return;

          if (result.status === 201 && result.data && result.data.id) {
            hideTemplateSaveRow();
            showToast('Template saved.', 'success');
            // Reload so the picker offers it straight away, already selected.
            loadTemplates().then(function () {
              if (templateSelect) templateSelect.value = result.data.id;
            });
            return;
          }

          showToast((result.data && result.data.error) || 'Could not save the template.', 'error');
        })
        .catch(function (err) {
          console.error('[manage-users] save template failed:', err);
          showToast('Could not save the template.', 'error');
        })
        .finally(function () {
          saveTemplateConfirmBtn.disabled = false;
          saveTemplateConfirmBtn.textContent = originalText;
        });
    }

    if (saveTemplateConfirmBtn) saveTemplateConfirmBtn.addEventListener('click', saveTemplate);

    if (templateNameInput) {
      // The row sits in the dialog header, outside the send-email <form>, so
      // Enter needs wiring by hand.
      templateNameInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveTemplate();
        }
      });
    }

    // cc/bcc accept a single address or a list, same as register-onboarding.
    function parseEmailListInput(value) {
      if (!value) return undefined;
      var list = value.split(/[,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!list.length) return undefined;
      return list.length === 1 ? list[0] : list;
    }

    function openSendEmail(user) {
      emailRecipient = user;
      sendEmailForm.reset();
      clearFormStatus(sendEmailStatus);
      hideTemplateSaveRow();
      selectEmailTab('editor');
      syncThreadField();
      loadTemplates();

      var fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      seRecipient.textContent = 'This will be sent to ' + (fullName ? fullName + ' (' + user.email + ')' : user.email) + '.';

      // <input type="datetime-local"> compares against local wall-clock time, so
      // min has to be local too - toISOString() would be UTC and reject valid
      // times for anyone east of Greenwich.
      var scheduleInput = document.getElementById('se-schedule');
      var now = new Date();
      var pad = function (n) { return String(n).padStart(2, '0'); };
      scheduleInput.min = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
        'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());

      showModal('admin-send-email-modal');
      document.getElementById('se-title').focus();
    }

    if (sendEmailForm) {
      sendEmailForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(sendEmailStatus);

        if (!emailRecipient) return;

        var title = document.getElementById('se-title').value.trim();
        var subtitle = document.getElementById('se-subtitle').value.trim();
        var markdown = seContent.value.trim();
        var scheduleValue = document.getElementById('se-schedule').value;

        if (!title) {
          setFormStatus(sendEmailStatus, 'Please enter a title.', 'error');
          return;
        }

        if (!markdown) {
          setFormStatus(sendEmailStatus, 'Please write a message.', 'error');
          return;
        }

        var onboardingId = modeSelect.value === 'thread' ? threadSelect.value : '';
        if (modeSelect.value === 'thread' && !onboardingId) {
          setFormStatus(sendEmailStatus, 'Please pick the onboarding thread to reply in.', 'error');
          return;
        }

        var scheduledAt;
        if (scheduleValue) {
          var when = new Date(scheduleValue);
          if (Number.isNaN(when.getTime())) {
            setFormStatus(sendEmailStatus, 'That schedule date is not valid.', 'error');
            return;
          }
          if (when.getTime() <= Date.now()) {
            setFormStatus(sendEmailStatus, 'The scheduled time must be in the future.', 'error');
            return;
          }
          // Sent as an absolute instant - the field is local wall-clock time.
          scheduledAt = when.toISOString();
        }

        var payload = {
          title: title,
          content: window.NKSMarkdown ? window.NKSMarkdown.toEmailHtml(markdown) : markdown,
          contentMarkdown: markdown
        };
        if (subtitle) payload.subtitle = subtitle;
        var cc = parseEmailListInput(document.getElementById('se-cc').value);
        var bcc = parseEmailListInput(document.getElementById('se-bcc').value);
        if (cc) payload.cc = cc;
        if (bcc) payload.bcc = bcc;
        if (scheduledAt) payload.scheduledAt = scheduledAt;
        if (onboardingId) payload.onboardingId = onboardingId;

        var originalText = sendEmailSubmitBtn.textContent;
        sendEmailSubmitBtn.disabled = true;
        sendEmailSubmitBtn.textContent = scheduledAt ? 'Scheduling…' : 'Sending…';

        fetch(API_BASE + '/users/' + encodeURIComponent(emailRecipient.id) + '/send-email', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;

            if (result.status === 201 && result.data && result.data.id) {
              sendEmailForm.reset();
              selectEmailTab('editor');
              closeModal();
              showToast(result.data.scheduled
                ? 'Email scheduled for ' + new Date(result.data.scheduledAt).toLocaleString() + '.'
                : 'Email sent.', 'success');
              return;
            }

            setFormStatus(sendEmailStatus, (result.data && result.data.error) || 'Could not send the email.', 'error');
          })
          .catch(function (err) {
            console.error('[manage-users] send email failed:', err);
            setFormStatus(sendEmailStatus, 'Something went wrong while sending. Please try again.', 'error');
          })
          .finally(function () {
            sendEmailSubmitBtn.disabled = false;
            sendEmailSubmitBtn.textContent = originalText;
          });
      });
    }

    function describeRelated(data) {
      var parts = [];
      if (data.onboardings) parts.push(data.onboardings + ' onboarding' + (data.onboardings === 1 ? '' : 's'));
      if (data.documents) parts.push(data.documents + ' uploaded document' + (data.documents === 1 ? '' : 's'));
      if (data.queuedEmails) parts.push(data.queuedEmails + ' queued email' + (data.queuedEmails === 1 ? '' : 's'));
      return parts.join(', ');
    }

    function deleteUser(user, btn, force) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Deleting…';

      fetch(API_BASE + '/users/' + encodeURIComponent(user.id) + (force ? '?force=true' : ''), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) return;

          // The user has data attached - say exactly what would go with them.
          if (result.status === 409 && result.data && result.data.reason === 'has_related_data') {
            var summary = describeRelated(result.data);
            if (window.confirm(
              'Deleting this user will also permanently delete ' + summary + ', including any files they uploaded.\n\n' +
              'This cannot be undone. Delete anyway?'
            )) {
              deleteUser(user, btn, true);
              return;
            }
            btn.disabled = false;
            btn.textContent = originalText;
            return;
          }

          if (result.status === 200 && result.data && result.data.deleted) {
            showToast('User deleted.', 'success');
            loadUsers();
            if (can('manage_permissions')) loadGroups();
            return;
          }

          showToast((result.data && result.data.error) || 'Could not delete the user.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        })
        .catch(function (err) {
          console.error('[manage-users] delete user failed:', err);
          showToast('Could not delete the user.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        });
    }

    var ueList = document.getElementById('ue-list');
    var ueTitle = document.getElementById('ue-title');
    var ueSubtitle = document.getElementById('ue-subtitle');
    var emailsRecipient = null;

    var EMAIL_STATUS_BADGE = {
      pending: { className: 'status-pending', label: 'Scheduled' },
      sent: { className: 'status-completed', label: 'Sent' },
      failed: { className: 'status-expired', label: 'Failed' },
      cancelled: { className: 'status-cancelled', label: 'Cancelled' }
    };

    function cancelScheduledEmail(email, btn) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Cancelling…';

      fetch(API_BASE + '/users/' + encodeURIComponent(emailsRecipient.id) +
            '/emails/' + encodeURIComponent(email.id) + '/cancel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) return;

          if (result.status === 200 && result.data && result.data.cancelled) {
            showToast('Scheduled email cancelled.', 'success');
            loadUserEmails(emailsRecipient);
            return;
          }

          showToast((result.data && result.data.error) || 'Could not cancel that email.', 'error');
          if (result.status === 409) loadUserEmails(emailsRecipient);
          btn.disabled = false;
          btn.textContent = originalText;
        })
        .catch(function (err) {
          console.error('[manage-users] cancel email failed:', err);
          showToast('Could not cancel that email.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        });
    }

    function renderEmailRow(email) {
      var row = document.createElement('div');
      row.className = 'onboarding-row is-clickable';
      row.addEventListener('click', function () { openEmailDetail(email); });

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var title = document.createElement('div');
      title.className = 'onboarding-row-name';
      title.textContent = email.title;
      info.appendChild(title);

      var metaParts = [];
      if (email.status === 'sent' && email.sentAt) {
        metaParts.push('Sent ' + new Date(email.sentAt).toLocaleString());
      } else if (email.status === 'pending') {
        metaParts.push('Scheduled for ' + new Date(email.scheduledAt).toLocaleString());
      } else if (email.status === 'cancelled' && email.cancelledAt) {
        metaParts.push('Cancelled ' + new Date(email.cancelledAt).toLocaleString());
      } else if (email.scheduledAt) {
        metaParts.push('Due ' + new Date(email.scheduledAt).toLocaleString());
      }
      if (email.threaded) metaParts.push('Reply in onboarding thread');
      if (email.cc && email.cc.length) metaParts.push('CC ' + email.cc.join(', '));
      if (email.bcc && email.bcc.length) metaParts.push('BCC ' + email.bcc.join(', '));

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = metaParts.join(' · ');
      info.appendChild(meta);

      if (email.status === 'failed' && email.lastError) {
        var error = document.createElement('div');
        error.className = 'onboarding-row-key';
        error.textContent = email.lastError + ' (' + email.attempts + ' attempt' + (email.attempts === 1 ? '' : 's') + ')';
        info.appendChild(error);
      }

      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';

      if (email.status === 'pending') {
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'onboarding-row-btn is-danger';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          cancelScheduledEmail(email, cancelBtn);
        });
        actions.appendChild(cancelBtn);
      }

      var badge = document.createElement('span');
      var style = EMAIL_STATUS_BADGE[email.status] || { className: 'status-pending', label: email.status };
      badge.className = 'onboarding-badge ' + style.className;
      badge.textContent = style.label;
      actions.appendChild(badge);

      row.appendChild(actions);
      return row;
    }

    var ueDetail = document.getElementById('ue-detail');
    var ueDetailBody = document.getElementById('ue-detail-body');
    var ueBackBtn = document.getElementById('ue-back');

    function showEmailList() {
      ueDetail.hidden = true;
      ueList.hidden = false;
      ueSubtitle.hidden = false;
    }

    if (ueBackBtn) ueBackBtn.addEventListener('click', showEmailList);

    function detailField(label, value) {
      if (value === null || value === undefined || value === '') return null;
      var field = document.createElement('div');
      field.className = 'onboarding-data-field';
      var labelEl = document.createElement('label');
      labelEl.textContent = label;
      var span = document.createElement('span');
      span.textContent = String(value);
      field.appendChild(labelEl);
      field.appendChild(span);
      return field;
    }

    function renderEmailDetail(email) {
      ueDetailBody.innerHTML = '';

      var header = document.createElement('div');
      header.className = 'email-detail-header';

      var heading = document.createElement('h4');
      heading.textContent = email.title;
      header.appendChild(heading);

      var style = EMAIL_STATUS_BADGE[email.status] || { className: 'status-pending', label: email.status };
      var badge = document.createElement('span');
      badge.className = 'onboarding-badge ' + style.className;
      badge.textContent = style.label;
      header.appendChild(badge);

      ueDetailBody.appendChild(header);

      if (email.subtitle) {
        var subtitle = document.createElement('p');
        subtitle.className = 'body-text';
        subtitle.textContent = email.subtitle;
        ueDetailBody.appendChild(subtitle);
      }

      var grid = document.createElement('div');
      grid.className = 'onboarding-data-grid';

      var when = email.status === 'sent' ? ['Sent', email.sentAt]
        : email.status === 'cancelled' ? ['Cancelled', email.cancelledAt]
        : ['Scheduled for', email.scheduledAt];

      [
        detailField('To', email.to ? email.to.name + ' (' + email.to.email + ')' : null),
        // Who composed it - the admin, not the recipient.
        detailField('Sent by', email.sentBy ? email.sentBy.name + ' (' + email.sentBy.email + ')' : 'Unknown'),
        detailField('Subject', email.subject),
        detailField(when[0], when[1] ? new Date(when[1]).toLocaleString() : null),
        detailField('Composed', email.createdAt ? new Date(email.createdAt).toLocaleString() : null),
        detailField('CC', email.cc && email.cc.length ? email.cc.join(', ') : null),
        detailField('BCC', email.bcc && email.bcc.length ? email.bcc.join(', ') : null),
        detailField('Cancelled by', email.cancelledBy ? email.cancelledBy.name : null),
        detailField('Thread', email.thread
          ? (THREAD_COMPANY_LABELS[email.thread.company] || email.thread.company) + ' · ' +
            (THREAD_LOCATION_LABELS[email.thread.location] || email.thread.location) + ' onboarding'
          : null),
        detailField('Delivery', email.status === 'failed'
          ? email.lastError + ' (' + email.attempts + ' attempt' + (email.attempts === 1 ? '' : 's') + ')'
          : null)
      ].filter(Boolean).forEach(function (field) { grid.appendChild(field); });

      ueDetailBody.appendChild(grid);

      var bodyHeading = document.createElement('h4');
      bodyHeading.className = 'email-detail-body-heading';
      bodyHeading.textContent = 'Message';
      ueDetailBody.appendChild(bodyHeading);

      // Server-sanitized on the way in (same allow-list as the onboarding extra
      // message), so this renders the actual email body rather than escaping it.
      var body = document.createElement('div');
      body.className = 'markdown-preview-body';
      body.innerHTML = email.contentHtml || '';
      ueDetailBody.appendChild(body);
    }

    function openEmailDetail(email) {
      ueList.hidden = true;
      ueSubtitle.hidden = true;
      ueDetail.hidden = false;
      ueDetailBody.innerHTML = '<p class="onboardings-message">Loading…</p>';

      fetch(API_BASE + '/users/' + encodeURIComponent(emailsRecipient.id) +
            '/emails/' + encodeURIComponent(email.id), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !result.data || !result.data.id) {
            handleApiFailure(result);
            ueDetailBody.innerHTML = '';
            var message = document.createElement('p');
            message.className = 'onboardings-message';
            message.textContent = (result.data && result.data.error) || 'Could not load that email.';
            ueDetailBody.appendChild(message);
            return;
          }
          renderEmailDetail(result.data);
        })
        .catch(function (err) {
          console.error('[manage-users] email detail fetch failed:', err);
          ueDetailBody.innerHTML = '';
          var message = document.createElement('p');
          message.className = 'onboardings-message';
          message.textContent = 'Could not load that email.';
          ueDetailBody.appendChild(message);
        });
    }

    function loadUserEmails(user) {
      showEmailList();
      setListMessage(ueList, 'Loading emails…');

      return fetch(API_BASE + '/users/' + encodeURIComponent(user.id) + '/emails', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            handleApiFailure(result);
            setListMessage(ueList, (result.data && result.data.error) || 'Could not load emails.');
            return;
          }

          ueList.innerHTML = '';
          if (!result.data.length) {
            setListMessage(ueList, 'No emails have been sent to this user yet.');
            return;
          }
          result.data.forEach(function (email) { ueList.appendChild(renderEmailRow(email)); });
        })
        .catch(function (err) {
          console.error('[manage-users] emails fetch failed:', err);
          setListMessage(ueList, 'Could not load emails.');
        });
    }

    function openUserEmails(user) {
      emailsRecipient = user;
      showModal('admin-user-emails-modal');

      var fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      ueTitle.textContent = (fullName || user.email) + ' — Emails';
      ueSubtitle.textContent = 'Everything sent to, or queued for, ' + user.email + '.';
      loadUserEmails(user);
    }

    function renderUserRow(user) {
      var row = document.createElement('div');
      row.className = 'onboarding-row';

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var name = document.createElement('div');
      name.className = 'onboarding-row-name';
      var fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      name.textContent = fullName || user.email;
      info.appendChild(name);

      var metaParts = [];
      if (user.email) metaParts.push(user.email);
      if (user.createdAt) metaParts.push('Added ' + new Date(user.createdAt).toLocaleDateString());
      if (user.isAdmin) metaParts.push(user.permissionGroup ? user.permissionGroup.name : 'No permission group');

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = metaParts.join(' · ');
      info.appendChild(meta);

      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';

      var menuItems = [];

      // Emailing is aimed at the people being onboarded, not at fellow admins.
      if (!user.isAdmin && can('email_users')) {
        menuItems.push({ label: 'Send Email', onSelect: function () { openSendEmail(user); } });
        menuItems.push({ label: 'Sent Emails', onSelect: function () { openUserEmails(user); } });
      }

      // Only non-admins get onboarded, so admins never have onboardings to show.
      // Reading them is also a different permission from managing users, so an
      // admin who only manages users doesn't get an entry that would 403.
      if (!user.isAdmin && canViewOnboardings()) {
        menuItems.push({ label: 'Show Onboardings', onSelect: function () { openUserOnboardings(user); } });
      }

      if (can('delete_users') && user.id !== myUserId) {
        menuItems.push({
          label: 'Delete User',
          danger: true,
          // Keeps the menu open: deleteUser writes progress into this element.
          keepOpen: true,
          onSelect: function (item) {
          var label = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
          if (!window.confirm('Delete ' + label + ' (' + user.email + ')?')) return;
            deleteUser(user, item, false);
          }
        });
      }

      var groupField = (user.isAdmin && can('manage_permissions')) ? buildGroupSelect(user) : null;

      var badge = document.createElement('span');
      badge.className = 'user-badge ' + (user.isAdmin ? 'is-admin' : 'is-member');
      badge.textContent = user.isAdmin ? 'Admin' : 'User';
      actions.appendChild(badge);

      if (menuItems.length || groupField) {
        actions.appendChild(window.NKSRowMenu.build(
          menuItems,
          groupField ? { label: 'Permission group', control: groupField } : null
        ));
      }

      row.appendChild(actions);

      return row;
    }

    function applyUsersFilter() {
      var term = searchInput.value.trim().toLowerCase();
      var role = roleFilter.value;

      var filtered = usersCache.filter(function (user) {
        if (role === 'admin' && !user.isAdmin) return false;
        if (role === 'member' && user.isAdmin) return false;
        if (term) {
          var haystack = ((user.firstName || '') + ' ' + (user.lastName || '') + ' ' + (user.email || '')).toLowerCase();
          if (haystack.indexOf(term) === -1) return false;
        }
        return true;
      });

      listEl.innerHTML = '';
      if (!filtered.length) {
        setListMessage(listEl, usersCache.length ? 'No users match your search.' : 'No users yet. Use "Add User" to create the first one.');
        return;
      }
      filtered.forEach(function (user) { listEl.appendChild(renderUserRow(user)); });
    }

    function loadUsers() {
      setListMessage(listEl, 'Loading users…');

      return fetch(API_BASE + '/users', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            handleApiFailure(result);
            setListMessage(listEl, (result.data && result.data.error) || 'Could not load users.');
            return;
          }
          usersCache = result.data;
          applyUsersFilter();
        })
        .catch(function (err) {
          console.error('[manage-users] users fetch failed:', err);
          setListMessage(listEl, 'Could not load users.');
        });
    }

    if (searchInput) searchInput.addEventListener('input', applyUsersFilter);
    if (roleFilter) roleFilter.addEventListener('change', applyUsersFilter);

    // ---- Permission groups ----

    var groupsListEl = document.getElementById('mu-groups-list');

    function renderGroupRow(group) {
      var row = document.createElement('div');
      row.className = 'onboarding-row' + (can('manage_permissions') ? ' is-clickable' : '');

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var name = document.createElement('div');
      name.className = 'onboarding-row-name';
      name.textContent = group.name;
      info.appendChild(name);

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = group.memberCount === 1 ? '1 admin' : (group.memberCount || 0) + ' admins';
      info.appendChild(meta);

      var chips = document.createElement('div');
      chips.className = 'permission-chips';

      if (!group.permissions || !group.permissions.length) {
        var emptyChip = document.createElement('span');
        emptyChip.className = 'permission-chip is-empty';
        emptyChip.textContent = 'No permissions';
        chips.appendChild(emptyChip);
      } else {
        group.permissions.forEach(function (permission) {
          var chip = document.createElement('span');
          chip.className = 'permission-chip';
          chip.textContent = permissionLabel(permission);
          chips.appendChild(chip);
        });
      }

      info.appendChild(chips);
      row.appendChild(info);

      if (can('manage_permissions')) {
        row.addEventListener('click', function () { openGroupModal(group); });
      }

      return row;
    }

    function renderGroups() {
      groupsListEl.innerHTML = '';
      if (!groupsCache.length) {
        setListMessage(groupsListEl, 'No permission groups yet. Use "Add Group" to create the first one.');
        return;
      }
      groupsCache.forEach(function (group) { groupsListEl.appendChild(renderGroupRow(group)); });
    }

    function loadGroups() {
      return fetch(API_BASE + '/permission-groups', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !result.data || !Array.isArray(result.data.groups)) {
            if (can('manage_permissions')) setListMessage(groupsListEl, 'Could not load permission groups.');
            return;
          }
          groupsCache = result.data.groups;
          if (Array.isArray(result.data.permissions) && result.data.permissions.length) {
            availablePermissions = result.data.permissions;
          }
          if (can('manage_permissions')) renderGroups();
        })
        .catch(function (err) {
          console.error('[manage-users] permission groups fetch failed:', err);
          if (can('manage_permissions')) setListMessage(groupsListEl, 'Could not load permission groups.');
        });
    }

    // ---- Permission group form (create + edit + delete) ----

    var groupForm = document.getElementById('admin-permission-group-form');
    var groupNameInput = document.getElementById('pg-name');
    var groupPermissionsEl = document.getElementById('pg-permissions');
    var groupSubmitBtn = document.getElementById('admin-permission-group-submit');
    var groupDeleteBtn = document.getElementById('pg-delete-btn');
    var groupStatus = document.getElementById('admin-permission-group-status');
    var groupTitle = document.getElementById('pg-title');
    var editingGroup = null;

    function renderPermissionOptions(selected) {
      groupPermissionsEl.innerHTML = '';

      availablePermissions.forEach(function (key) {
        var option = document.createElement('label');
        option.className = 'permission-option';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = key;
        checkbox.checked = selected.indexOf(key) !== -1;
        option.appendChild(checkbox);

        var text = document.createElement('span');
        text.className = 'permission-option-text';

        var label = document.createElement('span');
        label.className = 'permission-option-name';
        label.textContent = permissionLabel(key);
        text.appendChild(label);

        var hint = PERMISSIONS[key] && PERMISSIONS[key].hint;
        if (hint) {
          var hintEl = document.createElement('span');
          hintEl.className = 'permission-option-hint';
          hintEl.textContent = hint;
          text.appendChild(hintEl);
        }

        option.appendChild(text);
        groupPermissionsEl.appendChild(option);
      });
    }

    function selectedPermissions() {
      return Array.prototype.slice
        .call(groupPermissionsEl.querySelectorAll('input[type="checkbox"]'))
        .filter(function (cb) { return cb.checked; })
        .map(function (cb) { return cb.value; });
    }

    function openGroupModal(group) {
      editingGroup = group || null;
      groupForm.reset();
      clearFormStatus(groupStatus);

      groupTitle.textContent = group ? 'Edit Permission Group' : 'Add Permission Group';
      groupSubmitBtn.textContent = group ? 'Save Changes' : 'Create Group';
      groupNameInput.value = group ? group.name : '';
      groupDeleteBtn.hidden = !group;
      renderPermissionOptions(group ? group.permissions || [] : []);

      showModal('admin-permission-group-modal');
      groupNameInput.focus();
    }

    var addGroupBtn = document.getElementById('mu-add-group-btn');
    if (addGroupBtn) {
      addGroupBtn.addEventListener('click', function () { openGroupModal(null); });
    }

    if (groupForm) {
      groupForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(groupStatus);

        var name = groupNameInput.value.trim();
        var permissions = selectedPermissions();

        if (!name) {
          setFormStatus(groupStatus, 'Please enter a group name.', 'error');
          return;
        }

        if (!permissions.length) {
          setFormStatus(groupStatus, 'Select at least one permission - a group with none can do nothing.', 'error');
          return;
        }

        var editing = editingGroup;
        var originalText = groupSubmitBtn.textContent;
        groupSubmitBtn.disabled = true;
        groupSubmitBtn.textContent = 'Saving…';

        fetch(API_BASE + '/permission-groups' + (editing ? '/' + encodeURIComponent(editing.id) : ''), {
          method: editing ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, permissions: permissions })
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;

            if ((result.status === 201 || result.status === 200) && result.data && result.data.id) {
              closeModal();
              showToast(editing ? 'Permission group updated.' : 'Permission group created.', 'success');
              if (editing && myGroupId === editing.id) {
                // Just edited own group - own permissions may have changed, so
                // re-read them and re-render the page from the new set.
                checkAuth();
              } else {
                // The user list shows group names, so refresh it too.
                loadGroups().then(loadUsers);
              }
              return;
            }

            setFormStatus(groupStatus, (result.data && result.data.error) || 'Something went wrong. Please try again.', 'error');
          })
          .catch(function (err) {
            console.error('[manage-users] permission group save failed:', err);
            setFormStatus(groupStatus, 'Something went wrong while saving the group. Please try again.', 'error');
          })
          .finally(function () {
            groupSubmitBtn.disabled = false;
            groupSubmitBtn.textContent = originalText;
          });
      });
    }

    if (groupDeleteBtn) {
      groupDeleteBtn.addEventListener('click', function () {
        if (!editingGroup) return;
        if (!window.confirm('Delete the "' + editingGroup.name + '" group? Admins assigned to it must be moved first.')) return;

        var group = editingGroup;
        var originalText = groupDeleteBtn.textContent;
        groupDeleteBtn.disabled = true;
        groupDeleteBtn.textContent = 'Deleting…';

        fetch(API_BASE + '/permission-groups/' + encodeURIComponent(group.id), {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;

            if (result.status === 200 && result.data && result.data.deleted) {
              closeModal();
              showToast('Permission group deleted.', 'success');
              loadGroups();
              return;
            }

            setFormStatus(groupStatus, (result.data && result.data.error) || 'Could not delete the group.', 'error');
          })
          .catch(function (err) {
            console.error('[manage-users] permission group delete failed:', err);
            setFormStatus(groupStatus, 'Could not delete the group. Please try again.', 'error');
          })
          .finally(function () {
            groupDeleteBtn.disabled = false;
            groupDeleteBtn.textContent = originalText;
          });
      });
    }

    // ---- Create user ----

    var createUserForm = document.getElementById('admin-create-user-form');
    var createUserSubmitBtn = document.getElementById('admin-create-user-submit');
    var createUserStatus = document.getElementById('admin-create-user-status');
    var isAdminCheckbox = document.getElementById('cu-is-admin');
    var groupWrap = document.getElementById('cu-permission-group-wrap');
    var groupSelect = document.getElementById('cu-permission-group');

    function populateCreateUserGroups() {
      groupSelect.innerHTML = '';

      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = groupsCache.length ? 'Select a group…' : 'No permission groups exist yet';
      groupSelect.appendChild(placeholder);

      groupsCache.forEach(function (group) {
        var opt = document.createElement('option');
        opt.value = group.id;
        opt.textContent = group.name;
        groupSelect.appendChild(opt);
      });
    }

    // A permission group only means something for an admin, so the picker only
    // appears once "Is Admin" is ticked.
    function syncGroupField() {
      groupWrap.hidden = !isAdminCheckbox.checked;
      if (isAdminCheckbox.checked) populateCreateUserGroups();
    }

    if (isAdminCheckbox) isAdminCheckbox.addEventListener('change', syncGroupField);

    var addUserBtn = document.getElementById('mu-add-user-btn');
    if (addUserBtn) {
      addUserBtn.addEventListener('click', function () {
        createUserForm.reset();
        clearFormStatus(createUserStatus);
        syncGroupField();
        showModal('admin-create-user-modal');
        document.getElementById('cu-email').focus();
      });
    }

    if (createUserForm) {
      createUserForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(createUserStatus);

        var email = document.getElementById('cu-email').value.trim();
        var firstName = document.getElementById('cu-first-name').value.trim();
        var lastName = document.getElementById('cu-last-name').value.trim();
        var isAdmin = !!(isAdminCheckbox && isAdminCheckbox.checked);
        var permissionGroupId = groupSelect.value;

        if (!email || !firstName || !lastName) {
          setFormStatus(createUserStatus, 'Please fill in email, first name and last name.', 'error');
          return;
        }

        if (isAdmin && !permissionGroupId) {
          setFormStatus(createUserStatus, groupsCache.length
            ? 'Please select a permission group for this admin.'
            : 'Create a permission group first - an admin without one cannot do anything.', 'error');
          return;
        }

        var payload = { email: email, firstName: firstName, lastName: lastName, isAdmin: isAdmin };
        if (isAdmin) payload.permissionGroupId = permissionGroupId;

        var originalText = createUserSubmitBtn.textContent;
        createUserSubmitBtn.disabled = true;
        createUserSubmitBtn.textContent = 'Creating…';

        fetch(API_BASE + '/create-user', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;

            if (result.status === 201 && result.data && result.data.id) {
              createUserForm.reset();
              syncGroupField();
              closeModal();
              showToast(isAdmin
                ? 'Admin created. Their password has been emailed to them.'
                : 'User created successfully.', 'success');
              // The list is newest-first, so dropping any active search/filter
              // puts the user that was just created at the top of it - rather
              // than hiding it behind a filter they set a moment ago.
              searchInput.value = '';
              roleFilter.value = '';
              loadUsers();
              if (isAdmin) loadGroups(); // member counts moved
              return;
            }

            setFormStatus(createUserStatus, (result.data && result.data.error) || 'Something went wrong. Please try again.', 'error');
          })
          .catch(function (err) {
            console.error('[manage-users] create-user failed:', err);
            setFormStatus(createUserStatus, 'Something went wrong while creating the user. Please try again.', 'error');
          })
          .finally(function () {
            createUserSubmitBtn.disabled = false;
            createUserSubmitBtn.textContent = originalText;
          });
      });
    }

    // ---- Session check ----

    var myGroupId = null;
    var usersTab = document.getElementById('mu-tab-users');
    var permissionsTab = document.getElementById('mu-tab-permissions');
    var deniedMessage = document.getElementById('mu-denied-message');

    function applyPermissionsToUi() {
      var canUsers = can('manage_users') || can('manage_permissions');
      var canPermissions = can('manage_permissions');

      if (!canUsers && !canPermissions) {
        deniedMessage.textContent = myPermissions.length
          ? "Your permission group doesn't allow managing users or permissions."
          : 'No permission group is assigned to your account. Ask another admin to assign one.';
        showPanel('mu-denied-panel');
        return false;
      }

      usersTab.hidden = !canUsers;
      permissionsTab.hidden = !canPermissions;
      if (addUserBtn) addUserBtn.hidden = !can('manage_users');

      showPanel('mu-content-panel');
      selectTab(canUsers ? 'users' : 'permissions');
      return true;
    }

    function checkAuth() {
      showPanel('mu-loading-panel');

      fetch(API_BASE + '/auth', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (!result.data || !result.data.auth) {
            goToLogin();
            return;
          }

          showLogout(true);

          var user = result.data.user || {};
          myPermissions = Array.isArray(user.permissions) ? user.permissions : [];
          myUserId = user.id || null;
          myGroupId = user.permissionGroup ? user.permissionGroup.id : null;

          if (!applyPermissionsToUi()) return;

          // Groups first: the user rows and the create-user picker both render
          // group names out of this cache.
          loadGroups().then(function () {
            if (can('manage_users') || can('manage_permissions')) loadUsers();
          });
        })
        .catch(function (err) {
          console.error('[manage-users] auth check failed:', err);
          showPanel('mu-error-panel');
        });
    }

    var retryBtn = document.getElementById('mu-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', checkAuth);

    checkAuth();
  });
})();
