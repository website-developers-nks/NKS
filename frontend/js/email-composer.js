(function () {
  'use strict';

  var PLACEHOLDER_KEYS = ['firstName', 'lastName', 'fullName', 'email'];
  var PLAIN_PLACEHOLDER = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;
  var ENCODED_PLACEHOLDER = /%7B%7B(?:%20)*([A-Za-z_]+)(?:%20)*%7D%7D/gi;

  var THREAD_COMPANY_LABELS = {
    nksecurities: 'NK Securities',
    'nk securities research & tech': 'NKS Research & Tech'
  };
  var THREAD_LOCATION_LABELS = { gurugram: 'Gurugram', gift_city: 'GIFT City', dubai: 'Dubai', singapore: 'Singapore' };

  var EXPAND_ICONS =
    '<svg class="icon-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>' +
    '<svg class="icon-collapse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/></svg>';

  var MARKUP =
    '<div class="admin-modal-backdrop" data-modal-close></div>' +
    '<div class="admin-modal-dialog is-wide" role="dialog" aria-modal="true" aria-label="Send email">' +
      '<button type="button" class="admin-modal-action" id="se-save-template-btn">Save as template</button>' +
      '<button type="button" class="admin-modal-expand" data-modal-expand aria-label="Expand to full screen" aria-pressed="false" title="Expand">' + EXPAND_ICONS + '</button>' +
      '<button type="button" class="admin-modal-close" aria-label="Close" data-modal-close>&#10005;</button>' +
      '<h3 id="se-heading">Send Email</h3>' +
      '<p class="body-text" id="se-recipient"></p>' +
      '<div class="template-save-row" id="se-save-template-row" hidden>' +
        '<input type="text" id="se-template-name" placeholder="Template name" maxlength="80">' +
        '<button type="button" class="onboarding-row-btn" id="se-save-template-confirm">Save</button>' +
        '<button type="button" class="onboarding-row-btn" id="se-save-template-cancel">Cancel</button>' +
      '</div>' +
      '<form class="admin-form" id="admin-send-email-form" novalidate>' +
        '<div class="form-group" id="se-mode-wrap">' +
          '<label for="se-mode">Send as</label>' +
          '<div class="select-wrapper"><select id="se-mode">' +
            '<option value="separate" selected>A separate email</option>' +
            '<option value="thread">A reply in an onboarding thread</option>' +
          '</select></div>' +
        '</div>' +
        '<div class="form-group" id="se-thread-wrap" hidden>' +
          '<label for="se-onboarding">Onboarding thread</label>' +
          '<div class="select-wrapper"><select id="se-onboarding"><option value="" disabled selected>Select an onboarding…</option></select></div>' +
          '<p class="markdown-hint">The email arrives under that onboarding\'s invite, so it lands in the same conversation.</p>' +
        '</div>' +
        '<div class="form-group" id="se-addressing-wrap" hidden>' +
          '<label for="se-addressing">Address members as</label>' +
          '<div class="select-wrapper"><select id="se-addressing">' +
            '<option value="to" selected>To - everyone can see who else got it</option>' +
            '<option value="bcc">BCC - addresses are hidden from each other</option>' +
          '</select></div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="se-title">Title</label>' +
          '<input type="text" id="se-title" name="title" maxlength="150" required>' +
          '<p class="markdown-hint">Used as both the email subject and its heading.</p>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="se-subtitle">Subtitle (optional)</label>' +
          '<input type="text" id="se-subtitle" name="subtitle" maxlength="200">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="se-cc">CC (optional)</label>' +
          '<input type="text" id="se-cc" name="cc" placeholder="manager@nksecurities.com, other@nksecurities.com">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="se-bcc">BCC (optional)</label>' +
          '<input type="text" id="se-bcc" name="bcc" placeholder="hr@nksecurities.com">' +
          '<p class="markdown-hint" id="se-copy-hint" hidden>Everyone gets their own separate email, so CC and BCC addresses receive a copy of each one.</p>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="se-template">Template (optional)</label>' +
          '<div class="select-wrapper"><select id="se-template"><option value="" selected>No template</option></select></div>' +
          '<p class="markdown-hint">Loads a saved message into the editor below.</p>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="se-content">Message</label>' +
          '<div class="admin-tabs" role="tablist">' +
            '<button type="button" class="admin-tab is-active" data-se-tab="editor" role="tab" aria-selected="true">Editor</button>' +
            '<button type="button" class="admin-tab" data-se-tab="preview" role="tab" aria-selected="false">Preview</button>' +
          '</div>' +
          '<div class="admin-tab-panel" data-se-panel="editor">' +
            '<div class="markdown-toolbar" data-md-target="se-content">' +
              '<button type="button" class="markdown-toolbar-btn" data-md="bold" title="Bold">B</button>' +
              '<button type="button" class="markdown-toolbar-btn" data-md="italic" title="Italic">I</button>' +
              '<button type="button" class="markdown-toolbar-btn" data-md="heading" title="Heading">H</button>' +
              '<button type="button" class="markdown-toolbar-btn" data-md="ul" title="Bulleted list">&#8226;</button>' +
              '<button type="button" class="markdown-toolbar-btn" data-md="ol" title="Numbered list">1.</button>' +
              '<button type="button" class="markdown-toolbar-btn" data-md="quote" title="Quote">&#8221;</button>' +
              '<button type="button" class="markdown-toolbar-btn" data-md="code" title="Code">&lt;/&gt;</button>' +
              '<button type="button" class="markdown-toolbar-btn" data-md="link" title="Link">&#128279;</button>' +
            '</div>' +
            '<textarea id="se-content" name="content" rows="10" placeholder="Write your message here - **markdown** is supported."></textarea>' +
            '<p class="markdown-hint">Full markdown supported: headings, lists, quotes, code, tables, links and more.</p>' +
            '<div id="se-placeholder-wrap">' +
              '<div class="placeholder-bar" role="group" aria-labelledby="se-placeholder-label">' +
                '<span class="placeholder-bar-label" id="se-placeholder-label">Personalize</span>' +
                '<button type="button" class="markdown-toolbar-btn" data-placeholder="firstName">First name</button>' +
                '<button type="button" class="markdown-toolbar-btn" data-placeholder="lastName">Last name</button>' +
                '<button type="button" class="markdown-toolbar-btn" data-placeholder="fullName">Full name</button>' +
                '<button type="button" class="markdown-toolbar-btn" data-placeholder="email">Email</button>' +
              '</div>' +
              '<p class="markdown-hint">Adds a placeholder such as {{firstName}} where your cursor is, in the title, subtitle or message. Each person sees their own details.</p>' +
            '</div>' +
          '</div>' +
          '<div class="admin-tab-panel" data-se-panel="preview" hidden>' +
            '<div class="form-group preview-as" id="se-preview-as-wrap" hidden>' +
              '<label for="se-preview-as">Preview as</label>' +
              '<div class="select-wrapper"><select id="se-preview-as"></select></div>' +
            '</div>' +
            '<p class="preview-subject" id="se-preview-subject"></p>' +
            '<div class="markdown-preview-body" id="se-preview-body"></div>' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="se-schedule">Schedule for (optional)</label>' +
          '<input type="datetime-local" id="se-schedule" name="scheduledAt">' +
          '<p class="markdown-hint">Leave blank to send immediately.</p>' +
        '</div>' +
        '<button type="submit" class="form-submit" id="admin-send-email-submit">Send Email</button>' +
        '<div class="form-status" id="admin-send-email-status" role="alert" aria-live="polite"></div>' +
      '</form>' +
    '</div>';

  function placeholderKey(name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < PLACEHOLDER_KEYS.length; i++) {
      if (PLACEHOLDER_KEYS[i].toLowerCase() === lower) return PLACEHOLDER_KEYS[i];
    }
    return null;
  }

  function findPlaceholders(texts) {
    var known = [];
    var unknown = [];
    texts.forEach(function (text) {
      if (!text) return;
      text.replace(PLAIN_PLACEHOLDER, function (whole, name) {
        var list = placeholderKey(name) ? known : unknown;
        if (list.indexOf(name) === -1) list.push(name);
        return whole;
      });
    });
    return { known: known, unknown: unknown };
  }

  function tokens(names) {
    return names.map(function (name) { return '{{' + name + '}}'; }).join(', ');
  }

  function placeholderValues(user) {
    var firstName = (user.firstName || '').trim();
    var lastName = (user.lastName || '').trim();
    return {
      firstName: firstName,
      lastName: lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' '),
      email: (user.email || '').trim()
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fillPlaceholders(text, values, asHtml) {
    var out = text;
    if (asHtml) {
      out = out.replace(ENCODED_PLACEHOLDER, function (whole, name) {
        var key = placeholderKey(name);
        return key ? encodeURIComponent(values[key]) : whole;
      });
    }
    return out.replace(PLAIN_PLACEHOLDER, function (whole, name) {
      var key = placeholderKey(name);
      if (!key) return whole;
      return asHtml ? escapeHtml(values[key]) : values[key];
    });
  }

  function userName(user) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  function userLabel(user) {
    var name = userName(user);
    return name ? name + ' (' + user.email + ')' : user.email;
  }

  function nameList(users) {
    var names = users.slice(0, 3).map(function (user) { return userName(user) || user.email; });
    var rest = users.length - names.length;
    return names.join(', ') + (rest ? ' and ' + rest + ' more' : '');
  }

  function parseEmailListInput(value) {
    if (!value) return undefined;
    var list = value.split(/[,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!list.length) return undefined;
    return list.length === 1 ? list[0] : list;
  }

  function separateResultMessage(data) {
    if (data.scheduled) {
      return 'Scheduled ' + data.total + ' emails for ' + new Date(data.scheduledAt).toLocaleString() + '.';
    }
    if (data.sent === data.total) return 'Sent ' + data.total + ' emails.';
    var parts = ['Sent ' + data.sent + ' of ' + data.total + ' emails.'];
    if (data.queued) parts.push('The other ' + data.queued + ' will go out within a few minutes.');
    if (data.failed) parts.push(data.failed + ' could not be sent - open Sent Emails for those people to see why.');
    return parts.join(' ');
  }

  function create(deps) {
    var API_BASE = deps.apiBase;

    var modal = document.createElement('div');
    modal.className = 'admin-modal';
    modal.id = 'admin-send-email-modal';
    modal.setAttribute('data-expandable', '');
    modal.hidden = true;
    modal.innerHTML = MARKUP;
    document.body.appendChild(modal);

    if (window.NKSModalExpand) window.NKSModalExpand.init(modal.parentNode);
    if (window.NKSModalA11y) window.NKSModalA11y.scan(modal.parentNode);
    if (window.NKSMarkdown) window.NKSMarkdown.initToolbars(modal);

    Array.prototype.forEach.call(modal.querySelectorAll('[data-modal-close]'), function (el) {
      el.addEventListener('click', deps.closeModal);
    });

    function $(id) { return document.getElementById(id); }

    var form = $('admin-send-email-form');
    var submitBtn = $('admin-send-email-submit');
    var statusEl = $('admin-send-email-status');
    var headingEl = $('se-heading');
    var recipientEl = $('se-recipient');
    var seTitle = $('se-title');
    var seSubtitle = $('se-subtitle');
    var seContent = $('se-content');
    var sePreviewBody = $('se-preview-body');
    var sePreviewSubject = $('se-preview-subject');
    var sePreviewAsWrap = $('se-preview-as-wrap');
    var sePreviewAs = $('se-preview-as');
    var seModeWrap = $('se-mode-wrap');
    var modeSelect = $('se-mode');
    var threadWrap = $('se-thread-wrap');
    var threadSelect = $('se-onboarding');
    var addressingWrap = $('se-addressing-wrap');
    var addressingSelect = $('se-addressing');
    var copyHint = $('se-copy-hint');
    var placeholderWrap = $('se-placeholder-wrap');
    var scheduleInput = $('se-schedule');
    var templateSelect = $('se-template');
    var seTabs = Array.prototype.slice.call(modal.querySelectorAll('[data-se-tab]'));
    var sePanels = Array.prototype.slice.call(modal.querySelectorAll('[data-se-panel]'));

    var current = null;
    var placeholderTarget = seContent;

    [seTitle, seSubtitle, seContent].forEach(function (field) {
      field.addEventListener('focus', function () { placeholderTarget = field; });
    });

    Array.prototype.forEach.call(modal.querySelectorAll('[data-placeholder]'), function (btn) {
      btn.addEventListener('mousedown', function (event) { event.preventDefault(); });
      btn.addEventListener('click', function () {
        var active = document.activeElement;
        var field = active === seTitle || active === seSubtitle || active === seContent
          ? active
          : (placeholderTarget || seContent);
        var token = '{{' + btn.dataset.placeholder + '}}';
        var start = typeof field.selectionStart === 'number' ? field.selectionStart : field.value.length;
        var end = typeof field.selectionEnd === 'number' ? field.selectionEnd : field.value.length;
        field.value = field.value.slice(0, start) + token + field.value.slice(end);
        field.focus();
        field.setSelectionRange(start + token.length, start + token.length);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    function personalized() {
      return current && current.kind !== 'combined';
    }

    function previewRecipient() {
      if (!current || !personalized()) return null;
      var chosen = current.users.filter(function (user) { return user.id === sePreviewAs.value; })[0];
      return chosen || current.users[0] || null;
    }

    function renderPreview() {
      if (!window.NKSMarkdown) return;
      var user = previewRecipient();
      var values = user ? placeholderValues(user) : null;
      var html = window.NKSMarkdown.toEmailHtml(seContent.value);
      sePreviewBody.innerHTML = values ? fillPlaceholders(html, values, true) : html;

      var title = seTitle.value.trim();
      sePreviewSubject.textContent = title
        ? 'Subject: ' + (values ? fillPlaceholders(title, values, false) : title)
        : '';
    }

    sePreviewAs.addEventListener('change', renderPreview);

    function selectTab(name) {
      seTabs.forEach(function (tab) {
        var active = tab.dataset.seTab === name;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      sePanels.forEach(function (panel) { panel.hidden = panel.dataset.sePanel !== name; });
      if (name === 'preview') renderPreview();
    }

    seTabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.dataset.seTab); });
    });

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
        .then(deps.parseJson)
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            deps.handleApiFailure(result);
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
          console.error('[email-composer] threads fetch failed:', err);
          setThreadMessage('Could not load onboardings');
        });
    }

    function syncThreadField() {
      var threaded = current && current.kind === 'single' && modeSelect.value === 'thread';
      threadWrap.hidden = !threaded;
      if (threaded) loadThreads(current.users[0]);
    }

    modeSelect.addEventListener('change', syncThreadField);

    var templatesCache = [];

    function renderTemplateOptions() {
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
      return fetch(API_BASE + '/message-templates', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(deps.parseJson)
        .then(function (result) {
          if (result.status !== 200 || !Array.isArray(result.data)) {
            console.error('[email-composer] templates fetch failed:', result.status);
            return;
          }
          templatesCache = result.data;
          renderTemplateOptions();
        })
        .catch(function (err) {
          console.error('[email-composer] templates fetch failed:', err);
        });
    }

    templateSelect.addEventListener('change', function () {
      var template = templatesCache.filter(function (t) { return t.id === templateSelect.value; })[0];
      if (!template) return;

      var existing = seContent.value.trim();
      if (existing && existing !== template.content.trim() &&
          !window.confirm('Replace the current message with the "' + template.name + '" template?')) {
        templateSelect.value = '';
        return;
      }

      seContent.value = template.content;
      selectTab('editor');
    });

    var saveTemplateBtn = $('se-save-template-btn');
    var saveTemplateRow = $('se-save-template-row');
    var templateNameInput = $('se-template-name');
    var saveTemplateConfirmBtn = $('se-save-template-confirm');
    var saveTemplateCancelBtn = $('se-save-template-cancel');

    function hideTemplateSaveRow() {
      saveTemplateRow.hidden = true;
      templateNameInput.value = '';
    }

    saveTemplateBtn.addEventListener('click', function () {
      if (!seContent.value.trim()) {
        deps.showToast('There is nothing to save - write a message first.', 'error');
        return;
      }
      saveTemplateRow.hidden = false;
      templateNameInput.focus();
    });

    saveTemplateCancelBtn.addEventListener('click', hideTemplateSaveRow);

    function saveTemplate() {
      var name = templateNameInput.value.trim();

      if (!name) {
        deps.showToast('Please name the template.', 'error');
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
        .then(deps.parseJson)
        .then(function (result) {
          if (deps.handleApiFailure(result)) return;

          if (result.status === 201 && result.data && result.data.id) {
            hideTemplateSaveRow();
            deps.showToast('Template saved.', 'success');
            loadTemplates().then(function () { templateSelect.value = result.data.id; });
            return;
          }

          deps.showToast((result.data && result.data.error) || 'Could not save the template.', 'error');
        })
        .catch(function (err) {
          console.error('[email-composer] save template failed:', err);
          deps.showToast('Could not save the template.', 'error');
        })
        .finally(function () {
          saveTemplateConfirmBtn.disabled = false;
          saveTemplateConfirmBtn.textContent = originalText;
        });
    }

    saveTemplateConfirmBtn.addEventListener('click', saveTemplate);

    templateNameInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveTemplate();
      }
    });

    function describe(config) {
      if (config.description) return config.description;
      var users = config.users;
      if (config.kind === 'single') return 'This will be sent to ' + userLabel(users[0]) + '.';
      if (config.kind === 'combined') {
        return 'One email to all ' + users.length + ' people: ' + nameList(users) + '.';
      }
      return 'This will be sent separately to ' + users.length + ' people: ' + nameList(users) +
        '. Each person only sees their own email.';
    }

    function open(config) {
      current = {
        kind: config.kind,
        users: (config.users || []).slice(),
        url: config.url,
        payload: config.payload || {},
        onSent: config.onSent
      };
      var kind = current.kind;

      form.reset();
      deps.clearFormStatus(statusEl);
      hideTemplateSaveRow();
      placeholderTarget = seContent;

      headingEl.textContent = config.heading || 'Send Email';
      seModeWrap.hidden = kind !== 'single';
      addressingWrap.hidden = kind !== 'combined';
      copyHint.hidden = kind !== 'separate';
      placeholderWrap.hidden = kind === 'combined';
      sePreviewAsWrap.hidden = !(kind === 'separate' && current.users.length > 1);
      sePreviewAs.innerHTML = '';
      current.users.forEach(function (user) {
        var opt = document.createElement('option');
        opt.value = user.id;
        opt.textContent = userLabel(user);
        sePreviewAs.appendChild(opt);
      });

      selectTab('editor');
      syncThreadField();
      loadTemplates();

      recipientEl.textContent = describe(config);
      submitBtn.textContent = kind === 'separate'
        ? 'Send to ' + current.users.length + ' ' + (current.users.length === 1 ? 'person' : 'people')
        : kind === 'combined' ? 'Send one email to ' + current.users.length + ' people' : 'Send Email';

      var now = new Date();
      var pad = function (n) { return String(n).padStart(2, '0'); };
      scheduleInput.min = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
        'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());

      deps.showModal('admin-send-email-modal');
      seTitle.focus();
    }

    function successMessage(kind, data) {
      if (kind === 'separate') return separateResultMessage(data);
      if (data.scheduled) return 'Email scheduled for ' + new Date(data.scheduledAt).toLocaleString() + '.';
      if (kind === 'combined') {
        return data.sent ? 'Email sent to ' + data.total + ' people.' : 'Email queued - it will go out within a few minutes.';
      }
      return data.queued ? 'Email queued - it will go out within a few minutes.' : 'Email sent.';
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      deps.clearFormStatus(statusEl);
      if (!current || !current.users.length) return;
      var kind = current.kind;

      var title = seTitle.value.trim();
      var subtitle = seSubtitle.value.trim();
      var markdown = seContent.value.trim();
      var scheduleValue = scheduleInput.value;

      if (!title) {
        deps.setFormStatus(statusEl, 'Please enter a title.', 'error');
        return;
      }

      if (!markdown) {
        deps.setFormStatus(statusEl, 'Please write a message.', 'error');
        return;
      }

      var found = findPlaceholders([title, subtitle, markdown]);
      if (kind === 'combined' && (found.known.length || found.unknown.length)) {
        deps.setFormStatus(statusEl, tokens(found.known.concat(found.unknown)) +
          ' cannot be used in one combined email, because everyone receives the same message. ' +
          'Choose "Email each member separately" to personalize it.', 'error');
        return;
      }
      if (found.unknown.length) {
        deps.setFormStatus(statusEl, tokens(found.unknown) +
          (found.unknown.length === 1 ? ' is not a placeholder' : ' are not placeholders') +
          '. Use ' + tokens(PLACEHOLDER_KEYS) + '.', 'error');
        return;
      }

      var onboardingId = kind === 'single' && modeSelect.value === 'thread' ? threadSelect.value : '';
      if (kind === 'single' && modeSelect.value === 'thread' && !onboardingId) {
        deps.setFormStatus(statusEl, 'Please pick the onboarding thread to reply in.', 'error');
        return;
      }

      var scheduledAt;
      if (scheduleValue) {
        var when = new Date(scheduleValue);
        if (Number.isNaN(when.getTime())) {
          deps.setFormStatus(statusEl, 'That schedule date is not valid.', 'error');
          return;
        }
        if (when.getTime() <= Date.now()) {
          deps.setFormStatus(statusEl, 'The scheduled time must be in the future.', 'error');
          return;
        }
        scheduledAt = when.toISOString();
      }

      var payload = {
        title: title,
        content: window.NKSMarkdown ? window.NKSMarkdown.toEmailHtml(markdown) : markdown,
        contentMarkdown: markdown
      };
      Object.keys(current.payload).forEach(function (key) { payload[key] = current.payload[key]; });
      if (subtitle) payload.subtitle = subtitle;
      var cc = parseEmailListInput($('se-cc').value);
      var bcc = parseEmailListInput($('se-bcc').value);
      if (cc) payload.cc = cc;
      if (bcc) payload.bcc = bcc;
      if (scheduledAt) payload.scheduledAt = scheduledAt;
      if (onboardingId) payload.onboardingId = onboardingId;
      if (kind === 'combined') payload.addressing = addressingSelect.value;

      var url = current.url || API_BASE + '/users/' + encodeURIComponent(current.users[0].id) + '/send-email';
      var sending = current;

      var originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = scheduledAt ? 'Scheduling…' : 'Sending…';

      fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(deps.parseJson)
        .then(function (result) {
          if (deps.handleApiFailure(result)) return;

          if (result.status === 201 && result.data) {
            form.reset();
            selectTab('editor');
            deps.closeModal();
            var failed = kind === 'separate' && result.data.failed;
            deps.showToast(successMessage(kind, result.data), failed ? 'error' : 'success');
            if (sending.onSent) sending.onSent(result.data);
            return;
          }

          deps.setFormStatus(statusEl, (result.data && result.data.error) || 'Could not send the email.', 'error');
        })
        .catch(function (err) {
          console.error('[email-composer] send failed:', err);
          deps.setFormStatus(statusEl, 'Something went wrong while sending. Please try again.', 'error');
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        });
    });

    return { open: open };
  }

  window.NKSEmailComposer = { create: create, userLabel: userLabel };
})();
