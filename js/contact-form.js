/* =============================================================================
 * Contact form → EmailJS integration
 * -----------------------------------------------------------------------------
 * Sends Contact Us submissions straight to our inbox via the EmailJS browser
 * SDK. No backend required — works on any static host (GitHub Pages, Netlify,
 * Vercel, etc.).
 *
 * The EmailJS template should expect these parameters:
 *   { name, email, subject, phone, message }
 * ============================================================================= */

/* -----------------------------------------------------------------------------
 * 1. CONFIGURATION
 * -----------------------------------------------------------------------------
 * Replace the three placeholder strings below with the values from your
 * EmailJS dashboard (https://dashboard.emailjs.com):
 *
 *   EMAILJS_PUBLIC_KEY  ->  Account ▸ General ▸ "Public Key"   (replace YOUR_PUBLIC_KEY)
 *   EMAILJS_SERVICE_ID  ->  Email Services ▸ your service ▸ ID  (replace YOUR_SERVICE_ID)
 *   EMAILJS_TEMPLATE_ID ->  Email Templates ▸ your template ▸ ID (replace YOUR_TEMPLATE_ID)
 *
 * NOTE: The public key, service ID and template ID are *not* secrets — the
 * EmailJS browser SDK is designed to expose them in client-side code. Never
 * place a private key or any real secret here.
 * -------------------------------------------------------------------------- */
var EMAILJS_CONFIG = {
  EMAILJS_PUBLIC_KEY:  'SuSs9KSzrkPU88xdM',
  EMAILJS_SERVICE_ID:  'service_ck4re18',
  EMAILJS_TEMPLATE_ID: 'template_wppgxuq'
};

(function () {
  'use strict';

  /* ---------------------------------------------------------------------------
   * 2. EMAILJS INITIALISATION
   * ---------------------------------------------------------------------------
   * Initialise the SDK once with the public key. Guard against the CDN script
   * not loading (e.g. offline / blocked) so the rest of the page keeps working.
   * ------------------------------------------------------------------------ */
  if (typeof emailjs === 'undefined') {
    console.error('EmailJS SDK failed to load. Check the <script> CDN include.');
    return;
  }
  emailjs.init({ publicKey: EMAILJS_CONFIG.EMAILJS_PUBLIC_KEY });

  // Cache the DOM nodes we need.
  var form      = document.getElementById('contact-form');
  var submitBtn = document.getElementById('contact-submit');
  var statusEl  = document.getElementById('form-status');

  if (!form) return; // Not on the contact page.

  var defaultBtnText = submitBtn ? submitBtn.textContent : 'Submit';

  /* ---------------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------------ */

  // Basic input sanitisation: trim whitespace and strip angle brackets to
  // avoid injecting raw HTML into the email body.
  function sanitize(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/[<>]/g, '');
  }

  // Simple, well-tested email shape check.
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Show an inline status message (type = 'success' | 'error').
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

  // Toggle the button's loading state.
  function setLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = isLoading;
    submitBtn.textContent = isLoading ? 'Sending…' : defaultBtnText;
  }

  /* ---------------------------------------------------------------------------
   * 3. CLIENT-SIDE VALIDATION
   * ---------------------------------------------------------------------------
   * Returns a sanitised params object when valid, or null (after showing an
   * error message) when invalid. Phone is optional; everything else required.
   * ------------------------------------------------------------------------ */
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

    return params;

    function fail(msg) {
      showStatus(msg, 'error');
      return null;
    }
  }

  /* ---------------------------------------------------------------------------
   * 4. FORM SUBMISSION FLOW
   * ---------------------------------------------------------------------------
   *   a. Prevent the default page reload.
   *   b. Validate + collect sanitised field values.
   *   c. Enter loading state and send via EmailJS.
   *   d. On success: show success message + reset the form.
   *   e. On failure: show an error message (see error handling below).
   * ------------------------------------------------------------------------ */
  form.addEventListener('submit', function (event) {
    event.preventDefault(); // a. No page reload.

    clearStatus();

    var params = validateAndCollect(); // b. Validate.
    if (!params) return;               // Stop if invalid.

    setLoading(true); // c. Loading state.

    emailjs
      .send(EMAILJS_CONFIG.EMAILJS_SERVICE_ID, EMAILJS_CONFIG.EMAILJS_TEMPLATE_ID, params)
      .then(function () {
        // d. Success.
        showStatus('Thanks for reaching out! Your message has been sent.', 'success');
        form.reset();
      })
      .catch(function (error) {
        /* -------------------------------------------------------------------
         * 5. ERROR HANDLING
         * -------------------------------------------------------------------
         * EmailJS rejects with an object like { status, text }. We log the
         * details for debugging and show the user a friendly, non-technical
         * message so they can retry.
         * ---------------------------------------------------------------- */
        console.error('EmailJS send failed:', error);
        showStatus('Sorry, something went wrong and your message was not sent. Please try again or email us directly.', 'error');
      })
      .finally(function () {
        setLoading(false); // Always exit the loading state.
      });
  });
})();
