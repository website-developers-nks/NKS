(function () {
  'use strict';

  // Matches backend/src/routes/admin.router.ts.
  //
  // Every action below is gated on a permission from the admin's permission
  // group (see manage-users.html). A denied call answers 403 with reason
  // 'missing_permission' or 'no_permission_group'; that is NOT a dead session,
  // so handleApiFailure() keeps the admin on the page and only toasts. An admin
  // with no group holds no permissions at all and sees an empty dashboard.
  //
  //   GET  /api/admin/auth              -> reads the admin-auth cookie against User.authKey
  //                                        200 { auth: true, user: { id, email, firstName, lastName,
  //                                              isAdmin, permissions: [...], permissionGroup } }
  //                                        200 { auth: false, reason: 'no_cookie' }
  //                                        400 { auth: false, reason: 'not_found' }
  //   POST /api/admin/change-password   -> requireAdminAuth only (your own account, no permission)
  //                                        body { currentPassword, newPassword }
  //                                        200 { changed: true, signedOut: true } - the change ends the
  //                                        session (authKey unset, cookie cleared), so this page has to
  //                                        return to the login form afterwards
  //                                        401 here means the CURRENT password was wrong, not a dead
  //                                        session, so it must not go through handleApiFailure
  //   POST /api/admin/login             -> body { username, password } (username is the admin's email,
  //                                        password is their own - emailed when their account was created)
  //                                        200 { auth: false, otpRequired: true, userId } on correct password -
  //                                        a code is emailed to ADMIN_OTP_EMAIL, not the admin's own address
  //                                        400/401/503 { error: string }
  //   POST /api/admin/verify-login-otp  -> body { userId, otp }
  //                                        200 { auth: true, user: { ... same shape as /auth } }
  //                                        400/401/429/500 { error: string }
  //   (Creating and listing users moved to manage-users.html / js/manage-users.js -
  //    the "Manage Users" card here is a plain link to that page.)
  //   POST /api/admin/register-onboarding -> manage_onboardings, body { userId, ttl, location, company,
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
  //   POST /api/admin/attachments        -> manage_onboardings, multipart/form-data { file }
  //                                        uploads one file ahead of registering, to link into attachmentIds later
  //                                        201 { id, originalName, mimeType, sizeBytes }
  //                                        400/413/401/403/500 { error: string }
  //   DELETE /api/admin/attachments/:id  -> manage_onboardings
  //                                        200 { id, deleted: true }
  //                                        404/401/403/500 { error: string }
  //   GET  /api/admin/sheets             -> manage_sheets OR manage_onboardings
  //                                        (the latter so Register Onboarding can offer the picker)
  //                                        200 { configured, serviceAccount, sheets: [...] }
  //                                        configured is false when the server has no
  //                                        GOOGLE_SA_* credentials, so nothing can be written
  //   POST /api/admin/sheets             -> manage_sheets, body { name, spreadsheet, tabName? }
  //                                        verifies access to the spreadsheet before saving
  //                                        201 { id, name, spreadsheetId, tabName, url }
  //                                        400 { error, tabs? } / 409 duplicate / 503 unconfigured
  //   DELETE /api/admin/sheets/:id       -> manage_sheets
  //                                        409 reason 'in_use' when onboardings still point at it;
  //                                        repeat with ?force=true to unlink them and remove it
  //   GET  /api/admin/message-templates  -> manage_onboardings
  //                                        200 [{ id, name, content, createdAt }, ...] name-sorted;
  //                                        content is the raw markdown, which is what the picker
  //                                        above the extra-message editor loads back in
  //   POST /api/admin/message-templates  -> manage_onboardings, body { name, content }
  //                                        201 { id, name, content, createdAt }
  //                                        400/409 { error: string } - 409 on a duplicate name
  //   GET  /api/admin/get-user-list     -> manage_onboardings
  //                                        200 [{ id, email, firstName, lastName, createdAt }, ...]
  //                                        (isAdmin: false users only, authKey never exposed)
  //   GET  /api/admin/onboardings       -> view_onboarding_results OR manage_onboardings, query { search?, status? }
  //                                        status: 'pending' | 'completed' | 'expired'
  //                                        200 [{ id, onboardingKey, userId, fullName, email, location, company,
  //                                               status, ttl, expirationDate, createdAt }, ...]
  //                                        sorted pending -> expired -> completed, newest first within each
  //   GET  /api/admin/onboardings/:id/data -> view_onboarding_results
  //                                        200 { user, location, fields: {...}, docs: {...}, submittedAt }
  //                                        400/404/500 { error: string }
  //   GET  /api/admin/onboardings/:id/progress -> view_onboarding_results
  //                                        for onboardings with nothing submitted: whether the
  //                                        link was opened, how far they got, fieldUpdateCounts,
  //                                        the activity counters, and why/by whom it expired.
  //                                        Never 404s on missing data - "never started" is the answer
  //   GET  /api/admin/onboardings/:id/docs/:docId/download -> view_onboarding_docs
  //                                        200 { url, expiresIn, originalName, mimeType } - presigned R2 GET url
  //                                        400/404/500 { error: string }
  //   GET  /api/admin/onboardings/:id/export -> view_onboarding_results AND view_onboarding_docs
  //                                        200 text/html attachment - full response incl. documents as data URIs
  //                                        400/404/500 { error: string }
  //   GET  /api/admin/onboardings/:id/register-data -> manage_onboardings
  //                                        200 { id, userId, company, location, ttl, cc, bcc, extraContent }
  //                                        (extraContent here is the raw markdown source, for "Send Again")
  //                                        400/404/500 { error: string }
  //   POST /api/admin/onboardings/:id/remind -> manage_onboardings
  //                                        sends the reminder now, ignoring the cron's
  //                                        idle/cooldown rules; CC/BCC come from the invite
  //                                        200 { id, sent: true, lastReminderAt, reminderCount }
  //                                        400 if completed or expired / 502 if the send failed
  //   PATCH /api/admin/onboardings/:id/expire -> manage_onboardings
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

    var myPermissions = [];

    function can(permission) {
      return myPermissions.indexOf(permission) !== -1;
    }

    function canViewProgress() {
      return can('view_onboarding_list') || can('view_onboarding_results');
    }

    var CARD_PERMISSIONS = {
      'admin-manage-users-card': ['manage_users', 'manage_permissions'],
      'admin-register-onboarding-card': ['manage_onboardings'],
      'admin-view-onboardings-card': ['view_onboarding_list', 'view_onboarding_results', 'manage_onboardings'],
      'admin-manage-sheets-card': ['manage_sheets']
    };

    function showDashboard(user) {
      myPermissions = (user && Array.isArray(user.permissions)) ? user.permissions : [];

      var visibleCards = 0;
      Object.keys(CARD_PERMISSIONS).forEach(function (cardId) {
        var card = document.getElementById(cardId);
        if (!card) return;
        var allowed = CARD_PERMISSIONS[cardId].some(can);
        card.hidden = !allowed;
        if (allowed) visibleCards += 1;
      });

      var emptyNote = document.getElementById('admin-no-actions-note');
      if (emptyNote) emptyNote.hidden = visibleCards > 0;

      showLogout(true);
      showPanel('admin-dashboard-panel');

      if (user && user.mustChangePassword) {
        openChangePassword(true);
      }
    }

    // ---- Modals (View Onboardings, Manage Google Sheet, change password) ----

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

    Array.prototype.forEach.call(document.querySelectorAll('.admin-modal:not([data-stacked]) [data-modal-close]'), function (el) {
      el.addEventListener('click', closeModal);
    });

    // The markdown preview stacks on top of an already-open modal (e.g.
    // Register Onboarding) rather than replacing it, so it gets its own

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
      var canOpenRow = item.status === 'completed' ? can('view_onboarding_results') : canViewProgress();
      row.className = 'onboarding-row' + (canOpenRow ? ' is-clickable' : '');

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
      if (item.lastReminderAt) {
        metaParts.push('Reminded ' + new Date(item.lastReminderAt).toLocaleDateString() +
          (item.reminderCount > 1 ? ' (' + item.reminderCount + '×)' : ''));
      }
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

      var menuItems = [];

      if (item.status === 'pending' && can('manage_onboardings')) {
        menuItems.push({
          label: 'Send Reminder',
          keepOpen: true,
          onSelect: function (entry) { sendReminder(item, entry); }
        });
      }

      if (item.status === 'pending' && can('expire_onboardings')) {
        menuItems.push({
          label: 'Mark Expired',
          danger: true,
          keepOpen: true,
          onSelect: function (entry) { expireOnboarding(item, entry); }
        });
      }

      if (item.status === 'expired' && can('manage_onboardings')) {
        menuItems.push({ label: 'Send Again', onSelect: function () { openResendOnboarding(item); } });
      }

      if (item.status === 'completed') {
        if (can('view_onboarding_results')) {
          menuItems.push({ label: 'View Submitted Data', onSelect: function () { openOnboardingData(item); } });
        }
      } else if (canViewProgress()) {
        menuItems.push({ label: 'View Progress', onSelect: function () { openOnboardingProgress(item); } });
      }

      if (menuItems.length) actions.appendChild(window.NKSRowMenu.build(menuItems));

      row.appendChild(actions);

      if (canOpenRow) {
        row.addEventListener('click', function () {
          if (item.status === 'completed') {
            openOnboardingData(item);
          } else {
            openOnboardingProgress(item);
          }
        });
      }

      return row;
    }

    var PROGRESS_FIELD_LABELS = {
      welcomeAck: 'Welcome acknowledged', fullName: 'Full name', preferredName: 'Preferred name',
      personalEmail: 'Personal email', mobile: 'Mobile', dob: 'Date of birth', nationality: 'Nationality',
      maritalStatus: 'Marital status', bloodGroup: 'Blood group', emergencyContactName: 'Emergency contact name and relationship',
      emergencyContactNumber: 'Emergency contact number', passportNumber: 'Passport / Aadhar number', ssn: 'SSN',
      address: 'Permanent address', presentAddress: 'Present address', fathersName: "Father's name",
      fathersDob: "Father's DOB", mothersName: "Mother's name", mothersDob: "Mother's DOB",
      spouseName: 'Spouse name', spouseDob: 'Spouse DOB', childsInfo: 'Children', insuranceCoverage: 'Insurance coverage',
      campusName: 'Campus name', orgs: 'Employment history', bankName: 'Bank name', accountHolder: 'Account holder',
      accountNumber: 'Account number', ifsc: 'IFSC', introLine: 'Intro line', birthdayPref: 'Birthday preference',
      mealPreference: 'Meal preference', hobbies: 'Hobbies', funFact: 'Fun fact', declaration: 'Declaration',
      consent: 'Consent', experienceRating: 'Experience rating', experienceFeedback: 'Feedback',
      panNumber: 'PAN card number', passportNo: 'Passport number', uanNumber: 'UAN number',
      panDoc: 'PAN card', passportDoc: 'Passport', idDoc: 'ID proof', addressDoc: 'Address proof', photoDoc: 'Personal photo',
      higherSecondaryDoc: 'Higher secondary certificate', highestDegreeDoc: 'Highest degree certificate',
      resumeDoc: 'Resume', offerLetterDoc: 'Offer letter', lastIncrementDoc: 'Last increment letter',
      salarySlipDoc: 'Salary slip', bonusLetterDoc: 'Bonus letter', experienceLetterDoc: 'Experience letter',
      relievingLetterDoc: 'Relieving letter', bankDoc: 'Bank document'
    };

    function progressFieldLabel(key) {
      if (PROGRESS_FIELD_LABELS[key]) return PROGRESS_FIELD_LABELS[key];
      var spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }

    function progressSection(container, heading) {
      var section = document.createElement('div');
      section.className = 'onboarding-data-section';
      var title = document.createElement('h4');
      title.textContent = heading;
      section.appendChild(title);
      container.appendChild(section);
      return section;
    }

    function formatDateTime(value) {
      return value ? new Date(value).toLocaleString() : '—';
    }

    function renderOnboardingProgress(container, data) {
      container.innerHTML = '';

      var summaryParts = [];
      if (data.user) summaryParts.push(data.user.fullName + ' (' + data.user.email + ')');
      if (data.location) summaryParts.push(formatLocation(data.location));
      summaryParts.push(data.status.charAt(0).toUpperCase() + data.status.slice(1));

      var summary = document.createElement('p');
      summary.className = 'body-text';
      summary.textContent = summaryParts.join(' · ');
      container.appendChild(summary);

      // --- Where they got to ---
      var stateSection = progressSection(container, 'Status');
      var stateGrid = document.createElement('div');
      stateGrid.className = 'onboarding-data-grid';

      var openedLabel = data.opened
        ? 'Yes, first opened ' + formatDateTime(data.lastVerifiedAt)
        : 'No - the link has never been opened';

      appendDataField(stateGrid, 'Opened the link', openedLabel);
      appendDataField(stateGrid, 'Last activity', data.lastActivityAt ? formatDateTime(data.lastActivityAt) : 'Never');
      appendDataField(stateGrid, 'Started filling in', data.progress.started ? 'Yes' : 'No');
      appendDataField(stateGrid, 'Registered', formatDateTime(data.registeredAt));
      appendDataField(stateGrid, 'Expires', formatDateTime(data.expirationDate));
      appendDataField(stateGrid, 'Last saved', data.progress.lastSavedAt ? formatDateTime(data.progress.lastSavedAt) : '—');
      appendDataField(stateGrid, 'Onboarding key', data.onboardingKey);
      stateSection.appendChild(stateGrid);

      // --- Why it is dead, and who killed it ---
      if (data.expiry.expired) {
        var expirySection = progressSection(container, 'Expiry');
        var expiryGrid = document.createElement('div');
        expiryGrid.className = 'onboarding-data-grid';
        appendDataField(expiryGrid, 'Reason', data.expiry.reason ? formatExpiryReason(data.expiry.reason) : 'Unknown');
        appendDataField(expiryGrid, 'Expired at', data.expiry.at ? formatDateTime(data.expiry.at) : '—');
        appendDataField(expiryGrid, 'Expired by',
          data.expiry.by ? data.expiry.by.name + ' (' + data.expiry.by.email + ')'
            : data.expiry.reason === 'admin_expired' ? 'An admin (not recorded)'
            : 'Automatic');
        expirySection.appendChild(expiryGrid);
      }

      // --- Counters ---
      var activitySection = progressSection(container, 'Activity');
      var activityGrid = document.createElement('div');
      activityGrid.className = 'onboarding-data-grid';
      appendDataField(activityGrid, 'Fields filled', data.progress.filledFields);
      appendDataField(activityGrid, 'Documents uploaded', data.progress.documentsUploaded + ' (' + data.activity.docCount + ' upload' + (data.activity.docCount === 1 ? '' : 's') + ' total)');
      appendDataField(activityGrid, 'Total field edits', data.progress.totalFieldEdits);
      appendDataField(activityGrid, 'Saves', data.activity.syncRequestCount);
      appendDataField(activityGrid, 'Submit attempts', data.activity.submitAttempts);
      appendDataField(activityGrid, 'Verification codes sent', data.activity.otpSendCount);
      appendDataField(activityGrid, 'Reminders sent',
        data.activity.reminderCount + (data.activity.lastReminderAt ? ' (last ' + formatDateTime(data.activity.lastReminderAt) + ')' : ''));
      activitySection.appendChild(activityGrid);

      if (data.progress.extraFields && data.progress.extraFields.length) {
        var extraProgress = progressSection(container, 'More Info (' +
          data.progress.extraFieldsAnswered + ' of ' + data.progress.extraFieldsTotal + ' answered)');
        var extraProgressGrid = document.createElement('div');
        extraProgressGrid.className = 'onboarding-data-grid';
        data.progress.extraFields.forEach(function (item) {
          appendDataField(extraProgressGrid,
            item.label + (item.required ? ' *' : ''),
            item.answered ? 'Answered' : 'Not answered yet');
        });
        extraProgress.appendChild(extraProgressGrid);
      }

      // --- What has been filled in, and how often it was changed ---
      if (data.progress.filled.length) {
        var filledSection = progressSection(container, 'Completed so far');
        var chips = document.createElement('div');
        chips.className = 'permission-chips';
        data.progress.filled.forEach(function (key) {
          var chip = document.createElement('span');
          chip.className = 'permission-chip';
          var edits = data.progress.fieldUpdateCounts[key];
          chip.textContent = progressFieldLabel(key) + (edits ? ' ×' + edits : '');
          chips.appendChild(chip);
        });
        filledSection.appendChild(chips);
      }

      var editedKeys = Object.keys(data.progress.fieldUpdateCounts || {});
      if (editedKeys.length) {
        var editsSection = progressSection(container, 'Edits per field');
        var editsGrid = document.createElement('div');
        editsGrid.className = 'onboarding-data-grid';
        editedKeys
          .sort(function (a, b) { return data.progress.fieldUpdateCounts[b] - data.progress.fieldUpdateCounts[a]; })
          .forEach(function (key) {
            appendDataField(editsGrid, progressFieldLabel(key), data.progress.fieldUpdateCounts[key]);
          });
        editsSection.appendChild(editsGrid);
      }

      if (!data.progress.started) {
        var note = document.createElement('p');
        note.className = 'onboardings-message';
        note.textContent = data.opened
          ? 'They opened the link but saved nothing yet.'
          : 'Nothing has been filled in - the link has not been opened.';
        container.appendChild(note);
      }
    }

    var sheetsList = document.getElementById('sheets-list');
    var sheetsWarning = document.getElementById('sheets-config-warning');
    var sheetsCache = [];

    function setListMessage(el, message) {
      el.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'onboardings-message';
      p.textContent = message;
      el.appendChild(p);
    }

    function removeSheet(sheet, btn, force) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Removing…';

      fetch(API_BASE + '/sheets/' + encodeURIComponent(sheet.id) + (force ? '?force=true' : ''), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) {
            btn.disabled = false;
            btn.textContent = originalText;
            return;
          }

          if (result.status === 409 && result.data && result.data.reason === 'in_use') {
            if (window.confirm(result.data.error + '\n\nRemove it anyway?')) {
              removeSheet(sheet, btn, true);
              return;
            }
            btn.disabled = false;
            btn.textContent = originalText;
            return;
          }

          if (result.status === 200 && result.data && result.data.deleted) {
            window.NKSRowMenu.close();
            showToast('Sheet removed.', 'success');
            loadSheets();
            return;
          }

          showToast((result.data && result.data.error) || 'Could not remove the sheet.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        })
        .catch(function (err) {
          console.error('[admin] remove sheet failed:', err);
          showToast('Could not remove the sheet.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        });
    }

    function renderSheetRow(sheet) {
      var row = document.createElement('div');
      row.className = 'onboarding-row';

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var name = document.createElement('div');
      name.className = 'onboarding-row-name';
      name.textContent = sheet.name;
      info.appendChild(name);

      var metaParts = [];
      if (sheet.spreadsheetTitle) metaParts.push(sheet.spreadsheetTitle);
      metaParts.push('Tab: ' + sheet.tabName);
      metaParts.push(sheet.appendCount + ' row' + (sheet.appendCount === 1 ? '' : 's') + ' written');
      if (sheet.lastAppendAt) metaParts.push('Last ' + new Date(sheet.lastAppendAt).toLocaleString());

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = metaParts.join(' · ');
      info.appendChild(meta);

      if (sheet.lastError) {
        var error = document.createElement('div');
        error.className = 'onboarding-row-key';
        error.style.color = '#c62828';
        error.textContent = 'Last error: ' + sheet.lastError;
        info.appendChild(error);
      }

      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';
      actions.appendChild(window.NKSRowMenu.build([
        { label: 'Open in Google Sheets', onSelect: function () { window.open(sheet.url, '_blank', 'noopener'); } },
        { label: 'Remove', danger: true, keepOpen: true, onSelect: function (entry) { removeSheet(sheet, entry); } }
      ]));

      row.appendChild(actions);
      return row;
    }

    function loadSheets() {
      if (sheetsList) setListMessage(sheetsList, 'Loading sheets…');

      return fetch(API_BASE + '/sheets', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !result.data || !Array.isArray(result.data.sheets)) {
            handleApiFailure(result);
            if (sheetsList) setListMessage(sheetsList, 'Could not load sheets.');
            return;
          }

          sheetsCache = result.data.sheets;

          if (sheetsWarning) {
            if (result.data.configured) {
              sheetsWarning.classList.remove('is-visible', 'is-error');
              sheetsWarning.textContent = '';
            } else {
              sheetsWarning.textContent = 'Google Sheets credentials are not configured on the server, so nothing can be written yet. Set GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY.';
              sheetsWarning.classList.add('is-visible', 'is-error');
            }
          }

          if (!sheetsList) return;
          sheetsList.innerHTML = '';
          if (!sheetsCache.length) {
            setListMessage(sheetsList, 'No sheets yet. Add one below.');
            return;
          }
          sheetsCache.forEach(function (sheet) { sheetsList.appendChild(renderSheetRow(sheet)); });
        })
        .catch(function (err) {
          console.error('[admin] sheets fetch failed:', err);
          if (sheetsList) setListMessage(sheetsList, 'Could not load sheets.');
        });
    }

    var manageSheetsCard = document.getElementById('admin-manage-sheets-card');
    if (manageSheetsCard) {
      manageSheetsCard.addEventListener('click', function () {
        showModal('admin-sheets-modal');
        addSheetForm.reset();
        clearFormStatus(addSheetStatus);
        loadSheets();
      });
    }

    var addSheetForm = document.getElementById('admin-add-sheet-form');
    var addSheetSubmitBtn = document.getElementById('admin-add-sheet-submit');
    var addSheetStatus = document.getElementById('admin-add-sheet-status');

    if (addSheetForm) {
      addSheetForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(addSheetStatus);

        var name = document.getElementById('sheet-name').value.trim();
        var spreadsheet = document.getElementById('sheet-url').value.trim();
        var tabName = document.getElementById('sheet-tab').value.trim();

        if (!name || !spreadsheet) {
          setFormStatus(addSheetStatus, 'Please enter a name and a Google Sheets link.', 'error');
          return;
        }

        var originalText = addSheetSubmitBtn.textContent;
        addSheetSubmitBtn.disabled = true;
        addSheetSubmitBtn.textContent = 'Checking access…';

        fetch(API_BASE + '/sheets', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, spreadsheet: spreadsheet, tabName: tabName || undefined })
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;

            if (result.status === 201 && result.data && result.data.id) {
              addSheetForm.reset();
              showToast('Sheet added.', 'success');
              loadSheets();
              return;
            }

            var message = (result.data && result.data.error) || 'Could not add the sheet.';
            if (result.data && result.data.tabs && result.data.tabs.length) {
              message += ' Available tabs: ' + result.data.tabs.join(', ') + '.';
            }
            setFormStatus(addSheetStatus, message, 'error');
          })
          .catch(function (err) {
            console.error('[admin] add sheet failed:', err);
            setFormStatus(addSheetStatus, 'Could not add the sheet. Please try again.', 'error');
          })
          .finally(function () {
            addSheetSubmitBtn.disabled = false;
            addSheetSubmitBtn.textContent = originalText;
          });
      });
    }

    function openOnboardingProgress(item) {
      showModal('admin-onboarding-progress-modal');

      var title = document.getElementById('vop-title');
      var body = document.getElementById('vop-body');
      title.textContent = (item.fullName || item.email || 'Onboarding') + ' — Progress';
      body.innerHTML = '<p class="onboardings-message">Loading…</p>';

      fetch(API_BASE + '/onboardings/' + encodeURIComponent(item.id) + '/progress', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !result.data || !result.data.id) {
            handleApiFailure(result);
            body.innerHTML = '';
            var message = document.createElement('p');
            message.className = 'onboardings-message';
            message.textContent = (result.data && result.data.error) || 'Could not load onboarding progress.';
            body.appendChild(message);
            return;
          }
          renderOnboardingProgress(body, result.data);
        })
        .catch(function (err) {
          console.error('[admin] onboarding progress fetch failed:', err);
          body.innerHTML = '';
          var message = document.createElement('p');
          message.className = 'onboardings-message';
          message.textContent = 'Could not load onboarding progress.';
          body.appendChild(message);
        });
    }

    function sendReminder(item, btn) {
      var who = item.fullName || item.email || 'this user';
      if (!window.confirm('Send a reminder email to ' + who + ' now?')) return;

      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      fetch(API_BASE + '/onboardings/' + encodeURIComponent(item.id) + '/remind', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) {
            btn.disabled = false;
            btn.textContent = originalText;
            return;
          }

          if (result.status === 200 && result.data && result.data.sent) {
            item.lastReminderAt = result.data.lastReminderAt;
            item.reminderCount = result.data.reminderCount;
            showToast('Reminder sent to ' + (item.email || who) + '.', 'success');
            applyOnboardingsFilter();
            return;
          }

          showToast((result.data && result.data.error) || 'Could not send the reminder.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        })
        .catch(function (err) {
          console.error('[admin] send reminder failed:', err);
          showToast('Could not send the reminder.', 'error');
          btn.disabled = false;
          btn.textContent = originalText;
        });
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
          if (handleApiFailure(result)) return;
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

    // "Send Again" hands off to the Register Onboarding page, which prefills
    // itself from this onboarding's own register-data.
    function openResendOnboarding(item) {
      window.location.href = 'register-onboarding.html?from=' + encodeURIComponent(item.id);
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
          if (handleApiFailure(result)) {
            setOnboardingsMessage('Could not load onboardings.');
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
      emergency_contact_name: 'Emergency Contact Name and Relationship',
      emergency_contact_number: 'Emergency Contact Number',
      passport_number: 'Passport / Aadhar Number',
      pan_number: 'PAN Card Number',
      passport_no: 'Passport Number',
      uan_number: 'UAN Number',
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
      passport_doc: 'Passport',
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
          if (handleApiFailure(result)) return;
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

      if (doc && can('view_onboarding_docs')) {
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
          if (o.current) parts.push('Current');
          return parts.join(' — ');
        }).join('; '));
      }

      fieldsSection.appendChild(grid);
      container.appendChild(fieldsSection);

      var extras = data.extraFields || [];
      if (extras.length) {
        var extraSection = document.createElement('div');
        extraSection.className = 'onboarding-data-section';
        var extraHeading = document.createElement('h4');
        extraHeading.textContent = 'More Info';
        extraSection.appendChild(extraHeading);

        var extraGrid = document.createElement('div');
        extraGrid.className = 'onboarding-data-grid';

        extras.forEach(function (item) {
          if (item.type === 'document') {
            appendDocField(extraGrid, item.label, item.doc, authId);
            return;
          }
          var value = item.value;
          if (item.type === 'checkbox') value = value === true ? 'Yes' : value === false ? 'No' : null;
          appendDataField(extraGrid, item.label, value);
        });

        extraSection.appendChild(extraGrid);
        container.appendChild(extraSection);
      }

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

      (fields.orgs || []).forEach(function (org) {
        if (org.current) return;
        appendDocField(docsGrid, 'Relieving Letter — ' + org.name, org.relievingLetterDoc, authId);
      });

      docsSection.appendChild(docsGrid);
      container.appendChild(docsSection);
    }

    var currentExportOnboardingId = null;

    function openOnboardingData(item) {
      showModal('admin-onboarding-data-modal');
      currentExportOnboardingId = item.id;

      var exportBtn = document.getElementById('vod-download-response');
      if (exportBtn) exportBtn.hidden = !can('export_onboarding_data');

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
          if (handleApiFailure(result)) {
            body.innerHTML = '';
            var denied = document.createElement('p');
            denied.className = 'onboardings-message';
            denied.textContent = 'Could not load onboarding data.';
            body.appendChild(denied);
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
            if (res.status === 401 || res.status === 403) {
              return parseJson(res).then(function (result) {
                handleApiFailure(result);
                return null;
              });
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
            showLogout(false);
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

    function handleApiFailure(result) {
      if (result.status === 401) {
        closeModal();
        checkAuth();
        return true;
      }
      if (result.status === 403) {
        var reason = result.data && result.data.reason;
        if (reason === 'missing_permission' || reason === 'no_permission_group') {
          showToast((result.data && result.data.error) || 'You do not have permission to do this.', 'error');
          return true;
        }
        closeModal();
        checkAuth();
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

    var logoutButtons = [
      document.getElementById('admin-logout-btn'),
      document.getElementById('admin-logout-btn-mobile')
    ].filter(Boolean);

    function showLogout(visible) {
      logoutButtons.forEach(function (btn) { btn.classList.toggle('is-visible', !!visible); });
    }

    function logout() {
      logoutButtons.forEach(function (btn) { btn.disabled = true; });

      fetch(API_BASE + '/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .catch(function (err) {
          console.error('[admin] logout failed:', err);
        })
        .finally(function () {
          logoutButtons.forEach(function (btn) { btn.disabled = false; });
          closeModal();
          showLogout(false);
          myPermissions = [];
          if (loginForm) loginForm.reset();
          backToLoginStep();
          showPanel('admin-login-panel');
          showToast('You have been logged out.', 'success');
        });
    }

    logoutButtons.forEach(function (btn) { btn.addEventListener('click', logout); });

    // ---- Change password ----

    var changePasswordForm = document.getElementById('admin-change-password-form');
    var changePasswordSubmitBtn = document.getElementById('admin-change-password-submit');
    var changePasswordStatus = document.getElementById('admin-change-password-status');
    var changePasswordIntro = document.getElementById('cp-intro');
    var MIN_PASSWORD_LENGTH = 10; 

    function openChangePassword(isFirstLogin) {
      if (!changePasswordForm) return;
      changePasswordForm.reset();
      clearFormStatus(changePasswordStatus);
      changePasswordIntro.textContent = isFirstLogin
        ? "You're still using the password that was emailed to you. Set one only you know - you'll be signed out and can log straight back in with it."
        : "Pick a new password for signing in to the admin dashboard. You'll be signed out once it's changed.";
      showModal('admin-change-password-modal');
      document.getElementById('cp-current').focus();
    }

    var changePasswordBtn = document.getElementById('admin-change-password-btn');
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener('click', function () { openChangePassword(false); });
    }

    if (changePasswordForm) {
      changePasswordForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(changePasswordStatus);

        var currentPassword = document.getElementById('cp-current').value;
        var newPassword = document.getElementById('cp-new').value;
        var confirmPassword = document.getElementById('cp-confirm').value;

        if (!currentPassword || !newPassword || !confirmPassword) {
          setFormStatus(changePasswordStatus, 'Please fill in every field.', 'error');
          return;
        }

        if (newPassword.length < MIN_PASSWORD_LENGTH) {
          setFormStatus(changePasswordStatus, 'Your new password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.', 'error');
          return;
        }

        if (newPassword !== confirmPassword) {
          setFormStatus(changePasswordStatus, "The two new passwords don't match.", 'error');
          return;
        }

        if (newPassword === currentPassword) {
          setFormStatus(changePasswordStatus, 'Your new password must be different from the current one.', 'error');
          return;
        }

        var originalText = changePasswordSubmitBtn.textContent;
        changePasswordSubmitBtn.disabled = true;
        changePasswordSubmitBtn.textContent = 'Saving…';

        fetch(API_BASE + '/change-password', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword })
        })
          .then(parseJson)
          .then(function (result) {
            if (result.status === 401) {
              setFormStatus(changePasswordStatus, (result.data && result.data.error) || 'Your current password is incorrect.', 'error');
              return;
            }

            if (handleApiFailure(result)) return;

            if (result.status === 200 && result.data && result.data.changed) {
              changePasswordForm.reset();
              closeModal();
              showLogout(false);
              myPermissions = [];
              if (loginForm) loginForm.reset();
              backToLoginStep();
              showPanel('admin-login-panel');
              showToast('Password changed. Please log in with your new password.', 'success');
              return;
            }

            setFormStatus(changePasswordStatus, (result.data && result.data.error) || 'Something went wrong. Please try again.', 'error');
          })
          .catch(function (err) {
            console.error('[admin] change-password failed:', err);
            setFormStatus(changePasswordStatus, 'Something went wrong while changing your password. Please try again.', 'error');
          })
          .finally(function () {
            changePasswordSubmitBtn.disabled = false;
            changePasswordSubmitBtn.textContent = originalText;
          });
      });
    }


    checkAuth();
  });
})();
