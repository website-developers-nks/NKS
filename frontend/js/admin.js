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
      'admin-integrations-card': ['manage_sheets', 'manage_drive', 'manage_slack']
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

        if (item.driveConfigured && can('manage_drive')) {
          menuItems.push({
            label: item.driveSyncedAt ? 'Re-file to Drive' : 'File to Drive',
            keepOpen: true,
            onSelect: function (entry) { syncOnboardingToDrive(item, entry); }
          });
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
      gender: 'Gender', maritalStatus: 'Marital status', preferredDob: 'Preferred date of birth', bloodGroup: 'Blood group', emergencyContactName: 'Emergency contact name and relationship',
      emergencyContactNumber: 'Emergency contact number', passportNumber: 'Passport / Aadhar number', ssn: 'SSN',
      address: 'Permanent address', presentAddress: 'Present address', fathersName: "Father's name",
      fathersDob: "Father's DOB", mothersName: "Mother's name", mothersDob: "Mother's DOB",
      spouseName: 'Spouse name', spouseDob: 'Spouse DOB', childsInfo: 'Children', insuranceCoverage: 'Insurance coverage',
      campusName: 'Campus name', orgs: 'Employment history', bankName: 'Bank name', accountHolder: 'Account holder',
      accountNumber: 'Account number', ifsc: 'IFSC', introLine: 'Short intro', birthdayPref: 'Birthday preference',
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

    var driveList = document.getElementById('drive-list');
    var driveConfigs = [];
    var driveDocuments = [];
    var driveMappingConfig = null;
    var driveMappingDraft = {};
    var driveServiceAccount = null;

    function renderDriveRow(config) {
      var row = document.createElement('div');
      row.className = 'onboarding-row';

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var name = document.createElement('div');
      name.className = 'onboarding-row-name';
      name.textContent = config.name;
      info.appendChild(name);

      var metaParts = [config.mappedCount + ' of ' + driveDocuments.length + ' document types mapped'];
      if (config.defaultFolderName) metaParts.push('Default: ' + config.defaultFolderName);
      metaParts.push(config.fileCount + ' file' + (config.fileCount === 1 ? '' : 's') + ' filed');
      if (config.lastSyncAt) metaParts.push('Last ' + new Date(config.lastSyncAt).toLocaleString());

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = metaParts.join(' · ');
      info.appendChild(meta);

      if (!config.mappedCount && !config.defaultFolderId) {
        var warn = document.createElement('div');
        warn.className = 'onboarding-row-key';
        warn.textContent = 'No folders set, so nothing would be filed.';
        info.appendChild(warn);
      }

      if (config.lastError) {
        var error = document.createElement('div');
        error.className = 'onboarding-row-key';
        error.style.color = '#c62828';
        error.textContent = config.lastError;
        info.appendChild(error);
      }

      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';
      actions.appendChild(window.NKSRowMenu.build([
        { label: 'Edit folders', onSelect: function () { openDriveMapping(config); } },
        { label: 'Remove', danger: true, keepOpen: true, onSelect: function (entry) { removeDriveConfig(config, entry); } }
      ]));
      row.appendChild(actions);
      return row;
    }

    function loadDriveConfigs() {
      if (driveList) setListMessage(driveList, 'Loading…');

      return fetch(API_BASE + '/drive', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !result.data) {
            handleApiFailure(result);
            if (driveList) setListMessage(driveList, 'Could not load Drive configurations.');
            return;
          }

          driveConfigs = result.data.configs || [];
          driveDocuments = result.data.documents || [];
          driveServiceAccount = result.data.serviceAccount || null;

          var warning = document.getElementById('drive-config-warning');
          if (warning) {
            if (result.data.configured) {
              clearFormStatus(warning);
            } else {
              setFormStatus(warning, 'Google credentials are not configured on the server. Set GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY.', 'error');
            }
          }

          if (!driveList) return;
          driveList.innerHTML = '';
          if (!driveConfigs.length) {
            setListMessage(driveList, 'No Drive sync yet. Add one below.');
            return;
          }
          driveConfigs.forEach(function (config) { driveList.appendChild(renderDriveRow(config)); });
        })
        .catch(function (err) {
          console.error('[admin] drive fetch failed:', err);
          if (driveList) setListMessage(driveList, 'Could not load Drive configurations.');
        });
    }

    function removeDriveConfig(config, btn, force) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Removing…';

      fetch(API_BASE + '/drive/' + encodeURIComponent(config.id) + (force ? '?force=true' : ''), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = originalText;
          if (handleApiFailure(result)) return;

          if (result.status === 409 && result.data && result.data.reason === 'in_use') {
            if (window.confirm(result.data.error + '\n\nRemove it anyway?')) removeDriveConfig(config, btn, true);
            return;
          }
          if (result.status !== 200) {
            showToast((result.data && result.data.error) || 'Could not remove the Drive sync.', 'error');
            return;
          }
          showToast('Drive sync removed.', 'success');
          loadDriveConfigs();
        })
        .catch(function (err) {
          console.error('[admin] drive delete failed:', err);
          btn.disabled = false;
          btn.textContent = originalText;
          showToast('Could not remove the Drive sync.', 'error');
        });
    }

    //

    var SHEETS_ICON =
      '<svg viewBox="0 0 48 66" role="img" aria-hidden="true">' +
        '<path fill="#0F9D58" d="M29.5 0H4.5A4.5 4.5 0 0 0 0 4.5v57A4.5 4.5 0 0 0 4.5 66h39a4.5 4.5 0 0 0 4.5-4.5V18.5z"/>' +
        '<path fill="#0B8043" d="M29.5 0v14a4.5 4.5 0 0 0 4.5 4.5h14z"/>' +
        '<path fill="#F1F1F1" d="M11 27h26v22H11z"/>' +
        '<path fill="#0F9D58" d="M13 29h10v4H13zm12 0h10v4H25zM13 35h10v4H13zm12 0h10v4H25zM13 41h10v4H13zm12 0h10v4H25z"/>' +
      '</svg>';

    var DRIVE_ICON =
      '<svg viewBox="0 0 87.3 78" role="img" aria-hidden="true">' +
        '<path fill="#0066da" d="M6.6 66.85 10.45 73.5a9 9 0 0 0 3.3 3.3l13.75-23.8H0a9.06 9.06 0 0 0 1.2 4.5z"/>' +
        '<path fill="#00ac47" d="M43.65 25 29.9 1.2a9 9 0 0 0-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z"/>' +
        '<path fill="#ea4335" d="M73.55 76.8a9 9 0 0 0 3.3-3.3l1.6-2.75 7.65-13.25a9.06 9.06 0 0 0 1.2-4.5H59.8l5.85 11.5z"/>' +
        '<path fill="#00832d" d="M43.65 25 57.4 1.2A9.06 9.06 0 0 0 52.9 0H34.4a9.06 9.06 0 0 0-4.5 1.2z"/>' +
        '<path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8a9.06 9.06 0 0 0 4.5 1.2h50.8a9.06 9.06 0 0 0 4.5-1.2z"/>' +
        '<path fill="#ffba00" d="M73.4 26.5 60.7 4.5a9 9 0 0 0-3.3-3.3L43.65 25 59.8 53h27.45a9.06 9.06 0 0 0-1.2-4.5z"/>' +
      '</svg>';

    var SLACK_ICON =
      '<svg viewBox="0 0 122.8 122.8" role="img" aria-hidden="true">' +
        '<path fill="#E01E5A" d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9zm6.5 0a12.9 12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 0 1-25.8 0z"/>' +
        '<path fill="#36C5F0" d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9zm0 6.5a12.9 12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8z"/>' +
        '<path fill="#2EB67D" d="M97 45.2a12.9 12.9 0 1 1 12.9 12.9H97zm-6.5 0a12.9 12.9 0 0 1-25.8 0V12.9a12.9 12.9 0 0 1 25.8 0z"/>' +
        '<path fill="#ECB22E" d="M77.6 97a12.9 12.9 0 1 1-12.9 12.9V97zm0-6.5a12.9 12.9 0 0 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8z"/>' +
      '</svg>';

    var INTEGRATIONS = [
      {
        id: 'sheets',
        name: 'Google Sheets',
        description: 'Append each completed onboarding as a row.',
        permission: 'manage_sheets',
        icon: SHEETS_ICON,
        open: function () { openSheetsModal(); }
      },
      {
        id: 'drive',
        name: 'Google Drive',
        description: 'File uploaded documents into Drive folders.',
        permission: 'manage_drive',
        icon: DRIVE_ICON,
        open: function () { openDriveModal(); }
      },
      {
        id: 'slack',
        name: 'Slack',
        description: 'Post to a channel when an onboarding is sent, opened, completed or expires.',
        permission: 'manage_slack',
        icon: SLACK_ICON,
        open: function () { openSlackModal(); }
      }
    ];

    var integrationList = document.getElementById('integration-list');

    function renderIntegrations() {
      if (!integrationList) return;
      integrationList.innerHTML = '';

      var allowed = INTEGRATIONS.filter(function (entry) { return can(entry.permission); });

      if (!allowed.length) {
        setListMessage(integrationList, 'Your permission group does not allow managing any integration.');
        return;
      }

      allowed.forEach(function (entry) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'integration-row';

        row.innerHTML =
          '<span class="integration-row-icon">' + entry.icon + '</span>' +
          '<span class="integration-row-text"><span class="integration-row-name"></span>' +
          '<span class="integration-row-desc"></span></span>' +
          '<span class="integration-row-go" aria-hidden="true">&#8594;</span>';

        row.querySelector('.integration-row-name').textContent = entry.name;
        row.querySelector('.integration-row-desc').textContent = entry.description;
        row.addEventListener('click', entry.open);

        integrationList.appendChild(row);
      });
    }

    var integrationsCard = document.getElementById('admin-integrations-card');
    if (integrationsCard) {
      integrationsCard.addEventListener('click', function () {
        showModal('admin-integrations-modal');
        renderIntegrations();
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-integrations-back]'), function (btn) {
      btn.addEventListener('click', function () {
        showModal('admin-integrations-modal');
        renderIntegrations();
      });
    });

    var slackList = document.getElementById('slack-list');
    var slackEventsBox = document.getElementById('slack-events');
    var slackConfigs = [];
    var slackEvents = [];
    var slackDefaultBot = null;

    function renderSlackEventChecklist(selected) {
      if (!slackEventsBox) return;
      slackEventsBox.innerHTML = '';

      slackEvents.forEach(function (event) {
        var id = 'slack-event-' + event.key;
        var row = document.createElement('label');
        row.className = 'permission-option';
        row.setAttribute('for', id);

        var box = document.createElement('input');
        box.type = 'checkbox';
        box.id = id;
        box.value = event.key;
        box.checked = (selected || []).indexOf(event.key) !== -1;

        var text = document.createElement('span');
        text.className = 'permission-option-text';

        var name = document.createElement('span');
        name.className = 'permission-option-name';
        name.textContent = event.label;

        var hint = document.createElement('span');
        hint.className = 'permission-option-hint';
        hint.textContent = event.hint;

        text.appendChild(name);
        text.appendChild(hint);

        row.appendChild(box);
        row.appendChild(text);
        slackEventsBox.appendChild(row);
      });
    }

    function chosenSlackEvents() {
      if (!slackEventsBox) return [];
      return Array.prototype.slice.call(slackEventsBox.querySelectorAll('input:checked'))
        .map(function (box) { return box.value; });
    }

    function renderSlackRow(config) {
      var row = document.createElement('div');
      row.className = 'onboarding-row';

      var info = document.createElement('div');
      info.className = 'onboarding-row-info';

      var name = document.createElement('div');
      name.className = 'onboarding-row-name';
      name.textContent = config.name
        + (config.channelLabel ? ' · ' + config.channelLabel : '')
        + (config.channelId ? '  ' + config.channelId : '');
      info.appendChild(name);

      var labels = config.events.map(function (key) {
        var match = slackEvents.filter(function (e) { return e.key === key; })[0];
        return match ? match.label : key;
      });

      var meta = document.createElement('div');
      meta.className = 'onboarding-row-meta';
      meta.textContent = [
        config.enabled ? labels.length + ' event' + (labels.length === 1 ? '' : 's') : 'Paused',
        config.usesDefaultBot ? 'default bot' : 'own bot',
        config.notifyCount + ' sent',
        config.lastNotifiedAt ? 'Last ' + new Date(config.lastNotifiedAt).toLocaleString() : null
      ].filter(Boolean).join(' · ');
      info.appendChild(meta);

      if (labels.length) {
        var which = document.createElement('div');
        which.className = 'onboarding-row-key';
        which.textContent = labels.join(', ');
        info.appendChild(which);
      } else {
        var none = document.createElement('div');
        none.className = 'onboarding-row-key';
        none.textContent = 'No events chosen, so nothing is posted.';
        info.appendChild(none);
      }

      if (config.lastError) {
        var error = document.createElement('div');
        error.className = 'onboarding-row-key';
        error.style.color = '#c62828';
        error.textContent = config.lastError;
        info.appendChild(error);
      }

      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'onboarding-row-actions';
      actions.appendChild(window.NKSRowMenu.build([
        { label: 'Send a test message', keepOpen: true, onSelect: function (entry) { testSlack(config, entry); } },
        {
          label: config.enabled ? 'Pause' : 'Resume',
          keepOpen: true,
          onSelect: function (entry) { toggleSlack(config, entry); }
        },
        { label: 'Remove', danger: true, keepOpen: true, onSelect: function (entry) { removeSlack(config, entry); } }
      ]));
      row.appendChild(actions);
      return row;
    }

    function loadSlackConfigs() {
      if (slackList) setListMessage(slackList, 'Loading…');

      return fetch(API_BASE + '/slack', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          if (result.status !== 200 || !result.data) {
            handleApiFailure(result);
            if (slackList) setListMessage(slackList, 'Could not load Slack channels.');
            return;
          }

          slackConfigs = result.data.configs || [];
          slackEvents = result.data.events || [];
          slackDefaultBot = result.data.defaultBot || { configured: false };

          syncSlackBotChoice();
          renderSlackEventChecklist(['onboarding_completed', 'onboarding_expired']);

          if (!slackList) return;
          slackList.innerHTML = '';
          if (!slackConfigs.length) {
            setListMessage(slackList, 'No Slack channel connected yet. Add one below.');
            return;
          }
          slackConfigs.forEach(function (config) { slackList.appendChild(renderSlackRow(config)); });
        })
        .catch(function (err) {
          console.error('[admin] slack fetch failed:', err);
          if (slackList) setListMessage(slackList, 'Could not load Slack channels.');
        });
    }

    function slackAction(config, btn, label, run) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;

      run()
        .then(parseJson)
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = originalText;
          if (handleApiFailure(result)) return;

          if (result.status === 200 || result.status === 201) {
            loadSlackConfigs();
            return { ok: true };
          }
          showToast((result.data && result.data.error) || 'That did not work.', 'error');
        })
        .catch(function (err) {
          console.error('[admin] slack action failed:', err);
          btn.disabled = false;
          btn.textContent = originalText;
          showToast('That did not work.', 'error');
        });
    }

    function testSlack(config, btn) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      fetch(API_BASE + '/slack/' + encodeURIComponent(config.id) + '/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = originalText;
          if (handleApiFailure(result)) return;

          if (result.status === 200) {
            showToast('Test message sent - check the channel.', 'success');
            loadSlackConfigs();
            return;
          }
          showToast((result.data && result.data.error) || 'Slack did not accept the message.', 'error');
        })
        .catch(function (err) {
          console.error('[admin] slack test failed:', err);
          btn.disabled = false;
          btn.textContent = originalText;
          showToast('Could not reach Slack.', 'error');
        });
    }

    function toggleSlack(config, btn) {
      slackAction(config, btn, config.enabled ? 'Pausing…' : 'Resuming…', function () {
        return fetch(API_BASE + '/slack/' + encodeURIComponent(config.id), {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !config.enabled })
        });
      });
    }

    function removeSlack(config, btn) {
      if (!window.confirm('Remove "' + config.name + '"? Nothing will be posted to it any more.')) return;
      slackAction(config, btn, 'Removing…', function () {
        return fetch(API_BASE + '/slack/' + encodeURIComponent(config.id), {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
      });
    }

    var slackUseOwnBot = document.getElementById('slack-use-own-bot');
    var slackBotBlock = document.getElementById('slack-bot-block');
    var slackDefaultBotNote = document.getElementById('slack-default-bot-note');

    function syncSlackBotChoice() {
      var loaded = !!slackDefaultBot;
      var working = !!(slackDefaultBot && slackDefaultBot.configured && !slackDefaultBot.error);

      if (slackUseOwnBot && loaded) {
        if (!working) {
          slackUseOwnBot.checked = true;
          slackUseOwnBot.disabled = true;
        } else {
          if (slackUseOwnBot.disabled) slackUseOwnBot.checked = false;
          slackUseOwnBot.disabled = false;
        }
      }

      var own = slackUseOwnBot ? slackUseOwnBot.checked : true;
      if (slackBotBlock) slackBotBlock.hidden = !own;

      if (!slackDefaultBotNote) return;

      if (!loaded) {
        slackDefaultBotNote.textContent = '';
      } else if (working) {
        slackDefaultBotNote.textContent = own ? '' : 'Posting as default bot.';
      } else if (slackDefaultBot.configured) {
        slackDefaultBotNote.textContent = 'The default bot is not working: ' + slackDefaultBot.error;
      } else {
        slackDefaultBotNote.textContent = 'No default bot on the server.';
      }
    }

    if (slackUseOwnBot) slackUseOwnBot.addEventListener('change', syncSlackBotChoice);

    var slackBotInfoBtn = document.getElementById('slack-bot-info-btn');
    var slackBotInfo = document.getElementById('slack-bot-info');

    if (slackBotInfoBtn && slackBotInfo) {
      slackBotInfoBtn.addEventListener('click', function () {
        var open = slackBotInfo.hidden;
        slackBotInfo.hidden = !open;
        slackBotInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    var addSlackForm = document.getElementById('admin-add-slack-form');
    var addSlackSubmitBtn = document.getElementById('admin-add-slack-submit');
    var addSlackStatus = document.getElementById('admin-add-slack-status');

    function openSlackModal() {
      showModal('admin-slack-modal');
      if (addSlackForm) addSlackForm.reset();
      if (addSlackStatus) clearFormStatus(addSlackStatus);
      if (slackUseOwnBot) slackUseOwnBot.disabled = false;
      syncSlackBotChoice();
      loadSlackConfigs();
    }

    if (addSlackForm) {
      addSlackForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(addSlackStatus);

        var payload = {
          name: document.getElementById('slack-name').value.trim(),
          channelLabel: document.getElementById('slack-channel').value.trim(),
          botToken: (slackUseOwnBot && slackUseOwnBot.checked)
            ? document.getElementById('slack-bot-token').value.trim()
            : '',
          channelId: document.getElementById('slack-channel-id').value.trim(),
          events: chosenSlackEvents()
        };

        if (!payload.name) {
          setFormStatus(addSlackStatus, 'A name is required.', 'error');
          return;
        }
        if (!payload.channelId) {
          setFormStatus(addSlackStatus, 'A channel ID is required.', 'error');
          return;
        }
        if (slackUseOwnBot && slackUseOwnBot.checked && !payload.botToken) {
          setFormStatus(addSlackStatus, 'Enter the bot token, or untick "Use a different bot".', 'error');
          return;
        }
        if (!payload.events.length) {
          setFormStatus(addSlackStatus, 'Choose at least one event, or nothing would ever be posted.', 'error');
          return;
        }

        var originalText = addSlackSubmitBtn.textContent;
        addSlackSubmitBtn.disabled = true;
        addSlackSubmitBtn.textContent = 'Sending a test…';

        fetch(API_BASE + '/slack', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;
            if (result.status === 201 && result.data && result.data.id) {
              addSlackForm.reset();
              showToast('Connected - a test message is in the channel.', 'success');
              loadSlackConfigs();
              return;
            }
            setFormStatus(addSlackStatus, (result.data && result.data.error) || 'Could not connect the channel.', 'error');
          })
          .catch(function (err) {
            console.error('[admin] slack create failed:', err);
            setFormStatus(addSlackStatus, 'Could not connect the channel.', 'error');
          })
          .finally(function () {
            addSlackSubmitBtn.disabled = false;
            addSlackSubmitBtn.textContent = originalText;
          });
      });
    }

    function openDriveModal() {
      showModal('admin-drive-modal');
      if (addDriveForm) addDriveForm.reset();
      if (addDriveStatus) clearFormStatus(addDriveStatus);
      loadDriveConfigs();
    }

    var addDriveForm = document.getElementById('admin-add-drive-form');
    var addDriveSubmitBtn = document.getElementById('admin-add-drive-submit');
    var addDriveStatus = document.getElementById('admin-add-drive-status');

    if (addDriveForm) {
      addDriveForm.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFormStatus(addDriveStatus);

        var payload = {
          name: document.getElementById('drive-name').value.trim(),
          defaultFolder: document.getElementById('drive-default-folder').value.trim()
        };
        if (!payload.name) {
          setFormStatus(addDriveStatus, 'A name is required.', 'error');
          return;
        }

        var originalText = addDriveSubmitBtn.textContent;
        addDriveSubmitBtn.disabled = true;
        addDriveSubmitBtn.textContent = 'Checking folder…';

        fetch(API_BASE + '/drive', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;
            if (result.status === 201 && result.data && result.data.id) {
              addDriveForm.reset();
              showToast('Drive sync added. Set the folders next.', 'success');
              loadDriveConfigs().then(function () {
                var created = driveConfigs.filter(function (c) { return c.id === result.data.id; })[0];
                if (created) openDriveMapping(created);
              });
              return;
            }
            setFormStatus(addDriveStatus, (result.data && result.data.error) || 'Could not add the Drive sync.', 'error');
          })
          .catch(function (err) {
            console.error('[admin] drive create failed:', err);
            setFormStatus(addDriveStatus, 'Could not add the Drive sync.', 'error');
          })
          .finally(function () {
            addDriveSubmitBtn.disabled = false;
            addDriveSubmitBtn.textContent = originalText;
          });
      });
    }

    var driveMappingModal = document.getElementById('admin-drive-mapping-modal');
    var driveMappingList = document.getElementById('drive-mapping-list');
    var driveMappingIntro = document.getElementById('drive-mapping-intro');
    var driveMappingNote = document.getElementById('drive-mapping-note');
    var driveMappingStatus = document.getElementById('drive-mapping-status');
    var driveSaveMappingBtn = document.getElementById('drive-save-mapping-btn');

    function closeDriveMapping() {
      if (driveMappingModal) driveMappingModal.hidden = true;
      driveMappingConfig = null;
    }

    if (driveMappingModal) {
      Array.prototype.forEach.call(driveMappingModal.querySelectorAll('[data-modal-close]'), function (el) {
        el.addEventListener('click', closeDriveMapping);
      });
    }

    function verifyDriveFolder(key, value, statusEl, nameEl, refreshBtn) {
      statusEl.textContent = 'Checking…';
      statusEl.classList.remove('is-error');
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('is-spinning');
      }

      var done = function () {
        if (!refreshBtn) return;
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('is-spinning');
      };

      fetch(API_BASE + '/drive/check-folder', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: value })
      })
        .then(parseJson)
        .then(function (result) {
          if (handleApiFailure(result)) return;

          if (result.status !== 200 || !result.data || !result.data.id) {
            statusEl.textContent = (result.data && result.data.error) || 'Could not read that folder.';
            statusEl.classList.add('is-error');
            delete driveMappingDraft[key];
            return;
          }

          driveMappingDraft[key] = { folderId: result.data.id, folderName: result.data.name };
          nameEl.textContent = result.data.name;
          statusEl.textContent = result.data.warning || 'Shared Drive folder ✓';
          statusEl.classList.toggle('is-error', !!result.data.warning);
        })
        .catch(function (err) {
          console.error('[admin] folder check failed:', err);
          statusEl.textContent = 'Could not reach Drive.';
          statusEl.classList.add('is-error');
        })
        .finally(done);
    }

    var REFRESH_ICON_SVG =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 5v6h-6"/></svg>';

    function renderDriveMapping() {
      if (!driveMappingList) return;
      driveMappingList.innerHTML = '';

      driveDocuments.forEach(function (docType) {
        var current = driveMappingDraft[docType.key];

        var row = document.createElement('div');
        row.className = 'field-map-row' + (current && current.folderId ? ' is-mapped' : '');

        var left = document.createElement('div');
        left.className = 'field-map-source';
        var label = document.createElement('span');
        label.className = 'field-map-label';
        label.textContent = docType.label;
        var folderName = document.createElement('span');
        folderName.className = 'field-map-sub';
        folderName.textContent = (current && current.folderName) || 'no folder';
        left.appendChild(label);
        left.appendChild(folderName);

        var arrow = document.createElement('span');
        arrow.className = 'field-map-arrow';
        arrow.textContent = '→';

        var right = document.createElement('div');
        right.className = 'drive-mapping-target';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-map-input';
        input.placeholder = 'Drive folder link, or blank for the default';
        input.value = (current && current.folderId) ? 'https://drive.google.com/drive/folders/' + current.folderId : '';

        var status = document.createElement('span');
        status.className = 'drive-folder-status';

        var refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'drive-folder-refresh';
        refresh.title = 'Check this folder again';
        refresh.setAttribute('aria-label', 'Check ' + docType.label + ' folder again');
        refresh.innerHTML = REFRESH_ICON_SVG;
        refresh.addEventListener('click', function () {
          var value = input.value.trim();
          if (!value) {
            status.textContent = 'Add a folder link first.';
            status.classList.add('is-error');
            return;
          }
          verifyDriveFolder(docType.key, value, status, folderName, refresh);
        });

        input.addEventListener('change', function () {
          var value = input.value.trim();
          if (!value) {
            delete driveMappingDraft[docType.key];
            folderName.textContent = 'no folder';
            status.textContent = '';
            status.classList.remove('is-error');
            row.classList.remove('is-mapped');
            return;
          }
          row.classList.add('is-mapped');
          verifyDriveFolder(docType.key, value, status, folderName, refresh);
        });

        var inputRow = document.createElement('div');
        inputRow.className = 'drive-folder-input-row';
        inputRow.appendChild(input);
        inputRow.appendChild(refresh);

        right.appendChild(inputRow);
        right.appendChild(status);

        row.appendChild(left);
        row.appendChild(arrow);
        row.appendChild(right);
        driveMappingList.appendChild(row);
      });
    }

    function openDriveMapping(config) {
      driveMappingConfig = config;
      driveMappingDraft = {};
      Object.keys(config.mapping || {}).forEach(function (key) {
        driveMappingDraft[key] = config.mapping[key];
      });

      if (driveMappingIntro) {
        driveMappingIntro.textContent = config.defaultFolderName
          ? 'Give each document a Drive folder link. Anything left blank goes to the default folder, "' + config.defaultFolderName + '".'
          : 'Give each document a Drive folder link. There is no default folder, so anything left blank is skipped.';
      }
      if (driveMappingNote) {
        if (driveServiceAccount) {
          setFormStatus(driveMappingNote, 'Share each folder with ' + driveServiceAccount + ' as a Content manager first.', 'success');
        } else {
          clearFormStatus(driveMappingNote);
        }
      }
      if (driveMappingStatus) clearFormStatus(driveMappingStatus);

      renderDriveMapping();
      if (driveMappingModal) driveMappingModal.hidden = false;
    }

    if (driveSaveMappingBtn) {
      driveSaveMappingBtn.addEventListener('click', function () {
        if (!driveMappingConfig) return;
        clearFormStatus(driveMappingStatus);

        var originalText = driveSaveMappingBtn.textContent;
        driveSaveMappingBtn.disabled = true;
        driveSaveMappingBtn.textContent = 'Saving…';

        fetch(API_BASE + '/drive/' + encodeURIComponent(driveMappingConfig.id), {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mapping: driveMappingDraft })
        })
          .then(parseJson)
          .then(function (result) {
            if (handleApiFailure(result)) return;
            if (result.status === 200) {
              showToast('Folders saved.', 'success');
              closeDriveMapping();
              loadDriveConfigs();
              return;
            }
            setFormStatus(driveMappingStatus, (result.data && result.data.error) || 'Could not save the folders.', 'error');
          })
          .catch(function (err) {
            console.error('[admin] drive mapping save failed:', err);
            setFormStatus(driveMappingStatus, 'Could not save the folders.', 'error');
          })
          .finally(function () {
            driveSaveMappingBtn.disabled = false;
            driveSaveMappingBtn.textContent = originalText;
          });
      });
    }

    function openSheetsModal() {
      showModal('admin-sheets-modal');
      addSheetForm.reset();
      clearFormStatus(addSheetStatus);
      loadSheets();
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
      preferred_dob: 'Preferred Date of Birth',
      nationality: 'Nationality',
      gender: 'Gender',
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
      intro_line: 'Short Intro',
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

    var DATE_FIELD_KEYS = {
      dob: true, preferred_dob: true, fathers_dob: true, mothers_dob: true, spouse_dob: true
    };

    function formatDisplayDate(value) {
      var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
      return match ? match[3] + '/' + match[2] + '/' + match[1] : value;
    }

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
        if (DATE_FIELD_KEYS[key]) value = formatDisplayDate(value);
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
          return c.name + (c.dob ? ' (' + formatDisplayDate(c.dob) + ')' : '');
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

    function syncOnboardingToDrive(item, btn) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Filing…';

      fetch(API_BASE + '/onboardings/' + encodeURIComponent(item.id) + '/drive-sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(parseJson)
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = originalText;
          if (handleApiFailure(result)) return;

          if (result.status === 200 && result.data && result.data.synced) {
            item.driveSyncedAt = new Date().toISOString();
            var msg = 'Filed ' + result.data.uploaded + ' document(s) to Drive.';
            if (result.data.failed) msg += ' ' + result.data.failed + ' failed.';
            showToast(msg, result.data.failed ? 'error' : 'success');
            return;
          }
          showToast((result.data && result.data.error) || 'Could not file to Drive.', 'error');
        })
        .catch(function (err) {
          console.error('[admin] drive sync failed:', err);
          btn.disabled = false;
          btn.textContent = originalText;
          showToast('Could not file to Drive.', 'error');
        });
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
