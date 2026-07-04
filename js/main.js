
document.addEventListener('DOMContentLoaded', function() {

  initSplash();

  initThemeToggle();

  initMobileMenu();

  initScrollAnimations();

  initParallax();

  initWordReveal();

  initAccordion();

  initTimelineAnimation();

  initContactForm();

  initListenButton();

});

function initSplash() {
  var splash = document.getElementById('splash');
  if (!splash) return;

  var hidden = false;
  function hide() {
    if (hidden) return;
    hidden = true;
    splash.classList.add('splash-hidden');
    setTimeout(function() {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, 600);
  }

  // Keep the splash on screen briefly for a polished reveal, then hide once the
  // DOM is ready. A longer fallback guarantees it never gets stuck on slow loads.
  setTimeout(hide, 800);
  window.addEventListener('load', function() { setTimeout(hide, 200); });
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initThemeToggle() {
  const themeToggle = document.querySelector('.theme-toggle');

  if (!themeToggle) return;

  const savedTheme = localStorage.getItem('theme') || getSystemTheme();
  document.documentElement.setAttribute('data-theme', savedTheme);

  themeToggle.addEventListener('click', function() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
    if (!localStorage.getItem('theme')) {
      const newTheme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
    }
  });
}

(function() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const savedTheme = localStorage.getItem('theme') || systemTheme;
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

function initMobileMenu() {
  const hamburger = document.querySelector('.nav-hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');

  if (!hamburger || !mobileMenu) return;

  hamburger.addEventListener('click', function() {
    hamburger.classList.toggle('active');
    mobileMenu.classList.toggle('active');
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
  });

  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('active');
      mobileMenu.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

function initScrollAnimations() {
  const observerOptions = {
    root: null,
    rootMargin: '-100px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');

        const children = entry.target.querySelectorAll('.stagger-child');
        children.forEach((child, index) => {
          setTimeout(() => {
            child.classList.add('visible');
          }, index * 80);
        });

        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
}

function initParallax() {
  const parallaxElements = document.querySelectorAll('.parallax');

  if (parallaxElements.length === 0 || window.innerWidth < 768) return;

  let ticking = false;

  function updateParallax() {
    const scrollY = window.pageYOffset;

    parallaxElements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const elementTop = rect.top + scrollY;
      const elementVisible = scrollY + window.innerHeight > elementTop && scrollY < elementTop + rect.height;

      if (elementVisible) {
        const speed = parseFloat(el.dataset.speed) || 0.4;
        const yOffset = (scrollY - elementTop) * speed;
        el.style.transform = `translateY(${yOffset}px)`;
      }
    });

    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateParallax);
      ticking = true;
    }
  });
}

function initWordReveal() {
  const aboutText = document.querySelector('.about-text');

  if (!aboutText) return;

  const text = aboutText.textContent;
  const words = text.split(' ');
  aboutText.innerHTML = words.map(word => `<span class="word">${word}</span>`).join(' ');

  const wordSpans = aboutText.querySelectorAll('.word');
  const section = aboutText.closest('.about-section') || aboutText.closest('.section');

  function updateWordReveal() {
    const rect = section.getBoundingClientRect();
    const windowHeight = window.innerHeight;

    const sectionTop = rect.top;
    const sectionHeight = rect.height;

    const startOffset = windowHeight * 0.8;
    const endOffset = windowHeight * 0.2;

    const progress = Math.max(0, Math.min(1,
      (startOffset - sectionTop) / (startOffset - endOffset + sectionHeight * 0.5)
    ));

    const wordsToShow = Math.floor(progress * wordSpans.length);

    wordSpans.forEach((word, index) => {
      if (index < wordsToShow) {
        word.style.opacity = '1';
      } else if (index === wordsToShow) {

        const wordProgress = (progress * wordSpans.length) - wordsToShow;
        word.style.opacity = 0.15 + (wordProgress * 0.85);
      } else {
        word.style.opacity = '0.15';
      }
    });
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        updateWordReveal();
        ticking = false;
      });
      ticking = true;
    }
  });

  updateWordReveal();
}

