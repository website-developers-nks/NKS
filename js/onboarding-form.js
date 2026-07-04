(function () {
  'use strict';

  var API_BASE = 'https://api-nk.vercel.app';

  // Secure fetch wrapper - only sends credentials to our API
  function apiFetch(url, options) {
    options = options || {};
    if (url.indexOf(API_BASE) === 0) {
      options.credentials = 'include';
    }
    return fetch(url, options);
  }

  var VERIFY_ENDPOINT = API_BASE + '/api/onboarding/verify';
  var PROGRESS_DATA_ENDPOINT = API_BASE + '/api/onboarding/progress-data';
  var SUBMIT_ENDPOINT = API_BASE + '/api/onboarding/submit-data';
  var DOC_UPLOAD_ENDPOINT = API_BASE + '/api/docs/upload';
  var DOC_REMOVE_ENDPOINT = API_BASE + '/api/docs/remove_doc';
  var DOC_PRESIGN_ENDPOINT = API_BASE + '/api/docs/presign';
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
    link_expired: 'This onboarding link has expired. Please contact HR for assistance.'
  };

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

  function showVerifyFailed(reason) {
    // "completed" means the onboarding was already submitted - there's nothing
    // to re-verify, so it gets its own panel instead of the "Verify Now" one.
    if (reason === 'completed' && verifyCompletedPanel) {
      showStatePanel(verifyCompletedPanel);
      return;
    }

    // "expired" or "link_expired" means the onboarding link has expired - show dedicated panel
    if ((reason === 'expired' || reason === 'link_expired') && verifyExpiredPanel) {
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

  function handleSessionExpired(reason) {
    if (sessionExpired) return;
    sessionExpired = true;
    showVerifyFailed(reason);
  }

  function runVerification() {
    showStatePanel(verifyLoadingPanel);

    apiFetch(VERIFY_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'GET',
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
          showVerifyFailed(data.reason);
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
  function sessionExpiredInWizard(reason) {
    closePreviewModal();
    handleSessionExpired(reason);
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
  var STEP_STORAGE_KEY = 'nk-onboarding-form-step';

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
    emergency: 'Emergency contact',
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
    photo_doc: 'Passport Photo',
    highest_degree_doc: 'Highest Degree Certificate',
    higher_secondary_doc: 'Higher Secondary Marksheet',
    resume_doc: 'Resume',
    offer_letter_doc: 'Offer Letter (Last Company)',
    last_increment_doc: 'Last Increment Letter',
    salary_slip_doc: 'Salary Slip (3 Months Zipped)',
    bonus_letter_doc: 'Bonus Letter',
    experience_letter_doc: 'Experience Letter',
    campus_name: 'Campus Name',
    bank_name: 'Bank name',
    account_holder: 'Account holder name',
    account_number: 'Account number',
    ifsc: 'IFSC code',
    bank_doc: 'Bank proof file',
    intro_line: 'One line intro',
    birthday_pref: 'Birthday celebration preference',
    drink_order: 'Coffee / tea order',
    hobbies: 'Hobbies',
    fun_fact: 'Fun fact',
    policy_code: 'Code of Conduct acknowledgement',
    policy_confidentiality: 'Confidentiality acknowledgement',
    policy_it: 'IT policy acknowledgement',
    policy_hr: 'HR policy acknowledgement'
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
  // A field stays "dirty" until the backend explicitly confirms it with
  // { field_name, saved: true }. If a field changes again while its sync
  // request is still in flight, the confirmation for the stale value is
  // ignored so the newer value doesn't get incorrectly marked saved.

  var SYNC_FORM_ENDPOINT = API_BASE + '/api/onboarding/sync-form';
  var SYNC_DEBOUNCE_MS = 1500;
  var dirtyFields = {};
  var syncTimer = null;
  var syncInProgress = false;
  var syncQueued = false;

  function getFieldValue(field) {
    if (field.type === 'checkbox') return field.checked;
    return field.value || '';
  }

  function hasDirtyFields() {
    return Object.keys(dirtyFields).length > 0;
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
      dot.hidden = !hasError && !hasUnsaved;
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

  function markFieldDirty(name) {
    if (!name || sessionExpired) return;
    dirtyFields[name] = true;

    var field = form.elements[name];
    if (field) {
      setFieldSyncError(field, null);
      setFieldUnsaved(field, true);
    }

    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, SYNC_DEBOUNCE_MS);
  }

  function runSync() {
    clearTimeout(syncTimer);
    if (sessionExpired) return;
    if (!hasDirtyFields()) return;

    if (syncInProgress) {
      syncQueued = true;
      return;
    }

    syncInProgress = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    // Submit owns the button's disabled/text state during its own flow (it
    // already flushes pending sync itself) - don't fight over it here.
    if (!submitInProgress) submitBtn.disabled = true;

    var snapshot = {};
    Object.keys(dirtyFields).forEach(function (name) {
      if (name === 'childs_info') {
        // Use getChildrenData() to get only complete child entries
        snapshot[name] = getChildrenData();
      } else if (name === 'orgs') {
        // Use getOrgsData() to get organization entries
        snapshot[name] = getOrgsData();
      } else {
        var field = form.elements[name];
        if (field) snapshot[name] = getFieldValue(field);
      }
    });

    apiFetch(SYNC_FORM_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: snapshot })
    })
      .then(function (res) {
        if (res.status === 401) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            sessionExpiredInWizard(body.reason);
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

          // Handle childs_info specially (no form field)
          if (result.field_name === 'childs_info') {
            if (result.saved) {
              delete dirtyFields['childs_info'];
            } else {
              console.error('[onboarding-form] childs_info sync rejected:', result.error);
              rejected.push({ name: 'childs_info', error: result.error });
            }
            return;
          }

          // Handle orgs specially (no form field)
          if (result.field_name === 'orgs') {
            if (result.saved) {
              delete dirtyFields['orgs'];
            } else {
              console.error('[onboarding-form] orgs sync rejected:', result.error);
              rejected.push({ name: 'orgs', error: result.error });
            }
            return;
          }

          var field = form.elements[result.field_name];

          if (!result.saved) {
            console.error('[onboarding-form] field sync rejected:', result.field_name, result.error);
            if (field) setFieldSyncError(field, result.error || 'Could not save this field.');
            rejected.push({ name: result.field_name, error: result.error });
            return;
          }

          var stillMatches = field && getFieldValue(field) === snapshot[result.field_name];
          if (stillMatches) {
            delete dirtyFields[result.field_name];
            if (field) {
              setFieldSyncError(field, null);
              setFieldUnsaved(field, false);
            }
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
        if (!submitInProgress) submitBtn.disabled = false;
        if (sessionExpired) return;
        // Only auto-retry when something explicitly asked for another sync while
        // this one was in flight - not just because fields are still dirty, which
        // would otherwise hammer the backend in a tight loop on persistent failure.
        // Leftover dirty fields (rejected or errored) retry on the next real
        // change or Save Progress click instead.
        if (syncQueued) {
          syncQueued = false;
          runSync();
        }
      });
  }

  function scheduleSync(fieldName) {
    markFieldDirty(fieldName);
  }

  // Submitting must see the latest edits, not whatever was last confirmed -
  // flush any pending/in-flight sync first. A stuck or failing sync shouldn't
  // block submission forever though, since /submit-data is authoritative and
  // will report exactly what's still missing regardless.
  function flushPendingSync() {
    return new Promise(function (resolve) {
      if (!hasDirtyFields() && !syncInProgress) {
        resolve();
        return;
      }

      clearTimeout(syncTimer);
      runSync();

      var settled = false;
      var giveUp = setTimeout(function () {
        settled = true;
        clearInterval(poll);
        resolve();
      }, 6000);
      var poll = setInterval(function () {
        if (settled) return;
        if (!syncInProgress && !hasDirtyFields()) {
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

    if (syncInProgress) {
      showSubmitMessage('Please wait for your changes to finish saving, then try again.', 'error');
      return;
    }

    submitInProgress = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    showSubmitMessage('Checking your submission…', 'success');

    flushPendingSync()
      .then(function () {
        return apiFetch(SUBMIT_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
          method: 'GET',
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
          sessionExpiredInWizard(result.body.reason);
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
    apiFetch(PROGRESS_DATA_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'GET'
    })
      .then(function (res) {
        if (res.status === 401) {
          return res.json().then(function (body) { sessionExpiredInWizard(body.reason); return null; });
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

    // Check "same as permanent" if addresses match
    var addrField = form.elements['address'];
    var presentField = form.elements['present_address'];
    var sameCheckbox = document.querySelector('#sameAsPermanent');
    if (addrField && presentField && sameCheckbox && fields.address && fields.present_address) {
      if (fields.address === fields.present_address) {
        sameCheckbox.checked = true;
        presentField.disabled = true;
        var label = document.querySelector('#presentAddressLabel');
        if (label) label.style.opacity = '0.5';
      }
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
          addOrg(org.name, org.duration, org.info || '', org.current, true);
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

    apiFetch(DOC_UPLOAD_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
      body: formData
    })
      .then(function (res) { return res.json().then(function (data) { return { status: res.status, ok: res.ok, data: data }; }); })
      .then(function (result) {
        input.disabled = false;

        if (result.status === 401) {
          sessionExpiredInWizard(result.data.reason);
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

    apiFetch(DOC_REMOVE_ENDPOINT + '?id=' + encodeURIComponent(onboardingKey), {
      method: 'POST',
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
          sessionExpiredInWizard(result.data.reason);
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

    apiFetch(url, { method: 'GET' })
      .then(function (res) {
        if (res.status === 401) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            sessionExpiredInWizard(body.reason);
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

  // Reserve the sync-message slot under every syncable field up front, so its
  // first appearance (on error) never shifts layout - only its text changes.
  Array.prototype.forEach.call(form.elements, function (field) {
    if (!field.name) return;
    if (field.type === 'file' || field.type === 'button' || field.type === 'submit') return;
    ensureFieldSyncMessageEl(field);
  });

  // "Same as permanent address" checkbox logic
  var sameAsPermanentCheckbox = document.querySelector('#sameAsPermanent');
  var permanentAddressField = form.elements['address'];
  var presentAddressField = form.elements['present_address'];
  var presentAddressLabel = document.querySelector('#presentAddressLabel');

  function updatePresentAddressState() {
    if (!sameAsPermanentCheckbox || !presentAddressField) return;
    var isSame = sameAsPermanentCheckbox.checked;
    presentAddressField.disabled = isSame;
    if (presentAddressLabel) {
      presentAddressLabel.style.opacity = isSame ? '0.5' : '1';
    }
    if (isSame && permanentAddressField) {
      presentAddressField.value = permanentAddressField.value;
      scheduleSync('present_address');
    }
  }

  if (sameAsPermanentCheckbox) {
    sameAsPermanentCheckbox.addEventListener('change', updatePresentAddressState);
  }

  if (permanentAddressField) {
    permanentAddressField.addEventListener('input', function () {
      if (sameAsPermanentCheckbox && sameAsPermanentCheckbox.checked && presentAddressField) {
        presentAddressField.value = permanentAddressField.value;
        scheduleSync('present_address');
      }
    });
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
    dirtyFields['childs_info'] = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, SYNC_DEBOUNCE_MS);
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
  var orgModalInfo = document.querySelector('#orgModalInfo');
  var orgModalCurrent = document.querySelector('#orgModalCurrent');
  var orgModalError = document.querySelector('#orgModalError');
  var orgsData = []; // Array of { name, duration, info, current }

  function getOrgsData() {
    return orgsData.slice();
  }

  function renderOrgsChips() {
    if (!orgsChips) return;
    orgsChips.innerHTML = '';
    orgsData.forEach(function (org, index) {
      var chip = document.createElement('div');
      chip.className = 'org-chip';
      var infoHtml = org.info ? '<span class="org-chip-role">' + escapeHtml(org.info) + '</span>' : '';
      var currentBadge = org.current ? '<span class="org-chip-current">Current</span>' : '';
      chip.innerHTML =
        '<div class="org-chip-info">' +
          '<span class="org-chip-name">' + escapeHtml(org.name) + currentBadge + '</span>' +
          '<span class="org-chip-duration">' + escapeHtml(org.duration) + '</span>' +
          infoHtml +
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

  function addOrg(name, duration, info, current, skipSync) {
    orgsData.push({ name: name, duration: duration, info: info || '', current: !!current });
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
    dirtyFields['orgs'] = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, SYNC_DEBOUNCE_MS);
  }

  function openOrgModal() {
    if (!orgModal) return;
    if (orgModalName) orgModalName.value = '';
    if (orgModalDuration) orgModalDuration.value = '';
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

    addOrg(name, duration, info, current);
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
    localStorage.setItem('nk-onboarding-form-progress', JSON.stringify(data));

    if (hasDirtyFields()) {
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

  var saved = JSON.parse(localStorage.getItem('nk-onboarding-form-progress') || '{}');
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
