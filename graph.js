/* ============================================================
   Lumen — Interactive Hero Graph
   Self-contained IIFE. No dependencies. Vanilla JS + Canvas 2D.

   Physics:
   - Force-directed: node-node repulsion, spring edges, centering.
   - Velocity damping → graph settles smoothly to rest.
   - Fixed/clamped timestep so 60 Hz and 120 Hz behave identically.
   - Drag via Pointer Events (mouse + touch); touch-action: none on canvas.
   - Pauses via IntersectionObserver + visibilitychange.
   - Respects prefers-reduced-motion (static render, no animation).
============================================================ */
(function () {
  "use strict";

  /* ── DOM setup ─────────────────────────────────────────── */
  var canvas = document.getElementById("graph-canvas");
  if (!canvas) return;

  var ctx = canvas.getContext("2d");

  /* ── Reduced-motion gate ───────────────────────────────── */
  var prefersReduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── DPR / sizing ──────────────────────────────────────── */
  var LOGICAL_W = 720;
  var LOGICAL_H = 340;

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width  * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Scale factor from logical space → CSS pixels
    scaleX = rect.width  / LOGICAL_W;
    scaleY = rect.height / LOGICAL_H;
    drawStatic();
  }

  var scaleX = 1, scaleY = 1;

  /* ── Node definitions (from the original SVG positions) ── */
  // type: "hub" | "secondary" | "peripheral"
  var NODES = [
    // Hub
    { id: 0, x: 360, y: 160, r: 28, type: "hub",       label: "My thinking",  vx: 0, vy: 0, pinned: false },
    // Secondaries
    { id: 1, x: 200, y: 90,  r: 16, type: "secondary", label: "Research",     vx: 0, vy: 0, pinned: false },
    { id: 2, x: 520, y: 85,  r: 16, type: "secondary", label: "Ideas",        vx: 0, vy: 0, pinned: false },
    { id: 3, x: 170, y: 220, r: 16, type: "secondary", label: "Projects",     vx: 0, vy: 0, pinned: false },
    { id: 4, x: 550, y: 230, r: 16, type: "secondary", label: "Reading",      vx: 0, vy: 0, pinned: false },
    { id: 5, x: 360, y: 295, r: 16, type: "secondary", label: "Journal",      vx: 0, vy: 0, pinned: false },
    // Peripherals
    { id: 6, x: 100, y: 50,  r: 9,  type: "peripheral", label: "",            vx: 0, vy: 0, pinned: false },
    { id: 7, x: 630, y: 45,  r: 9,  type: "peripheral", label: "",            vx: 0, vy: 0, pinned: false },
    { id: 8, x: 75,  y: 295, r: 9,  type: "peripheral", label: "",            vx: 0, vy: 0, pinned: false },
    { id: 9, x: 650, y: 295, r: 9,  type: "peripheral", label: "",            vx: 0, vy: 0, pinned: false },
    { id: 10, x: 255, y: 330, r: 7, type: "peripheral", label: "",            vx: 0, vy: 0, pinned: false },
    { id: 11, x: 465, y: 330, r: 7, type: "peripheral", label: "",            vx: 0, vy: 0, pinned: false },
  ];

  // Rest positions (so centering force references the original layout)
  var REST = NODES.map(function(n) { return { x: n.x, y: n.y }; });

  /* ── Edge definitions ─────────────────────────────────── */
  // [from, to, strength, opacity]
  var EDGES = [
    // Hub → secondaries (strong)
    [0, 1, 1.0, 0.55],
    [0, 2, 1.0, 0.55],
    [0, 3, 1.0, 0.55],
    [0, 4, 1.0, 0.55],
    [0, 5, 1.0, 0.55],
    // Cross-links between secondaries
    [1, 2, 0.6, 0.32],
    [3, 5, 0.6, 0.32],
    [4, 5, 0.6, 0.32],
    // Secondary → peripheral
    [1, 6,  0.5, 0.24],
    [2, 7,  0.5, 0.24],
    [3, 8,  0.5, 0.24],
    [4, 9,  0.5, 0.24],
    [5, 10, 0.5, 0.24],
    [5, 11, 0.5, 0.24],
  ];

  /* ── Physics constants ─────────────────────────────────── */
  var TIMESTEP      = 1000 / 60;   // fixed step in ms (16.67 ms)
  var MAX_STEP      = 50;           // cap to avoid explosion on tab-refocus
  var DAMPING       = 0.88;         // velocity multiplied each step (lower = faster settle)
  var SPRING_K      = 0.012;        // spring stiffness
  var REPULSION     = 18000;        // node-node repulsion strength
  var CENTER_K      = 0.006;        // centering force strength (gentle drift back)
  var REST_DIST = (function() {
    // Natural spring rest lengths between connected pairs (from original positions)
    var d = {};
    EDGES.forEach(function(e) {
      var a = REST[e[0]], b = REST[e[1]];
      var dx = b.x - a.x, dy = b.y - a.y;
      d[e[0] + "," + e[1]] = Math.sqrt(dx * dx + dy * dy);
    });
    return d;
  }());

  /* ── Color helpers ─────────────────────────────────────── */
  // Sand palette
  var SAND_LIGHT = "#D8C0A0";
  var SAND_BASE  = "#C4A57B";
  var SAND_DARK  = "#A8875D";
  // Sage palette
  var SAGE_LIGHT = "#92B39A";
  var SAGE_BASE  = "#7A9E82";
  var SAGE_DARK  = "#5E8368";
  // Parchment (peripheral)
  var PARCH_LIGHT = "#F5EFE6";
  var PARCH_BASE  = "#EDE4D4";
  // Label ink
  var LABEL_COLOR = "rgba(70, 56, 36, 0.82)";
  // Mono tag
  var MONO_COLOR  = "rgba(100, 86, 68, 0.55)";

  /* ── Gradient cache (recreated on resize) ─────────────── */
  // We build per-node gradients at draw time using lx/ly (logical coords).

  function makeSandGradient(lx, ly, lr) {
    var sx = lx * scaleX, sy = ly * scaleY, sr = lr * Math.max(scaleX, scaleY);
    var grd = ctx.createRadialGradient(
      sx - sr * 0.18, sy - sr * 0.18, sr * 0.05,
      sx, sy, sr
    );
    grd.addColorStop(0,   SAND_LIGHT);
    grd.addColorStop(0.55, SAND_BASE);
    grd.addColorStop(1,   SAND_DARK);
    return grd;
  }

  function makeSageGradient(lx, ly, lr) {
    var sx = lx * scaleX, sy = ly * scaleY, sr = lr * Math.max(scaleX, scaleY);
    var grd = ctx.createRadialGradient(
      sx - sr * 0.18, sy - sr * 0.18, sr * 0.05,
      sx, sy, sr
    );
    grd.addColorStop(0,   SAGE_LIGHT);
    grd.addColorStop(0.55, SAGE_BASE);
    grd.addColorStop(1,   SAGE_DARK);
    return grd;
  }

  function makeParchGradient(lx, ly, lr) {
    var sx = lx * scaleX, sy = ly * scaleY, sr = lr * Math.max(scaleX, scaleY);
    var grd = ctx.createRadialGradient(
      sx - sr * 0.1, sy - sr * 0.1, sr * 0.05,
      sx, sy, sr
    );
    grd.addColorStop(0,   PARCH_LIGHT);
    grd.addColorStop(1,   PARCH_BASE);
    return grd;
  }

  /* ── Drawing ───────────────────────────────────────────── */
  function drawFrame() {
    // Clear using CSS pixel dimensions (ctx is already scaled by DPR via setTransform)
    var cssW = canvas.width  / (window.devicePixelRatio || 1);
    var cssH = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, cssW, cssH);

    // Edges first (under nodes)
    EDGES.forEach(function(e) {
      var a = NODES[e[0]], b = NODES[e[1]];
      var alpha  = e[3];
      var ax = a.x * scaleX, ay = a.y * scaleY;
      var bx = b.x * scaleX, by = b.y * scaleY;

      var grd = ctx.createLinearGradient(ax, ay, bx, by);
      // Sand → Sage
      grd.addColorStop(0,   "rgba(196,165,123," + alpha + ")");
      grd.addColorStop(1,   "rgba(122,158,130," + alpha + ")");

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = grd;
      // Hub-connected edges are slightly thicker
      ctx.lineWidth = (e[0] === 0 || e[1] === 0) ? 1.5 : 1.0;
      ctx.stroke();
    });

    // Nodes
    NODES.forEach(function(n) {
      var sx = n.x * scaleX;
      var sy = n.y * scaleY;
      var sr = n.r * Math.max(scaleX, scaleY);

      if (n.type === "hub") {
        // Fill
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = makeSandGradient(n.x, n.y, n.r);
        ctx.fill();
        // Rim
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.40)";
        ctx.stroke();
        // Sheen highlight (upper-left)
        var sheenR = sr * 0.26;
        var sheenX = sx - sr * 0.23;
        var sheenY = sy - sr * 0.23;
        ctx.beginPath();
        ctx.arc(sheenX, sheenY, sheenR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.fill();
      } else if (n.type === "secondary") {
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = makeSageGradient(n.x, n.y, n.r);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.stroke();
      } else {
        // peripheral
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = makeParchGradient(n.x, n.y, n.r);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(60,44,28,0.14)";
        ctx.stroke();
      }
    });

    // Labels — Shantell Sans, warm ink
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    NODES.forEach(function(n) {
      if (!n.label) return;
      var sx = n.x * scaleX;
      var sy = n.y * scaleY;
      var sr = n.r * Math.max(scaleX, scaleY);

      var fsize = n.type === "hub" ? 11 * Math.max(scaleX, scaleY) : 11 * Math.max(scaleX, scaleY);
      fsize = Math.max(8, Math.min(14, fsize));
      ctx.font = "500 " + fsize + "px 'Shantell Sans', 'Hanken Grotesk', cursive";
      ctx.fillStyle = LABEL_COLOR;

      // Position label below the node (mirroring the SVG which placed text ~25px below center)
      var labelY = sy + sr + 3 * Math.max(scaleX, scaleY);
      ctx.fillText(n.label, sx, labelY);
    });

    // "physics · live" mono tag (top-left, like in the SVG)
    var tagFsize = Math.max(7, 9 * Math.min(scaleX, scaleY));
    ctx.font = "400 " + tagFsize + "px 'JetBrains Mono', 'ui-monospace', monospace";
    ctx.fillStyle = MONO_COLOR;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("physics · live", 12 * scaleX, 12 * scaleY);
  }

  function drawStatic() {
    drawFrame();
  }

  /* ── Physics step ──────────────────────────────────────── */
  function physicsStep() {
    var n = NODES.length;

    // Accumulate forces into fx/fy
    var forces = NODES.map(function() { return { fx: 0, fy: 0 }; });

    // 1. Node-node repulsion (Coulomb-like)
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var dx = NODES[j].x - NODES[i].x;
        var dy = NODES[j].y - NODES[i].y;
        var dist2 = dx * dx + dy * dy;
        if (dist2 < 1) dist2 = 1;
        var dist = Math.sqrt(dist2);
        // Strength scales with sum of radii (bigger nodes push harder)
        var strength = REPULSION * (NODES[i].r + NODES[j].r) / (60 * dist2);
        var fx = (dx / dist) * strength;
        var fy = (dy / dist) * strength;
        forces[i].fx -= fx;
        forces[i].fy -= fy;
        forces[j].fx += fx;
        forces[j].fy += fy;
      }
    }

    // 2. Spring attraction along edges (Hooke's law)
    EDGES.forEach(function(e) {
      var a = NODES[e[0]], b = NODES[e[1]];
      var fa = forces[e[0]], fb = forces[e[1]];
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.01) return;
      var restLen = REST_DIST[e[0] + "," + e[1]] || 80;
      var stretch = dist - restLen;
      var k = SPRING_K * e[2];
      var fx = (dx / dist) * stretch * k;
      var fy = (dy / dist) * stretch * k;
      fa.fx += fx;
      fa.fy += fy;
      fb.fx -= fx;
      fb.fy -= fy;
    });

    // 3. Gentle centering force (pulls each node toward its rest position)
    NODES.forEach(function(node, i) {
      forces[i].fx += (REST[i].x - node.x) * CENTER_K;
      forces[i].fy += (REST[i].y - node.y) * CENTER_K;
    });

    // 4. Integrate: apply forces → velocity → position; damp velocity
    NODES.forEach(function(node, i) {
      if (node.pinned) return;
      node.vx = (node.vx + forces[i].fx) * DAMPING;
      node.vy = (node.vy + forces[i].fy) * DAMPING;
      node.x += node.vx;
      node.y += node.vy;

      // Clamp to logical bounds with a margin
      var margin = node.r + 4;
      node.x = Math.max(margin, Math.min(LOGICAL_W - margin, node.x));
      node.y = Math.max(margin, Math.min(LOGICAL_H - margin, node.y));
    });
  }

  /* ── Animation loop ────────────────────────────────────── */
  var rafId = null;
  var lastTime = null;
  var accumulator = 0;
  var running = false;
  var visible = true;
  var tabVisible = true;

  function loop(now) {
    if (!running) return;
    if (lastTime === null) lastTime = now;
    var delta = Math.min(now - lastTime, MAX_STEP);
    lastTime = now;
    accumulator += delta;

    while (accumulator >= TIMESTEP) {
      physicsStep();
      accumulator -= TIMESTEP;
    }

    drawFrame();
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastTime = null;
    accumulator = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    lastTime = null;
  }

  function checkRun() {
    if (visible && tabVisible) {
      startLoop();
    } else {
      stopLoop();
    }
  }

  /* ── Visibility pausing ─────────────────────────────────── */
  // Tab visibility
  document.addEventListener("visibilitychange", function() {
    tabVisible = document.visibilityState === "visible";
    checkRun();
  });

  // Intersection observer (in-viewport)
  if (window.IntersectionObserver) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        visible = entry.isIntersecting;
        checkRun();
      });
    }, { threshold: 0.05 });
    observer.observe(canvas);
  }

  /* ── Drag handling ─────────────────────────────────────── */
  var dragging = null;   // index of dragged node, or null
  var dragOffX = 0, dragOffY = 0;

  function logicalPos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scaleX,
      y: (e.clientY - rect.top)  / scaleY,
    };
  }

  function hitTest(lx, ly) {
    // Prioritize hub, then secondaries, then peripherals
    for (var i = 0; i < NODES.length; i++) {
      var n = NODES[i];
      var dx = lx - n.x, dy = ly - n.y;
      var hitR = n.r + 6; // slightly enlarged hit target
      if (dx * dx + dy * dy <= hitR * hitR) return i;
    }
    return -1;
  }

  canvas.addEventListener("pointerdown", function(e) {
    if (prefersReduced) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    var pos = logicalPos(e);
    var hit = hitTest(pos.x, pos.y);
    if (hit >= 0) {
      dragging = hit;
      NODES[hit].pinned = true;
      NODES[hit].vx = 0;
      NODES[hit].vy = 0;
      dragOffX = NODES[hit].x - pos.x;
      dragOffY = NODES[hit].y - pos.y;
      canvas.style.cursor = "grabbing";
    }
  });

  canvas.addEventListener("pointermove", function(e) {
    if (dragging === null) return;
    e.preventDefault();
    var pos = logicalPos(e);
    NODES[dragging].x = pos.x + dragOffX;
    NODES[dragging].y = pos.y + dragOffY;
  });

  function endDrag() {
    if (dragging === null) return;
    // Unpin — the physics loop already has momentum from the drag motion;
    // centering + damping will settle it home.
    NODES[dragging].pinned = false;
    dragging = null;
    canvas.style.cursor = "";
  }

  canvas.addEventListener("pointerup",     endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // Cursor hint on hover
  canvas.addEventListener("pointermove", function(e) {
    if (dragging !== null) return;
    var pos = logicalPos(e);
    var hit = hitTest(pos.x, pos.y);
    canvas.style.cursor = hit >= 0 ? "grab" : "";
  });

  /* ── Window resize ─────────────────────────────────────── */
  var resizeTimer;
  window.addEventListener("resize", function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 80);
  });

  /* ── Boot ──────────────────────────────────────────────── */
  // Wait for fonts to load so Shantell Sans renders correctly
  function init() {
    resize();
    if (prefersReduced) {
      // Static render only — no animation loop
      drawStatic();
      return;
    }
    startLoop();
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(init);
  } else {
    // Fallback: small delay to let fonts parse
    setTimeout(init, 150);
  }

}());
