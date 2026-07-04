var EMAILJS_CONFIG = {
  EMAILJS_PUBLIC_KEY:  'xjK8D0YJ5LoDwm9zQ',
  EMAILJS_SERVICE_ID:  'service_7gjz2og',
  EMAILJS_TEMPLATE_ID: 'template_jca8d96'
};

(function () {
  'use strict';
  if (typeof emailjs === 'undefined') {
    console.error('EmailJS SDK failed to load. Check the <script> CDN include.');
    return;
  }
  emailjs.init({ publicKey: EMAILJS_CONFIG.EMAILJS_PUBLIC_KEY });

  var form      = document.getElementById('contact-form');
  var submitBtn = document.getElementById('contact-submit');
  var statusEl  = document.getElementById('form-status');

  if (!form) return;

  var defaultBtnText = submitBtn ? submitBtn.textContent : 'Submit';
  function sanitize(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/[<>]/g, '');
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

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
    submitBtn.textContent = isLoading ? 'Sending…' : defaultBtnText;
  }

  function validateAndCollect() {
    var params = {
      name:    sanitize(form.name.value),
      email:   sanitize(form.email.value),
      subject: sanitize(form.subject.value),
      phone:   sanitize(form.phone.value),
      message: sanitize(form.message.value)
    };

    if (!params.name)    { return fail('Please enter your name.'); }
    if (!params.email)   { return fail('Please enter your email address.'); }
    if (!isValidEmail(params.email)) { return fail('Please enter a valid email address.'); }
    if (!params.subject) { return fail('Please enter a subject.'); }
    if (!params.message) { return fail('Please enter a message.'); }

    if (typeof grecaptcha === 'undefined' || !grecaptcha.getResponse()) {
      return fail('Please complete the CAPTCHA.');
    }

    return params;

    function fail(msg) {
      showStatus(msg, 'error');
      return null;
    }
  }


  form.addEventListener('submit', function (event) {
    event.preventDefault();

    clearStatus();

    var params = validateAndCollect();
    if (!params) return;              

    setLoading(true); 

    emailjs
      .send(EMAILJS_CONFIG.EMAILJS_SERVICE_ID, EMAILJS_CONFIG.EMAILJS_TEMPLATE_ID, params)
      .then(function () {
        showStatus('Thanks for reaching out! Your message has been sent.', 'success');
        form.reset();
      })
      .catch(function (error) {
        console.error('EmailJS send failed:', error);
        showStatus('Sorry, something went wrong and your message was not sent. Please try again or email us directly.', 'error');
        if (typeof grecaptcha !== 'undefined') { grecaptcha.reset(); }
      })
      .finally(function () {
        setLoading(false);
      });
  });
})();
