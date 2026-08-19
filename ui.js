/*
 * Age of Conquest - Interfaz gráfica
 *
 * Este archivo NO contiene las reglas principales de la simulación.
 * Su responsabilidad es dibujar el mapa, leer los controles del usuario
 * y mostrar en pantalla el estado calculado por engine.js.
 */
(() => {
  'use strict';
  // Importamos del motor únicamente lo que necesita la interfaz.
  const { Simulation, PARAMS, runBasicTests } = AgeEngine;
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');

  // Estado visual de la aplicación. `sim` es la instancia única del motor.
  let sim;
  let playing = false;
  let timer = null;
  let particles = [];
  let selectedCell = null;
  let hexR = 30, originX = 0, originY = 0;

  /**
   * Calcula el tamaño del canvas y del hexágono según el espacio disponible.
   * Se vuelve a ejecutar al iniciar y al cambiar el tamaño de la ventana.
   */
  function layout() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const sidebarWidth = document.getElementById('sidebar').getBoundingClientRect().width;
    const w = Math.max(320, rect.width - sidebarWidth);
    const h = rect.height;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    const rw = w / (0.75 * (sim.cols - 1) + 1) / 2;
    const rh = h / ((sim.rows + 0.5) * Math.sqrt(3));
    hexR = Math.min(rw, rh) * 0.96;
    const gridW = (0.75 * (sim.cols - 1) + 1) * 2 * hexR;
    const gridH = (sim.rows + 0.5) * Math.sqrt(3) * hexR;
    originX = (w - gridW) / 2 + hexR;
    originY = (h - gridH) / 2 + hexR * Math.sqrt(3) / 2;
  }

  // Convierte una coordenada lógica (columna, fila) en un punto (x,y) del canvas.
  function hexCenter(c, r) {
    return {
      x: originX + c * hexR * 1.5,
      y: originY + (r + (c % 2 ? 0.5 : 0)) * hexR * Math.sqrt(3)
    };
  }

  // Crea el contorno de un hexágono para poder rellenarlo o dibujar su borde.
  function hexPath(x, y, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i);
      const px = x + radius * Math.cos(angle);
      const py = y + radius * Math.sin(angle);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // Aclara u oscurece un color hexadecimal; se usa para el degradado de cada imperio.
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
    const b = Math.min(255, Math.max(0, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Dibuja el mapa completo a partir del estado actual del motor.
   * Muestra propietario, tropas, felicidad, capitales, selección y combates recientes.
   */
  function draw() {
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    for (let c = 0; c < sim.cols; c++) {
      for (let r = 0; r < sim.rows; r++) {
        const cell = sim.cells[c][r];
        const { x, y } = hexCenter(c, r);
        hexPath(x, y, hexR * 0.94);

        if (cell.owner >= 0) {
          const f = sim.factions[cell.owner];
          const g = ctx.createRadialGradient(x, y - hexR * 0.3, hexR * 0.1, x, y, hexR);
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
            ctx.font = `${Math.round(hexR * 0.58)}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('♜', x, y - hexR * 0.20);
            ctx.restore();
          }
          ctx.fillStyle = 'rgba(255,255,255,.94)';
          ctx.font = `700 ${Math.max(10, Math.round(hexR * 0.38))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(cell.troops, x, cell.capital ? y + hexR * 0.38 : y - 2);
          ctx.font = `600 ${Math.max(8, Math.round(hexR * 0.23))}px system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,.78)';
          ctx.fillText(`♥${Math.round(cell.happiness)}`, x, y + hexR * 0.48);
        } else {
          const opacity = 0.16 + cell.terrain * 0.12;
          ctx.fillStyle = `rgba(70,90,130,${opacity})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(90,110,150,.28)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (selectedCell && selectedCell.c === c && selectedCell.r === r) {
          ctx.save();
          ctx.strokeStyle = '#fff1a8';
          ctx.lineWidth = 3;
          hexPath(x, y, hexR * 1.01);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    for (const battle of sim.lastBattleCells) {
      const b = hexCenter(battle.c, battle.r);
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 3;
      hexPath(b.x, b.y, hexR * 1.02);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4 * p.life + 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Crea partículas puramente visuales cuando ocurre un combate. No modifica el modelo.
  function spawnParticles(c, r, attackerId, defenderId) {
    const { x, y } = hexCenter(c, r);
    const col1 = sim.factions[attackerId]?.color || '#ffd76a';
    const col2 = sim.factions[defenderId]?.color || '#ffffff';
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 2.2;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color: Math.random() < 0.5 ? col1 : col2
      });
    }
  }

  // Agrega un evento del motor al panel “Registro de eventos”.
  function appendLog(item) {
    const el = document.getElementById('log');
    const entry = document.createElement('div');
    entry.className = `entry ${item.type || ''}`;
    entry.textContent = `T${item.turn} — ${item.message}`;
    el.prepend(entry);
    while (el.children.length > 70) el.lastChild.remove();
  }

  /**
   * Reinicia la corrida usando la semilla escrita por el usuario.
   * Crea una nueva instancia de Simulation y limpia la interfaz anterior.
   */
  function resetSimulation() {
    stopAuto();
    const seed = Number(document.getElementById('seed-input').value) || 12345;
    document.getElementById('log').innerHTML = '';
    selectedCell = null;
    sim = new Simulation({
      seed,
      onLog: appendLog,
      onBattle: spawnParticles
    });
    window.simulacion = sim;
    document.getElementById('victory').classList.add('hidden');
    layout();
    updateAll();
  }

  /**
   * Sincroniza toda la interfaz con el estado del motor:
   * reloj, LEF, panel de imperios, editor manual, provincia seleccionada y mapa.
   */
  function updateAll() {
    document.getElementById('turn-num').textContent = sim.completedTurns;
    document.getElementById('clock-num').textContent = sim.turn;
    document.getElementById('lef-count').textContent = sim.lef.length;
    document.getElementById('last-event').textContent = sim.lastEvent
      ? `T${sim.lastEvent.turn} P${sim.lastEvent.priority} ${sim.lastEvent.type}`
      : '—';

    const total = sim.cols * sim.rows;
    document.getElementById('factions').innerHTML = sim.factions.map(f => {
      const s = sim.snapshotFaction(f.id);
      const territoryPct = (s.territories / total * 100).toFixed(1);
      return `
      <div class="faction${s.status === 'Activa' ? '' : ' dead'}">
        <span class="dot" style="background:${f.color};color:${f.color}"></span>
        <div class="info">
          <div class="name">${f.name}</div>
          <div class="stats"><b>${s.territories}</b> territorios · <b>${s.troops}</b> tropas</div>
          <div class="stats">Tesoro: <b>${s.treasury.toFixed(0)}</b> · Felicidad: <b>${s.happiness.toFixed(0)}</b></div>
          <div class="stats">Impuestos: <b>${(s.taxRate * 100).toFixed(0)}%</b> · Estado: ${s.status}</div>
          <div class="stats">Ingreso: ${s.incomeTurn.toFixed(0)} · Mant.: ${s.maintenanceTurn.toFixed(0)} · IA: ${s.lastAction}</div>
          <div class="barwrap"><div class="bar" style="width:${territoryPct}%;background:${f.color}"></div></div>
        </div>
      </div>`;
    }).join('');

    updateEditor();
    updateSelectedCell();
    draw();

    if (sim.status === 'Finalizada' && sim.winner != null) showVictory(sim.factions[sim.winner]);
    if (sim.status === 'Error') stopAuto();
  }

  // Actualiza los campos de entrada manual con los valores de la nación seleccionada.
  function updateEditor() {
    const select = document.getElementById('faction-select');
    if (!select.options.length) {
      select.innerHTML = sim.factions.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    }
    const id = Number(select.value || 0);
    const f = sim.factions[id];
    document.getElementById('tax-input').value = Math.round(f.taxRate * 100);
  }

  // Muestra población, tropas, moral, defensa e ingreso de la provincia seleccionada.
  function updateSelectedCell() {
    const box = document.getElementById('cell-info');
    if (!selectedCell) {
      box.innerHTML = '<span class="muted">Haz clic en una provincia del mapa.</span>';
      return;
    }
    const cell = sim.getCell(selectedCell);
    if (!cell) return;
    const owner = cell.owner >= 0 ? sim.factions[cell.owner].name : 'Libre';
    box.innerHTML = `
      <div><b>Provincia (${cell.c}, ${cell.r})</b>${cell.capital ? ' · Capital' : ''}</div>
      <div>Propietario: ${owner}</div>
      <div>Población: ${cell.population} / ${cell.capacity}</div>
      <div>Felicidad: ${cell.happiness.toFixed(1)}</div>
      <div>Tropas: ${cell.troops} · Moral: ${cell.morale.toFixed(1)}</div>
      <div>Defensa: ${cell.defense} · Ingreso base: ${cell.incomeBase}</div>`;
  }

  // Muestra la ventana final cuando el motor declara una nación ganadora.
  function showVictory(f) {
    stopAuto();
    document.getElementById('victory-title').textContent = `¡Victoria de ${f.name}!`;
    document.getElementById('victory-text').textContent =
      `La simulación terminó después de ${sim.completedTurns} turnos completos.`;
    document.getElementById('victory').classList.remove('hidden');
  }

  // Ejecuta exactamente un turno completo y refresca la interfaz.
  function stepTurn() {
    if (sim.status !== 'EnCurso') return;
    sim.runTurn();
    updateAll();
  }

  // Ejecuta cinco turnos consecutivos; facilita la demostración solicitada en la actividad.
  function runFive() {
    if (sim.status !== 'EnCurso') return;
    sim.runTurns(5);
    updateAll();
  }

  // Detiene el modo automático y restaura el texto del botón.
  function stopAuto() {
    playing = false;
    clearInterval(timer);
    timer = null;
    document.getElementById('btn-play').textContent = '⏵ Auto';
  }

  // Inicia el temporizador del modo automático usando la velocidad elegida.
  function startTimer() {
    clearInterval(timer);
    const speed = Number(document.getElementById('speed').value);
    timer = setInterval(() => {
      if (sim.status !== 'EnCurso') {
        stopAuto();
        return;
      }
      stepTurn();
    }, 1450 - speed * 120);
  }

  // Alterna entre avance automático y pausa.
  function togglePlay() {
    if (sim.status !== 'EnCurso') return;
    playing = !playing;
    if (playing) {
      document.getElementById('btn-play').textContent = '⏸ Pausa';
      startTimer();
    } else stopAuto();
  }

  /**
   * Lee impuestos y reclutas escritos por el usuario y los envía al motor.
   * Los cambios se aplican mediante los eventos del siguiente turno.
   */
  function applyManualInputs() {
    const factionId = Number(document.getElementById('faction-select').value);
    const tax = Number(document.getElementById('tax-input').value) / 100;
    const recruits = Number(document.getElementById('recruit-input').value);
    sim.setTaxRate(factionId, tax);
    if (recruits > 0) sim.requestRecruitment(factionId, recruits);
    document.getElementById('recruit-input').value = 0;
    updateAll();
  }

  // Busca qué hexágono fue seleccionado a partir de la posición del clic del mouse.
  function findCellFromClick(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDist = Infinity;
    for (let c = 0; c < sim.cols; c++) {
      for (let r = 0; r < sim.rows; r++) {
        const center = hexCenter(c, r);
        const dist = Math.hypot(x - center.x, y - center.y);
        if (dist < bestDist && dist <= hexR) {
          bestDist = dist;
          best = { c, r };
        }
      }
    }
    return best;
  }

  // Ejecuta las pruebas del motor desde el navegador y muestra el resumen en la consola.
  function runTestsInConsole() {
    const results = runBasicTests();
    console.table(results);
    const passed = results.filter(r => r.pass).length;
    sim.log(`Pruebas básicas: ${passed}/${results.length} PASS. Ver consola del navegador.`, passed === results.length ? 'system' : 'error');
    updateAll();
    return results;
  }

  // Disponible para la defensa: ejecutarPruebas() desde la consola.
  window.ejecutarPruebas = runTestsInConsole;

  // ---------- Enlace entre controles HTML y funciones de la interfaz ----------
  document.getElementById('btn-step').addEventListener('click', stepTurn);
  document.getElementById('btn-five').addEventListener('click', runFive);
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-reset').addEventListener('click', resetSimulation);
  document.getElementById('btn-again').addEventListener('click', resetSimulation);
  document.getElementById('btn-apply').addEventListener('click', applyManualInputs);
  document.getElementById('btn-tests').addEventListener('click', runTestsInConsole);
  document.getElementById('speed').addEventListener('input', () => { if (playing) startTimer(); });
  document.getElementById('faction-select').addEventListener('change', updateEditor);
  canvas.addEventListener('click', event => {
    selectedCell = findCellFromClick(event);
    updateSelectedCell();
    draw();
  });
  window.addEventListener('resize', () => { layout(); draw(); });

  // Bucle de animación visual. Solo actualiza partículas y redibuja el mapa.
  function animate() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.03;
      p.life -= 0.025;
    }
    particles = particles.filter(p => p.life > 0);
    draw();
    requestAnimationFrame(animate);
  }

  // ---------- Arranque de la aplicación ----------
  resetSimulation();
  animate();
})();
