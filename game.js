// Ace of Conquest — simulador de conquista por turnos sobre mapa hexagonal
(() => {
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');

  const COLS = 18, ROWS = 12;
  const FACTIONS = [
    { name: 'Imperio Carmesí',  color: '#e05555', glow: 'rgba(224,85,85,.55)' },
    { name: 'Reino Azur',       color: '#4f7de0', glow: 'rgba(79,125,224,.55)' },
    { name: 'Horda Esmeralda',  color: '#48b96c', glow: 'rgba(72,185,108,.55)' },
    { name: 'Dinastía Solar',   color: '#e0a63f', glow: 'rgba(224,166,63,.55)' },
  ];

  let cells, factions, turn, playing, timer, particles, lastBattles;

  // ---------- geometría hexagonal (offset odd-q) ----------
  let hexR = 30, originX = 0, originY = 0;

  function layout() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width - 320, h = rect.height;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    const rw = w / (0.75 * (COLS - 1) + 1) / 2;
    const rh = h / ((ROWS + 0.5) * Math.sqrt(3));
    hexR = Math.min(rw, rh) * 0.96;
    const gridW = (0.75 * (COLS - 1) + 1) * 2 * hexR;
    const gridH = (ROWS + 0.5) * Math.sqrt(3) * hexR;
    originX = (w - gridW) / 2 + hexR;
    originY = (h - gridH) / 2 + hexR * Math.sqrt(3) / 2;
  }

  function hexCenter(c, r) {
    const x = originX + c * hexR * 1.5;
    const y = originY + (r + (c % 2 ? 0.5 : 0)) * hexR * Math.sqrt(3);
    return { x, y };
  }

  function neighbors(c, r) {
    const odd = c % 2;
    const dirs = odd
      ? [[+1,0],[+1,+1],[0,-1],[0,+1],[-1,0],[-1,+1]]
      : [[+1,-1],[+1,0],[0,-1],[0,+1],[-1,-1],[-1,0]];
    return dirs
      .map(([dc,dr]) => [c+dc, r+dr])
      .filter(([nc,nr]) => nc>=0 && nc<COLS && nr>=0 && nr<ROWS);
  }

  // ---------- estado ----------
  function reset() {
    turn = 0;
    playing = false;
    particles = [];
    lastBattles = [];
    clearInterval(timer);
    document.getElementById('btn-play').textContent = '⏵ Auto';
    document.getElementById('victory').classList.add('hidden');
    document.getElementById('log').innerHTML = '';

    cells = [];
    for (let c = 0; c < COLS; c++) {
      cells[c] = [];
      for (let r = 0; r < ROWS; r++) {
        cells[c][r] = { owner: -1, troops: 0, terrain: Math.random() };
      }
    }
    factions = FACTIONS.map((f, i) => ({ ...f, alive: true, id: i }));
    const starts = [[1,1],[COLS-2,ROWS-2],[1,ROWS-2],[COLS-2,1]];
    starts.forEach(([c,r], i) => {
      cells[c][r] = { owner: i, troops: 20, terrain: cells[c][r].terrain, capital: true };
    });
    log('Los cuatro imperios despiertan. ¡Que comience la conquista!', 'conquest');
    updateSidebar();
    draw();
  }

  // ---------- simulación ----------
  function step() {
    turn++;
    lastBattles = [];
    // crecimiento
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const cell = cells[c][r];
      if (cell.owner >= 0) cell.troops = Math.min(60, cell.troops + (cell.capital ? 3 : 1));
    }
    // expansión / ataque: cada facción mueve desde sus celdas más fuertes
    const order = factions.filter(f => f.alive).sort(() => Math.random() - 0.5);
    for (const f of order) {
      const owned = [];
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++)
        if (cells[c][r].owner === f.id && cells[c][r].troops > 3) owned.push([c,r]);
      owned.sort((a,b) => cells[b[0]][b[1]].troops - cells[a[0]][a[1]].troops);

      for (const [c,r] of owned.slice(0, 6)) {
        const src = cells[c][r];
        const targets = neighbors(c,r).filter(([nc,nr]) => cells[nc][nr].owner !== f.id);
        if (!targets.length) continue;
        // preferir vacías, luego enemigas débiles
        targets.sort((a,b) => {
          const ca = cells[a[0]][a[1]], cb = cells[b[0]][b[1]];
          return (ca.owner<0?-100:ca.troops) - (cb.owner<0?-100:cb.troops);
        });
        const [tc,tr] = targets[0];
        const dst = cells[tc][tr];
        const force = Math.floor(src.troops * 0.6);
        if (force < 2) continue;

        if (dst.owner < 0) {
          src.troops -= force;
          dst.owner = f.id;
          dst.troops = force;
        } else {
          const defBonus = 1 + dst.terrain * 0.4 + (dst.capital ? 0.5 : 0);
          const atk = force * (0.8 + Math.random() * 0.4);
          const def = dst.troops * defBonus * (0.8 + Math.random() * 0.4);
          src.troops -= force;
          lastBattles.push(hexCenter(tc, tr));
          spawnParticles(tc, tr, factions[dst.owner].color, f.color);
          if (atk > def) {
            const prev = dst.owner;
            const wasCapital = dst.capital;
            dst.owner = f.id;
            dst.troops = Math.max(1, Math.floor(force - dst.troops * 0.5));
            dst.capital = false;
            log(`${f.name} conquista territorio de ${factions[prev].name}`, 'battle');
            if (wasCapital) {
              log(`🏰 ¡Cae la capital de ${factions[prev].name}!`, 'conquest');
            }
          } else {
            dst.troops = Math.max(1, Math.floor(dst.troops - force * 0.5));
          }
        }
      }
    }
    // comprobar eliminaciones y victoria
    for (const f of factions) {
      if (!f.alive) continue;
      let count = 0;
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++)
        if (cells[c][r].owner === f.id) count++;
      if (count === 0) {
        f.alive = false;
        log(`☠️ ${f.name} ha sido aniquilado`, 'conquest');
      }
    }
    const alive = factions.filter(f => f.alive);
    if (alive.length === 1) {
      playing = false;
      clearInterval(timer);
      document.getElementById('btn-play').textContent = '⏵ Auto';
      showVictory(alive[0]);
    }
    updateSidebar();
  }

  // ---------- partículas ----------
  function spawnParticles(c, r, col1, col2) {
    const { x, y } = hexCenter(c, r);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.5 + Math.random() * 2.2;
      particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1,
        color: Math.random() < 0.5 ? col1 : col2,
      });
    }
  }

  // ---------- render ----------
  function hexPath(x, y, R) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      const px = x + R * Math.cos(a), py = y + R * Math.sin(a);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function draw() {
    const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const cell = cells[c][r];
      const { x, y } = hexCenter(c, r);
      hexPath(x, y, hexR * 0.94);
      if (cell.owner >= 0) {
        const f = factions[cell.owner];
        const g = ctx.createRadialGradient(x, y - hexR*0.3, hexR*0.1, x, y, hexR);
        g.addColorStop(0, shade(f.color, 24));
        g.addColorStop(1, shade(f.color, -28));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = shade(f.color, 40);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        if (cell.capital) {
          ctx.save();
          ctx.shadowColor = f.glow;
          ctx.shadowBlur = 16;
          ctx.fillStyle = '#fff';
          ctx.font = `${Math.round(hexR*0.7)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🏰', x, y - hexR*0.15);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.font = `700 ${Math.max(10, Math.round(hexR*0.42))}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cell.troops, x, cell.capital ? y + hexR*0.45 : y);
      } else {
        const t = 0.16 + cell.terrain * 0.12;
        ctx.fillStyle = `rgba(70,90,130,${t})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,110,150,.28)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // destellos de batalla
    for (const b of lastBattles) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 3;
      hexPath(b.x, b.y, hexR * 1.02);
      ctx.stroke();
      ctx.restore();
    }

    // partículas
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4 * p.life + 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
    const b = Math.min(255, Math.max(0, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
  }

  // ---------- UI ----------
  function updateSidebar() {
    document.getElementById('turn-num').textContent = turn;
    const total = COLS * ROWS;
    const counts = factions.map(() => ({ cells: 0, troops: 0 }));
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const cell = cells[c][r];
      if (cell.owner >= 0) {
        counts[cell.owner].cells++;
        counts[cell.owner].troops += cell.troops;
      }
    }
    document.getElementById('factions').innerHTML = factions.map((f, i) => `
      <div class="faction${f.alive ? '' : ' dead'}">
        <span class="dot" style="background:${f.color};color:${f.color}"></span>
        <div class="info">
          <div class="name">${f.name}</div>
          <div class="stats">${counts[i].cells} territorios · ${counts[i].troops} tropas</div>
          <div class="barwrap"><div class="bar" style="width:${(counts[i].cells/total*100).toFixed(1)}%;background:${f.color}"></div></div>
        </div>
      </div>`).join('');
  }

  function log(msg, cls = '') {
    const el = document.getElementById('log');
    const e = document.createElement('div');
    e.className = 'entry ' + cls;
    e.textContent = `T${turn} — ${msg}`;
    el.prepend(e);
    while (el.children.length > 40) el.lastChild.remove();
  }

  function showVictory(f) {
    document.getElementById('victory-title').textContent = `¡${f.name} domina el mundo!`;
    document.getElementById('victory-text').textContent =
      `Tras ${turn} turnos de guerra, ${f.name} ha conquistado todos los territorios.`;
    document.getElementById('victory').classList.remove('hidden');
  }

  // ---------- bucle ----------
  function animate() {
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.03;
      p.life -= 0.025;
    }
    particles = particles.filter(p => p.life > 0);
    draw();
    requestAnimationFrame(animate);
  }

  function togglePlay() {
    playing = !playing;
    const btn = document.getElementById('btn-play');
    if (playing) {
      btn.textContent = '⏸ Pausa';
      startTimer();
    } else {
      btn.textContent = '⏵ Auto';
      clearInterval(timer);
    }
  }

  function startTimer() {
    clearInterval(timer);
    const speed = +document.getElementById('speed').value;
    timer = setInterval(step, 1400 - speed * 120);
  }

  document.getElementById('btn-step').addEventListener('click', step);
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-reset').addEventListener('click', reset);
  document.getElementById('btn-again').addEventListener('click', reset);
  document.getElementById('speed').addEventListener('input', () => { if (playing) startTimer(); });
  window.addEventListener('resize', () => { layout(); draw(); });

  layout();
  reset();
  animate();
})();
