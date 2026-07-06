
class ParticleBackground {
  constructor(container) {
    this.container = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.mouseX = 0;
    this.mouseY = 0;

    this.blueColor = 0x243d93;
    this.greenColor = 0x64a443;

    this.init();
    this.createParticles();

    this.animate();
    this.addEventListeners();
  }

  init() {

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.container.appendChild(this.renderer.domElement);

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);
  }

  createParticles() {
    const particleCount = 120;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities = [];

    const blueColorObj = new THREE.Color(this.blueColor);
    const greenColorObj = new THREE.Color(this.greenColor);

    for (let i = 0; i < particleCount; i++) {

      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6;

      const color = i % 2 === 0 ? blueColorObj : greenColorObj;
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      velocities.push({
        x: (Math.random() - 0.5) * 0.008,
        y: (Math.random() - 0.5) * 0.008,
        z: (Math.random() - 0.5) * 0.005
      });
    }

    this.particleVelocities = velocities;
    this.particleCount = particleCount;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.04,
      transparent: true,
      opacity: 0.7,
      vertexColors: true,
      blending: THREE.AdditiveBlending
    });

    this.particles = new THREE.Points(geometry, material);
    this.mainGroup.add(this.particles);
  }

  createConnections() {
    const lineCount = 20;
    this.connectionLines = [];

    for (let i = 0; i < lineCount; i++) {
      const points = [];
      const startX = (Math.random() - 0.5) * 10;
      const startY = (Math.random() - 0.5) * 6;
      const startZ = (Math.random() - 0.5) * 4;

      for (let j = 0; j <= 15; j++) {
        const t = j / 15;
        points.push(new THREE.Vector3(
          startX + Math.sin(t * Math.PI * 2) * 1.5,
          startY + Math.cos(t * Math.PI) * 0.8,
          startZ + t * 2 - 1
        ));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const color = i % 2 === 0 ? this.blueColor : this.greenColor;
      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.08
      });

      const line = new THREE.Line(geometry, material);
      line.userData = {
        speed: 0.001 + Math.random() * 0.002,
        offset: Math.random() * Math.PI * 2
      };

      this.connectionLines.push(line);
      this.mainGroup.add(line);
    }
  }

  addEventListeners() {
    window.addEventListener('mousemove', (e) => {
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
    });

    window.addEventListener('resize', () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;

      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(this.width, this.height);
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (window.nksA11yAnimPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const time = Date.now() * 0.001;

    this.mainGroup.rotation.y += (this.mouseX * 0.05 - this.mainGroup.rotation.y) * 0.02;
    this.mainGroup.rotation.x += (this.mouseY * 0.03 - this.mainGroup.rotation.x) * 0.02;

    this.mainGroup.rotation.y += 0.0005;

    if (this.particles) {
      const positions = this.particles.geometry.attributes.position.array;
      for (let i = 0; i < this.particleCount; i++) {
        positions[i * 3] += this.particleVelocities[i].x;
        positions[i * 3 + 1] += this.particleVelocities[i].y;
        positions[i * 3 + 2] += this.particleVelocities[i].z;

        if (positions[i * 3] > 6) positions[i * 3] = -6;
        if (positions[i * 3] < -6) positions[i * 3] = 6;
        if (positions[i * 3 + 1] > 4) positions[i * 3 + 1] = -4;
        if (positions[i * 3 + 1] < -4) positions[i * 3 + 1] = 4;
        if (positions[i * 3 + 2] > 3) positions[i * 3 + 2] = -3;
        if (positions[i * 3 + 2] < -3) positions[i * 3 + 2] = 3;
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('particles-bg');
  if (container && typeof THREE !== 'undefined') {
    new ParticleBackground(container);
  }
});

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
