// Капли, которые стекают по экрану, иногда замирая, и разбегаются кругами внизу.
(() => {
  const canvas = document.getElementById('drops');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { canvas.remove(); return; }

  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const maxDrops = () => Math.max(8, Math.min(32, Math.round(w / 48)));
  const drops = [];
  const ripples = [];

  function spawn(initial) {
    drops.push({
      x: rnd(8, w - 8),
      y: initial ? rnd(-10, h * 0.55) : rnd(-40, -6),
      r: rnd(2.2, 5),            // радиус капли
      vy: 0,
      g: rnd(0.035, 0.09),       // ускорение
      pause: initial ? rnd(0, 1.2) : 0, // секунды «зависания»
      tail: 0,                   // длина следа
      alpha: 0,
      hue: rnd(262, 292),
      phase: rnd(0, Math.PI * 2),
    });
  }
  for (let i = 0; i < Math.round(maxDrops() * 0.6); i++) spawn(true);

  let last = performance.now();
  let spawnTimer = 0;

  function drawDrop(d) {
    const { x, y, r, tail, alpha, hue } = d;
    // след
    if (tail > 1) {
      const g = ctx.createLinearGradient(x, y - tail, x, y);
      g.addColorStop(0, `hsla(${hue}, 90%, 60%, 0)`);
      g.addColorStop(1, `hsla(${hue}, 90%, 65%, ${0.4 * alpha})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = r * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y - tail); ctx.lineTo(x, y); ctx.stroke();
    }
    // сама капля (слегка вытянутая) со свечением
    ctx.save();
    ctx.shadowColor = `hsla(${hue}, 95%, 65%, ${0.8 * alpha})`;
    ctx.shadowBlur = 14;
    const rg = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.4);
    rg.addColorStop(0, `rgba(255, 255, 255, ${0.95 * alpha})`);
    rg.addColorStop(0.35, `hsla(${hue}, 90%, 75%, ${0.9 * alpha})`);
    rg.addColorStop(1, `hsla(${hue}, 85%, 45%, ${0.75 * alpha})`);
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min((now - last) / 16.667, 3);
    last = now;
    ctx.clearRect(0, 0, w, h);

    spawnTimer += dt;
    if (spawnTimer > 14 && drops.length < maxDrops()) { spawn(false); spawnTimer = 0; }

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.alpha = Math.min(1, d.alpha + 0.04 * dt);
      if (d.pause > 0) {            // капля «прилипла» и стоит
        d.pause -= dt / 60;
        d.vy *= Math.pow(0.8, dt);
      } else {
        d.vy = Math.min(d.vy + d.g * dt, 7);
        if (Math.random() < 0.004 * dt) d.pause = rnd(0.25, 0.9);
      }
      d.y += d.vy * dt;
      d.x += Math.sin((d.y + d.phase * 20) / 38) * 0.15 * dt; // лёгкое виляние
      d.tail += (d.vy * 9 - d.tail) * Math.min(1, 0.08 * dt);

      drawDrop(d);

      if (d.y > h - 4) {
        ripples.push({ x: d.x, y: h - 3, rx: 2, a: 0.7 });
        drops.splice(i, 1);
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const p = ripples[i];
      p.rx += 0.9 * dt; p.a -= 0.012 * dt;
      if (p.a <= 0) { ripples.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(192, 132, 252, ${p.a})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.rx * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
