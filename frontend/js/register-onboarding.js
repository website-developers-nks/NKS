(function () {
  'use strict';

  // Register Onboarding page (register-onboarding.html), reached from the
  // "Register Onboarding" card on administrator.html. Everything here used to
  // live in a modal on that page; the page owns it now so the form has room and
  // can be linked to directly. Backed by backend/src/routes/admin.router.ts:
  //   GET  /api/admin/auth              -> same session check administrator.html does;
  //                                        anything other than { auth: true } sends the
  //                                        admin back there to log in. Without
  //                                        manage_onboardings the form is never shown
  //   GET  /api/admin/get-user-list     -> manage_onboardings, fills the User picker
  //   GET  /api/admin/sheets            -> manage_onboardings OR manage_sheets
  //                                        200 { configured, sheets: [...] } - the sheet
  //                                        a completed onboarding is appended to
  //   GET  /api/admin/message-templates -> manage_onboardings OR manage_users
  //                                        saved markdown for the extra message
  //   POST /api/admin/message-templates -> manage_onboardings, body { name, content }
  //   POST /api/admin/attachments       -> manage_onboardings, multipart single "file"
  //                                        201 { id } - uploaded up front, only the id
  //                                        travels with the register call
  //   DELETE /api/admin/attachments/:id -> manage_onboardings
  //   GET  /api/admin/onboardings/:id/register-data -> manage_onboardings
  //                                        200 { company, location, ttl, cc, bcc,
  //                                        extraContent } - prefills this form when
  //                                        View Onboardings sends someone here with
  //                                        ?from=<onboardingId> ("Send Again")
  //   POST /api/admin/register-onboarding -> manage_onboardings
  //                                        body { userId, location, company, ttl,
  //                                        expirationDate, title?, sheetId?, cc?, bcc?,
  //                                        extraContent?, extraContentMarkdown?,
  //                                        attachmentIds?, extraFields? }
  //                                        201 { onboardingKey } -> the invite link
  var API_BASE = '/api/admin';
  var ADMIN_PAGE = 'administrator.html';

  // Handoff to onboarding-form.html?preview=1, which this page frames in a
  // popup. The framed page reads this on load and renders itself with the
  // location and extra fields chosen here instead of calling the API.
  var PREVIEW_STORAGE_KEY = 'nk-onboarding-form-preview';

  function parseJson(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { status: res.status, data: data };
    });
  }

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var panels = Array.prototype.slice.call(document.querySelectorAll('.admin-panel'));

    function showPanel(panelId) {
      panels.forEach(function (panel) { panel.hidden = panel.id !== panelId; });
    }

    function goToLogin() {
      window.location.replace(ADMIN_PAGE);
    }

    // The extra-message preview and the extra-info form are the only modals
    // here, and neither sits on top of another - each just hides itself.
    var markdownPreviewModal = document.getElementById('markdown-preview-modal');

    function closeMarkdownPreview() {
      if (markdownPreviewModal) markdownPreviewModal.hidden = true;
    }

    if (markdownPreviewModal) {
      Array.prototype.forEach.call(markdownPreviewModal.querySelectorAll('[data-modal-close]'), function (el) {
        el.addEventListener('click', closeMarkdownPreview);
      });
    }

    var formPreviewModal = document.getElementById('form-preview-modal');
    var formPreviewFrame = document.getElementById('form-preview-frame');

    // Dropping the src stops the framed page rather than leaving it running
    // behind a hidden modal.
    function closeFormPreview() {
      if (formPreviewModal) formPreviewModal.hidden = true;
      if (formPreviewFrame) formPreviewFrame.removeAttribute('src');
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }

    if (formPreviewModal) {
      Array.prototype.forEach.call(formPreviewModal.querySelectorAll('[data-modal-close]'), function (el) {
        el.addEventListener('click', closeFormPreview);
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && formPreviewModal && !formPreviewModal.hidden) closeFormPreview();
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
          .catch(function (err) { console.error('[register-onboarding] logout failed:', err); })
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

    // A 401, or a 403 that means the session isn't an admin session at all,
    // sends the admin back to the login form. A 403 carrying
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

    function setFormStatus(el, message, type) {
      el.textContent = message;
      el.classList.remove('is-success', 'is-error');
      el.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
    }

    function clearFormStatus(el) {
      el.classList.remove('is-visible', 'is-success', 'is-error');
      el.textContent = '';
    }

    function sessionLengthToSeconds(value) {
      var match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
      if (!match) return null;
      return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60;
    }

    function secondsToSessionLength(totalSeconds) {
      var hours = Math.floor(totalSeconds / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
    }

    // register-onboarding's cc/bcc accept a single address string or an array -
    // let the admin type a comma/semicolon-separated list either way.
    function parseEmailListInput(value) {
      if (!value) return undefined;
      var list = value.split(/[,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!list.length) return undefined;
      return list.length === 1 ? list[0] : list;
    }

    // Markdown -> inline-styled email HTML. Lives in js/markdown-email.js so
    // this page and manage-users.html render admin-authored markdown the same way.
    function markdownToHtml(markdown) {
      return window.NKSMarkdown ? window.NKSMarkdown.toEmailHtml(markdown) : '';
    }

    // ---- The User picker ----


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

    function loadUserList(selectUserId) {
      setUserSelectMessage('Loading users…');

      fetch(API_BASE + '/get-user-list', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) {
            setUserSelectMessage('Could not load users');
            return;
          }
          if (result.status !== 200 || !Array.isArray(result.data)) {
            setUserSelectMessage('Could not load users');
            return;
          }
          populateUserOptions(result.data);
          if (selectUserId) userIdSelect.value = selectUserId;
          syncInviteSubjectPlaceholder();
        })
        .catch(function (err) {
          console.error('[register-onboarding] get-user-list failed:', err);
          setUserSelectMessage('Could not load users');
        });
    }

    // ---- Default invite subject, shown as the Title field's placeholder ----

    var titleInput = document.getElementById('ro-title');
    var titleHint = document.getElementById('ro-title-hint');
    var COMPANY_EMAIL_NAMES = {
      nksecurities: 'NK Securities Research',
      'nk securities research & tech': 'NKS Research & Technology'
    };

    var TITLE_HINT_DEFAULT = 'Blank uses the subject shown in the box. The name always leads, so each candidate gets their own email thread.';

    function inviteeName() {
      var selected = userIdSelect.options[userIdSelect.selectedIndex];
      return selected && selected.value ? String(selected.textContent).split(' — ')[0].trim() : '';
    }

    function defaultInviteSubject() {
      var companyName = COMPANY_EMAIL_NAMES[document.getElementById('ro-company').value] || 'NK Securities Research';
      return (inviteeName() || 'Full Name') + ' | Complete your onboarding - ' + companyName;
    }

    function syncInviteSubjectPlaceholder() {
      if (titleInput) titleInput.placeholder = defaultInviteSubject();
      if (!titleHint) return;

      var custom = titleInput ? titleInput.value.trim() : '';
      titleHint.textContent = custom
        ? 'Subject: ' + (inviteeName() || 'Full Name') + ' | ' + custom
        : TITLE_HINT_DEFAULT;
    }

    ['ro-company', 'ro-user-id'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', syncInviteSubjectPlaceholder);
    });

    if (titleInput) titleInput.addEventListener('input', syncInviteSubjectPlaceholder);

    // ---- Extra info fields ----

    var extraFieldsDraft = [];
    var extraFieldsList = document.getElementById('ro-extra-fields-list');
    var extraFieldForm = document.getElementById('admin-extra-field-form');
    var extraFieldStatus = document.getElementById('admin-extra-field-status');
    var extraFieldTypeSelect = document.getElementById('ef-type');

    var EXTRA_TYPE_LABELS = {
      text: 'Short text',
      textarea: 'Long text',
      number: 'Number',
      date: 'Date',
      select: 'Choice',
      checkbox: 'Yes / no',
      document: 'Document'
    };

    function syncExtraFieldConstraints() {
      var type = extraFieldTypeSelect.value;
      Array.prototype.forEach.call(document.querySelectorAll('[data-ef-constraint]'), function (group) {
        group.hidden = group.dataset.efConstraint.split(' ').indexOf(type) === -1;
      });
    }

    if (extraFieldTypeSelect) extraFieldTypeSelect.addEventListener('change', syncExtraFieldConstraints);

    function describeExtraField(field) {
      var parts = [EXTRA_TYPE_LABELS[field.type] || field.type];
      if (field.required) parts.push('required');
      if (field.type === 'select' && field.options) parts.push(field.options.length + ' choices');
      if (field.type === 'number') {
        if (field.min !== undefined) parts.push('min ' + field.min);
        if (field.max !== undefined) parts.push('max ' + field.max);
      }
      if ((field.type === 'text' || field.type === 'textarea') && field.maxLength) {
        parts.push('max ' + field.maxLength + ' chars');
      }
      return parts.join(' · ');
    }

    function renderExtraFields() {
      if (!extraFieldsList) return;
      extraFieldsList.innerHTML = '';

      extraFieldsDraft.forEach(function (field, index) {
        var li = document.createElement('li');
        li.className = 'ro-attachment-item';

        var name = document.createElement('span');
        name.className = 'ro-attachment-name';
        name.textContent = field.label;
        li.appendChild(name);

        var meta = document.createElement('span');
        meta.className = 'ro-attachment-size';
        meta.textContent = describeExtraField(field);
        li.appendChild(meta);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ro-attachment-remove';
        remove.setAttribute('aria-label', 'Remove ' + field.label);
        remove.textContent = '✕';
        remove.addEventListener('click', function () {
          extraFieldsDraft.splice(index, 1);
          renderExtraFields();
        });
        li.appendChild(remove);

        extraFieldsList.appendChild(li);
      });
    }

    function resetExtraFieldsDraft() {
      extraFieldsDraft = [];
      renderExtraFields();
    }

    var addExtraFieldBtn = document.getElementById('ro-add-extra-field-btn');
    if (addExtraFieldBtn) {
      addExtraFieldBtn.addEventListener('click', function () {
        extraFieldForm.reset();
        clearFormStatus(extraFieldStatus);
        syncExtraFieldConstraints();
        var modal = document.getElementById('admin-extra-field-modal');
        if (modal) modal.hidden = false;
        document.getElementById('ef-label').focus();
      });
    }

    function closeExtraFieldModal() {
      var modal = document.getElementById('admin-extra-field-modal');
      if (modal) modal.hidden = true;
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('#admin-extra-field-modal [data-modal-close]'),
      function (el) { el.addEventListener('click', closeExtraFieldModal); }
    );

    if (extraFieldForm) {
      extraFieldForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(extraFieldStatus);

        var label = document.getElementById('ef-label').value.trim();
        var type = extraFieldTypeSelect.value;

        if (!label) {
          setFormStatus(extraFieldStatus, 'Please name the field.', 'error');
          return;
        }

        var duplicate = extraFieldsDraft.some(function (f) {
          return f.label.toLowerCase() === label.toLowerCase();
        });
        if (duplicate) {
          setFormStatus(extraFieldStatus, 'There is already a field with that name.', 'error');
          return;
        }

        var field = {
          label: label,
          type: type,
          required: document.getElementById('ef-required').checked
        };

        var help = document.getElementById('ef-help').value.trim();
        if (help) field.help = help;

        if (type === 'text' || type === 'textarea') {
          var maxLength = parseInt(document.getElementById('ef-maxlength').value, 10);
          if (!isNaN(maxLength) && maxLength > 0) field.maxLength = maxLength;
        }

        if (type === 'number') {
          var min = document.getElementById('ef-min').value.trim();
          var max = document.getElementById('ef-max').value.trim();
          if (min !== '') field.min = Number(min);
          if (max !== '') field.max = Number(max);
          if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
            setFormStatus(extraFieldStatus, 'The minimum is above the maximum.', 'error');
            return;
          }
        }

        if (type === 'select') {
          var options = document.getElementById('ef-options').value
            .split('\n').map(function (o) { return o.trim(); }).filter(Boolean);
          if (options.length < 2) {
            setFormStatus(extraFieldStatus, 'Please give at least two choices, one per line.', 'error');
            return;
          }
          field.options = options;
        }

        extraFieldsDraft.push(field);
        renderExtraFields();
        closeExtraFieldModal();
        showToast('Extra field added.', 'success');
      });
    }

    // The sheet picker only - adding and removing sheets stays on the
    // dashboard's Manage Google Sheet card.
    var sheetSelect = document.getElementById('ro-sheet');
    var sheetsCache = [];

    function renderSheetOptions(selectedId) {
      if (!sheetSelect) return;
      sheetSelect.innerHTML = '';

      var none = document.createElement('option');
      none.value = '';
      none.textContent = sheetsCache.length ? "Don't record in a sheet" : 'No sheets set up yet';
      sheetSelect.appendChild(none);

      sheetsCache.forEach(function (sheet) {
        var opt = document.createElement('option');
        opt.value = sheet.id;
        opt.textContent = sheet.name + ' — ' + sheet.tabName;
        sheetSelect.appendChild(opt);
      });

      sheetSelect.value = selectedId || '';
    }

    function loadSheets(selectedId) {
      return fetch(API_BASE + '/sheets', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !result.data || !Array.isArray(result.data.sheets)) {
            handleApiFailure(result);
            return;
          }
          sheetsCache = result.data.sheets;
          renderSheetOptions(selectedId);
        })
        .catch(function (err) {
          console.error('[register-onboarding] sheets fetch failed:', err);
        });
    }

    // ---- Markdown toolbar + preview popup for the extra-message field ----

    var extraContentInput = document.getElementById('ro-extra-content');
    var markdownPreviewBody = document.getElementById('markdown-preview-body');

    // The popup hosts the full-size editor and the preview on two tabs. Its
    // textarea is a working copy of the form's own field, mirrored back on
    // every keystroke, so the form stays the single source of truth for submit
    // and for saving templates.

    var mdEditor = document.getElementById('md-editor');
    var mdTabs = Array.prototype.slice.call(document.querySelectorAll('[data-md-tab]'));
    var mdPanels = Array.prototype.slice.call(document.querySelectorAll('[data-md-panel]'));

    function renderMarkdownPreview() {
      markdownPreviewBody.innerHTML = markdownToHtml(extraContentInput.value);
    }

    function selectMarkdownTab(name) {
      mdTabs.forEach(function (tab) {
        var active = tab.dataset.mdTab === name;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      mdPanels.forEach(function (panel) { panel.hidden = panel.dataset.mdPanel !== name; });

      if (name === 'preview') {
        renderMarkdownPreview();
      } else if (mdEditor) {
        mdEditor.focus();
      }
    }

    mdTabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectMarkdownTab(tab.dataset.mdTab); });
    });

    if (mdEditor) {
      mdEditor.addEventListener('input', function () {
        extraContentInput.value = mdEditor.value;
      });
    }

    function openMarkdownPopup(tab) {
      if (!markdownPreviewModal) return;
      if (mdEditor) mdEditor.value = extraContentInput.value;
      hideTemplateSaveRow();
      selectMarkdownTab(tab);
      markdownPreviewModal.hidden = false;
      if (tab === 'editor' && mdEditor) mdEditor.focus();
    }

    var previewBtn = document.getElementById('ro-preview-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', function () { openMarkdownPopup('preview'); });
    }

    var expandBtn = document.getElementById('ro-expand-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', function () { openMarkdownPopup('editor'); });
    }

    var templateSelect = document.getElementById('ro-template');
    var templatesCache = [];

    function renderTemplateOptions(selectedId) {
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

      templateSelect.value = selectedId || '';
    }

    function loadTemplates(selectedId) {
      if (!templateSelect) return Promise.resolve();

      return fetch(API_BASE + '/message-templates', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) return;
          if (result.status !== 200 || !Array.isArray(result.data)) {
            console.error('[register-onboarding] templates fetch failed:', result.status);
            return;
          }
          templatesCache = result.data;
          renderTemplateOptions(selectedId);
        })
        .catch(function (err) {
          console.error('[register-onboarding] templates fetch failed:', err);
        });
    }

    if (templateSelect) {
      templateSelect.addEventListener('change', function () {
        var template = templatesCache.filter(function (t) { return t.id === templateSelect.value; })[0];
        if (!template) return;

        // Loading a template overwrites whatever is in the editor, so only ask
        // when there is actually something to lose.
        var current = extraContentInput.value.trim();
        if (current && current !== template.content.trim() &&
            !window.confirm('Replace the current message with the "' + template.name + '" template?')) {
          templateSelect.value = '';
          return;
        }

        extraContentInput.value = template.content;
        extraContentInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    // Save-as-template, from the preview popup's header

    var saveTemplateBtn = document.getElementById('md-save-template-btn');
    var saveTemplateRow = document.getElementById('md-save-template-row');
    var templateNameInput = document.getElementById('md-template-name');
    var saveTemplateConfirmBtn = document.getElementById('md-save-template-confirm');
    var saveTemplateCancelBtn = document.getElementById('md-save-template-cancel');

    function hideTemplateSaveRow() {
      if (!saveTemplateRow) return;
      saveTemplateRow.hidden = true;
      templateNameInput.value = '';
    }

    if (saveTemplateBtn) {
      saveTemplateBtn.addEventListener('click', function () {
        if (!extraContentInput.value.trim()) {
          showToast('There is nothing to save - write a message first.', 'error');
          return;
        }
        saveTemplateRow.hidden = false;
        templateNameInput.focus();
      });
    }

    if (saveTemplateCancelBtn) {
      saveTemplateCancelBtn.addEventListener('click', hideTemplateSaveRow);
    }

    function saveTemplate() {
      var name = templateNameInput.value.trim();
      var content = extraContentInput.value;

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
        body: JSON.stringify({ name: name, content: content })
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) return;

          if (result.status === 201 && result.data && result.data.id) {
            hideTemplateSaveRow();
            showToast('Template saved.', 'success');
            // Reload so the picker offers it straight away, already selected.
            loadTemplates(result.data.id);
            return;
          }

          showToast((result.data && result.data.error) || 'Could not save the template.', 'error');
        })
        .catch(function (err) {
          console.error('[register-onboarding] save template failed:', err);
          showToast('Could not save the template.', 'error');
        })
        .finally(function () {
          saveTemplateConfirmBtn.disabled = false;
          saveTemplateConfirmBtn.textContent = originalText;
        });
    }

    if (saveTemplateConfirmBtn) saveTemplateConfirmBtn.addEventListener('click', saveTemplate);

    if (templateNameInput) {
      // The row lives inside no <form>, so Enter needs wiring by hand.
      templateNameInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveTemplate();
        }
      });
    }

    // Formatting buttons for both toolbars on this page (inline + expanded),
    // each targeting its own textarea via data-md-target.
    if (window.NKSMarkdown) window.NKSMarkdown.initToolbars();

    // ---- The register form itself ----

    var registerOnboardingForm = document.getElementById('admin-register-onboarding-form');
    var registerOnboardingSubmitBtn = document.getElementById('admin-register-onboarding-submit');
    var registerOnboardingStatus = document.getElementById('admin-register-onboarding-status');

    // Expiration must be at least tomorrow - set min so the date picker itself
    // blocks today/past dates instead of only catching it on submit.
    var expirationDateInput = document.getElementById('ro-expiration-date');
    if (expirationDateInput) {
      var tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      var minYear = tomorrow.getFullYear();
      var minMonth = String(tomorrow.getMonth() + 1).padStart(2, '0');
      var minDay = String(tomorrow.getDate()).padStart(2, '0');
      expirationDateInput.min = minYear + '-' + minMonth + '-' + minDay;
    }

    // <input type="time"/date"> only open their picker when the calendar/clock
    // icon itself is clicked - showPicker() lets a click anywhere in the field do it.
    ['ro-ttl', 'ro-expiration-date'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && typeof el.showPicker === 'function') {
        el.addEventListener('click', function () {
          try { el.showPicker(); } catch (e) {}
        });
      }
    });

    // ---- Attachments (upload-first, same idea as the onboarding-form doc
    // uploads: picking a file uploads it immediately via POST /attachments,
    // and only the returned id travels with the rest of the register-onboarding
    // submission - the file bytes themselves are never sent alongside the form data) ----

    var attachmentsInput = document.getElementById('ro-attachments');
    var attachmentsList = document.getElementById('ro-attachments-list');
    var roAttachments = []; // [{ originalName, sizeBytes, id?, uploading?, error? }]
    var roAttachmentsUploading = 0;

    function formatAttachmentSize(bytes) {
      if (!bytes) return '0 KB';
      var kb = bytes / 1024;
      return kb < 1024 ? Math.round(kb) + ' KB' : (kb / 1024).toFixed(1) + ' MB';
    }

    function renderAttachmentsList() {
      if (!attachmentsList) return;
      attachmentsList.innerHTML = '';

      roAttachments.forEach(function (att) {
        var li = document.createElement('li');
        li.className = 'ro-attachment-item' + (att.error ? ' is-error' : '');

        var name = document.createElement('span');
        name.className = 'ro-attachment-name';
        name.textContent = att.originalName;
        li.appendChild(name);

        var status = document.createElement('span');
        if (att.error) {
          status.className = 'ro-attachment-status';
          status.textContent = att.error;
        } else if (att.uploading) {
          status.className = 'ro-attachment-status';
          status.textContent = 'Uploading…';
        } else {
          status.className = 'ro-attachment-size';
          status.textContent = formatAttachmentSize(att.sizeBytes);
        }
        li.appendChild(status);

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'ro-attachment-remove';
        removeBtn.setAttribute('aria-label', 'Remove ' + att.originalName);
        removeBtn.disabled = !!att.uploading;
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', function () { removeAttachment(att); });
        li.appendChild(removeBtn);

        attachmentsList.appendChild(li);
      });
    }

    function removeAttachment(att) {
      roAttachments = roAttachments.filter(function (a) { return a !== att; });
      renderAttachmentsList();

      if (!att.id) return; // upload never finished (or failed) - nothing to delete server-side

      fetch(API_BASE + '/attachments/' + encodeURIComponent(att.id), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      }).catch(function (err) { console.error('[register-onboarding] attachment delete failed:', err); });
    }

    function resetAttachments() {
      roAttachments = [];
      roAttachmentsUploading = 0;
      if (attachmentsInput) attachmentsInput.value = '';
      renderAttachmentsList();
    }

    function uploadAttachment(file) {
      var att = { originalName: file.name, sizeBytes: file.size, uploading: true };
      roAttachments.push(att);
      roAttachmentsUploading += 1;
      renderAttachmentsList();

      var formData = new FormData();
      formData.append('file', file);

      fetch(API_BASE + '/attachments', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })
        .then(parseJson)
        .then(function (result) {
          att.uploading = false;
          roAttachmentsUploading -= 1;

          // Unlike a dead session, a permission failure leaves the admin on the
          // page - so the row has to stop saying "Uploading…" either way.
          if (handleApiFailure(result)) {
            att.error = 'Upload failed.';
            renderAttachmentsList();
            return;
          }

          if (result.status === 201 && result.data && result.data.id) {
            att.id = result.data.id;
          } else {
            att.error = (result.data && result.data.error) || 'Upload failed.';
          }
          renderAttachmentsList();
        })
        .catch(function (err) {
          console.error('[register-onboarding] attachment upload failed:', err);
          att.uploading = false;
          roAttachmentsUploading -= 1;
          att.error = 'Upload failed.';
          renderAttachmentsList();
        });
    }

    if (attachmentsInput) {
      attachmentsInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(attachmentsInput.files);
        attachmentsInput.value = ''; // let the same file be re-picked later if removed
        files.forEach(uploadAttachment);
      });
    }

    if (registerOnboardingForm) {
      registerOnboardingForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(registerOnboardingStatus);

        var company = document.getElementById('ro-company').value.trim();
        var userId = document.getElementById('ro-user-id').value.trim();
        var location = document.getElementById('ro-location').value.trim();
        var ttl = sessionLengthToSeconds(document.getElementById('ro-ttl').value);
        var expirationDate = document.getElementById('ro-expiration-date').value;
        if (!company || !userId || !location || !ttl || ttl <= 0 || !expirationDate) {
          setFormStatus(registerOnboardingStatus, 'Please select a company, a user, a location, enter a valid session length (HH:MM), and choose an expiration date.', 'error');
          return;
        }

        if (new Date(expirationDate).getTime() <= Date.now()) {
          setFormStatus(registerOnboardingStatus, 'Expiration date must be in the future.', 'error');
          return;
        }

        if (roAttachmentsUploading > 0) {
          setFormStatus(registerOnboardingStatus, 'Please wait for attachments to finish uploading.', 'error');
          return;
        }

        if (roAttachments.some(function (a) { return a.error; })) {
          setFormStatus(registerOnboardingStatus, 'Remove the failed attachment(s) before submitting.', 'error');
          return;
        }

        var cc = parseEmailListInput(document.getElementById('ro-cc').value);
        var bcc = parseEmailListInput(document.getElementById('ro-bcc').value);
        var extraContentRaw = document.getElementById('ro-extra-content').value.trim();
        var attachmentIds = roAttachments.filter(function (a) { return a.id; }).map(function (a) { return a.id; });

        var sheetId = sheetSelect ? sheetSelect.value : '';

        var payload = { userId: userId, location: location, company: company, ttl: ttl, expirationDate: expirationDate };
        if (sheetId) payload.sheetId = sheetId;
        if (extraFieldsDraft.length) payload.extraFields = extraFieldsDraft;

        var title = titleInput ? titleInput.value.trim() : '';
        if (title) payload.title = title;
        if (cc) payload.cc = cc;
        if (bcc) payload.bcc = bcc;
        if (extraContentRaw) {
          payload.extraContent = markdownToHtml(extraContentRaw);
          payload.extraContentMarkdown = extraContentRaw;
        }
        if (attachmentIds.length) payload.attachmentIds = attachmentIds;

        var originalText = registerOnboardingSubmitBtn.textContent;
        registerOnboardingSubmitBtn.disabled = true;
        registerOnboardingSubmitBtn.textContent = 'Registering…';

        fetch(API_BASE + '/register-onboarding', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;

            if (result.status === 201 && result.data && result.data.onboardingKey) {
              var link = window.location.origin + '/verify-onboarding.html?id=' + encodeURIComponent(result.data.onboardingKey);
              registerOnboardingForm.reset();
              resetAttachments();
              resetExtraFieldsDraft();
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
            console.error('[register-onboarding] register failed:', err);
            setFormStatus(registerOnboardingStatus, 'Something went wrong while registering onboarding. Please try again.', 'error');
          })
          .finally(function () {
            registerOnboardingSubmitBtn.disabled = false;
            registerOnboardingSubmitBtn.textContent = originalText;
          });
      });
    }
    // ---- Preview the onboarding form ----
    //
    // Frames the real onboarding form in preview mode, dressed with whatever is
    // selected here: the location decides which fields and which document
    // labels (Aadhar vs Passport) show, and the extra info fields are rendered
    // into "More Info" exactly as the invited person would see them. Nothing is
    // registered and nothing is saved - the preview never talks to the API.

    var previewFormBtn = document.getElementById('ro-preview-form-btn');

    if (previewFormBtn) {
      previewFormBtn.addEventListener('click', function () {
        var location = document.getElementById('ro-location').value.trim();
        if (!location) {
          showToast('Choose a location first - it decides which fields the form shows.', 'error');
          document.getElementById('ro-location').focus();
          return;
        }

        // The form reads the draft straight off the page, so the preview shows
        // extra fields that have not been registered yet.
        var config = {
          location: location,
          company: document.getElementById('ro-company').value.trim(),
          extraFields: extraFieldsDraft.map(function (field, index) {
            // Registered fields get their key from the server; a draft needs a
            // stand-in so the preview can name its inputs.
            return {
              key: 'preview_' + index,
              label: field.label,
              type: field.type,
              required: !!field.required,
              help: field.help,
              maxLength: field.maxLength,
              min: field.min,
              max: field.max,
              options: field.options
            };
          }),
          savedAt: Date.now()
        };

        try {
          window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(config));
        } catch (e) {
          showToast('Could not open the preview - browser storage is unavailable.', 'error');
          return;
        }

        if (!formPreviewModal || !formPreviewFrame) return;

        // A fresh query each time so reopening reloads the frame and picks up
        // the config as it stands now.
        formPreviewFrame.src = 'onboarding-form.html?preview=1&t=' + Date.now();
        formPreviewModal.hidden = false;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
      });
    }

    // ---- "Send Again" from View Onboardings lands here with ?from=<id> ----

    function prefillFromOnboarding(onboardingId) {
      fetch(API_BASE + '/onboardings/' + encodeURIComponent(onboardingId) + '/register-data', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) {
            loadUserList();
            return;
          }
          if (result.status !== 200 || !result.data) {
            showToast((result.data && result.data.error) || 'Could not load onboarding details.', 'error');
            loadUserList();
            return;
          }

          var data = result.data;
          loadUserList(data.userId || undefined);
          if (data.company) document.getElementById('ro-company').value = data.company;
          if (data.location) document.getElementById('ro-location').value = data.location;
          if (data.ttl) document.getElementById('ro-ttl').value = secondsToSessionLength(data.ttl);
          document.getElementById('ro-cc').value = (Array.isArray(data.cc) ? data.cc.join(', ') : data.cc) || '';
          document.getElementById('ro-bcc').value = (Array.isArray(data.bcc) ? data.bcc.join(', ') : data.bcc) || '';
          document.getElementById('ro-extra-content').value = data.extraContent || '';
          syncInviteSubjectPlaceholder();
          showToast('Loaded the details of the previous onboarding.', 'success');
        })
        .catch(function (err) {
          console.error('[register-onboarding] register-data fetch failed:', err);
          showToast('Could not load onboarding details.', 'error');
          loadUserList();
        });
    }

    // ---- Session check ----

    var noPermissionPanel = document.getElementById('ro-no-permission-panel');

    function checkAuth() {
      showPanel('ro-loading-panel');

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

          var permissions = (result.data.user && Array.isArray(result.data.user.permissions))
            ? result.data.user.permissions
            : [];

          showLogout(true);

          // Registering is all this page does, so without the permission there
          // is nothing to show - every call below would 403 anyway.
          if (permissions.indexOf('manage_onboardings') === -1) {
            showPanel('ro-no-permission-panel');
            return;
          }

          showPanel('ro-content-panel');

          var from = getParam('from');
          if (from) {
            prefillFromOnboarding(from);
          } else {
            loadUserList();
          }
          loadTemplates();
          loadSheets();
          resetAttachments();
          resetExtraFieldsDraft();
        })
        .catch(function (err) {
          console.error('[register-onboarding] auth check failed:', err);
          showPanel('ro-error-panel');
        });
    }

    var retryBtn = document.getElementById('ro-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', checkAuth);

    checkAuth();
  });
})();
