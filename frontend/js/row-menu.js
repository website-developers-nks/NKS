(function () {
  'use strict';

  var open = null;

  function close() {
    if (!open) return;
    open.list.hidden = true;
    open.button.setAttribute('aria-expanded', 'false');
    open.wrap.classList.remove('is-open');
    open = null;
  }

  document.addEventListener('click', function (event) {
    if (open && !open.wrap.contains(event.target)) close();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') close();
  });

  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);

  function position(button, list) {
    var rect = button.getBoundingClientRect();
    var height = list.offsetHeight;
    var width = list.offsetWidth;

    // Flip above the button when there isn't room below it.
    var top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }

    // Right-align with the button, without running off the left edge.
    var left = Math.max(8, rect.right - width);

    list.style.top = top + 'px';
    list.style.left = left + 'px';
  }

  function build(items, extraField) {
    var wrap = document.createElement('div');
    wrap.className = 'row-menu';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-menu-btn';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Actions');
    button.innerHTML = '&#8942;';

    var list = document.createElement('div');
    list.className = 'row-menu-list';
    list.hidden = true;

    list.addEventListener('click', function (event) { event.stopPropagation(); });

    (items || []).forEach(function (item) {
      var entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'row-menu-item' + (item.danger ? ' is-danger' : '');
      entry.textContent = item.label;
      entry.addEventListener('click', function () {
        if (!item.keepOpen) close();
        item.onSelect(entry);
      });
      list.appendChild(entry);
    });

    if (extraField) {
      var field = document.createElement('div');
      field.className = 'row-menu-field';

      var label = document.createElement('span');
      label.textContent = extraField.label;
      field.appendChild(label);
      field.appendChild(extraField.control);
      list.appendChild(field);
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var wasOpen = open && open.wrap === wrap;
      close();
      if (wasOpen) return;

      list.hidden = false;
      position(button, list);
      button.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      open = { wrap: wrap, list: list, button: button };
    });

    wrap.appendChild(button);
    wrap.appendChild(list);
    return wrap;
  }

  window.NKSRowMenu = { build: build, close: close };
})();
