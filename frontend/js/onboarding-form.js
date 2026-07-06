(function () {
  'use strict';

  var API_BASE = ""
  var VERIFY_ENDPOINT = API_BASE+'/api/onboarding/verify';
  var PROGRESS_DATA_ENDPOINT = API_BASE+'/api/onboarding/progress-data';
  var SUBMIT_ENDPOINT = API_BASE+'/api/onboarding/submit-data';
  var DOC_UPLOAD_ENDPOINT = API_BASE+'/api/docs/upload';
  var DOC_REMOVE_ENDPOINT = API_BASE+'/api/docs/remove_doc';
  var DOC_PRESIGN_ENDPOINT = API_BASE+'/api/docs/presign';
  var MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  var DOC_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

  var VERIFY_FAIL_MESSAGES = {
    no_onboarding_key: 'This onboarding link is missing required information.',
    no_cookie: "You haven't completed identity verification for this session yet.",
    not_found: 'We could not find an active verification session for this link.',
    unverified: "Your identity hasn't been verified yet.",
    key_mismatch: "This verification session doesn't match your onboarding link.",
    ttl_expired: 'Your verification session has expired.',
    expired: 'This onboarding link has expired. Please contact HR for assistance.',
    link_expired: 'This onboarding link has expired. Please contact HR for assistance.',
    session_inactive: 'Your session has expired due to inactivity. Please verify your identity again.'
  };

  var EXPIRY_REASON_MESSAGES = {
    too_many_doc_uploads: 'This happened because too many documents were uploaded using this link.',
    too_many_presign_requests: 'This happened because one of your documents was accessed too many times.',
    too_many_sync_requests: 'This happened because too many save requests were made using this link.',
    too_many_field_edits: 'This happened because one field was edited too many times.',
    too_many_submit_attempts: 'This happened because too many submission attempts were made.',
    link_expiration_date_passed: 'This link’s expiration date has passed.',
    admin_expired: 'This link was manually expired by an administrator.'
  };

  function formatExpiryReason(expiredReason) {
    return EXPIRY_REASON_MESSAGES[expiredReason] || '';
  }

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function sanitize(value) {
    return String(value == null ? '' : value).trim().replace(/[<>]/g, '');
  }

  var onboardingKey = sanitize(getParam('id'));

  var invalidLinkPanel = document.querySelector('#invalid-link-panel');
  var verifyLoadingPanel = document.querySelector('#verify-loading-panel');
  var verifyFailedPanel = document.querySelector('#verify-failed-panel');
  var verifyCompletedPanel = document.querySelector('#verify-completed-panel');
  var verifyExpiredPanel = document.querySelector('#verify-expired-panel');
  var verifyErrorPanel = document.querySelector('#verify-error-panel');
  var onboardingShell = document.querySelector('#onboarding-shell');

  var statePanels = [invalidLinkPanel, verifyLoadingPanel, verifyFailedPanel, verifyCompletedPanel, verifyExpiredPanel, verifyErrorPanel, onboardingShell].filter(Boolean);

  function showStatePanel(target) {
    statePanels.forEach(function (panel) { panel.hidden = panel !== target; });
  }

  if (!onboardingKey) {
    showStatePanel(invalidLinkPanel);
    return;
  }

  function showVerifyFailed(reason, expiredReason) {
    // "completed" means the onboarding was already submitted - there's nothing
    // to re-verify, so it gets its own panel instead of the "Verify Now" one.
    if (reason === 'completed' && verifyCompletedPanel) {
      showStatePanel(verifyCompletedPanel);
      return;
    }

    // "expired" or "link_expired" means the onboarding link has expired - show dedicated panel
    if ((reason === 'expired' || reason === 'link_expired') && verifyExpiredPanel) {
      var expiredReasonEl = document.querySelector('#verify-expired-reason');
      if (expiredReasonEl) expiredReasonEl.textContent = formatExpiryReason(expiredReason);
      showStatePanel(verifyExpiredPanel);
      return;
    }

    var reasonEl = document.querySelector('#verify-failed-reason');
    if (reasonEl) {
      reasonEl.textContent = VERIFY_FAIL_MESSAGES[reason] || 'You need to verify your identity before continuing with onboarding.';
    }
    var link = document.querySelector('#verify-now-link');
    if (link) link.href = 'verify-onboarding.html?id=' + encodeURIComponent(onboardingKey);
    showStatePanel(verifyFailedPanel);
  }

  // Any authenticated call (sync-form, upload, remove_doc) can discover mid-session
  // that the cookie/key is no longer valid (401 { error, reason }). When that
  // happens the whole form is no longer usable, so hide it and reuse the same
  // "verify again" takeover the initial page-load gate uses - once, even if
  // several in-flight requests all fail with 401 around the same time.
  var sessionExpired = false;

  function handleSessionExpired(reason, expiredReason) {
    if (sessionExpired) return;
    sessionExpired = true;
    showVerifyFailed(reason, expiredReason);
  }

  function runVerification() {
    showStatePanel(verifyLoadingPanel);

    fetch(VERIFY_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) {
        if (res.status === 400) {
          showStatePanel(invalidLinkPanel);
          return null;
        }
        if (!res.ok) throw new Error('Verification request failed with status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.auth) {
          showStatePanel(onboardingShell);
          initWizard();
        } else {
          showVerifyFailed(data.reason, data.expiredReason);
        }
      })
      .catch(function (err) {
        console.error('[onboarding-form] verify request failed:', err);
        showStatePanel(verifyErrorPanel);
      });
  }

  var verifyRetryBtn = document.querySelector('#verify-retry-btn');
  if (verifyRetryBtn) verifyRetryBtn.addEventListener('click', runVerification);

  function initWizard() {
  if (initWizard.done) return;
  initWizard.done = true;

  // The doc preview modal lives outside #onboarding-shell, so if a session
  // expires while it happens to be open it must be closed explicitly -
  // otherwise it's left stuck floating over a hidden form.
  function sessionExpiredInWizard(reason, expiredReason) {
    closePreviewModal();
    handleSessionExpired(reason, expiredReason);
  }

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.mission-tab'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.step-panel'));
  var form = document.querySelector('#onboardingForm');

  if (!form) return;

  var prevBtn = document.querySelector('#prevBtn');
  var nextBtn = document.querySelector('#nextBtn');
  var submitBtn = document.querySelector('#submitBtn');
  var submitBtnDefaultText = submitBtn.textContent;
  var submitInProgress = false;
  var saveBtn = document.querySelector('#saveBtn');
  var saveBtnDefaultText = saveBtn.textContent;
  var downloadCsvBtn = document.querySelector('#downloadCsvBtn');
  var progressText = document.querySelector('#progressText');
  var progressCircle = document.querySelector('#progressCircle');
  var badgeName = document.querySelector('#badgeName');
  var locationChip = document.querySelector('#locationChip');
  var reviewSummary = document.querySelector('#reviewSummary');
  var submitMessage = document.querySelector('#submitMessage');
  var currentStep = 0;
  var STEP_STORAGE_KEY = 'nk-onboarding-form-step-' + onboardingKey;
  var PROGRESS_STORAGE_KEY = 'nk-onboarding-form-progress-' + onboardingKey;

  var badges = [
    { min: 0, name: 'Market Explorer' },
    { min: 20, name: 'Profile Analyst' },
    { min: 45, name: 'Document Trader' },
    { min: 70, name: 'Compliance Pro' },
    { min: 100, name: 'Day 1 Listed' }
  ];

  var locationLabels = {
    gurugram: 'Gurugram',
    gift_city: 'GIFT City',
    dubai: 'Dubai'
  };

  var fieldLabels = {
    welcome_ack: 'Welcome acknowledgement',
    full_name: 'Full name',
    preferred_name: 'Preferred name',
    email: 'Personal email',
    mobile: 'Mobile number',
    dob: 'Date of birth',
    nationality: 'Nationality',
    marital_status: 'Marital status',
    blood_group: 'Blood group',
    emergency_contact_name: 'Emergency contact name',
    emergency_contact_number: 'Emergency contact number',
    passport_number: 'Identity number (Aadhar/Passport)',
    ssn: 'SSN',
    address: 'Permanent address',
    present_address: 'Current address',
    fathers_name: "Father's name",
    fathers_dob: "Father's date of birth",
    mothers_name: "Mother's name",
    mothers_dob: "Mother's date of birth",
    spouse_name: "Spouse's name",
    spouse_dob: "Spouse's date of birth",
    childs_info: 'Children information',
    insurance_coverage: 'Insurance coverage',
    orgs: 'Previous organizations',
    pan_doc: 'PAN Card',
    id_doc: 'ID Proof',
    address_doc: 'Address Proof',
    photo_doc: 'Personal Photo',
    highest_degree_doc: 'Highest Degree Certificate',
    higher_secondary_doc: 'Higher Secondary Marksheet',
    resume_doc: 'Resume',
    offer_letter_doc: 'Offer Letter (Last Company)',
    last_increment_doc: 'Last Increment Letter',
    salary_slip_doc: 'Salary Slip (3 Months Zipped)',
    bonus_letter_doc: 'Bonus Letter',
    experience_letter_doc: 'Experience Letter',
    relieving_letter_doc: 'Relieving Letter',
    campus_name: 'Campus Name',
    bank_name: 'Bank name',
    account_holder: 'Account holder name',
    account_number: 'Account number',
    ifsc: 'IFSC code',
    bank_doc: 'Bank proof file',
    intro_line: 'One line intro',
    birthday_pref: 'Birthday celebration preference',
    meal_preference: 'Meal preference',
    hobbies: 'Hobbies',
    fun_fact: 'Fun fact',
    declaration: 'Declaration',
    consent: 'Consent'
  };

  function updateLocationVisibility(location) {
    var elements = document.querySelectorAll('[data-location]');
    elements.forEach(function (el) {
      var allowedLocations = el.getAttribute('data-location').split(',');
      if (allowedLocations.indexOf(location) !== -1) {
        el.classList.add('location-visible');
      } else {
        el.classList.remove('location-visible');
      }
    });
    updateDocBasisLabels(location);
  }

  var DOC_BASIS_LABELS = {
    full_name: { dubai: 'Full name (As per Passport)', default: 'Full name (As per Aadhar)' },
    dob: { dubai: 'Date of birth (As per Passport)', default: 'Date of birth (As per Aadhar)' },
    identity_number: { dubai: 'Passport Number', default: 'Aadhar Number' },
    id_proof_type: { dubai: 'Passport', default: 'Aadhar' }
  };

  function updateDocBasisLabels(location) {
    var basis = location === 'dubai' ? 'dubai' : 'default';
    Object.keys(DOC_BASIS_LABELS).forEach(function (field) {
      var el = document.querySelector('[data-doc-basis-label="' + field + '"]');
      if (el) el.textContent = DOC_BASIS_LABELS[field][basis];
    });

    var identityInput = document.querySelector('input[name="passport_number"]');
    if (identityInput) {
      identityInput.placeholder = basis === 'dubai' ? 'Enter passport number' : 'Enter Aadhar number';
    }
  }

  function showStep(index) {
    currentStep = Math.max(0, Math.min(index, panels.length - 1));
    localStorage.setItem(STEP_STORAGE_KEY, String(currentStep));
    tabs.forEach(function (tab, i) { tab.classList.toggle('active', i === currentStep); });
    panels.forEach(function (panel, i) { panel.classList.toggle('active', i === currentStep); });
    prevBtn.style.visibility = currentStep === 0 ? 'hidden' : 'visible';
    var isLastStep = currentStep === panels.length - 1;
    nextBtn.style.display = isLastStep ? 'none' : 'inline-flex';
    submitBtn.style.display = isLastStep ? 'inline-flex' : 'none';
    updateProgress();
    if (currentStep === panels.length - 1) buildReview();
  }

  function fieldComplete(field) {
    if (field.type === 'checkbox') return field.checked;
    if (field.type === 'file') return (field.files && field.files.length > 0) || !!field.dataset.restoredFilename;
    return field.value.trim().length > 0;
  }

  function getFormPayload() {
    var payload = {
      submitted_at: new Date().toISOString(),
      source: 'NK Onboarding Trading Desk Quest'
    };

    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name) return;
      if (field.type === 'button' || field.type === 'submit') return;

      if (field.type === 'checkbox') {
        payload[field.name] = field.checked ? 'Yes' : 'No';
        return;
      }

      if (field.type === 'file') {
        payload[field.name] = field.files && field.files.length
          ? Array.prototype.map.call(field.files, function (file) { return file.name; }).join('; ')
          : '';
        return;
      }

      payload[field.name] = field.value || '';
    });

    return payload;
  }

  function isFieldVisible(field) {
    // Check if field or its parent has data-location and is not visible
    var el = field.closest('[data-location]');
    if (el && !el.classList.contains('location-visible')) return false;
    return true;
  }

  function updateProgress() {
    var requiredFields = Array.prototype.slice.call(form.querySelectorAll('[data-required="true"]'))
      .filter(isFieldVisible);
    var completed = requiredFields.filter(fieldComplete).length;
    var percent = requiredFields.length ? Math.round((completed / requiredFields.length) * 100) : 0;
    progressText.textContent = percent + '%';
    progressCircle.style.strokeDashoffset = 327 - (327 * percent) / 100;
    badgeName.textContent = badges.slice().reverse().find(function (badge) { return percent >= badge.min; }).name;
    updateSectionProgress();
  }

  // Shows "completed/total" required-field counts per mission next to its
  // sidebar tab, so progress is visible without opening every section.
  function updateSectionProgress() {
    panels.forEach(function (panel, i) {
      var tab = tabs[i];
      var countEl = tab ? tab.querySelector('.mission-progress-count') : null;
      if (!countEl) return;

      var sectionRequiredFields = Array.prototype.slice.call(panel.querySelectorAll('[data-required="true"]'))
        .filter(isFieldVisible);

      if (!sectionRequiredFields.length) {
        countEl.hidden = true;
        return;
      }

      var sectionCompleted = sectionRequiredFields.filter(fieldComplete).length;
      countEl.textContent = sectionCompleted + '/' + sectionRequiredFields.length;
      countEl.hidden = false;
    });
  }

  function buildReview() {
    var requiredFields = Array.prototype.slice.call(form.querySelectorAll('[data-required="true"]'))
      .filter(isFieldVisible);
    var missing = requiredFields.filter(function (field) { return !fieldComplete(field); });
    var data = new FormData(form);
    var name = data.get('full_name') || 'Not added yet';
    var email = data.get('email') || 'Not added yet';
    var mobile = data.get('mobile') || 'Not added yet';

    reviewSummary.innerHTML =
      '<div class="review-item"><strong>Name</strong><span></span></div>' +
      '<div class="review-item"><strong>Email</strong><span></span></div>' +
      '<div class="review-item"><strong>Mobile</strong><span></span></div>' +
      '<div class="review-item"><strong>Required fields missing</strong><span></span></div>';

    var values = [name, email, mobile, String(missing.length)];
    Array.prototype.forEach.call(reviewSummary.querySelectorAll('.review-item span'), function (el, i) {
      el.textContent = values[i];
    });
  }

  function escapeCsv(value) {
    var text = String(value == null ? '' : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function downloadCsv() {
    var payload = getFormPayload();
    var headers = Object.keys(payload);
    var csv = [
      headers.map(function (header) { return escapeCsv(fieldLabels[header] || header); }).join(','),
      headers.map(function (header) { return escapeCsv(payload[header]); }).join(',')
    ].join('\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var safeName = (payload.full_name || 'new-joiner').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.href = url;
    link.download = 'nk-onboarding-' + safeName + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function showSubmitMessage(message, type) {
    submitMessage.textContent = message;
    submitMessage.classList.remove('is-success', 'is-error');
    submitMessage.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
  }

  var toastContainer = document.querySelector('#toast-container');
  var TOAST_VISIBLE_MS = 6000;

  function showErrorToast(message) {
    if (!toastContainer) return;

    var toast = document.createElement('div');
    toast.className = 'toast';
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

  // ---- Background form sync (non-document fields only) ----
  //
  // Uses interval-based sync with timestamp conflict resolution:
  // - changedFields tracks fields with their last change timestamp
  // - erroredFields tracks fields that failed to sync (user must fix)
  // - Sync runs every 5s after previous response if there are changes
  // - Only applies response to fields whose change time < sync start time

  var SYNC_FORM_ENDPOINT = API_BASE+'/api/onboarding/sync-form';
  var SYNC_INTERVAL_MS = 5000; // 5 seconds after last response
  var changedFields = {}; // { fieldName: { value: any, changedAt: number } }
  var erroredFields = {}; // { fieldName: errorMessage }
  var syncIntervalId = null;
  var syncInProgress = false;
  var lastSyncStartedAt = null;

  function getFieldValue(field) {
    if (field.type === 'checkbox') return field.checked;
    return field.value || '';
  }

  function hasChangedFields() {
    return Object.keys(changedFields).length > 0;
  }

  function hasErroredFields() {
    return Object.keys(erroredFields).length > 0;
  }

  // Get submit button disabled reason for tooltip
  function getSubmitDisabledReason() {
    if (sessionExpired) return 'Session expired';
    if (submitInProgress) return 'Submitting...';
    if (syncInProgress) return 'Saving changes...';
    if (hasErroredFields()) return 'Please fix the fields with errors';
    if (hasChangedFields()) return 'Please wait for changes to be saved';
    return '';
  }

  // Update submit button state based on unsaved/errored changes
  function updateSubmitButtonState() {
    if (sessionExpired || submitInProgress) return;
    var shouldDisable = hasChangedFields() || hasErroredFields() || syncInProgress;
    submitBtn.disabled = shouldDisable;
    submitBtn.title = shouldDisable ? getSubmitDisabledReason() : '';
  }

  // For a checkbox (inside a .consent-row label), the border highlight goes on
  // the whole row rather than the tiny checkbox itself; everything else gets
  // it directly on the input/select/textarea.
  // For radio button groups (RadioNodeList), we target the first radio's parent.
  function getFieldHighlightTarget(field) {
    // RadioNodeList doesn't have classList or closest - get first element
    if (field instanceof RadioNodeList) {
      return field[0] ? field[0].closest('.radio-group') : null;
    }
    return field.type === 'checkbox' ? field.closest('.consent-row') : field;
  }

  function ensureFieldSyncMessageEl(field) {
    // RadioNodeList doesn't have closest - get first element or skip
    if (field instanceof RadioNodeList) {
      var radioGroup = field[0] ? field[0].closest('.radio-group') : null;
      if (!radioGroup) return null;
      var messageEl = radioGroup.querySelector('.field-sync-message');
      if (!messageEl) {
        messageEl = document.createElement('span');
        messageEl.className = 'field-sync-message';
        messageEl.setAttribute('aria-live', 'polite');
        radioGroup.appendChild(messageEl);
      }
      return messageEl;
    }
    var label = field.closest('label');
    if (!label) return null;
    var messageEl = label.querySelector('.field-sync-message');
    if (!messageEl) {
      messageEl = document.createElement('span');
      messageEl.className = 'field-sync-message';
      messageEl.setAttribute('aria-live', 'polite');
      label.appendChild(messageEl);
    }
    return messageEl;
  }

  // Reflects each step-panel's worst field state onto its sidebar tab: a red
  // dot if anything in that section failed to sync, otherwise a yellow dot if
  // anything is still unsaved, otherwise no dot at all.
  function updateSidebarStatus() {
    panels.forEach(function (panel, i) {
      var tab = tabs[i];
      var dot = tab ? tab.querySelector('.mission-status-dot') : null;
      if (!dot) return;

      var hasError = !!panel.querySelector('.field-sync-error') || !!panel.querySelector('.upload-status.is-error');
      var hasUnsaved = !hasError && !!panel.querySelector('.field-unsaved');

      dot.classList.toggle('is-error', hasError);
      dot.classList.toggle('is-unsaved', hasUnsaved);
    });
  }

  function setFieldUnsaved(field, isUnsaved) {
    var target = getFieldHighlightTarget(field);
    if (target) target.classList.toggle('field-unsaved', !!isUnsaved);
    updateSidebarStatus();
  }

  function setFieldSyncError(field, message) {
    var target = getFieldHighlightTarget(field);
    var messageEl = ensureFieldSyncMessageEl(field);

    if (message) {
      if (target) {
        target.classList.remove('field-unsaved');
        target.classList.add('field-sync-error');
      }
      if (messageEl) messageEl.textContent = message;
    } else {
      if (target) target.classList.remove('field-sync-error');
      if (messageEl) messageEl.textContent = '';
    }
    updateSidebarStatus();
  }

  function markFieldChanged(name) {
    if (!name || sessionExpired) return;

    var field = form.elements[name];
    var value;
    if (name === 'childs_info') {
      value = getChildrenData();
    } else if (name === 'orgs') {
      value = getOrgsData();
    } else if (name === 'address') {
      value = getPermanentAddressData();
    } else if (name === 'present_address') {
      value = getPresentAddressData();
    } else if (field) {
      value = getFieldValue(field);
    } else {
      return;
    }

    // Add to changed fields with timestamp
    changedFields[name] = { value: value, changedAt: Date.now() };

    // Remove from errored fields (user is fixing it)
    if (erroredFields[name]) {
      delete erroredFields[name];
      if (field) setFieldSyncError(field, null);
    }

    if (field) {
      setFieldUnsaved(field, true);
    }

    updateSubmitButtonState();
    startSyncInterval();
  }

  // Start the sync interval if not already running
  function startSyncInterval() {
    if (syncIntervalId !== null) return; // Already running
    syncIntervalId = setTimeout(checkAndSync, SYNC_INTERVAL_MS);
  }

  // Stop the sync interval
  function stopSyncInterval() {
    if (syncIntervalId !== null) {
      clearTimeout(syncIntervalId);
      syncIntervalId = null;
    }
  }

  // Check if sync is needed and run it
  function checkAndSync() {
    syncIntervalId = null; // Clear the interval ID

    if (sessionExpired) {
      stopSyncInterval();
      return;
    }

    if (!hasChangedFields()) {
      // No changes to sync, don't schedule next check
      return;
    }

    if (syncInProgress) {
      // Sync already in progress, schedule next check
      syncIntervalId = setTimeout(checkAndSync, SYNC_INTERVAL_MS);
      return;
    }

    runSync();
  }

  function runSync() {
    if (sessionExpired) return;
    if (!hasChangedFields()) return;
    if (syncInProgress) return;

    syncInProgress = true;
    lastSyncStartedAt = Date.now();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    updateSubmitButtonState();

    // Build snapshot of fields to sync
    var snapshot = {};
    Object.keys(changedFields).forEach(function (name) {
      snapshot[name] = changedFields[name].value;
    });

    var syncStartTime = lastSyncStartedAt;

    fetch(SYNC_FORM_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: snapshot })
    })
      .then(function (res) {
        if (res.status === 401) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            sessionExpiredInWizard(body.reason, body.expiredReason);
            return null;
          });
        }
        if (!res.ok) throw new Error('Sync failed with status ' + res.status);
        return res.json();
      })
      .then(function (results) {
        if (!results) return; // session-expired path already handled above

        if (!Array.isArray(results)) {
          console.error('[onboarding-form] unexpected sync response shape:', results);
          return;
        }

        var rejected = [];

        results.forEach(function (result) {
          if (!result || !result.field_name) return;

          var fieldName = result.field_name;
          var fieldData = changedFields[fieldName];

          // Only apply response if field wasn't changed after sync started
          if (!fieldData || fieldData.changedAt >= syncStartTime) {
            // Field was changed after sync started, ignore this response
            return;
          }

          var field = form.elements[fieldName];

          if (!result.saved) {
            // Field failed to save - add to errored fields, remove from changed
            console.error('[onboarding-form] field sync rejected:', fieldName, result.error);
            var errorMsg = result.error || 'Could not save this field.';
            erroredFields[fieldName] = errorMsg;
            delete changedFields[fieldName];
            if (field) {
              setFieldSyncError(field, errorMsg);
              setFieldUnsaved(field, false);
            }
            rejected.push({ name: fieldName, error: result.error });
            return;
          }

          // Field saved successfully - remove from changed fields
          delete changedFields[fieldName];
          if (field) {
            setFieldSyncError(field, null);
            setFieldUnsaved(field, false);
          }
        });

        if (rejected.length === 1) {
          var label = fieldLabels[rejected[0].name] || rejected[0].name;
          showErrorToast('Could not save "' + label + '": ' + (rejected[0].error || 'Please try again.'));
        } else if (rejected.length > 1) {
          showErrorToast('Could not save ' + rejected.length + ' fields - check the highlighted fields for details.');
        }
      })
      .catch(function (err) {
        console.error('[onboarding-form] form sync failed:', err);
        showErrorToast('Failed to save your changes. Please check your connection and try again.');
      })
      .finally(function () {
        syncInProgress = false;
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtnDefaultText;
        updateSubmitButtonState();

        if (sessionExpired) {
          stopSyncInterval();
          return;
        }

        // Schedule next sync check 5s after this response
        if (hasChangedFields()) {
          syncIntervalId = setTimeout(checkAndSync, SYNC_INTERVAL_MS);
        }
      });
  }

  function scheduleSync(fieldName) {
    markFieldChanged(fieldName);
  }

  // Submitting must see the latest edits, not whatever was last confirmed -
  // flush any pending/in-flight sync first. A stuck or failing sync shouldn't
  // block submission forever though, since /submit-data is authoritative and
  // will report exactly what's still missing regardless.
  function flushPendingSync() {
    return new Promise(function (resolve) {
      if (!hasChangedFields() && !syncInProgress) {
        resolve();
        return;
      }

      stopSyncInterval();
      runSync();

      var settled = false;
      var giveUp = setTimeout(function () {
        settled = true;
        clearInterval(poll);
        resolve();
      }, 6000);
      var poll = setInterval(function () {
        if (settled) return;
        if (!syncInProgress && !hasChangedFields()) {
          settled = true;
          clearInterval(poll);
          clearTimeout(giveUp);
          resolve();
        }
      }, 150);
    });
  }

  function highlightMissingItem(name) {
    var field = form.elements[name];
    if (!field) return null;
    if (field.type === 'file') {
      setUploadStatus(field, 'This document is required.', 'error');
    } else {
      setFieldSyncError(field, 'This field is required.');
    }
    return field;
  }

  function submitOnboarding() {
    if (sessionExpired || submitInProgress) return;

    if (hasErroredFields()) {
      showSubmitMessage('Please fix the fields with errors before submitting.', 'error');
      return;
    }

    if (hasChangedFields()) {
      showSubmitMessage('Please wait for your changes to be saved before submitting.', 'error');
      return;
    }

    if (syncInProgress) {
      showSubmitMessage('Please wait for your changes to finish saving, then try again.', 'error');
      return;
    }

    // Stop the sync interval during submission
    stopSyncInterval();

    submitInProgress = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    showSubmitMessage('Checking your submission…', 'success');

    flushPendingSync()
      .then(function () {
        return fetch(SUBMIT_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 401) {
          sessionExpiredInWizard(result.body.reason, result.body.expiredReason);
          return;
        }

        // Too many submit attempts also expires the link server-side, but comes
        // back as a 429 (not 401) since this request itself is what tripped it.
        if (result.status === 429 && result.body && result.body.reason === 'expired') {
          sessionExpiredInWizard(result.body.reason, result.body.expiredReason);
          return;
        }

        if (result.status === 422) {
          var missing = result.body.missing || [];
          var firstField = null;
          missing.forEach(function (name) {
            var field = highlightMissingItem(name);
            if (field && !firstField) firstField = field;
          });
          if (firstField) {
            var panel = firstField.closest('.step-panel');
            if (panel) showStep(parseInt(panel.dataset.panel, 10));
          }
          showSubmitMessage('Almost there - ' + missing.length + ' required item(s) still need attention.', 'error');
          return;
        }

        if (!result.body || !result.body.submitted) {
          showSubmitMessage('Something went wrong while submitting. Please try again.', 'error');
          return;
        }

        sessionExpiredInWizard('completed');
      })
      .catch(function (err) {
        console.error('[onboarding-form] submit failed:', err);
        showSubmitMessage('Something went wrong while submitting. Please try again.', 'error');
      })
      .finally(function () {
        submitInProgress = false;
        if (!sessionExpired) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtnDefaultText;
        }
      });
  }

  // Non-401 failure reasons only - a 401 from any authenticated call is
  // intercepted separately by handleSessionExpired before reaching these.
  var UPLOAD_ERROR_MESSAGES = {
    file_too_large: 'File is too large.',
    file_too_small: 'File appears to be empty or too small.',
    filename_too_long: 'Filename is too long.',
    invalid_type: 'Unsupported file type.',
    invalid_extension: 'Unsupported file extension.',
    invalid_doc_type: 'Unsupported document type.',
    no_file: 'No file was received. Please try again.',
    doc_already_exists: 'A document already exists. Remove it first to upload a new one.'
  };

  var REMOVE_ERROR_MESSAGES = {
    invalid_doc_type: 'Unsupported document type.',
    not_found: 'This document was already removed.'
  };

  function setUploadStatus(input, message, type) {
    var card = input.closest('.upload-card');
    var statusEl = card ? card.querySelector('.upload-status') : null;
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.remove('is-success', 'is-error', 'is-loading');
    if (type) statusEl.classList.add('is-' + type);
    updateSidebarStatus();
  }

  function escapeHtml(str) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, function (c) { return map[c]; });
  }

  function getUploadEls(input) {
    var card = input.closest('.upload-card');
    if (!card) return null;
    return {
      card: card,
      preview: card.querySelector('.upload-preview'),
      thumb: card.querySelector('.upload-preview-thumb'),
      removeBtn: card.querySelector('.upload-remove-btn')
    };
  }

  // Uses a data: URL (via FileReader) rather than URL.createObjectURL - the
  // site's CSP only allows img-src 'self' data:, so blob: image sources are
  // blocked by the browser.
  function setUploadPreviewContent(input, file) {
    var els = getUploadEls(input);
    if (!els || !els.preview || !els.thumb) return;

    if (!file) {
      els.preview.hidden = true;
      els.thumb.innerHTML = '';
      return;
    }

    if (file.type && file.type.indexOf('image/') === 0) {
      var reader = new FileReader();
      reader.onload = function () {
        // The user may have picked a different file (or removed this one)
        // before the async read finished - don't clobber the current state.
        if (input.files[0] !== file) return;
        els.thumb.innerHTML = '<img src="' + reader.result + '" alt="Preview of ' + escapeHtml(file.name) + '">';
      };
      reader.readAsDataURL(file);
    } else {
      els.thumb.innerHTML = '<span class="upload-preview-file">' + DOC_ICON_SVG + escapeHtml(file.name) + '</span>';
    }
    els.preview.hidden = false;
  }

  function setRemoveBtnState(input, state) {
    var els = getUploadEls(input);
    if (!els || !els.removeBtn) return;

    if (state === 'hidden') {
      els.removeBtn.hidden = true;
      els.removeBtn.disabled = false;
      els.removeBtn.classList.remove('is-loading');
    } else if (state === 'loading') {
      els.removeBtn.hidden = false;
      els.removeBtn.disabled = true;
      els.removeBtn.classList.add('is-loading');
    } else {
      els.removeBtn.hidden = false;
      els.removeBtn.disabled = false;
      els.removeBtn.classList.remove('is-loading');
    }
  }

  function resetUploadCard(input) {
    setUploadPreviewContent(input, null);
    setRemoveBtnState(input, 'hidden');
    input.hidden = false;
    input.disabled = false;
    input.value = '';
    delete input.dataset.docId;
    delete input.dataset.restoredFilename;
  }

  // A doc uploaded in a *previous* session has no File object to preview from -
  // only the filename and id the backend already stored. Shows it the same way
  // a non-image upload looks (icon + filename), with remove already available.
  // The id is what lets openPreviewModal() fetch a real download link later.
  function restoreUploadedDoc(input, filename, docId) {
    var els = getUploadEls(input);
    if (!els || !els.preview || !els.thumb || !filename) return;

    input.dataset.restoredFilename = filename;
    if (docId) input.dataset.docId = docId;
    els.thumb.innerHTML = '<span class="upload-preview-file">' + DOC_ICON_SVG + escapeHtml(filename) + '</span>';
    els.preview.hidden = false;
    input.hidden = true;
    input.disabled = true;
    setRemoveBtnState(input, 'ready');
  }

  // Restore previously-saved progress from the backend so a user returning
  // mid-onboarding (or on a new device) sees their prior answers and uploaded
  // documents instead of a blank form. Runs after the localStorage restore so
  // backend-confirmed data always wins.
  function loadProgressData() {
    fetch(PROGRESS_DATA_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'GET',
      credentials: 'include'
    })
      .then(function (res) {
        if (res.status === 401) {
          return res.json().then(function (body) { sessionExpiredInWizard(body.reason, body.expiredReason); return null; });
        }
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('progress-data request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data) applyProgressData(data);
      })
      .catch(function (err) {
        console.error('[onboarding-form] failed to load saved progress', err);
      });
  }

  function applyProgressData(data) {
    var fields = (data && data.fields) || {};
    Object.keys(fields).forEach(function (name) {
      if (name === 'address' || name === 'present_address') return;
      var field = form.elements[name];
      if (!field) return;
      var value = fields[name];
      if (value === null || value === undefined) return;
      if (field.type === 'checkbox') {
        field.checked = value === true;
      } else {
        field.value = value;
      }
    });

    // Each doc entry is now { id, name } (previously just a filename string) -
    // the id is what lets a restored doc be downloaded/previewed after reload.
    var docs = (data && data.docs) || {};
    Object.keys(docs).forEach(function (name) {
      var entry = docs[name];
      if (!entry || typeof entry !== 'object' || !entry.name) return;
      var input = form.elements[name];
      if (input && input.type === 'file') restoreUploadedDoc(input, entry.name, entry.id);
    });

    // Display the location chip from info and update location-based visibility
    var info = (data && data.info) || {};
    if (info.location && locationChip) {
      locationChip.textContent = locationLabels[info.location] || info.location;
      locationChip.hidden = false;
      updateLocationVisibility(info.location);
    }

    // Restore structured address records (skipSync=true since data is already saved)
    if (fields.address && typeof fields.address === 'object') {
      setPermanentAddress(fields.address, true);
    }
    if (fields.present_address && typeof fields.present_address === 'object') {
      setPresentAddress(fields.present_address, true);
    }

    // Check "same as permanent" if addresses match (restoring only - no re-sync)
    var sameCheckbox = document.querySelector('#sameAsPermanent');
    if (sameCheckbox && addressesEqual(fields.address, fields.present_address)) {
      sameCheckbox.checked = true;
      if (presentAddressSection) presentAddressSection.style.opacity = '0.5';
      if (addPresentAddressBtn) addPresentAddressBtn.disabled = true;
    }

    // Restore children info (skipSync=true since data is already saved)
    if (fields.childs_info && Array.isArray(fields.childs_info)) {
      fields.childs_info.forEach(function (child) {
        if (child && child.name && child.dob) {
          addChild(child.name, child.dob, true);
        }
      });
    }

    // Restore orgs info (skipSync=true since data is already saved)
    if (fields.orgs && Array.isArray(fields.orgs)) {
      fields.orgs.forEach(function (org) {
        if (org && org.name && org.duration) {
          addOrg(org.name, org.duration, org.role || '', org.info || '', org.current, true);
        }
      });
    }

    updateProgress();
  }

  function uploadDocument(input) {
    var file = input.files && input.files[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadStatus(input, 'File is too large. Max 10MB.', 'error');
      resetUploadCard(input);
      updateProgress();
      return;
    }

    setUploadPreviewContent(input, file);
    setRemoveBtnState(input, 'loading');
    setUploadStatus(input, 'Uploading…', 'loading');
    input.hidden = true;
    input.disabled = true;

    var docType = input.dataset.docType;
    var formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);

    fetch(DOC_UPLOAD_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
      credentials: 'include',
      body: formData
    })
      .then(function (res) { return res.json().then(function (data) { return { status: res.status, ok: res.ok, data: data }; }); })
      .then(function (result) {
        input.disabled = false;

        if (result.status === 401) {
          sessionExpiredInWizard(result.data.reason, result.data.expiredReason);
          return;
        }

        if (result.ok && result.data.uploaded) {
          input.dataset.docId = result.data.docId || '';
          input.disabled = true;
          setRemoveBtnState(input, 'ready');
          setUploadStatus(input, 'Uploaded ✓', 'success');
          return;
        }

        var reason = result.data.reason;
        setUploadStatus(input, UPLOAD_ERROR_MESSAGES[reason] || 'Upload failed. Please try again.', 'error');
        resetUploadCard(input);
        updateProgress();
      })
      .catch(function (err) {
        console.error('[onboarding-form] doc upload failed:', err);
        input.disabled = false;
        setUploadStatus(input, 'Upload failed. Please try again.', 'error');
        resetUploadCard(input);
        updateProgress();
      });
  }

  var REMOVE_MIN_LOADING_MS = 400;

  function removeDocument(input) {
    var els = getUploadEls(input);
    if (els && els.removeBtn && els.removeBtn.classList.contains('is-loading')) return;

    setRemoveBtnState(input, 'loading');
    setUploadStatus(input, 'Removing…', 'loading');

    var modalOpenForThis = currentModalInput === input;
    if (modalOpenForThis && docModalRemoveBtn) {
      docModalRemoveBtn.disabled = true;
      docModalRemoveBtn.textContent = 'Removing…';
      docModalRemoveBtn.classList.add('is-loading');
    }

    var startedAt = Date.now();

    function afterMinDelay(fn) {
      var elapsed = Date.now() - startedAt;
      var remaining = REMOVE_MIN_LOADING_MS - elapsed;
      if (remaining > 0) {
        setTimeout(fn, remaining);
      } else {
        fn();
      }
    }

    fetch(DOC_REMOVE_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: input.dataset.docType })
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = {};
          try { data = text ? JSON.parse(text) : {}; } catch (e) {}
          return { status: res.status, ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.status === 401) {
          sessionExpiredInWizard(result.data.reason, result.data.expiredReason);
          return;
        }

        afterMinDelay(function () {
          if (result.ok && result.data.removed !== false) {
            resetUploadCard(input);
            setUploadStatus(input, '', null);
            if (currentModalInput === input) closePreviewModal();
            updateProgress();
            return;
          }

          var message = (result.data && (REMOVE_ERROR_MESSAGES[result.data.reason] || result.data.error))
            || 'Failed to remove document. Please try again.';
          setRemoveBtnState(input, 'ready');
          setUploadStatus(input, message, 'error');
          if (modalOpenForThis && docModalRemoveBtn) {
            docModalRemoveBtn.disabled = false;
            docModalRemoveBtn.textContent = docModalRemoveBtnDefaultText;
            docModalRemoveBtn.classList.remove('is-loading');
          }
        });
      })
      .catch(function (err) {
        console.error('[onboarding-form] doc remove failed:', err);
        afterMinDelay(function () {
          setRemoveBtnState(input, 'ready');
          setUploadStatus(input, 'Failed to remove document. Please try again.', 'error');
          if (modalOpenForThis && docModalRemoveBtn) {
            docModalRemoveBtn.disabled = false;
            docModalRemoveBtn.textContent = docModalRemoveBtnDefaultText;
            docModalRemoveBtn.classList.remove('is-loading');
          }
        });
      });
  }

  // ---- Large document preview modal (shared across all upload cards) ----

  var docModal = document.querySelector('#doc-preview-modal');
  var docModalBackdrop = document.querySelector('#doc-modal-backdrop');
  var docModalClose = document.querySelector('#doc-modal-close');
  var docModalBody = document.querySelector('#doc-modal-body');
  var docModalRemoveBtn = document.querySelector('#doc-modal-remove');
  var docModalRemoveBtnDefaultText = docModalRemoveBtn ? docModalRemoveBtn.textContent : 'Remove document';
  var currentModalInput = null;

  function closePreviewModal() {
    if (!docModal) return;
    docModal.hidden = true;
    document.body.style.overflow = '';
    if (docModalBody) docModalBody.innerHTML = '';
    if (docModalRemoveBtn) {
      docModalRemoveBtn.disabled = false;
      docModalRemoveBtn.textContent = docModalRemoveBtnDefaultText;
      docModalRemoveBtn.classList.remove('is-loading');
    }
    currentModalInput = null;
  }

  function openPreviewModal(input) {
    if (!docModal || !docModalBody) return;
    var file = input.files && input.files[0];
    var restoredFilename = input.dataset.restoredFilename;
    if (!file && !restoredFilename) return;

    currentModalInput = input;

    if (file && file.type && file.type.indexOf('image/') === 0) {
      // data: URL (via FileReader), not URL.createObjectURL - the site's CSP
      // only allows img-src 'self' data:, so blob: image sources are blocked.
      docModalBody.innerHTML = '<div class="doc-modal-icon">' + DOC_ICON_SVG + '</div><p class="doc-modal-noprev">Loading preview…</p>';
      var reader = new FileReader();
      reader.onload = function () {
        if (currentModalInput !== input || (input.files && input.files[0]) !== file) return;
        docModalBody.innerHTML = '<img src="' + reader.result + '" alt="Document preview">';
      };
      reader.readAsDataURL(file);
    } else if (!file && input.dataset.docId) {
      // Restored doc from a previous session - fetch a real download link via
      // the doc's id rather than showing the old static "no preview" message.
      docModalBody.innerHTML =
        '<div class="doc-modal-icon">' + DOC_ICON_SVG + '</div>' +
        '<p class="doc-modal-filename">' + escapeHtml(restoredFilename) + '</p>' +
        '<p class="doc-modal-noprev">Loading document…</p>';
      loadRestoredDocLink(input, restoredFilename);
    } else {
      var filename = file ? file.name : restoredFilename;
      var noPreviewText = file
        ? 'Preview not available for this file type.'
        : 'This document was uploaded in a previous session, so a preview is not available here.';
      docModalBody.innerHTML =
        '<div class="doc-modal-icon">' + DOC_ICON_SVG + '</div>' +
        '<p class="doc-modal-filename">' + escapeHtml(filename) + '</p>' +
        '<p class="doc-modal-noprev">' + noPreviewText + '</p>';
    }

    docModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  // Fetches a short-lived presigned download URL for a restored doc (fresh
  // uploads already have the live File in-browser and never hit this path).
  // Note: the presign endpoint sets Content-Disposition: attachment, and the
  // site's CSP (img-src 'self' data:) blocks loading the R2 URL inline - so
  // this can only offer a real download, not an in-page preview.
  function loadRestoredDocLink(input, filename) {
    var docType = input.dataset.docType;
    var docId = input.dataset.docId;
    var url = DOC_PRESIGN_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey) +
      '&docType=' + encodeURIComponent(docType) +
      '&docId=' + encodeURIComponent(docId);

    fetch(url, { method: 'GET', credentials: 'include' })
      .then(function (res) {
        if (res.status === 401) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            sessionExpiredInWizard(body.reason, body.expiredReason);
            return null;
          });
        }
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { status: res.status, ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result || currentModalInput !== input) return; // session-expired, or user moved on

        if (!result.ok || !result.data || !result.data.url) {
          docModalBody.innerHTML =
            '<div class="doc-modal-icon">' + DOC_ICON_SVG + '</div>' +
            '<p class="doc-modal-filename">' + escapeHtml(filename) + '</p>' +
            '<p class="doc-modal-noprev">Could not load this document. Please try again.</p>';
          return;
        }

        docModalBody.innerHTML =
          '<div class="doc-modal-icon">' + DOC_ICON_SVG + '</div>' +
          '<p class="doc-modal-filename">' + escapeHtml(filename) + '</p>' +
          '<a class="btn-secondary" href="' + escapeHtml(result.data.url) + '" target="_blank" rel="noopener">Download document</a>' +
          '<p class="doc-modal-noprev">This link expires in a few minutes.</p>';
      })
      .catch(function (err) {
        console.error('[onboarding-form] presign request failed:', err);
        if (currentModalInput !== input) return;
        docModalBody.innerHTML =
          '<div class="doc-modal-icon">' + DOC_ICON_SVG + '</div>' +
          '<p class="doc-modal-filename">' + escapeHtml(filename) + '</p>' +
          '<p class="doc-modal-noprev">Could not load this document. Please try again.</p>';
      });
  }

  if (docModalClose) docModalClose.addEventListener('click', closePreviewModal);
  if (docModalBackdrop) docModalBackdrop.addEventListener('click', closePreviewModal);
  if (docModalRemoveBtn) {
    docModalRemoveBtn.addEventListener('click', function () {
      if (currentModalInput) removeDocument(currentModalInput);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && docModal && !docModal.hidden) closePreviewModal();
  });

  tabs.forEach(function (tab, index) { tab.addEventListener('click', function () { showStep(index); }); });
  prevBtn.addEventListener('click', function () { showStep(currentStep - 1); });
  nextBtn.addEventListener('click', function () { showStep(currentStep + 1); });
  form.addEventListener('input', updateProgress);
  form.addEventListener('change', updateProgress);
  downloadCsvBtn.addEventListener('click', downloadCsv);

  form.addEventListener('input', function (e) {
    if (e.target && e.target.name && e.target.type !== 'file') scheduleSync(e.target.name);
  });
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name && e.target.type !== 'file') scheduleSync(e.target.name);
  });

  // Warn user about unsaved changes before leaving
  window.addEventListener('beforeunload', function (e) {
    if (hasChangedFields() || hasErroredFields()) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Reserve the sync-message slot under every syncable field up front, so its
  // first appearance (on error) never shifts layout - only its text changes.
  Array.prototype.forEach.call(form.elements, function (field) {
    if (!field.name) return;
    if (field.type === 'file' || field.type === 'button' || field.type === 'submit') return;
    ensureFieldSyncMessageEl(field);
  });

  // Address handling (modal-based) - a single structured { address, city,
  // country, pincode } record for each of permanent/present address.
  var sameAsPermanentCheckbox = document.querySelector('#sameAsPermanent');
  var permanentAddressField = form.elements['address'];
  var presentAddressField = form.elements['present_address'];
  var presentAddressSection = document.querySelector('#presentAddressSection');
  var permanentAddressSummary = document.querySelector('#permanentAddressSummary');
  var presentAddressSummary = document.querySelector('#presentAddressSummary');
  var addPermanentAddressBtn = document.querySelector('#addPermanentAddressBtn');
  var addPresentAddressBtn = document.querySelector('#addPresentAddressBtn');

  var addressModal = document.querySelector('#address-modal');
  var addressModalBackdrop = document.querySelector('#address-modal-backdrop');
  var addressModalClose = document.querySelector('#address-modal-close');
  var addressModalCancel = document.querySelector('#address-modal-cancel');
  var addressModalSave = document.querySelector('#address-modal-save');
  var addressModalTitle = document.querySelector('#addressModalTitle');
  var addressModalLine = document.querySelector('#addressModalLine');
  var addressModalCity = document.querySelector('#addressModalCity');
  var addressModalCountry = document.querySelector('#addressModalCountry');
  var addressModalPincode = document.querySelector('#addressModalPincode');
  var addressModalError = document.querySelector('#addressModalError');
  var addressModalRequiredMarks = Array.prototype.slice.call(document.querySelectorAll('.address-modal-required'));
  var addressModalTarget = null; // 'permanent' | 'present'

  var permanentAddressData = null;
  var presentAddressData = null;

  function hasAddressContent(a) {
    return !!(a && (a.address || a.city || a.country || a.pincode));
  }

  function formatAddressSummary(a) {
    return [a.address, a.city, a.country, a.pincode].filter(Boolean).join(', ');
  }

  function addressesEqual(a, b) {
    if (!a || !b) return false;
    return a.address === b.address && a.city === b.city && a.country === b.country && a.pincode === b.pincode;
  }

  function renderAddressSummary(summaryEl, triggerBtn, data) {
    if (!summaryEl || !triggerBtn) return;
    if (hasAddressContent(data)) {
      summaryEl.querySelector('.address-summary-text').textContent = formatAddressSummary(data);
      summaryEl.hidden = false;
      triggerBtn.textContent = 'Edit address';
    } else {
      summaryEl.hidden = true;
      triggerBtn.textContent = '+ Add address';
    }
  }

  function setPermanentAddress(data, skipSync) {
    permanentAddressData = hasAddressContent(data) ? data : null;
    renderAddressSummary(permanentAddressSummary, addPermanentAddressBtn, permanentAddressData);
    if (permanentAddressField) permanentAddressField.value = permanentAddressData ? formatAddressSummary(permanentAddressData) : '';
    if (!skipSync) {
      scheduleSync('address');
      updateProgress();
    }
  }

  function setPresentAddress(data, skipSync) {
    presentAddressData = hasAddressContent(data) ? data : null;
    renderAddressSummary(presentAddressSummary, addPresentAddressBtn, presentAddressData);
    if (presentAddressField) presentAddressField.value = presentAddressData ? formatAddressSummary(presentAddressData) : '';
    if (!skipSync) {
      scheduleSync('present_address');
      updateProgress();
    }
  }

  function getPermanentAddressData() {
    return permanentAddressData || {};
  }

  function getPresentAddressData() {
    return presentAddressData || {};
  }

  function updatePresentAddressState() {
    if (!sameAsPermanentCheckbox) return;
    var isSame = sameAsPermanentCheckbox.checked;
    if (presentAddressSection) presentAddressSection.style.opacity = isSame ? '0.5' : '1';
    if (addPresentAddressBtn) addPresentAddressBtn.disabled = isSame;
    if (isSame) setPresentAddress(permanentAddressData);
  }

  if (sameAsPermanentCheckbox) {
    sameAsPermanentCheckbox.addEventListener('change', updatePresentAddressState);
  }

  function openAddressModal(target) {
    if (!addressModal) return;
    addressModalTarget = target;
    var data = target === 'permanent' ? permanentAddressData : presentAddressData;
    if (addressModalTitle) addressModalTitle.textContent = target === 'permanent' ? 'Permanent Address' : 'Current Address';
    if (addressModalLine) addressModalLine.value = (data && data.address) || '';
    if (addressModalCity) addressModalCity.value = (data && data.city) || '';
    if (addressModalCountry) addressModalCountry.value = (data && data.country) || '';
    if (addressModalPincode) addressModalPincode.value = (data && data.pincode) || '';
    if (addressModalError) addressModalError.hidden = true;
    addressModalRequiredMarks.forEach(function (mark) { mark.hidden = target !== 'permanent'; });
    addressModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (addressModalLine) addressModalLine.focus();
  }

  function closeAddressModal() {
    if (!addressModal) return;
    addressModal.hidden = true;
    document.body.style.overflow = '';
    addressModalTarget = null;
  }

  function saveAddressFromModal() {
    var line = addressModalLine ? addressModalLine.value.trim() : '';
    var city = addressModalCity ? addressModalCity.value.trim() : '';
    var country = addressModalCountry ? addressModalCountry.value.trim() : '';
    var pincode = addressModalPincode ? addressModalPincode.value.trim() : '';

    if (addressModalTarget === 'permanent' && (!line || !city || !country || !pincode)) {
      if (addressModalError) {
        addressModalError.textContent = 'Please fill in all address fields.';
        addressModalError.hidden = false;
      }
      return;
    }

    var data = { address: line, city: city, country: country, pincode: pincode };

    if (addressModalTarget === 'permanent') {
      setPermanentAddress(data);
      if (sameAsPermanentCheckbox && sameAsPermanentCheckbox.checked) setPresentAddress(data);
    } else {
      setPresentAddress(data);
    }
    closeAddressModal();
  }

  if (addPermanentAddressBtn) {
    addPermanentAddressBtn.addEventListener('click', function () { openAddressModal('permanent'); });
  }
  if (addPresentAddressBtn) {
    addPresentAddressBtn.addEventListener('click', function () { openAddressModal('present'); });
  }
  if (addressModalBackdrop) {
    addressModalBackdrop.addEventListener('click', closeAddressModal);
  }
  if (addressModalClose) {
    addressModalClose.addEventListener('click', closeAddressModal);
  }
  if (addressModalCancel) {
    addressModalCancel.addEventListener('click', closeAddressModal);
  }
  if (addressModalSave) {
    addressModalSave.addEventListener('click', saveAddressFromModal);
  }

  // Children info handling (modal-based)
  var childrenChips = document.querySelector('#childrenChips');
  var addChildBtn = document.querySelector('#addChildBtn');
  var childModal = document.querySelector('#child-modal');
  var childModalBackdrop = document.querySelector('#child-modal-backdrop');
  var childModalClose = document.querySelector('#child-modal-close');
  var childModalCancel = document.querySelector('#child-modal-cancel');
  var childModalSave = document.querySelector('#child-modal-save');
  var childModalName = document.querySelector('#childModalName');
  var childModalDob = document.querySelector('#childModalDob');
  var childModalError = document.querySelector('#childModalError');
  var MAX_CHILDREN = 10;
  var childrenData = []; // Array of { name, dob }

  function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function updateAddChildBtnState() {
    if (addChildBtn) {
      addChildBtn.disabled = childrenData.length >= MAX_CHILDREN;
    }
  }

  function getChildrenData() {
    return childrenData.slice(); // Return a copy
  }

  function renderChildrenChips() {
    if (!childrenChips) return;
    childrenChips.innerHTML = '';
    childrenData.forEach(function (child, index) {
      var chip = document.createElement('div');
      chip.className = 'child-chip';
      chip.innerHTML =
        '<div class="child-chip-info">' +
          '<span class="child-chip-name">' + escapeHtml(child.name) + '</span>' +
          '<span class="child-chip-dob">' + formatDateForDisplay(child.dob) + '</span>' +
        '</div>' +
        '<button type="button" class="child-chip-remove" aria-label="Remove child" data-index="' + index + '">×</button>';
      childrenChips.appendChild(chip);

      var removeBtn = chip.querySelector('.child-chip-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', function () {
          removeChild(index);
        });
      }
    });
    updateAddChildBtnState();
  }

  function addChild(name, dob, skipSync) {
    if (childrenData.length >= MAX_CHILDREN) return;
    childrenData.push({ name: name, dob: dob });
    renderChildrenChips();
    if (!skipSync) {
      syncChildrenToBackend();
    }
  }

  function removeChild(index) {
    childrenData.splice(index, 1);
    renderChildrenChips();
    syncChildrenToBackend();
  }

  function syncChildrenToBackend() {
    markFieldChanged('childs_info');
  }

  function openChildModal() {
    if (!childModal) return;
    if (childModalName) childModalName.value = '';
    if (childModalDob) childModalDob.value = '';
    if (childModalError) childModalError.hidden = true;
    childModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (childModalName) childModalName.focus();
  }

  function closeChildModal() {
    if (!childModal) return;
    childModal.hidden = true;
    document.body.style.overflow = '';
  }

  function saveChildFromModal() {
    var name = childModalName ? childModalName.value.trim() : '';
    var dob = childModalDob ? childModalDob.value : '';

    // Validate
    if (!name) {
      if (childModalError) {
        childModalError.textContent = "Please enter the child's name.";
        childModalError.hidden = false;
      }
      return;
    }
    if (!dob) {
      if (childModalError) {
        childModalError.textContent = 'Please enter the date of birth.';
        childModalError.hidden = false;
      }
      return;
    }

    var dobDate = new Date(dob);
    if (dobDate >= new Date()) {
      if (childModalError) {
        childModalError.textContent = 'Date of birth must be in the past.';
        childModalError.hidden = false;
      }
      return;
    }

    addChild(name, dob);
    closeChildModal();
  }

  if (addChildBtn) {
    addChildBtn.addEventListener('click', openChildModal);
  }
  if (childModalBackdrop) {
    childModalBackdrop.addEventListener('click', closeChildModal);
  }
  if (childModalClose) {
    childModalClose.addEventListener('click', closeChildModal);
  }
  if (childModalCancel) {
    childModalCancel.addEventListener('click', closeChildModal);
  }
  if (childModalSave) {
    childModalSave.addEventListener('click', saveChildFromModal);
  }
  if (childModalName) {
    childModalName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (childModalDob) childModalDob.focus();
      }
    });
  }
  if (childModalDob) {
    childModalDob.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveChildFromModal();
      }
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && childModal && !childModal.hidden) closeChildModal();
    if (e.key === 'Escape' && orgModal && !orgModal.hidden) closeOrgModal();
  });

  // Organizations handling (modal-based)
  var orgsChips = document.querySelector('#orgsChips');
  var addOrgBtn = document.querySelector('#addOrgBtn');
  var orgModal = document.querySelector('#org-modal');
  var orgModalBackdrop = document.querySelector('#org-modal-backdrop');
  var orgModalClose = document.querySelector('#org-modal-close');
  var orgModalCancel = document.querySelector('#org-modal-cancel');
  var orgModalSave = document.querySelector('#org-modal-save');
  var orgModalName = document.querySelector('#orgModalName');
  var orgModalDuration = document.querySelector('#orgModalDuration');
  var orgModalRole = document.querySelector('#orgModalRole');
  var orgModalInfo = document.querySelector('#orgModalInfo');
  var orgModalCurrent = document.querySelector('#orgModalCurrent');
  var orgModalError = document.querySelector('#orgModalError');
  var orgsData = []; // Array of { name, duration, role, info, current }

  function getOrgsData() {
    return orgsData.slice();
  }

  function renderOrgsChips() {
    if (!orgsChips) return;
    orgsChips.innerHTML = '';
    orgsData.forEach(function (org, index) {
      var chip = document.createElement('div');
      chip.className = 'org-chip';
      var roleHtml = org.role ? '<span class="org-chip-role">' + escapeHtml(org.role) + '</span>' : '';
      var currentBadge = org.current ? '<span class="org-chip-current">Current</span>' : '';
      chip.innerHTML =
        '<div class="org-chip-info">' +
          '<span class="org-chip-name">' + escapeHtml(org.name) + currentBadge + '</span>' +
          '<span class="org-chip-duration">' + escapeHtml(org.duration) + '</span>' +
          roleHtml +
        '</div>' +
        '<button type="button" class="child-chip-remove" aria-label="Remove organization" data-index="' + index + '">×</button>';
      orgsChips.appendChild(chip);

      var removeBtn = chip.querySelector('.child-chip-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', function () {
          removeOrg(index);
        });
      }
    });
  }

  function addOrg(name, duration, role, info, current, skipSync) {
    orgsData.push({ name: name, duration: duration, role: role || '', info: info || '', current: !!current });
    renderOrgsChips();
    if (!skipSync) {
      syncOrgsToBackend();
    }
  }

  function removeOrg(index) {
    orgsData.splice(index, 1);
    renderOrgsChips();
    syncOrgsToBackend();
  }

  function syncOrgsToBackend() {
    markFieldChanged('orgs');
  }

  function openOrgModal() {
    if (!orgModal) return;
    if (orgModalName) orgModalName.value = '';
    if (orgModalDuration) orgModalDuration.value = '';
    if (orgModalRole) orgModalRole.value = '';
    if (orgModalInfo) orgModalInfo.value = '';
    if (orgModalCurrent) orgModalCurrent.checked = false;
    if (orgModalError) orgModalError.hidden = true;
    orgModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (orgModalName) orgModalName.focus();
  }

  function closeOrgModal() {
    if (!orgModal) return;
    orgModal.hidden = true;
    document.body.style.overflow = '';
  }

  function saveOrgFromModal() {
    var name = orgModalName ? orgModalName.value.trim() : '';
    var duration = orgModalDuration ? orgModalDuration.value.trim() : '';
    var role = orgModalRole ? orgModalRole.value.trim() : '';
    var info = orgModalInfo ? orgModalInfo.value.trim() : '';
    var current = orgModalCurrent ? orgModalCurrent.checked : false;

    if (!name) {
      if (orgModalError) {
        orgModalError.textContent = 'Please enter the organization name.';
        orgModalError.hidden = false;
      }
      return;
    }
    if (!duration) {
      if (orgModalError) {
        orgModalError.textContent = 'Please enter the duration.';
        orgModalError.hidden = false;
      }
      return;
    }

    addOrg(name, duration, role, info, current);
    closeOrgModal();
  }

  if (addOrgBtn) {
    addOrgBtn.addEventListener('click', openOrgModal);
  }
  if (orgModalBackdrop) {
    orgModalBackdrop.addEventListener('click', closeOrgModal);
  }
  if (orgModalClose) {
    orgModalClose.addEventListener('click', closeOrgModal);
  }
  if (orgModalCancel) {
    orgModalCancel.addEventListener('click', closeOrgModal);
  }
  if (orgModalSave) {
    orgModalSave.addEventListener('click', saveOrgFromModal);
  }

  Array.prototype.forEach.call(form.querySelectorAll('input[type="file"][data-doc-type]'), function (input) {
    input.addEventListener('change', function () { uploadDocument(input); });

    var els = getUploadEls(input);
    if (els && els.thumb) {
      els.thumb.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPreviewModal(input);
      });
    }
    if (els && els.removeBtn) {
      els.removeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        removeDocument(input);
      });
    }
  });

  saveBtn.addEventListener('click', function () {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (!(value instanceof File)) data[key] = value;
    });
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data));

    if (hasChangedFields()) {
      runSync();
      return;
    }

    var originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saved ✓';
    setTimeout(function () { saveBtn.textContent = originalText; }, 1400);
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitOnboarding();
  });

  var saved = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
  Object.keys(saved).forEach(function (key) {
    var field = form.elements[key];
    if (field && field.type !== 'file') field.value = saved[key];
  });
  var savedStep = parseInt(localStorage.getItem(STEP_STORAGE_KEY), 10);
  showStep(isNaN(savedStep) ? 0 : savedStep);
  loadProgressData();
  } // end initWizard

  runVerification();
})();
