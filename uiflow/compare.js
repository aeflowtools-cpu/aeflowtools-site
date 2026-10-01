/* UI Flow vs AEUX comparison — shared by /uiflow and /uiflow/vs.
   Markup hook: <div class="vs" data-vs></div>  (this script fills it in).
   Optional lightbox: #lbOverlay with #lbImg #lbCap #lbClose #lbPrev #lbNext. */
(function () {
  var CASES = [
    { name: 'Text',         issue: 'Text doubles up and shifts' },
    { name: 'Image mask',   issue: 'Mask ignored, the image spills out' },
    { name: 'Infographic',  issue: 'Colors shift, text blurs and doubles' },
    { name: 'Image stroke', issue: 'Stroke drifts off and fades' },
    { name: 'Drop shadow',  issue: 'Shadow lands in the wrong place' },
    { name: 'Blur',         issue: 'Soft blur turns into a hard square' }
  ];
  var BASE = '/uiflow/assets/';
  function src(kind, i) { return BASE + kind + '-' + (i + 1) + '.png'; }

  var PANELS = [
    { kind: 'figma',  cls: 'src',  icon: '<svg viewBox="0 0 38 57" aria-hidden="true"><path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z"/><path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z"/><path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z"/><path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z"/><path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z"/></svg>',
      label: 'Figma', note: function () { return 'Original design'; } },
    { kind: 'uiflow', cls: 'good', icon: '<b>✓</b>', label: 'UI Flow',
      note: function () { return '✓ Matches Figma'; } },
    { kind: 'aeux',   cls: 'bad',  icon: '<b>✕</b>', label: 'AEUX',
      note: function (c) { return '✕ ' + c.issue; } }
  ];

  function build(root) {
    var cur = 0;
    var tabs = CASES.map(function (c, i) {
      return '<button class="vs-case' + (i === 0 ? ' active' : '') + '" role="tab" aria-selected="' + (i === 0) + '" data-i="' + i + '">' + c.name + '</button>';
    }).join('');
    var panels = PANELS.map(function (p, j) {
      return '<figure class="vs-panel ' + p.cls + '">' +
        '<figcaption class="vs-head"><span class="vs-ic ' + p.cls + '">' + p.icon + '</span>' + p.label + '</figcaption>' +
        '<button class="vs-img" data-j="' + j + '" aria-label="Zoom ' + p.label + ' image"><img alt="" /></button>' +
        '<div class="vs-note"></div>' +
      '</figure>';
    }).join('');
    root.innerHTML =
      '<div class="vs-cases" role="tablist" aria-label="Comparison case">' + tabs + '</div>' +
      '<div class="vs-stage">' + panels + '</div>' +
      '<div class="vs-foot">' +
        '<button class="vs-nav" data-d="-1" aria-label="Previous case">‹</button>' +
        '<span class="vs-count"></span>' +
        '<button class="vs-nav" data-d="1" aria-label="Next case">›</button>' +
      '</div>' +
      '<p class="vs-hint"><span class="vs-hint-desk">Tap an image to zoom · ← → to switch cases</span><span class="vs-hint-mob">Swipe the panels to compare →</span></p>';

    var caseBtns = root.querySelectorAll('.vs-case');
    var imgs = root.querySelectorAll('.vs-img img');
    var notes = root.querySelectorAll('.vs-note');
    var count = root.querySelector('.vs-count');
    var stage = root.querySelector('.vs-stage');

    // preload everything so switching is instant
    CASES.forEach(function (c, i) { PANELS.forEach(function (p) { var im = new Image(); im.src = src(p.kind, i); }); });

    function show(i) {
      cur = (i + CASES.length) % CASES.length;
      var c = CASES[cur];
      caseBtns.forEach(function (b, k) {
        var on = k === cur; b.classList.toggle('active', on); b.setAttribute('aria-selected', on);
        var bar = b.parentNode; // keep the active tab in view when the tab row scrolls (phones)
        if (on && bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
      });
      PANELS.forEach(function (p, j) {
        imgs[j].src = src(p.kind, cur);
        imgs[j].alt = c.name + ' — ' + p.label;
        notes[j].textContent = p.note(c);
      });
      count.textContent = (cur + 1) + ' / ' + CASES.length;
    }

    caseBtns.forEach(function (b) { b.addEventListener('click', function () { show(+b.getAttribute('data-i')); }); });
    root.querySelectorAll('.vs-nav').forEach(function (b) { b.addEventListener('click', function () { show(cur + (+b.getAttribute('data-d'))); }); });
    root.querySelector('.vs-cases').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); show(cur + (e.key === 'ArrowRight' ? 1 : -1));
        caseBtns[cur].focus();
      }
    });

    // ---- lightbox: flips Figma → UI Flow → AEUX for the current case ----
    var ov = document.getElementById('lbOverlay');
    if (ov) {
      var lbImg = document.getElementById('lbImg'), lbCap = document.getElementById('lbCap'), lj = 0;
      function lb(j) {
        lj = (j + PANELS.length) % PANELS.length;
        lbImg.src = src(PANELS[lj].kind, cur);
        lbImg.alt = CASES[cur].name + ' — ' + PANELS[lj].label;
        lbCap.textContent = CASES[cur].name + ' · ' + PANELS[lj].label + ' — ' + PANELS[lj].note(CASES[cur]).replace(/^[✓✕] /, '');
      }
      function open(j) { lb(j); ov.classList.add('open'); document.body.style.overflow = 'hidden'; }
      function close() { ov.classList.remove('open'); document.body.style.overflow = ''; }
      root.querySelectorAll('.vs-img').forEach(function (b) { b.addEventListener('click', function () { open(+b.getAttribute('data-j')); }); });
      document.getElementById('lbClose').onclick = close;
      document.getElementById('lbPrev').onclick = function (e) { e.stopPropagation(); lb(lj - 1); };
      document.getElementById('lbNext').onclick = function (e) { e.stopPropagation(); lb(lj + 1); };
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.addEventListener('keydown', function (e) {
        if (!ov.classList.contains('open')) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') lb(lj - 1);
        else if (e.key === 'ArrowRight') lb(lj + 1);
      });
      var sx = 0, sy = 0;
      ov.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
      ov.addEventListener('touchend', function (e) {
        var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) lb(dx < 0 ? lj + 1 : lj - 1);
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
      }, { passive: true });
    }

    show(0);
    if (stage) stage.scrollLeft = 0;
  }

  function init() { document.querySelectorAll('[data-vs]').forEach(build); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
