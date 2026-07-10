(function () {
  'use strict';

  // Matches backend/src/routes/admin.router.ts:
  //   GET  /api/admin/auth              -> reads the admin-auth cookie against User.authKey
  //                                        200 { auth: true, user: { id, email, firstName, lastName, isAdmin } }
  //                                        200 { auth: false, reason: 'no_cookie' }
  //                                        400 { auth: false, reason: 'not_found' }
  //   POST /api/admin/login             -> body { username, password } (username is the admin's email)
  //                                        200 { auth: false, otpRequired: true, userId } on correct password -
  //                                        a code is emailed to ADMIN_OTP_EMAIL, not the admin's own address
  //                                        400/401/503 { error: string }
  //   POST /api/admin/verify-login-otp  -> body { userId, otp }
  //                                        200 { auth: true, user: { id, email, firstName, lastName } }
  //                                        400/401/429/500 { error: string }
  //   POST /api/admin/create-user       -> requireAdminAuth, body { email, firstName, lastName }
  //                                        201 { id, email, firstName, lastName }
  //                                        400/409/401/403/500 { error: string }
  //   POST /api/admin/register-onboarding -> requireAdminAuth, body { userId, ttl, location, company,
  //                                          expirationDate, cc?, bcc?, extraContent?, extraContentMarkdown?, attachmentIds? }
  //                                        location: OfficeLocation enum - 'gurugram' | 'gift_city' | 'dubai'
  //                                        company: Company enum - 'nksecurities' | 'nk securities research & tech'
  //                                        expirationDate: ISO date string, must be in the future
  //                                        extraContent: sanitized HTML actually emailed; extraContentMarkdown: raw
  //                                        source text, persisted only so "Send Again" can repopulate the form
  //                                        attachmentIds: ids from POST /attachments, up to 10, resolved and emailed
  //                                        with the invite (400 if any id can't be resolved)
  //                                        201 { id, onboardingKey, userId, ttl, location, company, expirationDate }
  //                                        400 { error, validLocations?, validCompanies? } / 404/401/403/500 { error: string }
  //   POST /api/admin/attachments        -> requireAdminAuth, multipart/form-data { file }
  //                                        uploads one file ahead of registering, to link into attachmentIds later
  //                                        201 { id, originalName, mimeType, sizeBytes }
  //                                        400/413/401/403/500 { error: string }
  //   DELETE /api/admin/attachments/:id  -> requireAdminAuth
  //                                        200 { id, deleted: true }
  //                                        404/401/403/500 { error: string }
  //   GET  /api/admin/get-user-list     -> requireAdminAuth
  //                                        200 [{ id, email, firstName, lastName, createdAt }, ...]
  //                                        (isAdmin: false users only, authKey never exposed)
  //   GET  /api/admin/onboardings       -> requireAdminAuth, query { search?, status? }
  //                                        status: 'pending' | 'completed' | 'expired'
  //                                        200 [{ id, onboardingKey, userId, fullName, email, location, company,
  //                                               status, ttl, expirationDate, createdAt }, ...]
  //                                        sorted pending -> expired -> completed, newest first within each
  //   GET  /api/admin/onboardings/:id/data -> requireAdminAuth
  //                                        200 { user, location, fields: {...}, docs: {...}, submittedAt }
  //                                        400/404/500 { error: string }
  //   GET  /api/admin/onboardings/:id/docs/:docId/download -> requireAdminAuth
  //                                        200 { url, expiresIn, originalName, mimeType } - presigned R2 GET url
  //                                        400/404/500 { error: string }
  //   GET  /api/admin/onboardings/:id/export -> requireAdminAuth
  //                                        200 text/html attachment - full response incl. documents as data URIs
  //                                        400/404/500 { error: string }
  //   GET  /api/admin/onboardings/:id/register-data -> requireAdminAuth
  //                                        200 { id, userId, company, location, ttl, cc, bcc, extraContent }
  //                                        (extraContent here is the raw markdown source, for "Send Again")
  //                                        400/404/500 { error: string }
  //   PATCH /api/admin/onboardings/:id/expire -> requireAdminAuth
  //                                        200 { id, expired: true }
  //                                        400/404/500 { error: string }
  var API_BASE = '/api/admin';

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

    function loadUserList(selectUserId) {
      setUserSelectMessage('Loading users…');

      fetch(API_BASE + '/get-user-list', {
        method: 'GET',
        credentials: 'include',
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
          if (selectUserId) userIdSelect.value = selectUserId;
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
        resetAttachments();
      });
    }

    // ---- View Onboardings (search/filter list + submitted-data viewer) ----

    var LOCATION_LABELS = { gurugram: 'Gurugram', gift_city: 'GIFT City', dubai: 'Dubai' };
    function formatLocation(loc) { return LOCATION_LABELS[loc] || loc; }

    var EXPIRY_REASON_LABELS = {
      too_many_doc_uploads: 'Too many document uploads',
      too_many_presign_requests: 'Too many presign requests for a document',
      too_many_sync_requests: 'Too many sync requests',
      too_many_field_edits: 'Too many edits to a field',
      too_many_submit_attempts: 'Too many submission attempts',
      link_expiration_date_passed: 'Expiration date passed',
      admin_expired: 'Manually expired by admin'
    };
    function formatExpiryReason(reason) { return EXPIRY_REASON_LABELS[reason] || reason; }

    var viewOnboardingsCard = document.getElementById('admin-view-onboardings-card');
    var voSearchInput = document.getElementById('vo-search');
    var voStatusFilter = document.getElementById('vo-status-filter');
    var voList = document.getElementById('vo-list');
    var onboardingsCache = [];

    function setOnboardingsMessage(message) {
      voList.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'onboardings-message';
      p.textContent = message;
      voList.appendChild(p);
    }

    function renderOnboardingRow(item) {
      var row = document.createElement('div');
      row.className = 'onboarding-row' + (item.status === 'completed' ? ' is-clickable' : '');

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var name = document.createElement('div');
      name.className = 'onboarding-row-name';
      name.textContent = item.fullName || item.email || 'Unknown user';
      info.appendChild(name);

      var metaParts = [];
      if (item.email) metaParts.push(item.email);
      if (item.location) metaParts.push(formatLocation(item.location));
      if (item.createdAt) metaParts.push('Registered ' + new Date(item.createdAt).toLocaleDateString());
      if (item.status === 'expired' && item.expiredReason) metaParts.push(formatExpiryReason(item.expiredReason));

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

      if (item.status === 'pending') {
        var expireBtn = document.createElement('button');
        expireBtn.type = 'button';
        expireBtn.className = 'onboarding-row-btn';
        expireBtn.textContent = 'Mark Expired';
        expireBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          expireOnboarding(item, expireBtn);
        });
        actions.appendChild(expireBtn);
      } else if (item.status === 'expired') {
        var resendBtn = document.createElement('button');
        resendBtn.type = 'button';
        resendBtn.className = 'onboarding-row-btn';
        resendBtn.textContent = 'Send Again';
        resendBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          openResendOnboarding(item);
        });
        actions.appendChild(resendBtn);
      }

      row.appendChild(actions);

      if (item.status === 'completed') {
        row.addEventListener('click', function () { openOnboardingData(item); });
      }

      return row;
    }

    function expireOnboarding(item, btn) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Expiring…';

      fetch(API_BASE + '/onboardings/' + encodeURIComponent(item.id) + '/expire', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (isSessionExpired(result.status)) {
            closeModal();
            checkAuth();
            return;
          }
          if (result.status !== 200) {
            showToast((result.data && result.data.error) || 'Could not expire onboarding.', 'error');
            btn.disabled = false;
            btn.textContent = originalText;
            return;
          }
          item.status = 'expired';
          applyOnboardingsFilter();
          showToast('Onboarding marked as expired.', 'success');
        })
        .catch(function (err) {
          console.error('[admin] expire onboarding failed:', err);
          showToast('Could not expire onboarding.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        });
    }

    
    function openResendOnboarding(item) {
      registerOnboardingForm.reset();
      resetAttachments();
      clearFormStatus(registerOnboardingStatus);
      showModal('admin-register-onboarding-modal');
      loadUserList(item.userId);

      document.getElementById('ro-company').value = item.company || '';
      document.getElementById('ro-location').value = item.location || '';
      if (item.ttl) document.getElementById('ro-ttl').value = secondsToSessionLength(item.ttl);

      fetch(API_BASE + '/onboardings/' + encodeURIComponent(item.id) + '/register-data', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (isSessionExpired(result.status)) {
            closeModal();
            checkAuth();
            return;
          }
          if (result.status !== 200 || !result.data) {
            showToast((result.data && result.data.error) || 'Could not load onboarding details.', 'error');
            return;
          }

          var data = result.data;
          if (data.company) document.getElementById('ro-company').value = data.company;
          if (data.location) document.getElementById('ro-location').value = data.location;
          if (data.ttl) document.getElementById('ro-ttl').value = secondsToSessionLength(data.ttl);
          document.getElementById('ro-cc').value = (Array.isArray(data.cc) ? data.cc.join(', ') : data.cc) || '';
          document.getElementById('ro-bcc').value = (Array.isArray(data.bcc) ? data.bcc.join(', ') : data.bcc) || '';
          document.getElementById('ro-extra-content').value = data.extraContent || '';
        })
        .catch(function (err) {
          console.error('[admin] register-data fetch failed:', err);
          showToast('Could not load onboarding details.', 'error');
        });
    }

    function applyOnboardingsFilter() {
      var term = voSearchInput.value.trim().toLowerCase();
      var statusFilter = voStatusFilter.value;

      var filtered = onboardingsCache.filter(function (item) {
        if (statusFilter && item.status !== statusFilter) return false;
        if (term) {
          var haystack = ((item.fullName || '') + ' ' + (item.email || '')).toLowerCase();
          if (haystack.indexOf(term) === -1) return false;
        }
        return true;
      });

      voList.innerHTML = '';
      if (!filtered.length) {
        setOnboardingsMessage('No onboardings found.');
        return;
      }
      filtered.forEach(function (item) { voList.appendChild(renderOnboardingRow(item)); });
    }

    function loadOnboardings() {
      setOnboardingsMessage('Loading onboardings…');

      fetch(API_BASE + '/onboardings', {
        method: 'GET',
        credentials: 'include',
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
            setOnboardingsMessage('Could not load onboardings.');
            return;
          }
          onboardingsCache = result.data;
          applyOnboardingsFilter();
        })
        .catch(function (err) {
          console.error('[admin] onboardings fetch failed:', err);
          setOnboardingsMessage('Could not load onboardings.');
        });
    }

    if (viewOnboardingsCard) {
      viewOnboardingsCard.addEventListener('click', function () {
        showModal('admin-view-onboardings-modal');
        voSearchInput.value = '';
        voStatusFilter.value = '';
        loadOnboardings();
      });
    }

    if (voSearchInput) voSearchInput.addEventListener('input', applyOnboardingsFilter);
    if (voStatusFilter) voStatusFilter.addEventListener('change', applyOnboardingsFilter);

    var FIELD_LABELS = {
      full_name: 'Full Name',
      preferred_name: 'Preferred Name',
      email: 'Personal Email',
      mobile: 'Mobile',
      dob: 'Date of Birth',
      nationality: 'Nationality',
      marital_status: 'Marital Status',
      blood_group: 'Blood Group',
      emergency_contact_name: 'Emergency Contact Name',
      emergency_contact_number: 'Emergency Contact Number',
      passport_number: 'Passport Number',
      ssn: 'SSN',
      fathers_name: "Father's Name",
      fathers_dob: "Father's DOB",
      mothers_name: "Mother's Name",
      mothers_dob: "Mother's DOB",
      spouse_name: 'Spouse Name',
      spouse_dob: 'Spouse DOB',
      insurance_coverage: 'Insurance Coverage',
      campus_name: 'Campus Name',
      bank_name: 'Bank Name',
      account_holder: 'Account Holder',
      account_number: 'Account Number',
      ifsc: 'IFSC',
      intro_line: 'Intro Line',
      birthday_pref: 'Birthday Preference',
      meal_preference: 'Meal Preference',
      hobbies: 'Hobbies',
      fun_fact: 'Fun Fact',
      experience_rating: 'Experience Rating',
      experience_feedback: 'Feedback'
    };

    var BOOLEAN_FIELDS = {
      welcome_ack: 'Welcome Acknowledged',
      declaration: 'Declaration',
      consent: 'Consent'
    };

    var DOC_LABELS = {
      pan_doc: 'PAN Card',
      id_doc: 'ID Proof',
      address_doc: 'Address Proof',
      photo_doc: 'Personal Photo',
      higher_secondary_doc: 'Higher Secondary Certificate',
      highest_degree_doc: 'Highest Degree Certificate',
      resume_doc: 'Resume',
      offer_letter_doc: 'Offer Letter',
      last_increment_doc: 'Last Increment Letter',
      salary_slip_doc: 'Salary Slip',
      bonus_letter_doc: 'Bonus Letter',
      experience_letter_doc: 'Experience Letter',
      relieving_letter_doc: 'Relieving Letter',
      bank_doc: 'Bank Document'
    };

    function appendDataField(grid, label, value) {
      var fieldEl = document.createElement('div');
      fieldEl.className = 'onboarding-data-field';
      var labelEl = document.createElement('label');
      labelEl.textContent = label;
      var span = document.createElement('span');
      span.textContent = (value === null || value === undefined || value === '') ? '—' : String(value);
      fieldEl.appendChild(labelEl);
      fieldEl.appendChild(span);
      grid.appendChild(fieldEl);
    }

    // Opens a document in a new tab via a short-lived presigned R2 URL -
    // fetched fresh each click rather than cached, since it expires in 5 minutes.
    function openDocInNewTab(authId, docId, btn) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Opening…';

      fetch(API_BASE + '/onboardings/' + encodeURIComponent(authId) + '/docs/' + encodeURIComponent(docId) + '/download', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (isSessionExpired(result.status)) {
            closeModal();
            checkAuth();
            return;
          }
          if (result.status !== 200 || !result.data || !result.data.url) {
            showToast((result.data && result.data.error) || 'Could not open document.', 'error');
            return;
          }
          window.open(result.data.url, '_blank', 'noopener');
        })
        .catch(function (err) {
          console.error('[admin] doc download failed:', err);
          showToast('Could not open document.', 'error');
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = originalText;
        });
    }

    function appendDocField(grid, label, doc, authId) {
      var fieldEl = document.createElement('div');
      fieldEl.className = 'onboarding-data-field';
      var labelEl = document.createElement('label');
      labelEl.textContent = label;
      fieldEl.appendChild(labelEl);

      var row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';

      var span = document.createElement('span');
      span.textContent = doc ? doc.name : '—';
      row.appendChild(span);

      if (doc) {
        var viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'onboarding-row-btn';
        viewBtn.textContent = 'View';
        viewBtn.addEventListener('click', function () { openDocInNewTab(authId, doc.id, viewBtn); });
        row.appendChild(viewBtn);
      }

      fieldEl.appendChild(row);
      grid.appendChild(fieldEl);
    }

    function renderOnboardingData(container, data, authId) {
      container.innerHTML = '';

      var user = data.user;
      var summaryParts = [];
      if (user) summaryParts.push(user.fullName + ' (' + user.email + ')');
      if (data.location) summaryParts.push(formatLocation(data.location));
      if (data.submittedAt) summaryParts.push('Submitted ' + new Date(data.submittedAt).toLocaleString());
      if (data.expired && data.expiredReason) summaryParts.push('Expired: ' + formatExpiryReason(data.expiredReason));

      var summary = document.createElement('p');
      summary.className = 'body-text';
      summary.textContent = summaryParts.join(' · ');
      container.appendChild(summary);

      var fieldsSection = document.createElement('div');
      fieldsSection.className = 'onboarding-data-section';
      var fieldsHeading = document.createElement('h4');
      fieldsHeading.textContent = 'Details';
      fieldsSection.appendChild(fieldsHeading);

      var grid = document.createElement('div');
      grid.className = 'onboarding-data-grid';
      var fields = data.fields || {};
      var isDubai = data.location === 'dubai';

      Object.keys(FIELD_LABELS).forEach(function (key) {
        var label = FIELD_LABELS[key];
        if (key === 'passport_number') label = isDubai ? 'Passport Number' : 'Aadhar Number';
        var value = fields[key];
        if (key === 'experience_rating' && value != null) value = value + ' / 5';
        appendDataField(grid, label, value);
      });

      function formatAddress(a) {
        if (!a || typeof a !== 'object') return null;
        var parts = [a.address, a.city, a.country, a.pincode].filter(Boolean);
        return parts.length ? parts.join(', ') : null;
      }

      appendDataField(grid, 'Permanent Address', formatAddress(fields.address));
      appendDataField(grid, 'Present Address', formatAddress(fields.present_address));

      Object.keys(BOOLEAN_FIELDS).forEach(function (key) {
        var value = fields[key];
        appendDataField(grid, BOOLEAN_FIELDS[key], value === null || value === undefined ? null : (value ? 'Yes' : 'No'));
      });

      if (fields.childs_info && fields.childs_info.length) {
        appendDataField(grid, 'Children', fields.childs_info.map(function (c) {
          return c.name + (c.dob ? ' (' + c.dob + ')' : '');
        }).join(', '));
      }

      if (fields.orgs && fields.orgs.length) {
        appendDataField(grid, 'Employment History', fields.orgs.map(function (o) {
          var parts = [o.name + ' (' + o.duration + ')'];
          if (o.role) parts.push(o.role);
          if (o.info) parts.push(o.info);
          return parts.join(' — ');
        }).join('; '));
      }

      fieldsSection.appendChild(grid);
      container.appendChild(fieldsSection);

      var docsSection = document.createElement('div');
      docsSection.className = 'onboarding-data-section';
      var docsHeading = document.createElement('h4');
      docsHeading.textContent = 'Documents';
      docsSection.appendChild(docsHeading);

      var docsGrid = document.createElement('div');
      docsGrid.className = 'onboarding-data-grid';
      var docs = data.docs || {};

      Object.keys(DOC_LABELS).forEach(function (key) {
        var doc = docs[key];
        var label = DOC_LABELS[key];
        if (key === 'id_doc') label = 'ID Proof (' + (isDubai ? 'Passport' : 'Aadhar') + ')';
        appendDocField(docsGrid, label, doc, authId);
      });

      docsSection.appendChild(docsGrid);
      container.appendChild(docsSection);
    }

    var currentExportOnboardingId = null;

    function openOnboardingData(item) {
      showModal('admin-onboarding-data-modal');
      currentExportOnboardingId = item.id;

      var title = document.getElementById('vod-title');
      var body = document.getElementById('vod-body');
      title.textContent = (item.fullName || item.email || 'Onboarding') + ' — Submitted Data';
      body.innerHTML = '<p class="onboardings-message">Loading…</p>';

      fetch(API_BASE + '/onboardings/' + encodeURIComponent(item.id) + '/data', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (isSessionExpired(result.status)) {
            closeModal();
            checkAuth();
            return;
          }
          if (result.status !== 200 || !result.data) {
            body.innerHTML = '';
            var p = document.createElement('p');
            p.className = 'onboardings-message';
            p.textContent = (result.data && result.data.error) || 'Could not load onboarding data.';
            body.appendChild(p);
            return;
          }
          renderOnboardingData(body, result.data, item.id);
        })
        .catch(function (err) {
          console.error('[admin] onboarding data fetch failed:', err);
          body.innerHTML = '';
          var p = document.createElement('p');
          p.className = 'onboardings-message';
          p.textContent = 'Could not load onboarding data.';
          body.appendChild(p);
        });
    }

    // The export endpoint returns a plain HTML file (not JSON), so this
    // downloads it as a blob rather than reusing parseJson/fetch-to-json.
    var downloadResponseBtn = document.getElementById('vod-download-response');
    if (downloadResponseBtn) {
      downloadResponseBtn.addEventListener('click', function () {
        if (!currentExportOnboardingId) return;

        var originalText = downloadResponseBtn.textContent;
        downloadResponseBtn.disabled = true;
        downloadResponseBtn.textContent = 'Preparing…';

        fetch(API_BASE + '/onboardings/' + encodeURIComponent(currentExportOnboardingId) + '/export', {
          method: 'GET',
          credentials: 'include'
        })
          .then(function (res) {
            if (isSessionExpired(res.status)) {
              closeModal();
              checkAuth();
              return null;
            }
            if (!res.ok) throw new Error('Export failed with status ' + res.status);

            var disposition = res.headers.get('Content-Disposition') || '';
            var match = /filename="([^"]+)"/.exec(disposition);
            var filename = match ? match[1] : 'onboarding-response.html';

            return res.blob().then(function (blob) { return { blob: blob, filename: filename }; });
          })
          .then(function (result) {
            if (!result) return;
            var url = window.URL.createObjectURL(result.blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = result.filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
          })
          .catch(function (err) {
            console.error('[admin] export failed:', err);
            showToast('Could not download the response. Please try again.', 'error');
          })
          .finally(function () {
            downloadResponseBtn.disabled = false;
            downloadResponseBtn.textContent = originalText;
          });
      });
    }

    function checkAuth() {
      showPanel('admin-loading-panel');

      fetch(API_BASE + '/auth', {
        method: 'GET',
        credentials: 'include',
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

    var loginOtpForm = document.getElementById('admin-login-otp-form');
    var loginOtpInput = document.getElementById('admin-login-otp');
    var loginOtpSubmitBtn = document.getElementById('admin-login-otp-submit');
    var loginOtpBackBtn = document.getElementById('admin-login-otp-back');
    var loginOtpStatus = document.getElementById('admin-login-otp-status');
    var pendingLoginUserId = null;

    function showLoginError(message) {
      loginStatus.textContent = message;
      loginStatus.classList.add('is-visible', 'is-error');
    }

    function clearLoginError() {
      loginStatus.classList.remove('is-visible', 'is-error');
      loginStatus.textContent = '';
    }

    function showOtpStep(userId) {
      pendingLoginUserId = userId;
      passwordInput.value = '';
      loginForm.hidden = true;
      loginOtpForm.hidden = false;
      loginOtpInput.value = '';
      clearFormStatus(loginOtpStatus);
      loginOtpInput.focus();
    }

    function backToLoginStep() {
      pendingLoginUserId = null;
      loginOtpForm.hidden = true;
      loginForm.hidden = false;
      clearLoginError();
      usernameInput.focus();
    }

    if (loginOtpBackBtn) loginOtpBackBtn.addEventListener('click', backToLoginStep);

    if (loginOtpForm) {
      loginOtpForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(loginOtpStatus);

        var otp = loginOtpInput.value.trim();
        if (!otp) {
          setFormStatus(loginOtpStatus, 'Please enter the verification code.', 'error');
          return;
        }

        var originalText = loginOtpSubmitBtn.textContent;
        loginOtpSubmitBtn.disabled = true;
        loginOtpSubmitBtn.textContent = 'Verifying…';

        fetch(API_BASE + '/verify-login-otp', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: pendingLoginUserId, otp: otp })
        })
          .then(parseJson)
          .then(function (result) {
            if (result.status === 200 && result.data && result.data.auth) {
              pendingLoginUserId = null;
              showDashboard(result.data.user);
              return;
            }

            setFormStatus(loginOtpStatus, (result.data && result.data.error) || 'Something went wrong. Please try again.', 'error');
          })
          .catch(function (err) {
            console.error('[admin] otp verification failed:', err);
            setFormStatus(loginOtpStatus, 'Something went wrong while verifying the code. Please try again.', 'error');
          })
          .finally(function () {
            loginOtpSubmitBtn.disabled = false;
            loginOtpSubmitBtn.textContent = originalText;
          });
      });
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

        fetch(API_BASE + '/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username, password: password })
        })
          .then(parseJson)
          .then(function (result) {
            if (result.status === 200 && result.data && result.data.otpRequired) {
              showOtpStep(result.data.userId);
              return;
            }

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

        fetch(API_BASE + '/create-user', {
          method: 'POST',
          credentials: 'include',
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
      }).catch(function (err) { console.error('[admin] attachment delete failed:', err); });
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
          if (isSessionExpired(result.status)) {
            checkAuth();
            return;
          }

          att.uploading = false;
          roAttachmentsUploading -= 1;

          if (result.status === 201 && result.data && result.data.id) {
            att.id = result.data.id;
          } else {
            att.error = (result.data && result.data.error) || 'Upload failed.';
          }
          renderAttachmentsList();
        })
        .catch(function (err) {
          console.error('[admin] attachment upload failed:', err);
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

        var payload = { userId: userId, location: location, company: company, ttl: ttl, expirationDate: expirationDate };
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
            if (isSessionExpired(result.status)) {
              checkAuth();
              return;
            }

            if (result.status === 201 && result.data && result.data.onboardingKey) {
              var link = window.location.origin + '/verify-onboarding.html?id=' + encodeURIComponent(result.data.onboardingKey);
              registerOnboardingForm.reset();
              resetAttachments();
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