function initAccordion() {
  const accordionItems = document.querySelectorAll('.accordion-item');

  accordionItems.forEach(item => {
    const header = item.querySelector('.accordion-header');

    header.addEventListener('click', () => {
      const isActive = item.classList.contains('active');

      accordionItems.forEach(otherItem => {
        otherItem.classList.remove('active');
      });

      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}

function initTimelineAnimation() {
  const timelineItems = document.querySelectorAll('.timeline-item');

  if (timelineItems.length === 0) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    rootMargin: '-50px',
    threshold: 0.1
  });

  timelineItems.forEach((item, index) => {
    item.style.transitionDelay = `${index * 0.1}s`;
    observer.observe(item);
  });
}

function initContactForm() {
  const form = document.querySelector('.contact-form');

  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();

    const name = form.querySelector('input[name="name"]').value;
    const email = form.querySelector('input[name="email"]').value;
    const message = form.querySelector('textarea[name="message"]').value;

    if (!name || !email || !message) {
      alert('Please fill in all fields.');
      return;
    }

    alert('Thank you for your message. We will get back to you soon.');
    form.reset();
  });
}

document.querySelectorAll('a[href^="./"]').forEach(link => {
  link.addEventListener('click', function(e) {
    const href = this.getAttribute('href');

    if (href === window.location.pathname || href.startsWith('http')) return;

    e.preventDefault();

    document.body.style.opacity = '0';
    document.body.style.transform = 'translateY(8px)';
    document.body.style.transition = 'all 0.3s ease';

    setTimeout(() => {
      window.location.href = href;
    }, 300);
  });
});

window.addEventListener('load', function() {
  document.body.style.opacity = '1';
  document.body.style.transform = 'translateY(0)';

  setTimeout(function() {
    document.body.style.transform = 'none';
  }, 400);
});

