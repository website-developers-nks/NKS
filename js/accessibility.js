
(function () {
  'use strict';

  var STORAGE_KEY = 'nks-a11y-v1';
  var MASK_WIN_H  = 100;

  var DEFAULTS = {
    fontSizeStep    : 0,
    lineHeightStep  : 0,
    letterSpacingStep: 0,
    fontWeight      : false,
    bigCursor       : false,
    highContrast    : false,
    hideImages      : false,
    stopAnimations  : false,
    readingLine     : false,
    readingMask     : false,
  };

  var state = {};
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });

  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      Object.keys(DEFAULTS).forEach(function (k) {
        if (k in saved) state[k] = saved[k];
      });
    }
  } catch (e) {}

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  var dynStyle = null;

  function updateDynamicStyle() {
    if (!dynStyle) {
      dynStyle = document.createElement('style');
      dynStyle.id = 'nks-a11y-dyn';
      document.head.appendChild(dynStyle);
    }
    var css = '';
    if (state.lineHeightStep !== 0) {
      var lh = (1.5 + state.lineHeightStep * 0.3).toFixed(2);
      css += 'body *{line-height:' + lh + '!important}';
    }
    if (state.letterSpacingStep !== 0) {
      var ls = (state.letterSpacingStep * 0.8).toFixed(1);
      css += 'body *{letter-spacing:' + ls + 'px!important}';
    }

    css += '#nks-a11y-widget,#nks-a11y-widget *{line-height:1.4!important;letter-spacing:normal!important}';
    dynStyle.textContent = css;
  }

  function applyAll() {
    var html = document.documentElement;
    var body = document.body;

    var zoom = 1 + state.fontSizeStep * 0.1;
    body.style.zoom = (zoom !== 1) ? String(zoom) : '';

    updateDynamicStyle();

    toggle(html, 'acc-bold',        state.fontWeight);
    toggle(html, 'acc-big-cursor',  state.bigCursor);
    toggle(html, 'acc-high-contrast', state.highContrast);
    toggle(html, 'acc-hide-images', state.hideImages);
    toggle(html, 'acc-stop-anim',   state.stopAnimations);

    window.nksA11yAnimPaused = state.stopAnimations;
    toggle(html, 'acc-reading-line', state.readingLine);
    toggle(html, 'acc-reading-mask', state.readingMask);

    save();
    refreshUI();
  }

  function toggle(el, cls, on) {
    el.classList[on ? 'add' : 'remove'](cls);
  }

  var ui = { checkboxes: {}, stepUpdaters: {} };

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className')   { e.className = attrs[k]; }
        else                     { e.setAttribute(k, attrs[k]); }
      });
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + path + '</svg>';
  }

  var IC = {
    access    : svg('<path d="M20.5 6c-2.61.7-5.67 1-8.5 1s-5.89-.3-8.5-1L3 8c1.86.5 4 .83 6 1v13h2v-6h2v6h2V9c2-.17 4.14-.5 6-1l-.5-2zM12 6c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>'),
    close     : svg('<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>'),
    fontSize  : svg('<path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z"/>'),
    lineHt    : svg('<path d="M6 7h2.5L5 3.5 1.5 7H4v10H1.5L5 20.5 8.5 17H6V7zm4-2v2h12V5H10zm0 14h12v-2H10v2zm0-6h12v-2H10v2z"/>'),
    bold      : svg('<path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>'),
    letterSp  : svg('<path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v14h2V5H7zm4 0v14h2V5h-2zm4 0v14h2V5h-2zm4 0v14h2V5h-2z"/>'),
    contrast  : svg('<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 2v14c-3.87 0-7-3.13-7-7s3.13-7 7-7z"/>'),
    cursor    : svg('<path d="M4 0l16 12.279-6.951 1.17 4.325 8.817-3.596 1.734-4.35-8.879L4 18.617z"/>'),
    hideImg   : svg('<path d="M21.9 21.9l-8.49-8.49-9.82-9.82L2.1 5.07 5 8l.16.16C3.18 10.46 2 12.15 2 12s3.75-8 10-8c1.09 0 2.12.19 3.09.49l2.21 2.21A9.6 9.6 0 0 1 12 6c-3.35 0-6.27 1.88-7.78 4.65L6.5 12.93A5 5 0 0 1 12 8c.68 0 1.33.13 1.93.36l2.12 2.12A3 3 0 0 0 12 11a3 3 0 0 0-3 3c0 .32.05.63.14.92L11 16.82A5 5 0 0 1 7.07 12l-1.5-1.5A9.56 9.56 0 0 0 5 12c0 3.87 2.33 7.21 5.72 8.63L12 22l1.29-1.29c-.17.01-.33.04-.5.07l-.07.07-1.5-1.5C9.85 18.96 8 16.68 8 14c0-.37.04-.74.1-1.1L5.07 9.87A9.96 9.96 0 0 0 2 12c0 5.52 4.48 10 10 10 2.7 0 5.15-1.07 6.96-2.79l1.45 1.45 1.49-1.76zM12 20c-4.41 0-8-3.59-8-8 0-1.48.41-2.86 1.12-4.05L12 14.93V20zm0-14c4.41 0 8 3.59 8 8 0 1.48-.41 2.86-1.12 4.05L12 11.07V6z"/>'),
    stopAnim  : svg('<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'),
    readLine  : svg('<path d="M3 9v2h18V9H3zm0 8h18v-2H3v2zm0-4h18v-2H3v2z"/>'),
    readMask  : svg('<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-7-9H7v4h10v-4z"/>'),
  };

  function makeSwitch(key) {
    var label = el('label', { className: 'nks-a11y-switch', title: key });
    var input = el('input', { type: 'checkbox' });
    input.checked = !!state[key];
    input.addEventListener('change', function () {
      state[key] = input.checked;
      applyAll();
    });
    var track = el('span', { className: 'nks-a11y-switch-track' });
    label.appendChild(input);
    label.appendChild(track);
    ui.checkboxes[key] = input;
    return label;
  }

  function makeStepper(key, min, max, fmt) {
    var wrap = el('div', { className: 'nks-a11y-stepper' });
    var dec  = el('button', { className: 'nks-a11y-st-btn', 'aria-label': 'Decrease', type: 'button' });
    dec.innerHTML = '&#8722;';
    var valSpan = el('span', { className: 'nks-a11y-st-val' });
    var inc  = el('button', { className: 'nks-a11y-st-btn', 'aria-label': 'Increase', type: 'button' });
    inc.innerHTML = '+';

    function update() {
      var v = state[key];
      valSpan.textContent = fmt ? fmt(v) : String(v);
      valSpan.className = 'nks-a11y-st-val' + (v !== 0 ? ' nks-active' : '');
      dec.disabled = (v <= min);
      inc.disabled = (v >= max);
    }

    dec.addEventListener('click', function () {
      if (state[key] > min) { state[key]--; applyAll(); }
    });
    inc.addEventListener('click', function () {
      if (state[key] < max) { state[key]++; applyAll(); }
    });

    wrap.appendChild(dec);
    wrap.appendChild(valSpan);
    wrap.appendChild(inc);
    ui.stepUpdaters[key] = update;
    update();
    return wrap;
  }

  function makeRow(iconHtml, labelText, control) {
    var row = el('div', { className: 'nks-a11y-row' });
    var lbl = el('div', { className: 'nks-a11y-row-lbl' });
    var iconWrap = el('span');
    iconWrap.innerHTML = iconHtml;
    lbl.appendChild(iconWrap);
    lbl.appendChild(document.createTextNode(labelText));
    row.appendChild(lbl);
    row.appendChild(control);
    return row;
  }

  function makeGrpLabel(text) {
    var d = el('div', { className: 'nks-a11y-grp-lbl' });
    d.textContent = text;
    return d;
  }

  function createWidget() {
    var widget = el('div', { id: 'nks-a11y-widget', role: 'region', 'aria-label': 'Accessibility Options' });

    var panel = el('div', { id: 'nks-a11y-panel', role: 'dialog', 'aria-label': 'Accessibility Panel', 'aria-modal': 'false' });

    var hdr = el('div', { className: 'nks-a11y-hdr' });

    var title = el('div', { className: 'nks-a11y-hdr-title' });
    var titleIcon = el('span');
    titleIcon.innerHTML = IC.access;
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode('Accessibility'));

    var closeBtn = el('button', { className: 'nks-a11y-hdr-close', 'aria-label': 'Close accessibility panel', type: 'button' });
    closeBtn.innerHTML = IC.close;
    closeBtn.addEventListener('click', closePanel);

    hdr.appendChild(title);
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    var body = el('div', { className: 'nks-a11y-body' });

    body.appendChild(makeGrpLabel('Text'));

    body.appendChild(makeRow(IC.fontSize, 'Font Size',
      makeStepper('fontSizeStep', -3, 6, function (v) {
        if (v === 0) return 'Default';
        return (v > 0 ? '+' : '') + (v * 10) + '%';
      })
    ));

    body.appendChild(makeRow(IC.lineHt, 'Line Height',
      makeStepper('lineHeightStep', 0, 5, function (v) {
        return v === 0 ? 'Default' : '+' + v;
      })
    ));

    body.appendChild(makeRow(IC.bold, 'Bold Text', makeSwitch('fontWeight')));

    body.appendChild(makeRow(IC.letterSp, 'Letter Spacing',
      makeStepper('letterSpacingStep', -1, 5, function (v) {
        if (v === 0) return 'Default';
        return (v > 0 ? '+' : '') + (v * 0.8).toFixed(1) + 'px';
      })
    ));

    body.appendChild(el('div', { className: 'nks-a11y-divider' }));

    body.appendChild(makeGrpLabel('Display'));
    body.appendChild(makeRow(IC.contrast,  'High Contrast',   makeSwitch('highContrast')));
    body.appendChild(makeRow(IC.cursor,    'Big Cursor',      makeSwitch('bigCursor')));
    body.appendChild(makeRow(IC.hideImg,   'Hide Images',     makeSwitch('hideImages')));
    body.appendChild(makeRow(IC.stopAnim,  'Stop Animations', makeSwitch('stopAnimations')));

    body.appendChild(el('div', { className: 'nks-a11y-divider' }));

    body.appendChild(makeGrpLabel('Reading'));
    body.appendChild(makeRow(IC.readLine, 'Reading Line', makeSwitch('readingLine')));
    body.appendChild(makeRow(IC.readMask, 'Reading Mask', makeSwitch('readingMask')));

    panel.appendChild(body);

    var ftr = el('div', { className: 'nks-a11y-ftr' });
    var resetBtn = el('button', { className: 'nks-a11y-reset-btn', type: 'button', 'aria-label': 'Reset all accessibility settings' });
    resetBtn.textContent = 'Reset All Settings';
    resetBtn.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
      applyAll();
    });
    ftr.appendChild(resetBtn);
    panel.appendChild(ftr);

    widget.appendChild(panel);
    document.documentElement.appendChild(widget);

    var toggleBtn = el('button', {
      id: 'nks-a11y-toggle-btn',
      'aria-label': 'Open accessibility options',
      'aria-expanded': 'false',
      'aria-controls': 'nks-a11y-panel',
      type: 'button',
    });
    toggleBtn.innerHTML = IC.access;
    toggleBtn.addEventListener('click', function () {
      panel.classList.contains('nks-open') ? closePanel() : openPanel();
    });

    var navActions = document.querySelector('.nav-actions');
    if (navActions) {

      var listenBtn = document.getElementById('listenNavBtn');
      var themeToggle = navActions.querySelector('.theme-toggle');
      var anchor = listenBtn || themeToggle;
      if (anchor) {
        navActions.insertBefore(toggleBtn, anchor);
      } else {
        navActions.insertBefore(toggleBtn, navActions.firstChild);
      }
    }

    ui.panel     = panel;
    ui.toggleBtn = toggleBtn;

    document.addEventListener('click', function (e) {
      if (ui.panel.classList.contains('nks-open') &&
          !widget.contains(e.target) &&
          e.target !== toggleBtn &&
          !toggleBtn.contains(e.target)) {
        closePanel();
      }
    });

    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.keyCode === 27) && ui.panel.classList.contains('nks-open')) {
        closePanel();
        ui.toggleBtn.focus();
      }
    });
  }

  function openPanel() {
    var rect    = ui.toggleBtn.getBoundingClientRect();
    var panel   = ui.panel;
    var pWidth  = 292;
    var gap     = 8;
    var margin  = 8;

    panel.style.top = (rect.bottom + gap) + 'px';

    var idealLeft = rect.right - pWidth;
    var clampedLeft = Math.min(
      Math.max(idealLeft, margin),
      window.innerWidth - pWidth - margin
    );
    panel.style.left = clampedLeft + 'px';

    var openFromRight = rect.right > window.innerWidth / 2;
    panel.style.transformOrigin = 'top ' + (openFromRight ? 'right' : 'left');

    var listenTray = document.getElementById('listenTray');
    if (listenTray) listenTray.classList.remove('open');

    panel.classList.add('nks-open');
    ui.toggleBtn.setAttribute('aria-expanded', 'true');
    ui.toggleBtn.classList.add('nks-active');
  }

  function closePanel() {
    ui.panel.classList.remove('nks-open');
    ui.toggleBtn.setAttribute('aria-expanded', 'false');
    ui.toggleBtn.classList.remove('nks-active');
  }

  function refreshUI() {
    Object.keys(ui.checkboxes).forEach(function (k) {
      ui.checkboxes[k].checked = !!state[k];
    });
    Object.keys(ui.stepUpdaters).forEach(function (k) {
      ui.stepUpdaters[k]();
    });
  }

  function createOverlays() {
    var line    = el('div', { id: 'nks-a11y-reading-line',  'aria-hidden': 'true' });
    var maskTop = el('div', { id: 'nks-a11y-mask-top',      'aria-hidden': 'true' });
    var maskBot = el('div', { id: 'nks-a11y-mask-bottom',   'aria-hidden': 'true' });
    document.body.appendChild(line);
    document.body.appendChild(maskTop);
    document.body.appendChild(maskBot);
  }

  function updateOverlays(clientY) {
    var line = document.getElementById('nks-a11y-reading-line');
    if (line) line.style.top = clientY + 'px';

    var half = MASK_WIN_H / 2;
    var mt = document.getElementById('nks-a11y-mask-top');
    var mb = document.getElementById('nks-a11y-mask-bottom');
    if (mt) mt.style.height = Math.max(0, clientY - half) + 'px';
    if (mb) mb.style.height = Math.max(0, window.innerHeight - clientY - half) + 'px';
  }

  document.addEventListener('mousemove', function (e) {
    updateOverlays(e.clientY);
  });

  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches[0]) updateOverlays(e.touches[0].clientY);
  }, { passive: true });

  function init() {
    createWidget();
    createOverlays();
    applyAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
