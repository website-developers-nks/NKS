(function () {
  'use strict';

  var API_BASE = '/api/onboarding';

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

  function revealFadeUps(root) {
    var els = root.classList.contains('fade-up') ? [root] : [];
    els = els.concat(Array.prototype.slice.call(root.querySelectorAll('.fade-up')));
    els.forEach(function (el) { el.classList.add('visible'); });
  }

  function parseJson(res) {
    return res.json().then(function (data) { return { status: res.status, data: data }; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var onboardingKey = sanitize(getParam('id'));

    var panels = Array.prototype.slice.call(document.querySelectorAll('.verify-panel'));
    var howItWorksSection = document.getElementById('how-it-works-section');
    var securityNote      = document.getElementById('security-note');
    var heroGreeting       = document.getElementById('hero-greeting');

    function showPanel(panelId) {
      panels.forEach(function (panel) {
        panel.hidden = panel.id !== panelId;
      });
      var active = document.getElementById(panelId);
      if (active) revealFadeUps(active);

      var showSupportingSections = panelId === 'panel-generate-otp';
      if (howItWorksSection) {
        howItWorksSection.hidden = !showSupportingSections;
        if (showSupportingSections) revealFadeUps(howItWorksSection);
      }
      if (securityNote) securityNote.hidden = !showSupportingSections;
    }

    var ONBOARDING_FORM_URL = 'onboarding-form.html';
    var REDIRECT_SECONDS = 10;
    var redirectTimer = null;

    function goToOnboardingForm() {
      window.location.href = ONBOARDING_FORM_URL + '?id=' + encodeURIComponent(onboardingKey);
    }

    function startRedirectCountdown() {
      clearInterval(redirectTimer);
      var countdownEl = document.getElementById('redirect-countdown');
      var remaining = REDIRECT_SECONDS;

      function tick() {
        if (countdownEl) countdownEl.textContent = 'Taking you to your onboarding form in ' + remaining + 's…';
        if (remaining <= 0) {
          clearInterval(redirectTimer);
          goToOnboardingForm();
          return;
        }
        remaining -= 1;
      }

      tick();
      redirectTimer = setInterval(tick, 1000);
    }

    function showVerified(user) {
      user = user || {};
      var fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

      var heading = document.getElementById('verified-heading');
      if (heading) heading.textContent = user.firstName ? 'Welcome, ' + user.firstName + '!' : "You're Verified";

      if (heroGreeting && user.firstName) {
        heroGreeting.textContent = 'Hi ' + user.firstName + ', welcome aboard!';
      }

      var nameEl  = document.getElementById('verified-name');
      var emailEl = document.getElementById('verified-email');
      if (nameEl)  nameEl.textContent  = fullName;
      if (emailEl) emailEl.textContent = user.email || '';

      showPanel('panel-verified');
      startRedirectCountdown();
    }

    function runVerification() {
      showPanel('panel-loading');

      fetch(API_BASE + '/verify?id=' + encodeURIComponent(onboardingKey), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(function (res) {
          if (res.status === 400) {
            showPanel('panel-missing-id');
            return null;
          }
          if (!res.ok) throw new Error('Verification request failed with status ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data) return;
          if (data.auth) {
            showVerified(data.user);
          } else if (data.reason === 'completed') {
            showPanel('panel-completed');
          } else if (data.reason === 'expired') {
            showPanel('panel-expired');
          } else {
            checkOtpStatus();
          }
        })
        .catch(function (err) {
          console.error('[verify-onboarding] verify request failed:', err);
          showPanel('panel-error');
        });
    }

    function checkOtpStatus() {
      fetch(API_BASE + '/check-otp-status?onboardingKey=' + encodeURIComponent(onboardingKey), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
        .then(function (res) {
          if (!res.ok) throw new Error('check-otp-status request failed with status ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data.linkExpired) {
            showPanel('panel-expired');
            return;
          }
          if (data.completed) {
            showPanel('panel-completed');
            return;
          }
          showPanel('panel-generate-otp');
          if (data.page === 'enter_otp') {
            enterOtpStage();
            startResendCooldown(data.nextResendAt);
          }
        })
        .catch(function (err) {
          console.error('[verify-onboarding] check-otp-status failed:', err);
          showPanel('panel-generate-otp');
        });
    }

    if (!onboardingKey) {
      showPanel('panel-missing-id');
    } else {
      runVerification();
    }

    var retryBtn = document.getElementById('retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', runVerification);

    var continueBtn = document.getElementById('continue-btn');
    if (continueBtn) {
      continueBtn.addEventListener('click', function () {
        clearInterval(redirectTimer);
        goToOnboardingForm();
      });
    }

    // ---- OTP request / entry flow (POST /send_otp, POST /verify_otp) ----

    var requestBlock = document.getElementById('otp-request-block');
    var entryBlock   = document.getElementById('otp-entry-block');
    var otpHeading   = document.getElementById('otp-heading');
    var otpSubtext   = document.getElementById('otp-subtext');
    var otpStatus    = document.getElementById('otp-status');
    var otpMeta      = document.getElementById('otp-meta');
    var generateBtn  = document.getElementById('generate-otp-btn');
    var otpForm      = document.getElementById('otp-form');
    var otpInput     = document.getElementById('otp-input');
    var verifyBtn    = document.getElementById('verify-otp-btn');
    var resendBtn    = document.getElementById('resend-otp-btn');

    if (!generateBtn || !otpForm) return;

    var cooldownTimer = null;

    function showOtpStatus(message, type) {
      otpStatus.textContent = message;
      otpStatus.classList.remove('is-success', 'is-error');
      otpStatus.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
    }

    function clearOtpStatus() {
      otpStatus.classList.remove('is-visible', 'is-success', 'is-error');
      otpStatus.textContent = '';
    }

    function enterOtpStage() {
      requestBlock.hidden = true;
      entryBlock.hidden = false;
      otpHeading.textContent = 'Enter Your Code';
      otpSubtext.innerHTML = "We've sent a 6-digit code to <strong>your registered email address</strong>. Enter it below to verify your identity.";
      otpMeta.textContent = "Didn't get it? Check your spam or junk folder, then use resend below.";
      otpInput.value = '';
      otpInput.focus();
    }

    function startResendCooldown(nextResendAtIso) {
      clearInterval(cooldownTimer);

      if (!nextResendAtIso) {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend OTP';
        return;
      }

      function tick() {
        var remaining = Math.ceil((new Date(nextResendAtIso).getTime() - Date.now()) / 1000);
        if (remaining <= 0) {
          clearInterval(cooldownTimer);
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend OTP';
          return;
        }
        resendBtn.disabled = true;
        resendBtn.textContent = 'Resend OTP in ' + remaining + 's';
      }

      tick();
      cooldownTimer = setInterval(tick, 1000);
    }

    function requestOtp(isResend) {
      var triggerBtn    = isResend ? resendBtn : generateBtn;
      var originalText  = triggerBtn.textContent;
      triggerBtn.disabled = true;
      triggerBtn.textContent = isResend ? 'Sending…' : 'Generating…';
      clearOtpStatus();

      fetch(API_BASE + '/send_otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingKey: onboardingKey })
      })
        .then(parseJson)
        .then(function (result) {
          var status = result.status;
          var data   = result.data;

          if (status === 404) {
            showPanel('panel-invalid-key');
            return;
          }

          if (status === 400 || status === 502) {
            triggerBtn.disabled = false;
            triggerBtn.textContent = originalText;
            showOtpStatus(data.error || 'Something went wrong. Please try again.', 'error');
            return;
          }

          if (data.sent) {
            enterOtpStage();
            showOtpStatus('A one-time password has been sent to your registered email address. It is valid for 10 minutes.', 'success');
            startResendCooldown(data.nextResendAt);
            return;
          }

          if (data.reason === 'too_soon') {
            enterOtpStage();
            showOtpStatus('A code was already sent - please check your inbox, or wait to request another.', 'error');
            startResendCooldown(data.nextResendAt);
            return;
          }

          if (data.reason === 'max_resends') {
            enterOtpStage();
            showOtpStatus("You've reached the maximum number of codes for this session. Please use the last code you received, or contact us for help.", 'error');
            resendBtn.disabled = true;
            resendBtn.textContent = 'Resend OTP';
            return;
          }

          if (data.reason === 'expired') {
            showPanel('panel-expired');
            return;
          }

          if (data.reason === 'completed') {
            showPanel('panel-completed');
            return;
          }

          triggerBtn.disabled = false;
          triggerBtn.textContent = originalText;
          showOtpStatus('Something went wrong. Please try again.', 'error');
        })
        .catch(function (err) {
          console.error('[verify-onboarding] send_otp failed:', err);
          triggerBtn.disabled = false;
          triggerBtn.textContent = originalText;
          showOtpStatus('Something went wrong while sending your code. Please try again.', 'error');
        });
    }

    generateBtn.addEventListener('click', function () { requestOtp(false); });
    resendBtn.addEventListener('click', function () { requestOtp(true); });

    otpForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var code = otpInput.value.trim();
      if (!code) {
        showOtpStatus('Please enter the code sent to your email.', 'error');
        return;
      }

      var originalText = verifyBtn.textContent;
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying…';
      clearOtpStatus();

      fetch(API_BASE + '/verify_otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingKey: onboardingKey, otp: code })
      })
        .then(parseJson)
        .then(function (result) {
          var data = result.data;

          if (data.verified) {
            runVerification();
            return;
          }

          // Onboarding link expired - show dedicated panel
          if (data.reason === 'link_expired') {
            showPanel('panel-expired');
            return;
          }

          // Onboarding already completed
          if (data.reason === 'completed') {
            showPanel('panel-completed');
            return;
          }

          verifyBtn.disabled = false;
          verifyBtn.textContent = originalText;
          otpInput.value = '';
          otpInput.focus();

          var reasonMessages = {
            not_found:    'This onboarding link is no longer valid. Please contact us for help.',
            expired:      'This code has expired. Please request a new one below.',
            invalid_otp:  "That code isn't correct. Please try again.",
            max_attempts: 'Too many incorrect attempts. Please request a new code below.'
          };
          showOtpStatus(reasonMessages[data.reason] || data.error || 'We could not verify that code. Please try again.', 'error');
        })
        .catch(function (err) {
          console.error('[verify-onboarding] verify_otp failed:', err);
          verifyBtn.disabled = false;
          verifyBtn.textContent = originalText;
          showOtpStatus('Something went wrong while verifying your code. Please try again.', 'error');
        });
    });
  });
})();