function initListenButton() {
  if (!window.speechSynthesis) return;

  var style = document.createElement('style');
  style.textContent = [

    '.listen-nav-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:transparent;border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:all .3s ease;flex-shrink:0;color:var(--text-secondary);position:relative;}',
    '.listen-nav-btn:hover{border-color:var(--accent);color:var(--text-primary);}',
    '.listen-nav-btn.active{border-color:var(--accent);color:var(--accent);}',
    '.listen-nav-btn svg{width:18px;height:18px;fill:currentColor;transition:fill .3s;}',
    '.listen-nav-btn.active::after{content:"";position:absolute;top:6px;right:6px;width:5px;height:5px;border-radius:50%;background:var(--accent);}',
    '@media(max-width:1023px){.listen-nav-btn{position:absolute;right:104px;top:50%;transform:translateY(-50%);}}',

    '.listen-tray{position:fixed;top:0;left:0;width:300px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 16px 56px rgba(0,0,0,.45);z-index:9997;display:flex;flex-direction:column;overflow:hidden;transform-origin:top right;transform:scale(.94) translateY(-10px);opacity:0;visibility:hidden;pointer-events:none;transition:transform .22s cubic-bezier(.34,1.56,.64,1),opacity .18s ease,visibility 0s linear .22s;}',
    '.listen-tray.open{transform:scale(1) translateY(0);opacity:1;visibility:visible;pointer-events:auto;transition:transform .22s cubic-bezier(.34,1.56,.64,1),opacity .18s ease,visibility 0s linear 0s;}',
    '@media(max-width:320px){.listen-tray{width:calc(100vw - 16px);}}',

    '.listen-tray-header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border);flex-shrink:0;}',
    '.listen-tray-title{font-family:"Inter",sans-serif;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--text-secondary);}',
    '.listen-tray-close{width:28px;height:28px;border-radius:4px;border:1px solid var(--border);background:transparent;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;transition:all .2s;}',
    '.listen-tray-close:hover{border-color:var(--accent);color:var(--text-primary);}',
    '.listen-tray-close svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;}',

    '.listen-tray-body{max-height:60vh;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:0;}',
    '.listen-tray-body::-webkit-scrollbar{width:3px;}',
    '.listen-tray-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}',

    '.listen-status{font-family:"Inter",sans-serif;font-size:20px;font-weight:500;color:var(--text-primary);margin-bottom:4px;}',
    '.listen-status-sub{font-family:"Inter",sans-serif;font-size:12px;color:var(--text-secondary);margin-bottom:20px;}',

    '.listen-tray-waves{display:flex;align-items:center;gap:3px;height:40px;margin-bottom:24px;}',
    '.listen-tray-waves span{display:block;width:4px;border-radius:3px;background:var(--accent);transition:opacity .2s;}',
    '.listen-tray-waves.playing span{animation:trayWave .9s ease-in-out infinite;}',
    '.listen-tray-waves.paused span{animation:none;height:4px!important;opacity:.35;}',
    '.listen-tray-waves.idle span{height:4px!important;opacity:.18;animation:none;}',
    '.listen-tray-waves span:nth-child(1){animation-delay:.00s}',
    '.listen-tray-waves span:nth-child(2){animation-delay:.10s}',
    '.listen-tray-waves span:nth-child(3){animation-delay:.20s}',
    '.listen-tray-waves span:nth-child(4){animation-delay:.05s}',
    '.listen-tray-waves span:nth-child(5){animation-delay:.15s}',
    '.listen-tray-waves span:nth-child(6){animation-delay:.08s}',
    '.listen-tray-waves span:nth-child(7){animation-delay:.18s}',
    '.listen-tray-waves span:nth-child(8){animation-delay:.03s}',
    '@keyframes trayWave{0%,100%{height:5px;opacity:.4}50%{height:36px;opacity:1}}',

    '.listen-divider{height:1px;background:var(--border);margin:20px 0;}',

    '.listen-section-label{font-family:"Inter",sans-serif;font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:16px;}',

    '.listen-ctrl-row{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;}',
    '.listen-ctrl-top{display:flex;justify-content:space-between;align-items:center;}',
    '.listen-ctrl-label{font-family:"Inter",sans-serif;font-size:12px;color:var(--text-secondary);}',
    '.listen-ctrl-value{font-family:"Inter",sans-serif;font-size:12px;font-weight:500;color:var(--text-primary);min-width:36px;text-align:right;}',

    '.listen-range{-webkit-appearance:none;appearance:none;width:100%;height:3px;border-radius:2px;background:var(--border);outline:none;cursor:pointer;}',
    '.listen-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid var(--surface);box-shadow:0 0 0 1px var(--accent);}',
    '.listen-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid var(--surface);box-shadow:0 0 0 1px var(--accent);}',

    '.listen-voice-select{width:100%;padding:8px 10px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-family:"Inter",sans-serif;font-size:12px;cursor:pointer;outline:none;transition:border-color .2s;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%23888\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;}',
    '.listen-voice-select:focus{border-color:var(--accent);}',
    '.listen-voice-select option{background:var(--surface,#111);color:var(--text-primary,#fff);}',

    '.listen-advanced-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;background:transparent;border:none;padding:0;cursor:pointer;margin-bottom:0;}',
    '.listen-advanced-toggle .listen-section-label{margin-bottom:0;cursor:pointer;}',
    '.listen-advanced-chevron{width:14px;height:14px;stroke:var(--text-secondary);fill:none;stroke-width:2;transition:transform .25s ease;flex-shrink:0;}',
    '.listen-advanced-toggle.open .listen-advanced-chevron{transform:rotate(180deg);}',
    '.listen-advanced-body{overflow:hidden;max-height:0;transition:max-height .3s ease;display:flex;flex-direction:column;gap:0;}',
    '.listen-advanced-body.open{max-height:200px;}',
    '.listen-advanced-inner{padding-top:14px;display:flex;flex-direction:column;gap:0;}',

    '.listen-tray-footer{padding:16px 24px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;flex-shrink:0;}',
    '.listen-tray-btn{width:100%;padding:11px 0;border-radius:4px;border:1px solid var(--border);background:transparent;cursor:pointer;font-family:"Inter",sans-serif;font-size:13px;font-weight:500;color:var(--text-primary);transition:all .2s;letter-spacing:.04em;}',
    '.listen-tray-btn:hover{border-color:var(--accent);color:var(--accent);}',
    '.listen-tray-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;}',
    '.listen-tray-btn.primary:hover{opacity:.85;}',
  ].join('');
  document.head.appendChild(style);

  var waveBars = '';
  for (var i = 0; i < 8; i++) waveBars += '<span></span>';

  var navActions = document.querySelector('.nav-actions');
  if (navActions) {
    var navBtn = document.createElement('button');
    navBtn.id = 'listenNavBtn';
    navBtn.className = 'listen-nav-btn';
    navBtn.setAttribute('aria-label', 'Listen to page');
    navBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    navActions.insertBefore(navBtn, navActions.querySelector('.theme-toggle'));
  }

  var tray = document.createElement('div');
  tray.className = 'listen-tray';
  tray.id = 'listenTray';
  tray.innerHTML =
    '<div class="listen-tray-header">' +
      '<span class="listen-tray-title">Text to Speech</span>' +
      '<button class="listen-tray-close" id="listenTrayClose" aria-label="Close">' +
        '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>' +

    '<div class="listen-tray-body">' +
      '<div class="listen-status" id="listenStatus">Ready</div>' +
      '<div class="listen-status-sub" id="listenStatusSub">Press play to listen to this page</div>' +
      '<div class="listen-tray-waves idle" id="listenWaves">' + waveBars + '</div>' +

      '<div class="listen-divider"></div>' +
      '<div class="listen-section-label">Settings</div>' +

      '<div class="listen-ctrl-row">' +
        '<div class="listen-ctrl-top">' +
          '<span class="listen-ctrl-label">Volume</span>' +
          '<span class="listen-ctrl-value" id="listenVolVal">100%</span>' +
        '</div>' +
        '<input type="range" class="listen-range" id="listenVol" min="0" max="1" step="0.05" value="1">' +
      '</div>' +

      '<div class="listen-ctrl-row">' +
        '<div class="listen-ctrl-top">' +
          '<span class="listen-ctrl-label">Speed</span>' +
          '<span class="listen-ctrl-value" id="listenSpeedVal">1.0×</span>' +
        '</div>' +
        '<input type="range" class="listen-range" id="listenSpeed" min="0.5" max="2" step="0.1" value="1">' +
      '</div>' +

      '<div class="listen-divider"></div>' +

      '<button class="listen-advanced-toggle" id="listenAdvancedToggle">' +
        '<span class="listen-section-label">Advanced</span>' +
        '<svg class="listen-advanced-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</button>' +

      '<div class="listen-advanced-body" id="listenAdvancedBody">' +
        '<div class="listen-advanced-inner">' +

          '<div class="listen-ctrl-row">' +
            '<div class="listen-ctrl-top">' +
              '<span class="listen-ctrl-label">Voice</span>' +
            '</div>' +
            '<select class="listen-voice-select" id="listenVoiceSelect"><option>Loading voices…</option></select>' +
          '</div>' +

          '<div class="listen-ctrl-row">' +
            '<div class="listen-ctrl-top">' +
              '<span class="listen-ctrl-label">Pitch</span>' +
              '<span class="listen-ctrl-value" id="listenPitchVal">1.0</span>' +
            '</div>' +
            '<input type="range" class="listen-range" id="listenPitch" min="0.5" max="2" step="0.1" value="1">' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="listen-tray-footer">' +
      '<button class="listen-tray-btn primary" id="listenPlayBtn">Play</button>' +
      '<button class="listen-tray-btn" id="listenStopBtn">Stop</button>' +
    '</div>';
  document.body.appendChild(tray);

  var navBtnEl    = document.getElementById('listenNavBtn');
  var trayEl      = document.getElementById('listenTray');
  var closeBtn    = document.getElementById('listenTrayClose');
  var playBtn     = document.getElementById('listenPlayBtn');
  var stopBtn     = document.getElementById('listenStopBtn');
  var statusEl    = document.getElementById('listenStatus');
  var statusSub   = document.getElementById('listenStatusSub');
  var wavesEl     = document.getElementById('listenWaves');
  var voiceSel    = document.getElementById('listenVoiceSelect');
  var speedRange  = document.getElementById('listenSpeed');
  var speedVal    = document.getElementById('listenSpeedVal');
  var volRange    = document.getElementById('listenVol');
  var volVal      = document.getElementById('listenVolVal');
  var pitchRange  = document.getElementById('listenPitch');
  var pitchVal    = document.getElementById('listenPitchVal');
  var synth       = window.speechSynthesis;
  var voices      = [];
  var currentUtt  = null;

  function loadVoices() {
    voices = synth.getVoices();
    if (!voices.length) return;
    voiceSel.innerHTML = voices.map(function(v, i) {
      return '<option value="' + i + '">' + v.name + ' (' + v.lang + ')</option>';
    }).join('');

    var engIdx = voices.findIndex(function(v) { return v.lang.startsWith('en'); });
    if (engIdx > -1) voiceSel.value = engIdx;
  }
  loadVoices();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;

  var advToggle = document.getElementById('listenAdvancedToggle');
  var advBody   = document.getElementById('listenAdvancedBody');
  advToggle.addEventListener('click', function() {
    var open = advBody.classList.toggle('open');
    advToggle.classList.toggle('open', open);
  });

  function onSettingChange() {
    if (synth.speaking) startReading();
  }

  speedRange.addEventListener('input', function() {
    speedVal.textContent = parseFloat(this.value).toFixed(1) + '×';
  });
  speedRange.addEventListener('change', onSettingChange);

  volRange.addEventListener('input', function() {
    volVal.textContent = Math.round(this.value * 100) + '%';
  });
  volRange.addEventListener('change', onSettingChange);

  pitchRange.addEventListener('input', function() {
    pitchVal.textContent = parseFloat(this.value).toFixed(1);
  });
  pitchRange.addEventListener('change', onSettingChange);

  voiceSel.addEventListener('change', onSettingChange);

  function getPageText() {
    var nodes = document.querySelectorAll('section h1, section h2, section h3, section p');
    return Array.from(nodes)
      .map(function(n) { return n.textContent.trim(); })
      .filter(function(t) { return t.length > 2; })
      .join('. ');
  }

  function setUIState(state) {
    wavesEl.className = 'listen-tray-waves ' + state;
    if (state === 'playing') {
      statusEl.textContent = 'Playing';
      statusSub.textContent = 'Listening to page content';
      playBtn.textContent = 'Pause';
      playBtn.classList.add('primary');
      navBtnEl.classList.add('active');
    } else if (state === 'paused') {
      statusEl.textContent = 'Paused';
      statusSub.textContent = 'Press resume to continue';
      playBtn.textContent = 'Resume';
      playBtn.classList.add('primary');
    } else {
      statusEl.textContent = 'Ready';
      statusSub.textContent = 'Press play to listen to this page';
      playBtn.textContent = 'Play';
      playBtn.classList.remove('primary');
      navBtnEl.classList.remove('active');
    }
  }

  function startReading() {
    synth.cancel();
    var utt = new SpeechSynthesisUtterance(getPageText());
    currentUtt = utt;
    utt.rate   = parseFloat(speedRange.value);
    utt.volume = parseFloat(volRange.value);
    utt.pitch  = parseFloat(pitchRange.value);
    if (voices.length) utt.voice = voices[parseInt(voiceSel.value)] || null;
    utt.onend   = function() { if (currentUtt === utt) setUIState('idle'); };
    utt.onerror = function() { if (currentUtt === utt) setUIState('idle'); };
    synth.speak(utt);
    setUIState('playing');
  }

  function openTray() {
    var rect   = navBtnEl.getBoundingClientRect();
    var pWidth = trayEl.offsetWidth || 300;
    var gap    = 8;
    var margin = 8;
    trayEl.style.top = (rect.bottom + gap) + 'px';
    var idealLeft   = rect.right - pWidth;
    var clampedLeft = Math.min(
      Math.max(idealLeft, margin),
      window.innerWidth - pWidth - margin
    );
    trayEl.style.left = clampedLeft + 'px';
    trayEl.style.transformOrigin = 'top ' + (rect.right > window.innerWidth / 2 ? 'right' : 'left');

    var a11yPanel = document.getElementById('nks-a11y-panel');
    if (a11yPanel && a11yPanel.classList.contains('nks-open')) {
      a11yPanel.classList.remove('nks-open');
      var a11yBtn = document.getElementById('nks-a11y-toggle-btn');
      if (a11yBtn) {
        a11yBtn.setAttribute('aria-expanded', 'false');
        a11yBtn.classList.remove('nks-active');
      }
    }

    trayEl.classList.add('open');
  }
  function closeTray() { trayEl.classList.remove('open'); }

  navBtnEl.addEventListener('click', function(e) {
    e.stopPropagation();
    trayEl.classList.contains('open') ? closeTray() : openTray();
  });
  closeBtn.addEventListener('click', closeTray);

  document.addEventListener('click', function(e) {
    if (trayEl.classList.contains('open') &&
        !trayEl.contains(e.target) &&
        e.target !== navBtnEl &&
        !navBtnEl.contains(e.target)) {
      closeTray();
    }
  });

  document.addEventListener('keydown', function(e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && trayEl.classList.contains('open')) {
      closeTray();
      navBtnEl.focus();
    }
  });

  playBtn.addEventListener('click', function() {
    if (synth.speaking && !synth.paused) {
      synth.pause(); setUIState('paused');
    } else if (synth.paused) {
      synth.resume(); setUIState('playing');
    } else {
      startReading();
    }
  });

  stopBtn.addEventListener('click', function() { currentUtt = null; synth.cancel(); setUIState('idle'); });
  window.addEventListener('beforeunload', function() { synth.cancel(); });
}
