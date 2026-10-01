(function () {
  'use strict';

  var API_BASE = '/api/email';
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var CV_MAX_BYTES = 5 * 1024 * 1024;
  var CV_EXTENSIONS = ['pdf', 'doc', 'docx'];
  var IS_LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(window.location.hostname) !== -1;

  if (IS_LOCAL) {
    Array.prototype.forEach.call(document.querySelectorAll('.g-recaptcha'), function (el) {
      el.hidden = true;
    });
  }

  function value(form, name) {
    var field = form.elements[name];
    return field ? String(field.value || '').trim() : '';
  }

  function captchaToken() {
    if (IS_LOCAL) return 'localhost';
    return typeof grecaptcha !== 'undefined' ? grecaptcha.getResponse() : '';
  }

  function resetCaptcha() {
    if (!IS_LOCAL && typeof grecaptcha !== 'undefined') grecaptcha.reset();
  }

  function waitText(seconds) {
    if (!seconds || seconds < 60) return 'in a minute';
    var minutes = Math.ceil(seconds / 60);
    return 'in ' + minutes + ' minute' + (minutes === 1 ? '' : 's');
  }

  function setupForm(form, options) {
    var submitBtn = form.querySelector('.form-submit');
    var statusEl = form.querySelector('.form-status');
    var defaultBtnText = submitBtn ? submitBtn.textContent : 'Submit';
    var blockedUntil = 0;

    function showStatus(message, type) {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.classList.remove('is-success', 'is-error');
      statusEl.classList.add('is-visible', type === 'success' ? 'is-success' : 'is-error');
    }

    function clearStatus() {
      if (!statusEl) return;
      statusEl.textContent = '';
      statusEl.classList.remove('is-visible', 'is-success', 'is-error');
    }

    function setLoading(isLoading) {
      if (!submitBtn) return;
      submitBtn.disabled = isLoading;
      submitBtn.classList.toggle('is-loading', isLoading);
      submitBtn.textContent = isLoading ? options.loadingText : defaultBtnText;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus();

      if (Date.now() < blockedUntil) {
        showStatus('Too many submissions. Please try again ' + waitText((blockedUntil - Date.now()) / 1000) + '.', 'error');
        return;
      }

      var error = options.validate(form);
      if (error) {
        showStatus(error, 'error');
        return;
      }

      var token = captchaToken();
      if (!token) {
        showStatus('Please complete the CAPTCHA.', 'error');
        return;
      }

      setLoading(true);

      fetch(API_BASE + options.path, {
        method: 'POST',
        headers: options.json ? { 'Content-Type': 'application/json', 'Accept': 'application/json' } : { 'Accept': 'application/json' },
        body: options.buildBody(form, token)
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            return { status: res.status, data: data, retryAfter: Number(res.headers.get('Retry-After')) || 0 };
          });
        })
        .then(function (result) {
          if (result.status === 200 && result.data.ok) {
            showStatus(options.successText, 'success');
            form.reset();
            resetCaptcha();
            return;
          }

          resetCaptcha();

          if (result.status === 429) {
            var seconds = result.data.retryAfterSeconds || result.retryAfter || 15 * 60;
            blockedUntil = Date.now() + seconds * 1000;
            showStatus('Too many submissions. Please try again ' + waitText(seconds) + '.', 'error');
            return;
          }

          showStatus(result.data.error || options.failureText, 'error');
        })
        .catch(function (err) {
          console.error('[forms] submit failed:', err);
          resetCaptcha();
          showStatus(options.failureText, 'error');
        })
        .finally(function () {
          setLoading(false);
        });
    });
  }

  var contactForm = document.getElementById('contact-form');
  if (contactForm) {
    setupForm(contactForm, {
      path: '/contact',
      json: true,
      loadingText: 'Sending…',
      successText: 'Thanks for reaching out! Your message has been sent.',
      failureText: 'Sorry, something went wrong and your message was not sent. Please try again or email us directly.',
      validate: function (form) {
        if (!value(form, 'name')) return 'Please enter your name.';
        if (!value(form, 'email')) return 'Please enter your email address.';
        if (!EMAIL_PATTERN.test(value(form, 'email'))) return 'Please enter a valid email address.';
        if (!value(form, 'subject')) return 'Please enter a subject.';
        if (!value(form, 'message')) return 'Please enter a message.';
        return null;
      },
      buildBody: function (form, token) {
        return JSON.stringify({
          senderName: value(form, 'name'),
          senderEmail: value(form, 'email'),
          phone: value(form, 'phone'),
          subject: value(form, 'subject'),
          message: value(form, 'message'),
          source: 'contact',
          recaptchaToken: token
        });
      }
    });
  }

  var cvForm = document.getElementById('cv-form');
  if (cvForm) {
    setupForm(cvForm, {
      path: '/cv',
      json: false,
      loadingText: 'Uploading…',
      successText: 'Thanks! Your CV has been sent to our Recruitment team. We will be in touch if there is a fit.',
      failureText: 'Sorry, something went wrong and your CV was not sent. Please try again.',
      validate: function (form) {
        if (!value(form, 'name')) return 'Please enter your name.';
        if (!value(form, 'email')) return 'Please enter your email address.';
        if (!EMAIL_PATTERN.test(value(form, 'email'))) return 'Please enter a valid email address.';
        if (!value(form, 'college')) return 'Please enter your college.';
        var cgpa = value(form, 'cgpa');
        if (!/^\d{1,2}(\.\d{1,2})?$/.test(cgpa) || Number(cgpa) > 10) return 'Please enter your CGPA on a 10-point scale, e.g. 8.25.';
        var linkedin = value(form, 'linkedin');
        if (linkedin && !/^https?:\/\/\S+$/i.test(linkedin)) return 'Please enter a full LinkedIn URL starting with https://.';

        var file = form.elements.cv && form.elements.cv.files[0];
        if (!file) return 'Please attach your CV.';
        var ext = file.name.split('.').pop().toLowerCase();
        if (CV_EXTENSIONS.indexOf(ext) === -1) return 'Your CV must be a PDF, DOC or DOCX file.';
        if (file.size > CV_MAX_BYTES) return 'Your CV must be 5MB or smaller.';
        return null;
      },
      buildBody: function (form, token) {
        var data = new FormData();
        ['name', 'email', 'phone', 'role', 'college', 'cgpa', 'linkedin', 'message'].forEach(function (name) {
          data.append(name, value(form, name));
        });
        data.append('recaptchaToken', token);
        data.append('cv', form.elements.cv.files[0]);
        return data;
      }
    });
  }
})();
