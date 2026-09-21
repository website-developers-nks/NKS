(function () {
  'use strict';

  var FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  var stack = [];

  function isVisible(el) {
    return el && !el.hidden && el.offsetParent !== null;
  }

  function dialogOf(modal) {
    return modal.querySelector('.admin-modal-dialog, .doc-modal-dialog') || modal;
  }

  function focusables(dialog) {
    return Array.prototype.filter.call(
      dialog.querySelectorAll(FOCUSABLE),
      function (el) { return el.offsetParent !== null && !el.hidden; }
    );
  }

  function onOpen(modal) {
    if (stack.some(function (e) { return e.modal === modal; })) return;
    stack.push({ modal: modal, prevFocus: document.activeElement });

    var dialog = dialogOf(modal);
    if (dialog.contains(document.activeElement)) return;

    var first = focusables(dialog)[0];
    if (first) {
      first.focus();
    } else {
      dialog.setAttribute('tabindex', '-1');
      dialog.focus();
    }
  }

  function onClose(modal) {
    var idx = -1;
    for (var i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].modal === modal) { idx = i; break; }
    }
    if (idx === -1) return;
    var entry = stack.splice(idx, 1)[0];
    if (entry.prevFocus && typeof entry.prevFocus.focus === 'function' && document.contains(entry.prevFocus)) {
      entry.prevFocus.focus();
    }
  }

  function top() {
    return stack.length ? stack[stack.length - 1].modal : null;
  }

  function closeControl(modal) {
    return modal.querySelector('[data-confirm-cancel], [data-modal-close].admin-modal-close, [data-modal-close], .doc-modal-close');
  }

  document.addEventListener('keydown', function (e) {
    var modal = top();
    if (!modal || !isVisible(modal)) return;

    if (e.key === 'Escape') {
      var ctrl = closeControl(modal);
      if (ctrl) { e.preventDefault(); ctrl.click(); }
      return;
    }

    if (e.key === 'Tab') {
      var items = focusables(dialogOf(modal));
      if (!items.length) return;
      var firstEl = items[0];
      var lastEl = items[items.length - 1];
      var active = document.activeElement;

      if (e.shiftKey && (active === firstEl || !dialogOf(modal).contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  }, true);

  function watch(modal) {
    if (modal.dataset.a11yWatched === 'true') return;
    modal.dataset.a11yWatched = 'true';

    var observer = new MutationObserver(function () {
      if (isVisible(modal)) onOpen(modal);
      else onClose(modal);
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['hidden'] });

    if (isVisible(modal)) onOpen(modal);
  }

  function scan(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('.admin-modal, .doc-modal'), watch);
  }

  document.addEventListener('DOMContentLoaded', function () { scan(); });

  window.NKSModalA11y = { scan: scan };
})();
