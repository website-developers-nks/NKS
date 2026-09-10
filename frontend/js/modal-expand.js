
(function () {
  'use strict';

  var STORAGE_PREFIX = 'nks-modal-expanded:';

  function read(modalId) {
    try {
      return window.localStorage.getItem(STORAGE_PREFIX + modalId) === 'true';
    } catch (e) {
      return false;
    }
  }

  function write(modalId, expanded) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + modalId, expanded ? 'true' : 'false');
    } catch (e) {
    }
  }

  function apply(modal, expanded) {
    modal.classList.toggle('is-expanded', expanded);

    var toggle = modal.querySelector('[data-modal-expand]');
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', expanded ? 'Restore to window' : 'Expand to full screen');
    toggle.title = expanded ? 'Restore' : 'Expand';
  }

  function init(root) {
    var scope = root || document;

    Array.prototype.forEach.call(scope.querySelectorAll('.admin-modal[data-expandable]'), function (modal) {
      if (modal.dataset.expandBound === 'true') return;
      modal.dataset.expandBound = 'true';

      apply(modal, read(modal.id));

      var toggle = modal.querySelector('[data-modal-expand]');
      if (!toggle) return;

      toggle.addEventListener('click', function (event) {
        event.stopPropagation();
        var expanded = !modal.classList.contains('is-expanded');
        apply(modal, expanded);
        write(modal.id, expanded);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () { init(); });

  window.NKSModalExpand = { init: init };
})();
