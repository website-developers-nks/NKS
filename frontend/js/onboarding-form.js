(function () {
  'use strict';

  var API_BASE = ""
  var VERIFY_ENDPOINT = API_BASE+'/api/onboarding/verify';
  var PROGRESS_DATA_ENDPOINT = API_BASE+'/api/onboarding/progress-data';
  var SUBMIT_ENDPOINT = API_BASE+'/api/onboarding/submit-data';
  var DOC_UPLOAD_ENDPOINT = API_BASE+'/api/docs/upload';
  var DOC_REMOVE_ENDPOINT = API_BASE+'/api/docs/remove_doc';
  var DOC_PRESIGN_ENDPOINT = API_BASE+'/api/docs/presign';
  // Preview mode is for admins only, and this is what proves it.
  var ADMIN_AUTH_ENDPOINT = API_BASE+'/api/admin/auth';
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

  var previewMode = getParam('preview') === '1';
  var PREVIEW_STORAGE_KEY = 'nk-onboarding-form-preview';

  var invalidLinkPanel = document.querySelector('#invalid-link-panel');
  var verifyLoadingPanel = document.querySelector('#verify-loading-panel');
  var verifyFailedPanel = document.querySelector('#verify-failed-panel');
  var verifyCompletedPanel = document.querySelector('#verify-completed-panel');
  var verifyExpiredPanel = document.querySelector('#verify-expired-panel');
  var verifyErrorPanel = document.querySelector('#verify-error-panel');
  var onboardingShell = document.querySelector('#onboarding-shell');
  var previewDeniedPanel = document.querySelector('#preview-denied-panel');

  var statePanels = [invalidLinkPanel, previewDeniedPanel, verifyLoadingPanel, verifyFailedPanel, verifyCompletedPanel, verifyExpiredPanel, verifyErrorPanel, onboardingShell].filter(Boolean);

  function showStatePanel(target) {
    statePanels.forEach(function (panel) { panel.hidden = panel !== target; });
  }

  if (!onboardingKey && !previewMode) {
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
    preferred_dob: 'Preferred date of birth',
    nationality: 'Nationality',
    gender: 'Gender',
    marital_status: 'Marital status',
    blood_group: 'Blood group',
    emergency_contact_name: 'Emergency contact name and relationship',
    emergency_contact_number: 'Emergency contact number',
    passport_number: 'Identity number (Aadhar/Passport)',
    pan_number: 'PAN Card Number',
    passport_no: 'Passport Number',
    uan_number: 'UAN Number',
    passport_doc: 'Passport',
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
    intro_line: 'Short intro',
    birthday_pref: 'Birthday celebration preference',
    meal_preference: 'Meal preference',
    hobbies: 'Hobbies',
    fun_fact: 'Fun fact',
    declaration: 'Declaration',
    consent: 'Consent',
    experience_rating: 'Experience rating',
    experience_feedback: 'Feedback'
  };

  var currentLocation = 'gurugram';

  function updateLocationVisibility(location) {
    currentLocation = location;
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
    updatePayrollLedgerRequirement(location);
  }

  // Payroll Ledger (bank details) is only mandatory for India locations -
  // IFSC in particular is an Indian bank code and doesn't apply in Dubai.
  // The section stays visible for Dubai so employees can still fill it in
  // voluntarily, it just isn't required to submit.
  var PAYROLL_LEDGER_FIELD_NAMES = ['bank_name', 'account_holder', 'account_number', 'ifsc', 'bank_doc'];

  function updatePayrollLedgerRequirement(location) {
    var required = location !== 'dubai';
    PAYROLL_LEDGER_FIELD_NAMES.forEach(function (name) {
      var field = form.elements[name];
      var el = field instanceof RadioNodeList ? field[0] : field;
      if (!el) return;

      if (required) {
        el.setAttribute('data-required', 'true');
      } else {
        el.removeAttribute('data-required');
      }

      var label = el.closest('label');
      var mark = label ? label.querySelector('.required-mark') : null;
      if (mark) mark.hidden = !required;
    });
    updateProgress();
  }

  var DOC_BASIS_LABELS = {
    first_name: { dubai: 'First name (As per Passport)', default: 'First name (As per Aadhar)' },
    last_name: { dubai: 'Last name (As per Passport)', default: 'Last name (As per Aadhar)' },
    dob: { dubai: 'Date of birth (As per Passport)', default: 'Date of birth (As per Aadhar)' },
    identity_number: { dubai: 'Passport Number', default: 'Aadhar Number' },
    id_proof_type: { dubai: 'Passport', default: 'Aadhar' }
  };

  function updateDocBasisLabels(location) {
    var basis = location === 'dubai' ? 'dubai' : 'default';
    Object.keys(DOC_BASIS_LABELS).forEach(function (field) {
      Array.prototype.forEach.call(
        document.querySelectorAll('[data-doc-basis-label="' + field + '"]'),
        function (el) { el.textContent = DOC_BASIS_LABELS[field][basis]; },
      );
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
    if (hasValidationErrors()) return 'Please fix the highlighted fields';
    if (hasErroredFields()) return 'Please fix the fields with errors';
    if (hasChangedFields()) return 'Please wait for changes to be saved';
    return '';
  }

  // Update submit button state based on unsaved/errored changes
  function updateSubmitButtonState() {
    if (sessionExpired || submitInProgress) return;
    var shouldDisable = hasChangedFields() || hasErroredFields() || hasValidationErrors() || syncInProgress;
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

  // full_name is a hidden input fed by the First/Last name boxes, so its
  // unsaved/error outline has to be drawn on those two instead.
  function getFieldHighlightTargets(field) {
    if (!(field instanceof RadioNodeList) && field.type === 'hidden' && field.name === 'full_name') {
      return [document.getElementById('first_name'), document.getElementById('last_name')]
        .filter(Boolean);
    }
    var target = getFieldHighlightTarget(field);
    return target ? [target] : [];
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
    getFieldHighlightTargets(field).forEach(function (target) {
      target.classList.toggle('field-unsaved', !!isUnsaved);
    });
    updateSidebarStatus();
  }

  function setFieldSyncError(field, message) {
    var targets = getFieldHighlightTargets(field);
    var messageEl = ensureFieldSyncMessageEl(field);

    if (message) {
      targets.forEach(function (target) {
        target.classList.remove('field-unsaved');
        target.classList.add('field-sync-error');
      });
      if (messageEl) messageEl.textContent = message;
    } else {
      targets.forEach(function (target) { target.classList.remove('field-sync-error'); });
      if (messageEl) messageEl.textContent = '';
    }
    updateSidebarStatus();
  }

  function markFieldChanged(name) {
    if (!name || sessionExpired || previewMode) return;

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

  var MIN_EMPLOYEE_AGE = 15;  
  var MAX_EMPLOYEE_AGE = 100;
  var MIN_PARENT_GAP = 15;     
  var MAX_PARENT_AGE = 120;
  var MIN_SPOUSE_AGE = 18;
  var MIN_INTRO_LENGTH = 20;

  var NAME_RE = /^[A-Za-z][A-Za-z .'-]*$/;
  var CONTACT_NAME_RE = /^[A-Za-z][A-Za-z .,'()/-]*$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
  var PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  var IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  var AADHAR_RE = /^[2-9][0-9]{11}$/;
  var PASSPORT_RE = /^[A-Za-z0-9]{6,12}$/;
  var BANK_NAME_RE = /^[A-Za-z][A-Za-z0-9 .,'&-]*$/;

  var validationErrors = {}; // { fieldName: message }


  function parseDateValue(value) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!parts) return null;
    var year = +parts[1], month = +parts[2] - 1, day = +parts[3];
    var date = new Date(Date.UTC(year, month, day));
    if (isNaN(date.getTime())) return null;
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    return date;
  }

  function todayUTC() {
    var now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  function toISODate(date) {
    return date.toISOString().slice(0, 10);
  }

  function shiftYears(date, years) {
    return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
  }

  function yearsBetween(from, to) {
    var years = to.getUTCFullYear() - from.getUTCFullYear();
    if (shiftYears(from, years).getTime() > to.getTime()) years -= 1;
    return years;
  }

  
  function checkDateOfBirth(value, minAge, maxAge, subject) {
    var date = parseDateValue(value);
    if (!date) return 'Please enter a valid date.';

    var today = todayUTC();
    if (date.getTime() > today.getTime()) return 'Date of birth cannot be in the future.';

    var age = yearsBetween(date, today);
    if (age < minAge) return subject + ' must be at least ' + minAge + ' years old.';
    if (age > maxAge) return 'Please check this date - it works out to an age over ' + maxAge + '.';
    return '';
  }

  function checkParentDob(value, subject) {
    var message = checkDateOfBirth(value, MIN_PARENT_GAP, MAX_PARENT_AGE, subject);
    if (message) return message;

    var ownDob = validOwnDob();
    if (!ownDob) return '';

    var parentDob = parseDateValue(value);
    if (yearsBetween(parentDob, ownDob) < MIN_PARENT_GAP) {
      return subject + ' must be at least ' + MIN_PARENT_GAP + ' years older than you.';
    }
    return '';
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[\s()\-.]/g, '');
  }

  function checkPhone(value) {
    var cleaned = normalizePhone(value);
    if (!/^\+?\d+$/.test(cleaned)) return 'Use digits only, optionally starting with +.';

    var digits = cleaned.replace(/^\+/, '').replace(/^0+/, '');
    if (digits.length < 10 || digits.length > 15) return 'Enter a valid phone number (10-15 digits).';

    var local = digits.length === 12 && digits.indexOf('91') === 0 ? digits.slice(2) : digits;
    if (local.length === 10 && !/^[6-9]/.test(local)) return 'Enter a valid 10-digit mobile number.';
    return '';
  }

  function phoneIdentity(value) {
    var digits = normalizePhone(value).replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  function isDubai() {
    return currentLocation === 'dubai';
  }

  var FIELD_VALIDATORS = {
    full_name: function (value) {
      return NAME_RE.test(value) ? '' : 'Name can only contain letters, spaces, apostrophes, dots and hyphens.';
    },
    preferred_name: function (value) {
      return NAME_RE.test(value) ? '' : 'Use letters only.';
    },
    email: function (value) {
      return EMAIL_RE.test(value) ? '' : 'Enter a valid email address, e.g. name@email.com.';
    },
    mobile: checkPhone,
    emergency_contact_number: function (value) {
      var message = checkPhone(value);
      if (message) return message;
      var mobile = fieldValue('mobile');
      if (mobile && phoneIdentity(mobile) && phoneIdentity(mobile) === phoneIdentity(value)) {
        return 'Emergency contact should be different from your own mobile number.';
      }
      return '';
    },
    dob: function (value) {
      return checkDateOfBirth(value, MIN_EMPLOYEE_AGE, MAX_EMPLOYEE_AGE, 'You');
    },
    preferred_dob: function (value) {
      if (value === fieldValue('dob')) return 'Leave this blank if it matches your actual date of birth.';
      return checkDateOfBirth(value, MIN_EMPLOYEE_AGE, MAX_EMPLOYEE_AGE, 'You');
    },
    fathers_dob: function (value) {
      return checkParentDob(value, 'Your father');
    },
    mothers_dob: function (value) {
      return checkParentDob(value, 'Your mother');
    },
    
    spouse_name: function (value) {
      var marital = fieldValue('marital_status');
      if (!value) return marital === 'married' ? 'Please add your spouse\u2019s name.' : '';
      if (marital === 'unmarried') return 'You selected Unmarried - clear this or update your marital status.';
      return NAME_RE.test(value) ? '' : 'Name can only contain letters, spaces, apostrophes, dots and hyphens.';
    },
    spouse_dob: function (value) {
      var marital = fieldValue('marital_status');
      if (!value) return marital === 'married' ? 'Please add your spouse\u2019s date of birth.' : '';
      if (marital === 'unmarried') return 'You selected Unmarried - clear this or update your marital status.';
      return checkDateOfBirth(value, MIN_SPOUSE_AGE, MAX_EMPLOYEE_AGE, 'Your spouse');
    },
    nationality: function (value) {
      return NAME_RE.test(value) ? '' : 'Enter a valid nationality, e.g. Indian.';
    },
    fathers_name: function (value) {
      return NAME_RE.test(value) ? '' : 'Name can only contain letters, spaces, apostrophes, dots and hyphens.';
    },
    mothers_name: function (value) {
      return NAME_RE.test(value) ? '' : 'Name can only contain letters, spaces, apostrophes, dots and hyphens.';
    },
    emergency_contact_name: function (value) {
      if (!CONTACT_NAME_RE.test(value)) return 'Use letters only, e.g. Rekha Rao (Mother).';
      return value.length >= 3 ? '' : 'Enter the contact name and their relationship to you.';
    },
    passport_number: function (value) {
      if (isDubai()) {
        return PASSPORT_RE.test(value) ? '' : 'Enter a valid passport number (6-12 letters or digits).';
      }
      return AADHAR_RE.test(value.replace(/\s/g, '')) ? '' : 'Enter a valid 12-digit Aadhar number.';
    },
    passport_no: function (value) {
      return PASSPORT_RE.test(value) ? '' : 'Enter a valid passport number (6-12 letters or digits).';
    },
    pan_number: function (value) {
      if (/^NA$/i.test(value)) return '';
      return PAN_RE.test(value.toUpperCase()) ? '' : 'Enter a valid PAN, e.g. ABCDE1234F (or NA if you do not have one).';
    },
    uan_number: function (value) {
      if (/^NA$/i.test(value)) return '';
      return /^\d{12}$/.test(value.replace(/\s/g, '')) ? '' : 'Enter a valid 12-digit UAN (or NA if you do not have one).';
    },
    bank_name: function (value) {
      return BANK_NAME_RE.test(value) ? '' : 'Enter a valid bank name.';
    },
    account_holder: function (value) {
      return NAME_RE.test(value) ? '' : 'Name can only contain letters, spaces, apostrophes, dots and hyphens.';
    },
    account_number: function (value) {
      var cleaned = value.replace(/\s/g, '');
      if (isDubai()) {
        return /^[A-Za-z0-9]{8,34}$/.test(cleaned) ? '' : 'Enter a valid account number.';
      }
      return /^\d{9,18}$/.test(cleaned) ? '' : 'Enter a valid account number (9-18 digits).';
    },
    intro_line: function (value) {
      return value.length >= MIN_INTRO_LENGTH
        ? ''
        : 'Please write at least a sentence (' + MIN_INTRO_LENGTH + '+ characters) - this one is shared with the whole team.';
    },
    ifsc: function (value) {
      if (isDubai()) return ''; 
      return IFSC_RE.test(value.toUpperCase()) ? '' : 'Enter a valid IFSC code, e.g. HDFC0001234.';
    }
  };

  
  function validOwnDob() {
    var value = fieldValue('dob');
    if (!value || FIELD_VALIDATORS.dob(value)) return null;
    return parseDateValue(value);
  }

  var VALIDATE_WHILE_TYPING = { dob: true, preferred_dob: true, fathers_dob: true, mothers_dob: true, spouse_dob: true };

  var VALIDATE_WHEN_EMPTY = { spouse_name: true, spouse_dob: true };

  var VALIDATION_DEPENDENTS = {
    dob: ['preferred_dob', 'fathers_dob', 'mothers_dob', 'spouse_dob', 'childs_info'],
    mobile: ['emergency_contact_number'],
    marital_status: ['spouse_name', 'spouse_dob', 'insurance_coverage'],
    spouse_name: ['insurance_coverage'],
    spouse_dob: ['insurance_coverage']
  };

  function fieldValue(name) {
    var field = form.elements[name];
    if (!field) return '';
    return typeof field.value === 'string' ? field.value.trim() : '';
  }

  function hasValidationErrors() {
    return Object.keys(validationErrors).length > 0;
  }

  function setValidationError(name, message, silent) {
    if (message) validationErrors[name] = message;
    else delete validationErrors[name];

    if (name === 'childs_info') {
      if (childrenError) {
        childrenError.textContent = message || '';
        childrenError.hidden = !message;
      }
      updateSubmitButtonState();
      return;
    }

    var field = form.elements[name];
    if (field && (!message || !silent)) setFieldSyncError(field, message || null);
    updateSubmitButtonState();
  }

  function validateFieldByName(name, silent) {
    if (name === 'childs_info') return validateChildren();
    if (name === 'insurance_coverage') return validateInsurance();

    var validator = FIELD_VALIDATORS[name];
    if (!validator) return true;

    var field = form.elements[name];
    if (!field || field instanceof RadioNodeList) return true;

    var value = String(field.value || '').trim();
    var checkable = isFieldVisible(field) && (value || VALIDATE_WHEN_EMPTY[name]);
    var message = checkable ? validator(value) : '';
    setValidationError(name, message, silent);
    return !message;
  }

  function revalidateDependents(name) {
    var dependents = VALIDATION_DEPENDENTS[name];
    if (!dependents) return;

    if (name === 'dob') applyDateBounds();
    if (name === 'marital_status') updateSpouseRequirement();
    dependents.forEach(function (dependent) { validateFieldByName(dependent); });
  }

  function validateAllFields() {
    updateSpouseRequirement();
    Object.keys(FIELD_VALIDATORS).forEach(function (name) { validateFieldByName(name); });
    validateChildren();
    validateInsurance();
    applyDateBounds();
  }

  var SPOUSE_FIELD_NAMES = ['spouse_name', 'spouse_dob'];

  function updateSpouseRequirement() {
    var required = fieldValue('marital_status') === 'married';
    SPOUSE_FIELD_NAMES.forEach(function (name) {
      var field = form.elements[name];
      if (!field || field instanceof RadioNodeList) return;

      if (required) field.setAttribute('data-required', 'true');
      else field.removeAttribute('data-required');

      var label = field.closest('label');
      var mark = label ? label.querySelector('.required-mark') : null;
      if (mark) mark.hidden = !required;
    });
    updateProgress();
  }

  var INSURANCE_FAMILY_PLAN = 'employee_spouse_kids';
  var INSURANCE_PLAN_CHILDREN = 2;

  function validateInsurance() {
    var plan = fieldValue('insurance_coverage');
    var childCount = Array.isArray(childrenData) ? childrenData.length : 0;
    var hasSpouse = fieldValue('marital_status') === 'married' || !!fieldValue('spouse_name');

    var message = plan === INSURANCE_FAMILY_PLAN && !hasSpouse && !childCount
      ? 'This plan covers a spouse and children, but neither is on your form. Add them, or pick the parents plan.'
      : '';
    setValidationError('insurance_coverage', message);

    if (insuranceNote) {
      var note = !message && plan === INSURANCE_FAMILY_PLAN && childCount > INSURANCE_PLAN_CHILDREN
        ? 'This plan covers ' + INSURANCE_PLAN_CHILDREN + ' children and you have added ' + childCount + '. HR will confirm the cover for the others.'
        : '';
      insuranceNote.textContent = note;
      insuranceNote.hidden = !note;
    }
    return !message;
  }

  function checkChildDob(value) {
    var date = parseDateValue(value);
    if (!date) return 'Please enter a valid date of birth.';

    var today = todayUTC();
    if (date.getTime() > today.getTime()) return 'Date of birth must be in the past.';

    var ownDob = validOwnDob();
    if (ownDob && yearsBetween(ownDob, date) < MIN_PARENT_GAP) {
      return 'A child’s date of birth must be at least ' + MIN_PARENT_GAP + ' years after your own.';
    }
    return '';
  }

  function validateChildren() {
    if (!Array.isArray(childrenData) || !childrenData.length) {
      setValidationError('childs_info', '');
      return true;
    }

    var message = '';
    childrenData.some(function (child) {
      var childMessage = checkChildDob(child && child.dob);
      if (!childMessage) return false;
      message = ((child && child.name) || 'This child') + ': ' + childMessage.charAt(0).toLowerCase() + childMessage.slice(1);
      return true;
    });

    setValidationError('childs_info', message);
    return !message;
  }

  function checkOrgDuration(duration) {
    var years = (String(duration).match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
    if (!years.length) return '';

    var thisYear = todayUTC().getUTCFullYear();
    if (years.some(function (year) { return year > thisYear; })) return 'Duration cannot include a future year.';

    var ownDob = validOwnDob();
    if (ownDob && years.some(function (year) { return year < ownDob.getUTCFullYear() + MIN_EMPLOYEE_AGE; })) {
      return 'Duration starts before you turned ' + MIN_EMPLOYEE_AGE + '. Please check the years.';
    }
    if (years.length > 1 && years[years.length - 1] < years[0]) return 'The end year cannot be before the start year.';
    return '';
  }

  function setDateBounds(name, min, max) {
    var field = form.elements[name];
    if (!field || field instanceof RadioNodeList) return;
    if (min) field.min = min; else field.removeAttribute('min');
    if (max) field.max = max; else field.removeAttribute('max');
  }

  function applyDateBounds() {
    var today = todayUTC();
    var selfMin = toISODate(shiftYears(today, -MAX_EMPLOYEE_AGE));
    var selfMax = toISODate(shiftYears(today, -MIN_EMPLOYEE_AGE));

    setDateBounds('dob', selfMin, selfMax);
    setDateBounds('preferred_dob', selfMin, selfMax);
    setDateBounds('spouse_dob', selfMin, toISODate(shiftYears(today, -MIN_SPOUSE_AGE)));

    var ownDob = validOwnDob();
    var parentMin = toISODate(shiftYears(today, -MAX_PARENT_AGE));
    var parentMax = ownDob ? toISODate(shiftYears(ownDob, -MIN_PARENT_GAP)) : selfMax;
    setDateBounds('fathers_dob', parentMin, parentMax);
    setDateBounds('mothers_dob', parentMin, parentMax);

    if (childModalDob) {
      childModalDob.max = toISODate(today);
      if (ownDob) childModalDob.min = toISODate(shiftYears(ownDob, MIN_PARENT_GAP));
      else childModalDob.removeAttribute('min');
    }
  }

  applyDateBounds();

  function scheduleSync(fieldName, phase) {
    var silent = phase === 'input' && !VALIDATE_WHILE_TYPING[fieldName];
    var valid = validateFieldByName(fieldName, silent);
    revalidateDependents(fieldName);

    if (!valid) {
      if (changedFields[fieldName]) {
        delete changedFields[fieldName];
        var field = form.elements[fieldName];
        if (field) setFieldUnsaved(field, false);
      }
      updateSubmitButtonState();
      return;
    }

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
    if (name === 'orgs' || name.indexOf(ORG_LETTER_DOC_PREFIX) === 0) {
      var orgId = name === 'orgs' ? null : name.slice(ORG_LETTER_DOC_PREFIX.length);
      var index = orgsData.findIndex(function (org) { return org.orgId === orgId; });
      var chips = orgsChips ? orgsChips.querySelectorAll('.org-chip') : [];
      var chip = index >= 0 ? chips[index] : chips[0];
      if (chip) chip.classList.add('is-error');
      return orgsChips;
    }

    var field = form.elements[name];
    if (!field) return null;
    if (field.type === 'file') {
      setUploadStatus(field, 'This document is required.', 'error');
    } else {
      setFieldSyncError(field, 'This field is required.');
    }
    return field instanceof RadioNodeList ? field[0] : field;
  }

  function showInvalidFieldsMessage() {
    var names = Object.keys(validationErrors);
    names.forEach(function (name) { setValidationError(name, validationErrors[name]); });

    var first = names.map(function (name) {
      if (name === 'childs_info') return childrenChips;
      var field = form.elements[name];
      return field instanceof RadioNodeList ? field[0] : field;
    }).filter(Boolean)[0];

    if (first) {
      var panel = first.closest('.step-panel');
      if (panel) showStep(parseInt(panel.dataset.panel, 10));
    }
    showSubmitMessage('Please fix the ' + names.length + ' highlighted field(s) before submitting.', 'error');
  }

  function submitOnboarding() {
    if (sessionExpired || submitInProgress) return;

    if (previewMode) {
      showSubmitMessage('This is a preview - nothing is submitted from here.', 'error');
      return;
    }

    if (hasValidationErrors()) {
      showInvalidFieldsMessage();
      return;
    }

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

  function renderMoreInfoFields(defs, values, docs) {
    var section = document.getElementById('more-info-section');
    var grid = document.getElementById('more-info-fields');
    if (!section || !grid) return;

    if (!defs || !defs.length) {
      section.hidden = true;
      return;
    }

    grid.innerHTML = '';

    defs.forEach(function (def) {
      var name = 'extra_' + def.key;
      var value = values ? values[name] : undefined;

      var label = document.createElement('label');
      if (def.type === 'checkbox') label.className = 'consent-row';

      var caption = document.createElement('span');
      caption.textContent = def.label;
      if (def.required) {
        var mark = document.createElement('span');
        mark.className = 'required-mark';
        mark.textContent = ' *';
        caption.appendChild(mark);
      }

      if (def.type === 'document') {
        label.className = 'upload-card';

        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = name;
        fileInput.dataset.docType = name;
        fileInput.accept = 'image/*,application/pdf';
        if (def.required) fileInput.dataset.required = 'true';

        var preview = document.createElement('div');
        preview.className = 'upload-preview';
        preview.hidden = true;
        var thumb = document.createElement('div');
        thumb.className = 'upload-preview-thumb';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'upload-remove-btn';
        removeBtn.setAttribute('aria-label', 'Remove file');
        removeBtn.hidden = true;
        removeBtn.innerHTML = '&#10005;';
        preview.appendChild(thumb);
        preview.appendChild(removeBtn);

        var status = document.createElement('span');
        status.className = 'upload-status';
        status.setAttribute('aria-live', 'polite');

        label.appendChild(caption);
        label.appendChild(fileInput);
        label.appendChild(preview);
        label.appendChild(status);

        if (def.help) {
          var docHelp = document.createElement('span');
          docHelp.className = 'field-help';
          docHelp.textContent = def.help;
          label.appendChild(docHelp);
        }

        grid.appendChild(label);
        bindUploadInput(fileInput);

        var uploaded = docs && docs[name];
        if (uploaded && uploaded.name) restoreUploadedDoc(fileInput, uploaded.name, uploaded.id);
        return;
      }

      var input;
      switch (def.type) {
        case 'textarea':
          input = document.createElement('textarea');
          if (def.maxLength) input.maxLength = def.maxLength;
          break;
        case 'select':
          input = document.createElement('select');
          var blank = document.createElement('option');
          blank.value = '';
          blank.textContent = 'Select';
          input.appendChild(blank);
          (def.options || []).forEach(function (option) {
            var opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            input.appendChild(opt);
          });
          break;
        case 'checkbox':
          input = document.createElement('input');
          input.type = 'checkbox';
          break;
        case 'number':
          input = document.createElement('input');
          input.type = 'number';
          if (def.min !== undefined && def.min !== null) input.min = def.min;
          if (def.max !== undefined && def.max !== null) input.max = def.max;
          break;
        case 'date':
          input = document.createElement('input');
          input.type = 'date';
          break;
        default:
          input = document.createElement('input');
          input.type = 'text';
          if (def.maxLength) input.maxLength = def.maxLength;
      }

      input.name = name;
      // buildReview counts these when listing what is still missing.
      if (def.required) input.dataset.required = 'true';

      if (value !== undefined && value !== null) {
        if (def.type === 'checkbox') input.checked = value === true;
        else input.value = value;
      }

      if (def.type === 'checkbox') {
        label.appendChild(input);
        label.appendChild(caption);
      } else {
        label.appendChild(caption);
        label.appendChild(input);
      }

      if (def.help) {
        var help = document.createElement('span');
        help.className = 'field-help';
        help.textContent = def.help;
        label.appendChild(help);
      }

      grid.appendChild(label);

      ensureFieldSyncMessageEl(input);
    });

    section.hidden = false;
    updateProgress();
  }

  // ---- Name split ----
  //
  // The form asks for first and last name, but the stored field is still a
  // single full_name: the two inputs are joined into a hidden input, which is
  // what syncs and submits. Keeping one stored field means existing responses,
  // the sheet, the export and the admin views all keep working unchanged.

  var firstNameInput = document.getElementById('first_name');
  var lastNameInput = document.getElementById('last_name');
  var fullNameInput = form.elements['full_name'];

  function composeFullName() {
    if (!firstNameInput || !lastNameInput || !fullNameInput) return;

    var joined = [firstNameInput.value.trim(), lastNameInput.value.trim()].filter(Boolean).join(' ');
    if (fullNameInput.value === joined) return;

    fullNameInput.value = joined;
    // The sync listeners are delegated on the form, but a programmatic value
    // change fires no event - so this one is raised by hand.
    fullNameInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Splits a stored full name back across the two inputs on reload. */
  function splitFullName(value) {
    if (!firstNameInput || !lastNameInput) return;

    var parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return;

    firstNameInput.value = parts[0];
    // Everything after the first word is the last name, so middle names and
    // multi-word surnames survive the round trip.
    lastNameInput.value = parts.slice(1).join(' ');
  }

  if (firstNameInput) firstNameInput.addEventListener('input', composeFullName);
  if (lastNameInput) lastNameInput.addEventListener('input', composeFullName);

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

    splitFullName(fields.full_name);

    // Display the location chip from info and update location-based visibility
    var info = (data && data.info) || {};

    renderMoreInfoFields(info.extraFields, (data && data.extraFieldValues) || {}, (data && data.extraDocs) || {});
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
        if (!org || !org.name || !org.duration) return;
        addOrg({
          // Orgs saved before letters were per-org have no id - mint one now so
          // a letter can be attached to them.
          orgId: org.orgId || newOrgId(),
          name: org.name,
          duration: org.duration,
          role: org.role || '',
          info: org.info || '',
          current: org.current,
          letter: org.relievingLetterDoc
            ? { docId: org.relievingLetterDoc.id, name: org.relievingLetterDoc.name }
            : null
        }, true);
      });
    }

    validateAllFields();
    updateProgress();
  }

  function uploadDocument(input) {
    var file = input.files && input.files[0];
    if (!file) return;

    if (previewMode) {
      setUploadStatus(input, 'Uploads are disabled in preview.', 'error');
      resetUploadCard(input);
      return;
    }

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

  form.addEventListener('input', function (e) {
    if (e.target && e.target.name && e.target.type !== 'file') scheduleSync(e.target.name, 'input');
  });
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name && e.target.type !== 'file') scheduleSync(e.target.name, 'change');
  });

  var UPPERCASE_FIELDS = ['pan_number', 'ifsc', 'passport_number', 'passport_no', 'uan_number'];
  var TEXT_INPUT_TYPES = ['text', 'email', 'tel', 'search', 'url'];

  form.addEventListener('change', function (e) {
    var field = e.target;
    if (!field || !field.name) return;
    if (field.tagName !== 'TEXTAREA' && TEXT_INPUT_TYPES.indexOf(field.type) === -1) return;

    var normalized = field.value.trim();
    if (UPPERCASE_FIELDS.indexOf(field.name) !== -1) normalized = normalized.toUpperCase();
    if (normalized === field.value) return;

    field.value = normalized;
    scheduleSync(field.name, 'change');
  });

  // Warn user about unsaved changes before leaving
  window.addEventListener('beforeunload', function (e) {
    if (hasChangedFields() || hasErroredFields() || hasValidationErrors()) {
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
    addressModalRequiredMarks.forEach(function (mark) { mark.hidden = false; });
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

    function failAddress(message) {
      if (addressModalError) {
        addressModalError.textContent = message;
        addressModalError.hidden = false;
      }
    }

    if (!line || !city || !country || !pincode) {
      failAddress('Please fill in all address fields.');
      return;
    }
    if (!NAME_RE.test(city)) {
      failAddress('Please enter a valid city name.');
      return;
    }
    if (!NAME_RE.test(country)) {
      failAddress('Please enter a valid country name.');
      return;
    }

    var indianAddress = /^india$/i.test(country);
    var pincodeOk = indianAddress
      ? /^[1-9]\d{5}$/.test(pincode)
      : /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(pincode);
    if (!pincodeOk) {
      failAddress(indianAddress ? 'Please enter a valid 6-digit pincode.' : 'Please enter a valid postal code.');
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
  var childrenError = document.querySelector('#childrenError');
  var insuranceNote = document.querySelector('#insuranceNote');
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
    validateChildren();
    validateInsurance();
    markFieldChanged('childs_info');
  }

  function openChildModal() {
    if (!childModal) return;
    applyDateBounds();
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

    var dobError = checkChildDob(dob);
    if (dobError) {
      if (childModalError) {
        childModalError.textContent = dobError;
        childModalError.hidden = false;
      }
      return;
    }

    var duplicateChild = childrenData.some(function (child) {
      return child && String(child.name).trim().toLowerCase() === name.toLowerCase() && child.dob === dob;
    });
    if (duplicateChild) {
      if (childModalError) {
        childModalError.textContent = 'This child has already been added.';
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
  var orgModalLetter = document.querySelector('#orgModalLetter');
  var orgModalLetterLabel = document.querySelector('#orgModalLetterLabel');
  var orgModalLetterStatus = document.querySelector('#orgModalLetterStatus');
  var orgModalLetterRemove = document.querySelector('#orgModalLetterRemove');

  // { orgId, name, duration, role, info, current, letter: { docId, name } | null }
  var orgsData = [];

  var ORG_LETTER_DOC_PREFIX = 'org_relieving_letter_';
  var orgModalDraft = null; // { orgId, letter: { docId, name } | null }

  function newOrgId() {
    var id = '';
    while (id.length < 12) id += Math.random().toString(36).slice(2);
    return id.slice(0, 12);
  }

  function orgLetterDocType(orgId) {
    return ORG_LETTER_DOC_PREFIX + orgId;
  }

  function setOrgLetterStatus(message, type) {
    if (!orgModalLetterStatus) return;
    orgModalLetterStatus.textContent = message || '';
    orgModalLetterStatus.classList.toggle('is-error', type === 'error');
  }

  function syncOrgLetterVisibility() {
    if (!orgModalLetterLabel) return;
    var current = orgModalCurrent ? orgModalCurrent.checked : false;
    orgModalLetterLabel.hidden = current;
  }

  function uploadOrgLetter(file) {
    if (!orgModalDraft) return;

    if (previewMode) {
      setOrgLetterStatus('Uploads are disabled in preview.', 'error');
      if (orgModalLetter) orgModalLetter.value = '';
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setOrgLetterStatus('File is too large. Max 10MB.', 'error');
      if (orgModalLetter) orgModalLetter.value = '';
      return;
    }

    var docType = orgLetterDocType(orgModalDraft.orgId);
    var formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);

    setOrgLetterStatus('Uploading…');
    if (orgModalLetter) orgModalLetter.disabled = true;

    fetch(DOC_UPLOAD_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
      credentials: 'include',
      body: formData
    })
      .then(function (res) { return res.json().then(function (data) { return { status: res.status, ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (orgModalLetter) orgModalLetter.disabled = false;

        if (result.status === 401) {
          sessionExpiredInWizard(result.data.reason, result.data.expiredReason);
          return;
        }

        if (result.ok && result.data.uploaded) {
          orgModalDraft.letter = { docId: result.data.docId, name: file.name };
          setOrgLetterStatus(file.name + ' uploaded ✓');
          if (orgModalLetterRemove) orgModalLetterRemove.hidden = false;
          if (orgModalLetter) orgModalLetter.hidden = true;
          return;
        }

        setOrgLetterStatus(UPLOAD_ERROR_MESSAGES[result.data.reason] || 'Upload failed. Please try again.', 'error');
        if (orgModalLetter) orgModalLetter.value = '';
      })
      .catch(function (err) {
        console.error('[onboarding-form] org letter upload failed:', err);
        if (orgModalLetter) orgModalLetter.disabled = false;
        setOrgLetterStatus('Upload failed. Please try again.', 'error');
        if (orgModalLetter) orgModalLetter.value = '';
      });
  }

  /** Deletes an org's letter server-side. Used by both Remove and Cancel. */
  function deleteOrgLetter(orgId) {
    if (previewMode || !orgId) return Promise.resolve();

    return fetch(DOC_REMOVE_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: orgLetterDocType(orgId) })
    }).catch(function (err) {
      console.error('[onboarding-form] org letter remove failed:', err);
    });
  }

  function clearOrgLetterField() {
    if (orgModalLetter) {
      orgModalLetter.value = '';
      orgModalLetter.hidden = false;
      orgModalLetter.disabled = false;
    }
    if (orgModalLetterRemove) orgModalLetterRemove.hidden = true;
    setOrgLetterStatus('');
  }

  if (orgModalLetter) {
    orgModalLetter.addEventListener('change', function () {
      var file = orgModalLetter.files && orgModalLetter.files[0];
      if (file) uploadOrgLetter(file);
    });
  }

  if (orgModalLetterRemove) {
    orgModalLetterRemove.addEventListener('click', function () {
      if (!orgModalDraft || !orgModalDraft.letter) return;
      deleteOrgLetter(orgModalDraft.orgId);
      orgModalDraft.letter = null;
      clearOrgLetterField();
    });
  }

  if (orgModalCurrent) orgModalCurrent.addEventListener('change', syncOrgLetterVisibility);

  function getOrgsData() {
    return orgsData.map(function (org) {
      var payload = {
        orgId: org.orgId,
        name: org.name,
        duration: org.duration,
        role: org.role,
        info: org.info,
        current: org.current
      };
      if (org.letter && org.letter.docId) payload.relievingLetterDocId = org.letter.docId;
      return payload;
    });
  }

  function renderOrgsChips() {
    if (!orgsChips) return;
    orgsChips.innerHTML = '';
    orgsData.forEach(function (org, index) {
      var chip = document.createElement('div');
      chip.className = 'org-chip';
      var roleHtml = org.role ? '<span class="org-chip-role">' + escapeHtml(org.role) + '</span>' : '';
      var currentBadge = org.current ? '<span class="org-chip-current">Current</span>' : '';

      var letterHtml = '';
      if (!org.current) {
        letterHtml = org.letter
          ? '<span class="org-chip-letter">Relieving letter: ' + escapeHtml(org.letter.name) + '</span>'
          : '<span class="org-chip-letter">Relieving letter missing</span>';
      }

      chip.innerHTML =
        '<div class="org-chip-info">' +
          '<span class="org-chip-name">' + escapeHtml(org.name) + currentBadge + '</span>' +
          '<span class="org-chip-duration">' + escapeHtml(org.duration) + '</span>' +
          roleHtml +
          letterHtml +
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

  function addOrg(org, skipSync) {
    orgsData.push({
      orgId: org.orgId || newOrgId(),
      name: org.name,
      duration: org.duration,
      role: org.role || '',
      info: org.info || '',
      current: !!org.current,
      letter: org.letter || null
    });
    renderOrgsChips();
    if (!skipSync) {
      syncOrgsToBackend();
    }
  }

  function removeOrg(index) {
    var org = orgsData[index];
    orgsData.splice(index, 1);
    // The letter belongs to the org, so it goes with it.
    if (org && org.letter) deleteOrgLetter(org.orgId);
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
    orgModalDraft = { orgId: newOrgId(), letter: null };
    clearOrgLetterField();
    syncOrgLetterVisibility();
    orgModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (orgModalName) orgModalName.focus();
  }

  function closeOrgModal(keepLetter) {
    if (!orgModal) return;
    if (!keepLetter && orgModalDraft && orgModalDraft.letter) {
      deleteOrgLetter(orgModalDraft.orgId);
    }
    orgModalDraft = null;
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

    var durationError = checkOrgDuration(duration);
    if (durationError) {
      if (orgModalError) {
        orgModalError.textContent = durationError;
        orgModalError.hidden = false;
      }
      return;
    }

    var duplicateOrg = orgsData.some(function (org) {
      return org && String(org.name).trim().toLowerCase() === name.toLowerCase();
    });
    if (duplicateOrg) {
      if (orgModalError) {
        orgModalError.textContent = 'You have already added this organization.';
        orgModalError.hidden = false;
      }
      return;
    }

    if (current && orgsData.some(function (org) { return org && org.current; })) {
      if (orgModalError) {
        orgModalError.textContent = 'Another organization is already marked as current - only one can be your current employer.';
        orgModalError.hidden = false;
      }
      return;
    }

    var letter = orgModalDraft ? orgModalDraft.letter : null;
    if (!current && !letter) {
      if (orgModalError) {
        orgModalError.textContent = 'Please attach the relieving letter for this organization.';
        orgModalError.hidden = false;
      }
      return;
    }

    addOrg({
      orgId: orgModalDraft ? orgModalDraft.orgId : undefined,
      name: name,
      duration: duration,
      role: role,
      info: info,
      current: current,
      letter: current ? null : letter
    });

    if (current && letter && orgModalDraft) deleteOrgLetter(orgModalDraft.orgId);

    closeOrgModal(true);
  }

  if (addOrgBtn) {
    addOrgBtn.addEventListener('click', openOrgModal);
  }
  function discardOrgModal() {
    closeOrgModal();
  }

  if (orgModalBackdrop) {
    orgModalBackdrop.addEventListener('click', discardOrgModal);
  }
  if (orgModalClose) {
    orgModalClose.addEventListener('click', discardOrgModal);
  }
  if (orgModalCancel) {
    orgModalCancel.addEventListener('click', discardOrgModal);
  }
  if (orgModalSave) {
    orgModalSave.addEventListener('click', saveOrgFromModal);
  }

  function bindUploadInput(input) {
    if (input.dataset.uploadBound === 'true') return;
    input.dataset.uploadBound = 'true';

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
  }

  Array.prototype.forEach.call(form.querySelectorAll('input[type="file"][data-doc-type]'), bindUploadInput);

  saveBtn.addEventListener('click', function () {
    if (previewMode) {
      var previewText = saveBtn.textContent;
      saveBtn.textContent = 'Preview only';
      setTimeout(function () { saveBtn.textContent = previewText; }, 1400);
      return;
    }

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

  if (previewMode) {
    applyPreviewConfig();
    showStep(0);
  } else {
  var saved = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
  Object.keys(saved).forEach(function (key) {
    var field = form.elements[key];
    if (field && field.type !== 'file') field.value = saved[key];
  });
  // full_name is hidden, so the local draft has to be split back out too.
  splitFullName(saved.full_name);
  var savedStep = parseInt(localStorage.getItem(STEP_STORAGE_KEY), 10);
  showStep(isNaN(savedStep) ? 0 : savedStep);
  loadProgressData();
  }

  function applyPreviewConfig() {
    var config = {};
    try {
      config = JSON.parse(window.localStorage.getItem(PREVIEW_STORAGE_KEY) || '{}');
    } catch (e) {
      config = {};
    }

    var location = config.location || 'gurugram';

    renderMoreInfoFields(config.extraFields, {}, {});
    if (locationChip) {
      locationChip.textContent = locationLabels[location] || location;
      locationChip.hidden = false;
    }
    updateLocationVisibility(location);

    var banner = document.getElementById('preview-banner');
    if (banner) banner.hidden = false;

    validateAllFields();
    updateProgress();
  }
  } // end initWizard

  // The preview renders the whole form with no onboarding behind it, so it is
  // gated on a live admin session rather than on the query parameter alone -
  // ?preview=1 on its own gets the "Admins only" card.
  function runPreview() {
    showStatePanel(verifyLoadingPanel);

    fetch(ADMIN_AUTH_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        var permissions = (data && data.user && data.user.permissions) || [];
        var allowed = !!(data && data.auth) && permissions.indexOf('manage_onboardings') !== -1;

        if (!allowed) {
          showStatePanel(previewDeniedPanel);
          return;
        }

        showStatePanel(onboardingShell);
        initWizard();
      })
      .catch(function (err) {
        console.error('[onboarding-form] preview auth check failed:', err);
        showStatePanel(verifyErrorPanel);
      });
  }

  if (previewMode) {
    runPreview();
  } else {
    runVerification();
  }
})();
