(() => {
  const scene = document.getElementById("scene");
  const card = document.getElementById("card");
  const stage = document.getElementById("stage");
  const shadow = document.getElementById("shadow");
  const glare = document.getElementById("glare");
  const floor = document.getElementById("floor");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // oak parquet: long planks running away from the wall, painted once into a tile
  function paintFloor() {
    let seed = 779;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const size = 1024, pw = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");

    function plank(x, y, len) {
      const light = 24 + rand() * 12;
      const hue = 24 + rand() * 8;
      for (const dy of [-size, 0, size]) {      // wrap so the tile repeats seamlessly
        const py = y + dy;
        if (py > size || py + len < 0) continue;
        g.fillStyle = `hsl(${hue}, ${38 + rand() * 10}%, ${light}%)`;
        g.fillRect(x, py, pw, len);
        for (let i = 0; i < 16; i++) {           // grain
          const gx = x + 3 + rand() * (pw - 6);
          g.strokeStyle = `hsla(${hue - 6}, 45%, ${light - 10}%, ${0.15 + rand() * 0.25})`;
          g.lineWidth = 0.6 + rand() * 1.4;
          g.beginPath();
          g.moveTo(gx, py);
          const wob = 1 + rand() * 3;
          for (let s = 0; s <= len; s += 24) g.lineTo(gx + Math.sin(s / (40 + rand() * 40)) * wob, py + s);
          g.stroke();
        }
        g.fillStyle = "rgba(0,0,0,0.55)";        // seams
        g.fillRect(x, py, 2, len);
        g.fillRect(x, py, pw, 2);
        g.fillStyle = "rgba(255,230,190,0.08)";
        g.fillRect(x + 2, py + 2, 1, len - 2);
      }
    }
    for (let x = 0; x < size; x += pw) {
      let y = -rand() * 500;
      while (y < size) {
        const len = 260 + rand() * 340;
        plank(x, y, len);
        y += len;
      }
    }
    floor.style.backgroundImage =
      `linear-gradient(180deg, rgba(255,240,210,0.07), transparent 12%), url(${c.toDataURL("image/jpeg", 0.85)})`;
    floor.style.backgroundSize = "auto, 30vh 30vh";
  }
  paintFloor();

  // each animated property: current value and velocity
  const s = { x: 0, vx: 0, y: 0, vy: 0, rx: 0, vrx: 0, ry: 0, vry: 0, rz: 0, vrz: 0,
              flip: 0, vflip: 0, lift: 0, vlift: 0 };

  let dragging = false, hovering = false, flipped = false;
  let px = 0, py = 0, grabX = 0, grabY = 0;
  let hx = 0, hy = 0;                     // hover position, -0.5..0.5 across the painting
  let down = null;                         // pointerdown info, for telling a click from a drag

  const LIFT = 130;                        // px off the wall at full lift
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // lowest y offset before the frame's bottom edge would sink past the floor line on screen.
  // Mirrors the CSS: perspective 130vh, origin at 42%, floor at 80vh, --w and --d.
  let restBottom = 0, cw = 0, ch = 0, depth = 0, zNow = 0;
  const measure = () => {
    restBottom = stage.getBoundingClientRect().bottom;
    cw = card.offsetWidth;
    ch = card.offsetHeight;
    depth = cw / (1 + 0.14 * 2.24) * 0.14 * 0.55;   // --d
  };
  addEventListener("resize", measure);
  measure();

  // how far the frame's deepest corner reaches behind its centre at the current rotation.
  // The rotation is linear, so the deepest corner is |A|·w/2 + |B|·h/2 + |C|·d/2.
  function reach() {
    const r = Math.PI / 180;
    const sa = Math.sin(s.rx * r), ca = Math.cos(s.rx * r);
    const sb = Math.sin((s.ry + s.flip) * r), cb = Math.cos((s.ry + s.flip) * r);
    const sz = Math.sin(s.rz * r), cz = Math.cos(s.rz * r);
    const A = sz * sa - cz * sb * ca;
    const B = cz * sa + sz * sb * ca;
    const C = cb * ca;
    return Math.abs(A) * cw / 2 + Math.abs(B) * ch / 2 + Math.abs(C) * depth / 2;
  }

  function floorLimit() {
    const H = innerHeight, P = 1.3 * H, oy = 0.42 * H, floorY = 0.8 * H;
    const w = Math.min(0.34 * H, 0.56 * innerWidth);
    const f = P / (P - zNow);              // how much nearer things are magnified
    const halfW = (w + w * 0.14 * 2.24) / 2;
    const swing = Math.abs(Math.sin(s.rz * Math.PI / 180)) * halfW + Math.abs(s.rx) * 1.5;
    return (floorY - oy) / f - (restBottom - oy) - swing - 4;
  }

  function spring(key, target, k, d, dt) {
    const vk = "v" + key;
    const a = k * (target - s[key]) - d * s[vk];
    s[vk] += a * dt;
    s[key] += s[vk] * dt;
  }

  function step(dt) {
    const tx = dragging ? px - grabX : 0;
    const ty = dragging ? py - grabY : 0;

    // stiff and damped while held so it trails the pointer; loose and bouncy when let go
    if (dragging) { spring("x", tx, 700, 42, dt); spring("y", ty, 700, 42, dt); }
    else { spring("x", 0, 160, reduce ? 26 : 12, dt); spring("y", 0, 160, reduce ? 26 : 12, dt); }

    // the floor is solid: stop at it and bounce back a little
    const maxY = floorLimit();
    if (s.y > maxY) {
      s.y = maxY;
      if (s.vy > 0) s.vy *= -0.35;
    }

    const tilt = reduce ? 0 : 1;
    const speed = Math.hypot(s.vx, s.vy);
    let rxT = 0, ryT = 0;
    if (dragging || speed > 40) {
      rxT = clamp(-s.vy * 0.012, -28, 28);
      ryT = clamp(s.vx * 0.012, -28, 28);
    } else if (hovering) {
      rxT = -hy * 22;
      ryT = hx * 22;
    }
    spring("rx", rxT * tilt, 220, 18, dt);
    spring("ry", ryT * tilt, 220, 18, dt);
    spring("rz", clamp(s.vx * 0.01, -16, 16) * tilt, 160, 14, dt);

    spring("flip", flipped ? 180 : 0, 140, reduce ? 24 : 15, dt);

    // lift off the wall while held, hovered, moving or flipping, so it never swings into the wall
    const flipping = Math.min(1, Math.abs((flipped ? 180 : 0) - s.flip) / 90);
    const liftT = Math.max(dragging ? 1 : 0, hovering ? 0.35 : 0, flipping * 1.3, Math.min(1, speed / 1200));
    spring("lift", liftT, 200, 20, dt);
  }

  function render() {
    // never let any corner pass behind the wall, whatever the tilt
    zNow = Math.max(depth / 2 + 2 + s.lift * LIFT, reach() + 2);
    card.style.transform =
      `translate3d(${s.x}px, ${s.y}px, ${zNow}px) rotateX(${s.rx}deg) rotateY(${s.ry + s.flip}deg) rotateZ(${s.rz}deg)`;

    // shadow on the wall: light comes from above, so it falls lower and softer as the painting lifts
    const turn = Math.abs(Math.cos((s.ry + s.flip) * Math.PI / 180));
    const off = (zNow - depth / 2 - 2) / LIFT;   // actual distance from the wall, 0..~1.3
    const grow = 1 + off * 0.12;
    shadow.style.transform =
      `translate3d(${s.x + s.ry * 0.8 + off * 10}px, ${s.y - s.rx * 0.8 + 10 + off * 46}px, 1px) rotate(${s.rz}deg) scale(${Math.max(0.08, turn) * grow}, ${grow})`;
    shadow.style.opacity = (0.8 - off * 0.3).toFixed(3);

    glare.style.setProperty("--gx", `${50 + (s.ry / 28) * 55}%`);
    glare.style.setProperty("--gy", `${40 - (s.rx / 28) * 55}%`);
    glare.style.setProperty("--go", Math.min(1, (Math.abs(s.rx) + Math.abs(s.ry)) / 16 + s.lift * 0.3).toFixed(3));
  }

  let last = performance.now();
  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    while (dt > 0) {                        // substep so springs stay stable on slow frames
      const h = Math.min(dt, 1 / 240);
      step(h);
      dt -= h;
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function updateHover(e) {
    const r = stage.getBoundingClientRect();   // stage is never transformed, so this is the resting position
    hx = clamp((e.clientX - r.left) / r.width - 0.5, -0.6, 0.6);
    hy = clamp((e.clientY - r.top) / r.height - 0.5, -0.6, 0.6);
  }

  card.addEventListener("pointerenter", () => { hovering = true; });
  card.addEventListener("pointerleave", () => { hovering = false; });

  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("a")) return;   // let links on the back open normally
    e.preventDefault();
    card.setPointerCapture(e.pointerId);
    dragging = true;
    card.classList.add("dragging");
    px = e.clientX; py = e.clientY;
    grabX = px - s.x; grabY = py - s.y;
    down = { x: px, y: py, t: performance.now() };
  });

  card.addEventListener("pointermove", (e) => {
    updateHover(e);
    if (!dragging) return;
    px = e.clientX; py = e.clientY;
  });

  function release(e) {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    if (down) {
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6 && performance.now() - down.t < 400) flip(e.clientX);
    }
    down = null;
  }
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);

  function flip(clientX) {
    flipped = !flipped;
    // spin away from the side that was clicked, like flicking a card over
    const r = stage.getBoundingClientRect();
    const side = clientX == null ? 1 : Math.sign(clientX - (r.left + r.width / 2)) || 1;
    s.vry += side * -120;
    s.vrz += side * 60;
  }

  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (nudge) { e.preventDefault(); s.vx += nudge[0] * 900; s.vy += nudge[1] * 900; }
  });
})();
