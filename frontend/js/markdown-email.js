(function () {
  'use strict';
  var EMAIL_INLINE_STYLES = {
    H1: 'margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#1a1a1a;',
    H2: 'margin:16px 0 10px;font-family:Georgia,serif;font-size:19px;color:#1a1a1a;',
    H3: 'margin:14px 0 8px;font-family:Georgia,serif;font-size:17px;color:#1a1a1a;',
    H4: 'margin:12px 0 8px;font-family:Georgia,serif;font-size:15px;color:#1a1a1a;',
    H5: 'margin:12px 0 8px;font-size:14px;color:#1a1a1a;',
    H6: 'margin:12px 0 8px;font-size:13px;color:#1a1a1a;',
    P: 'margin:0 0 12px;',
    UL: 'margin:0 0 12px;padding-left:22px;',
    OL: 'margin:0 0 12px;padding-left:22px;',
    LI: 'margin:0 0 6px;',
    BLOCKQUOTE: 'margin:0 0 12px;padding-left:14px;border-left:3px solid #ddd;color:#666;',
    PRE: 'margin:0 0 12px;padding:12px;background:#f4f4f4;border-radius:4px;overflow-x:auto;',
    CODE: 'background:#f4f4f4;border-radius:3px;padding:2px 5px;font-size:0.9em;',
    HR: 'border:none;border-top:1px solid #ddd;margin:16px 0;',
    TABLE: 'border-collapse:collapse;width:100%;margin:0 0 12px;',
    TH: 'border:1px solid #ddd;padding:6px 10px;text-align:left;',
    TD: 'border:1px solid #ddd;padding:6px 10px;'
  };

  function toEmailHtml(markdown) {
    if (!markdown || typeof marked === 'undefined') return '';
    var html = marked.parse(markdown.trim(), { breaks: true, gfm: true });

    var container = document.createElement('div');
    container.innerHTML = html;

    Array.prototype.forEach.call(container.querySelectorAll('*'), function (el) {
      var style = EMAIL_INLINE_STYLES[el.tagName];
      if (style) el.setAttribute('style', style);
    });
    // A <code> inside a <pre> already inherits the block's background - undo the
    // standalone inline-code styling so it isn't doubled up.
    Array.prototype.forEach.call(container.querySelectorAll('pre code'), function (el) {
      el.setAttribute('style', 'background:none;padding:0;');
    });
    Array.prototype.forEach.call(container.querySelectorAll('a'), function (el) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
      el.setAttribute('style', 'color:#1a3080;');
    });

    return container.innerHTML;
  }

  var WRAP_SYNTAX = { bold: '**', italic: '*' };
  var LINE_PREFIX = { heading: '## ', ul: '- ', ol: '1. ', quote: '> ' };

  /**
   * Wires the formatting buttons. A toolbar names its textarea with
   * data-md-target, so several editors can coexist on one page.
   */
  function initToolbars(root) {
    var scope = root || document;

    Array.prototype.forEach.call(scope.querySelectorAll('.markdown-toolbar-btn'), function (btn) {
      if (btn.dataset.mdBound === 'true') return;
      btn.dataset.mdBound = 'true';

      btn.addEventListener('click', function () {
        var type = btn.dataset.md;
        var toolbar = btn.closest('.markdown-toolbar');
        var input = toolbar && document.getElementById(toolbar.dataset.mdTarget);
        if (!input) return;

        var start = input.selectionStart;
        var end = input.selectionEnd;
        var value = input.value;
        var selected = value.slice(start, end);
        var text, cursor;

        if (type === 'link') {
          var inserted = '[' + (selected || 'link text') + '](https://example.com)';
          text = value.slice(0, start) + inserted + value.slice(end);
          cursor = start + inserted.length;
        } else if (type === 'code') {
          var codeInserted = selected.indexOf('\n') !== -1
            ? '```\n' + selected + '\n```'
            : '`' + (selected || 'code') + '`';
          text = value.slice(0, start) + codeInserted + value.slice(end);
          cursor = start + codeInserted.length;
        } else if (WRAP_SYNTAX[type]) {
          var wrap = WRAP_SYNTAX[type];
          var wrapped = wrap + (selected || (type === 'bold' ? 'bold text' : 'italic text')) + wrap;
          text = value.slice(0, start) + wrapped + value.slice(end);
          cursor = start + wrapped.length;
        } else if (LINE_PREFIX[type]) {
          var prefix = LINE_PREFIX[type];
          var lineStart = value.lastIndexOf('\n', start - 1) + 1;
          text = value.slice(0, lineStart) + prefix + value.slice(lineStart);
          cursor = start + prefix.length;
        } else {
          return;
        }

        input.value = text;
        input.focus();
        input.setSelectionRange(cursor, cursor);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  window.NKSMarkdown = { toEmailHtml: toEmailHtml, initToolbars: initToolbars };
})();
