/*
 * Age of Conquest - Motor de simulación académico
 * Simulación de Sistemas - proyecto final
 *
 * Este archivo contiene la lógica del modelo y no depende de la interfaz.
 * El reloj es discreto (turnos) y los eventos se procesan mediante una LEF.
 */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.AgeEngine = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Configuración visual y nombres de las cuatro naciones del escenario inicial.
  // Estos datos no contienen reglas de simulación; solo identifican a cada facción.
  const DEFAULT_FACTIONS = [
    { name: 'Imperio Carmesí', color: '#e05555', glow: 'rgba(224,85,85,.55)' },
    { name: 'Reino Azur', color: '#4f7de0', glow: 'rgba(79,125,224,.55)' },
    { name: 'Horda Esmeralda', color: '#48b96c', glow: 'rgba(72,185,108,.55)' },
    { name: 'Dinastía Solar', color: '#e0a63f', glow: 'rgba(224,166,63,.55)' }
  ];

  // Parámetros adoptados en el modelo matemático del parcial anterior.
  // Object.freeze evita que se modifiquen accidentalmente durante una corrida.
  const PARAMS = Object.freeze({
    populationGrowthRate: 0.03,
    maintenanceCost: 2,
    recruitmentCost: 10,
    alphaAttacker: 0.10,
    betaDefender: 0.08,
    deficitPopulationLoss: 0.01,
    warPopulationLoss: 0.03,
    taxSensitivity: 0.20,
    stabilityEffect: 2,
    warEffect: 4,
    militaryResultEffect: 2,
    moraleSensitivity: 1.0,
    rebellionThreshold: 20,
    retreatThreshold: 25,
    rebelControlThreshold: 3,
    conquestPenalty: 25,
    recruitmentMoraleBonus: 2,
    maxCombatRounds: 5,
    victoryShare: 0.60,
    maxMovementPoints: 1,
    maxRecruitmentPerTurn: 12
  });

  // Prioridades de la Lista de Eventos Futuros (LEF).
  // Un número menor significa que el evento se procesa antes dentro del mismo turno.
  const PRIORITY = Object.freeze({
    InicioTurno: 10,
    ActualizarPoblacion: 20,
    ActualizarFelicidad: 25,
    GenerarIngresos: 35,
    PagarMantenimiento: 40,
    DecidirAccion: 45,
    DeclararGuerra: 50,
    Reclutamiento: 55,
    MovimientoEjercito: 60,
    Combate: 70,
    ConquistaProvincia: 80,
    CalcularFelicidadNacional: 83,
    EvaluarRebeliones: 85,
    Rebelion: 87,
    VerificarVictoria: 90,
    FinTurno: 100
  });

  // Limita un valor a un intervalo. Se usa, por ejemplo, para mantener
  // felicidad y moral entre 0 y 100, y población dentro de su capacidad.
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const keyOf = (c, r) => `${c},${r}`;

  /**
   * Generador congruencial lineal multiplicativo.
   * Produce números pseudoaleatorios reproducibles a partir de una semilla.
   * Esto permite repetir una corrida con exactamente la misma secuencia aleatoria.
   */
  class LCG {
    // Crea el generador usando la semilla indicada.
    constructor(seed = 12345) { this.setSeed(seed); }
    // Normaliza y guarda la semilla interna del generador.
    setSeed(seed) {
      const n = Number(seed);
      this.state = Number.isFinite(n) ? (Math.abs(Math.floor(n)) % 2147483647 || 1) : 12345;
    }
    // Retorna un valor pseudoaleatorio uniforme en el intervalo [0, 1).
    random() {
      this.state = (this.state * 48271) % 2147483647;
      return (this.state - 1) / 2147483646;
    }
    // Transforma U(0,1) a un valor uniforme entre min y max.
    uniform(min, max) { return min + (max - min) * this.random(); }
    // Retorna un entero pseudoaleatorio entre min y maxInclusive.
    int(min, maxInclusive) { return Math.floor(this.uniform(min, maxInclusive + 1)); }
  }

  /**
   * Motor principal de la simulación.
   * Mantiene el estado del mapa, las naciones, la LEF y el reloj discreto.
   * La interfaz gráfica solo consulta y modifica este objeto; las reglas viven aquí.
   */
  class Simulation {
    // Configura dimensiones, semilla y callbacks de interfaz, y crea el escenario inicial.
    constructor(options = {}) {
      this.cols = options.cols || 18;
      this.rows = options.rows || 12;
      this.seed = options.seed || 12345;
      this.rng = new LCG(this.seed);
      this.onLog = typeof options.onLog === 'function' ? options.onLog : null;
      this.onBattle = typeof options.onBattle === 'function' ? options.onBattle : null;
      this.reset(this.seed);
    }

    /**
     * Reinicia completamente la corrida.
     * Genera las provincias, crea las naciones, asigna las capitales y programa
     * el primer evento InicioTurno.
     */
    reset(seed = this.seed) {
      this.seed = Number(seed) || 12345;
      this.rng.setSeed(this.seed);
      this.turn = 0;
      this.completedTurns = 0;
      this.status = 'EnCurso';
      this.winner = null;
      this.sequence = 1;
      this.lef = [];
      this.logs = [];
      this.lastEvent = null;
      this.lastBattleCells = [];
      this.cells = [];

      for (let c = 0; c < this.cols; c++) {
        this.cells[c] = [];
        for (let r = 0; r < this.rows; r++) {
          const terrain = this.rng.random();
          const capacity = this.rng.int(1200, 2200);
          const population = this.rng.int(650, Math.floor(capacity * 0.80));
          this.cells[c][r] = {
            c, r,
            owner: -1,
            troops: 0,
            morale: 100,
            terrain,
            defense: clamp(Math.round(terrain * 7), 0, 10),
            population,
            capacity,
            incomeBase: this.rng.int(650, 1150),
            happiness: 70,
            capital: false,
            warThisTurn: false,
            warLastTurn: false
          };
        }
      }

      this.factions = DEFAULT_FACTIONS.map((f, id) => ({
        ...f,
        id,
        treasury: 500,
        happiness: 70,
        taxRate: 0.20,
        status: 'Activa',
        victoriesTurn: 0,
        defeatsTurn: 0,
        incomeTurn: 0,
        taxesTurn: 0,
        maintenanceTurn: 0,
        recruitedTurn: 0,
        requestedRecruits: 0,
        lastAction: 'Esperar'
      }));

      this.relations = this.factions.map((_, i) =>
        this.factions.map((_, j) => (i === j ? 'Propia' : 'Paz'))
      );
      this.passage = this.factions.map(() => this.factions.map(() => 0));

      const starts = [
        [1, 1],
        [this.cols - 2, this.rows - 2],
        [1, this.rows - 2],
        [this.cols - 2, 1]
      ];
      starts.forEach(([c, r], factionId) => {
        const cell = this.cells[c][r];
        cell.owner = factionId;
        cell.troops = 20;
        cell.morale = 100;
        cell.happiness = 70;
        cell.population = Math.min(cell.capacity, 1100);
        cell.incomeBase = 1200;
        cell.defense = Math.max(cell.defense, 5);
        cell.capital = true;
      });

      // Estado inicial t=0. El primer turno operativo se ejecuta en t=1.
      this.scheduleEvent(1, PRIORITY.InicioTurno, 'InicioTurno', 'Partida');
      this.log('Simulación inicializada. Semilla: ' + this.seed, 'system');
      return this;
    }

    // ---------- Geometría lógica ----------
    // Devuelve las coordenadas de las seis provincias adyacentes a un hexágono.
    neighbors(c, r) {
      const odd = c % 2;
      const dirs = odd
        ? [[1,0],[1,1],[0,-1],[0,1],[-1,0],[-1,1]]
        : [[1,-1],[1,0],[0,-1],[0,1],[-1,-1],[-1,0]];
      return dirs
        .map(([dc, dr]) => [c + dc, r + dr])
        .filter(([nc, nr]) => nc >= 0 && nc < this.cols && nr >= 0 && nr < this.rows);
    }

    // Obtiene una provincia a partir de {c,r} o [c,r]. Retorna null si no existe.
    getCell(pos) {
      if (!pos) return null;
      const c = Array.isArray(pos) ? pos[0] : pos.c;
      const r = Array.isArray(pos) ? pos[1] : pos.r;
      return this.cells[c] && this.cells[c][r] ? this.cells[c][r] : null;
    }

    // Reúne todas las provincias que actualmente pertenecen a una nación.
    ownedCells(factionId) {
      const result = [];
      for (let c = 0; c < this.cols; c++) {
        for (let r = 0; r < this.rows; r++) {
          if (this.cells[c][r].owner === factionId) result.push(this.cells[c][r]);
        }
      }
      return result;
    }

    // Suma las tropas desplegadas en todos los territorios de una nación.
    totalTroops(factionId) {
      return this.ownedCells(factionId).reduce((sum, cell) => sum + cell.troops, 0);
    }

    // Suma la población de todos los territorios de una nación.
    totalPopulation(factionId) {
      return this.ownedCells(factionId).reduce((sum, cell) => sum + cell.population, 0);
    }

    // Busca la provincia propia con mayor cantidad de tropas.
    strongestCell(factionId) {
      const owned = this.ownedCells(factionId);
      return owned.sort((a, b) => b.troops - a.troops)[0] || null;
    }

    /**
     * Selecciona una frontera candidata para expansión o ataque.
     * Las provincias libres tienen prioridad; si hay enemigos, se considera
     * su fuerza/defensa y la cantidad de tropas disponibles en el origen.
     */
    weakestFrontier(factionId) {
      const candidates = [];
      for (const src of this.ownedCells(factionId)) {
        for (const [c, r] of this.neighbors(src.c, src.r)) {
          const dst = this.cells[c][r];
          if (dst.owner !== factionId) {
            // Las provincias Libres se priorizan. Entre varias opciones libres,
            // se prefiere la que pueda ser ocupada desde la frontera con más tropas.
            const score = dst.owner < 0
              ? -1000 - src.troops
              : dst.troops + dst.defense * 2 - src.troops * 0.05;
            candidates.push({ source: src, destination: dst, score });
          }
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      return candidates[0] || null;
    }

    // ---------- LEF ----------
    /**
     * Inserta un evento en la LEF con la estructura:
     * (turno, prioridad, secuencia, tipo, origen, destino, datos).
     * Después ordena la cola por turno, prioridad y secuencia.
     */
    scheduleEvent(turn, priority, type, origin = null, destination = null, data = {}) {
      const event = {
        turn,
        priority,
        sequence: this.sequence++,
        type,
        origin,
        destination,
        data: data || {}
      };
      this.lef.push(event);
      this.lef.sort((a, b) =>
        a.turn - b.turn || a.priority - b.priority || a.sequence - b.sequence
      );
      return event;
    }

    // Extrae el siguiente evento programado de la LEF.
    extractNextEvent() { return this.lef.shift() || null; }

    /**
     * Ejecuta un solo evento de la LEF y actualiza el reloj de simulación.
     * Si no quedan eventos mientras la partida sigue activa, marca un error.
     */
    runNextEvent() {
      if (this.status !== 'EnCurso') return null;
      const event = this.extractNextEvent();
      if (!event) {
        this.status = 'Error';
        this.log('ERROR: La LEF quedó vacía mientras la partida seguía activa.', 'error');
        return null;
      }
      this.turn = event.turn;
      this.lastEvent = event;
      this.processEvent(event);
      return event;
    }

    // Procesa todos los eventos correspondientes al próximo turno completo.
    runTurn() {
      if (this.status !== 'EnCurso') return false;
      if (!this.lef.length) {
        this.status = 'Error';
        this.log('ERROR: La LEF quedó vacía mientras la partida seguía activa.', 'error');
        return false;
      }
      const targetTurn = this.lef[0].turn;
      while (this.status === 'EnCurso' && this.lef.length && this.lef[0].turn === targetTurn) {
        this.runNextEvent();
      }
      return true;
    }

    // Ejecuta varios turnos consecutivos; se usa en el botón “5 turnos” y en pruebas.
    runTurns(count = 5) {
      const executed = [];
      for (let i = 0; i < count && this.status === 'EnCurso'; i++) {
        const before = this.completedTurns;
        this.runTurn();
        if (this.completedTurns > before) executed.push(this.completedTurns);
      }
      return executed;
    }

    /**
     * Enrutador central de eventos.
     * Relaciona el nombre de cada evento de la LEF con la función que implementa su lógica.
     */
    processEvent(event) {
      const handlers = {
        InicioTurno: () => this.startTurn(event.turn),
        ActualizarPoblacion: () => this.updatePopulation(event.origin),
        ActualizarFelicidad: () => this.updateProvincialHappiness(event.origin),
        GenerarIngresos: () => this.generateIncome(event.origin),
        PagarMantenimiento: () => this.payMaintenance(event.origin),
        DecidirAccion: () => this.decideAction(event.origin, event.turn),
        DeclararGuerra: () => this.declareWar(event.origin, event.destination),
        Reclutamiento: () => this.recruit(event.origin, event.destination, event.data.amount),
        MovimientoEjercito: () => this.moveArmy(event.origin, event.destination, event.data, event.turn),
        Combate: () => this.resolveCombat(event.data, event.turn),
        ConquistaProvincia: () => this.conquer(event.origin, event.destination, event.data, event.turn),
        CalcularFelicidadNacional: () => this.calculateNationalHappiness(event.origin),
        EvaluarRebeliones: () => this.evaluateRebellions(event.turn),
        Rebelion: () => this.rebel(event.origin),
        VerificarVictoria: () => this.verifyVictory(),
        FinTurno: () => this.finishTurn(event.turn)
      };
      const handler = handlers[event.type];
      if (!handler) {
        this.log(`Evento desconocido: ${event.type}`, 'error');
        return;
      }
      handler();
    }

    /**
     * Programa todas las fases que deben ocurrir durante un turno.
     * La prioridad de cada evento garantiza el orden definido en el modelo conceptual.
     */
    startTurn(turn) {
      this.log(`Inicio del turno ${turn}. Se programan las fases en la LEF.`, 'phase');
      this.lastBattleCells = [];

      for (const faction of this.factions.filter(f => f.status === 'Activa')) {
        faction.incomeTurn = 0;
        faction.taxesTurn = 0;
        faction.maintenanceTurn = 0;
        faction.recruitedTurn = 0;

        for (const cell of this.ownedCells(faction.id)) {
          this.scheduleEvent(turn, PRIORITY.ActualizarPoblacion, 'ActualizarPoblacion', { c: cell.c, r: cell.r });
          this.scheduleEvent(turn, PRIORITY.ActualizarFelicidad, 'ActualizarFelicidad', { c: cell.c, r: cell.r });
        }
        this.scheduleEvent(turn, PRIORITY.GenerarIngresos, 'GenerarIngresos', faction.id);
        this.scheduleEvent(turn, PRIORITY.PagarMantenimiento, 'PagarMantenimiento', faction.id);
        this.scheduleEvent(turn, PRIORITY.DecidirAccion, 'DecidirAccion', faction.id);
        this.scheduleEvent(turn, PRIORITY.CalcularFelicidadNacional, 'CalcularFelicidadNacional', faction.id);
      }

      this.scheduleEvent(turn, PRIORITY.EvaluarRebeliones, 'EvaluarRebeliones', 'Partida');
      this.scheduleEvent(turn, PRIORITY.VerificarVictoria, 'VerificarVictoria', 'Partida');
      this.scheduleEvent(turn, PRIORITY.FinTurno, 'FinTurno', 'Partida');
    }

    // ---------- Subsistema poblacional ----------
    /**
     * Actualiza la población de una provincia mediante crecimiento logístico.
     * También aplica pérdidas por déficit económico y por guerra del turno anterior.
     */
    updatePopulation(pos) {
      const cell = this.getCell(pos);
      if (!cell) return;

      let deficit = 0;
      if (cell.owner >= 0) deficit = this.factions[cell.owner].treasury < 0 ? 1 : 0;
      const war = cell.warLastTurn ? 1 : 0;
      const p = cell.population;
      const losses = Math.min(
        p,
        PARAMS.deficitPopulationLoss * p * deficit + PARAMS.warPopulationLoss * p * war
      );
      const growth = PARAMS.populationGrowthRate * p * (1 - p / cell.capacity);
      cell.population = Math.round(clamp(p + growth - losses, 0, cell.capacity));
    }

    /**
     * Actualiza la felicidad provincial según impuestos, estabilidad y guerra.
     * Una provincia libre usa tasa de impuesto 0.
     */
    updateProvincialHappiness(pos) {
      const cell = this.getCell(pos);
      if (!cell) return;
      const tax = cell.owner >= 0 ? this.factions[cell.owner].taxRate : 0;
      const war = cell.warLastTurn ? 1 : 0;
      const stability = war ? 0 : 1;
      const next = cell.happiness
        - PARAMS.taxSensitivity * (100 * tax)
        + PARAMS.stabilityEffect * stability
        - PARAMS.warEffect * war;
      cell.happiness = clamp(next, 0, 100);
    }

    // ---------- Economía ----------
    // Calcula el ingreso bruto de una provincia según ingreso base, población y felicidad.
    provincialIncome(cell) {
      if (!cell || cell.owner < 0 || cell.population <= 0) return 0;
      return cell.incomeBase * (cell.population / cell.capacity) * (cell.happiness / 100);
    }

    /**
     * Suma la producción de las provincias, calcula impuestos y los agrega al tesoro.
     * Todavía no descuenta mantenimiento ni reclutamiento.
     */
    generateIncome(factionId) {
      const faction = this.factions[factionId];
      if (!faction || faction.status !== 'Activa') return;
      const income = this.ownedCells(factionId).reduce((sum, cell) => sum + this.provincialIncome(cell), 0);
      const taxes = income * faction.taxRate;
      faction.incomeTurn = income;
      faction.taxesTurn = taxes;
      faction.treasury += taxes;
      this.log(`${faction.name}: ingresos ${income.toFixed(1)}, impuestos +${taxes.toFixed(1)} oro.`, 'economy');
    }

    // Descuenta del tesoro el costo de mantener las tropas de la nación durante el turno.
    payMaintenance(factionId) {
      const faction = this.factions[factionId];
      if (!faction || faction.status !== 'Activa') return;
      const maintenance = this.totalTroops(factionId) * PARAMS.maintenanceCost;
      faction.maintenanceTurn = maintenance;
      faction.treasury -= maintenance;
      this.log(`${faction.name}: mantenimiento -${maintenance.toFixed(1)} oro. Tesoro ${faction.treasury.toFixed(1)}.`, 'economy');
      if (faction.treasury < 0) this.applyBankruptcy(factionId);
    }

    /**
     * Maneja un tesoro negativo. Reduce felicidad y desmoviliza parte de las tropas.
     * La desmovilización reduce el gasto militar de turnos posteriores.
     */
    applyBankruptcy(factionId) {
      const faction = this.factions[factionId];
      if (!faction) return;
      faction.happiness = clamp(faction.happiness - 10, 0, 100);
      const cells = this.ownedCells(factionId).sort((a, b) => a.troops - b.troops);
      let removed = 0;
      for (const cell of cells) {
        if (faction.treasury >= 0) break;
        if (cell.troops <= 1) continue;
        const cut = Math.max(1, Math.ceil(cell.troops * 0.10));
        cell.troops = Math.max(1, cell.troops - cut);
        removed += cut;
        // No se devuelve dinero; la reducción disminuye el mantenimiento del siguiente turno.
      }
      this.log(`⚠ Bancarrota de ${faction.name}. Felicidad -10${removed ? ` y ${removed} tropas desmovilizadas` : ''}.`, 'warning');
    }

    // Calcula el máximo de soldados que la nación puede reclutar en el turno.
    recruitmentLimit(factionId) {
      const byPopulation = Math.max(1, Math.floor(this.totalPopulation(factionId) / 1200));
      return Math.min(PARAMS.maxRecruitmentPerTurn, byPopulation);
    }

    /**
     * Recluta soldados si hay oro y capacidad disponible.
     * El costo se descuenta aquí una sola vez, tal como exige el modelo económico.
     */
    recruit(factionId, pos, requested = 0) {
      const faction = this.factions[factionId];
      const cell = this.getCell(pos) || this.strongestCell(factionId);
      if (!faction || faction.status !== 'Activa' || !cell || cell.owner !== factionId) return 0;
      if (faction.treasury <= 0) {
        this.log(`${faction.name}: reclutamiento cancelado por falta de oro.`, 'warning');
        return 0;
      }
      const byTreasury = Math.floor(Math.max(0, faction.treasury) / PARAMS.recruitmentCost);
      const amount = Math.max(0, Math.min(
        Math.floor(requested || 0),
        byTreasury,
        this.recruitmentLimit(factionId)
      ));
      if (amount <= 0) {
        this.log(`${faction.name}: no pudo reclutar tropas.`, 'warning');
        return 0;
      }
      const totalCost = amount * PARAMS.recruitmentCost;
      cell.troops += amount;
      cell.morale = clamp(cell.morale + PARAMS.recruitmentMoraleBonus, 0, 100);
      faction.treasury -= totalCost; // Se descuenta una sola vez, aquí.
      faction.recruitedTurn += amount;
      faction.requestedRecruits = 0;
      this.log(`${faction.name} recluta ${amount} soldados por ${totalCost} de oro.`, 'recruit');
      return amount;
    }

    // ---------- IA y diplomacia ----------
    // Estimación sencilla usada por la IA para decidir si puede afrontar una guerra.
    estimatedWarCost(factionId, targetCell) {
      const base = targetCell ? targetCell.troops * PARAMS.recruitmentCost : 100;
      return Math.max(80, base + this.totalTroops(factionId) * PARAMS.maintenanceCost);
    }

    // Calcula la relación entre fuerza enemiga y fuerza propia en fronteras en guerra.
    borderThreat(factionId) {
  let enemy = 0;
  let own = 0;

  // Evita contar varias veces la misma provincia enemiga.
  const enemyCells = new Set();
  const ownFrontierCells = new Set();

  for (const cell of this.ownedCells(factionId)) {
    for (const [c, r] of this.neighbors(cell.c, cell.r)) {
      const other = this.cells[c][r];

      if (
        other.owner >= 0 &&
        other.owner !== factionId &&
        this.relations[factionId][other.owner] === 'Guerra'
      ) {
        const enemyKey = `${other.c},${other.r}`;
        const ownKey = `${cell.c},${cell.r}`;

        if (!enemyCells.has(enemyKey)) {
          enemyCells.add(enemyKey);
          enemy += other.troops;
        }

        if (!ownFrontierCells.has(ownKey)) {
          ownFrontierCells.add(ownKey);
          own += cell.troops;
        }
      }
    }
  }

  return enemy / Math.max(1, own);
}

    /**
     * Árbol de decisión básico de la IA.
     * Decide entre consolidar, defender, expandirse, atacar, reclutar, aliarse o esperar.
     * Las decisiones se materializan programando nuevos eventos en la LEF.
     */
  decideAction(factionId, turn) {
    const faction = this.factions[factionId];

    if (!faction || faction.status !== 'Activa') return;

    const strongest = this.strongestCell(factionId);
    if (!strongest) return;

    // 1. Reclutamiento solicitado manualmente por el usuario.
    if (faction.requestedRecruits > 0) {
      faction.lastAction = 'Reclutar (manual)';

      this.scheduleEvent(
        turn,
        PRIORITY.Reclutamiento,
        'Reclutamiento',
        factionId,
        { c: strongest.c, r: strongest.r },
        { amount: faction.requestedRecruits }
      );

      return;
    }

    // 2. Si existe una crisis económica o social, la nación se consolida.
    if (faction.treasury < 0 || faction.happiness < 30) {
      faction.lastAction = 'Consolidar';

      faction.taxRate = clamp(
        faction.taxRate - 0.02,
        0.05,
        0.50
      );

      this.log(
        `${faction.name}: IA decide CONSOLIDAR.`,
        'ai'
      );

      return;
    }

    // 3. Buscar una provincia vecina para expansión o ataque.
    const target = this.weakestFrontier(factionId);

    if (!target) {
      faction.lastAction = 'Esperar';
      return;
    }

    // 4. Las provincias libres tienen prioridad.
    if (target.destination.owner < 0) {

      // Si la frontera tiene muy pocas tropas, primero se refuerza.
      if (
        target.source.troops <= 1 &&
        faction.treasury >= PARAMS.recruitmentCost
      ) {
        faction.lastAction = 'Reforzar frontera';

        this.scheduleEvent(
          turn,
          PRIORITY.Reclutamiento,
          'Reclutamiento',
          factionId,
          { c: target.source.c, r: target.source.r },
          { amount: 5 }
        );

        this.log(
          `${faction.name}: IA decide REFORZAR una provincia fronteriza.`,
          'ai'
        );

        return;
      }

      // Si tiene tropas disponibles, ocupa la provincia libre.
      if (target.source.troops > 1) {
        faction.lastAction = 'Expandir';

        this.scheduleEvent(
          turn,
          PRIORITY.MovimientoEjercito,
          'MovimientoEjercito',
          { c: target.source.c, r: target.source.r },
          { c: target.destination.c, r: target.destination.r },
          { factionId }
        );

        this.log(
          `${faction.name}: IA decide EXPANDIRSE hacia una provincia Libre.`,
          'ai'
        );

        return;
      }
    }

    // 5. Calcular la relación de fuerzas si el territorio pertenece a otra nación.
    const forceOwn = Math.max(
      1,
      target.source.troops *
        (target.source.morale / 100)
    );

    const forceEnemy = Math.max(
      1,
      target.destination.troops *
        (target.destination.morale / 100) *
        (1 + target.destination.defense / 10)
    );

    const ratio = forceOwn / forceEnemy;
    const threat = this.borderThreat(factionId);

    /*
    * 6. ATACAR.
    *
    * Antes se exigía ratio > 1.5.
    * Era demasiado restrictivo porque ambos imperios
    * podían reclutar indefinidamente sin atacarse.
    *
    * Como la defensa territorial ya está incluida en
    * forceEnemy, 1.15 sigue exigiendo cierta ventaja.
    */
    if (
      ratio >= 1.15 &&
      faction.happiness > 50 &&
      target.source.troops > 3
    ) {
      faction.lastAction = 'Atacar';

      const enemyId = target.destination.owner;

      // Primero declarar la guerra si todavía están en paz.
      if (
        enemyId >= 0 &&
        this.relations[factionId][enemyId] !== 'Guerra'
      ) {
        this.scheduleEvent(
          turn,
          PRIORITY.DeclararGuerra,
          'DeclararGuerra',
          factionId,
          enemyId
        );
      }

      // Después programar el movimiento que producirá el combate.
      this.scheduleEvent(
        turn,
        PRIORITY.MovimientoEjercito,
        'MovimientoEjercito',
        { c: target.source.c, r: target.source.r },
        { c: target.destination.c, r: target.destination.r },
        { factionId }
      );

      this.log(
        `${faction.name}: IA decide ATACAR (ratio ${ratio.toFixed(2)}).`,
        'ai'
      );

      return;
    }

    /*
    * 7. DEFENDER.
    *
    * Solo defender cuando realmente existe una desventaja
    * importante. Ya no basta con amenaza > 1.2.
    */
    if (
      threat > 1.35 &&
      ratio < 0.90 &&
      faction.treasury >= PARAMS.recruitmentCost
    ) {
      faction.lastAction = 'Defender';

      this.scheduleEvent(
        turn,
        PRIORITY.Reclutamiento,
        'Reclutamiento',
        factionId,
        { c: target.source.c, r: target.source.r },
        { amount: 4 }
      );

      this.log(
        `${faction.name}: IA decide DEFENDER.`,
        'ai'
      );

      return;
    }

    // 8. Si todavía no puede atacar pero tiene dinero, refuerza la frontera.
    if (
      faction.treasury >
      2 * this.estimatedWarCost(factionId, target.destination)
    ) {
      faction.lastAction = 'Reclutar';

      this.scheduleEvent(
        turn,
        PRIORITY.Reclutamiento,
        'Reclutamiento',
        factionId,
        { c: target.source.c, r: target.source.r },
        { amount: 5 }
      );

      this.log(
        `${faction.name}: IA decide RECLUTAR en la frontera.`,
        'ai'
      );

      return;
    }

    // 9. Si no puede realizar ninguna otra acción, espera.
    faction.lastAction = 'Esperar';

    this.log(
      `${faction.name}: IA decide ESPERAR.`,
      'ai'
    );
  }

    // Declara guerra de forma simétrica entre dos naciones y rompe una alianza previa si existe.
    declareWar(n, m) {
      if (n == null || m == null || n === m) return;
      if (this.relations[n][m] === 'Alianza') this.breakAlliance(n, m);
      this.relations[n][m] = 'Guerra';
      this.relations[m][n] = 'Guerra';
      this.passage[n][m] = 0;
      this.passage[m][n] = 0;
      this.log(`⚔ ${this.factions[n].name} declara la guerra a ${this.factions[m].name}.`, 'battle');
    }

    // Cambia de forma simétrica la relación diplomática de dos naciones a Paz.
    makePeace(n, m) {
      this.relations[n][m] = 'Paz';
      this.relations[m][n] = 'Paz';
      this.passage[n][m] = 0;
      this.passage[m][n] = 0;
    }

    // Crea una alianza simétrica y, opcionalmente, autoriza el paso por territorio aliado.
    makeAlliance(n, m, allowPassage = false) {
      this.relations[n][m] = 'Alianza';
      this.relations[m][n] = 'Alianza';
      this.passage[n][m] = allowPassage ? 1 : 0;
      this.passage[m][n] = allowPassage ? 1 : 0;
    }

    // Rompe una alianza y vuelve a Paz, retirando cualquier permiso de paso territorial.
    breakAlliance(n, m) {
      this.relations[n][m] = 'Paz';
      this.relations[m][n] = 'Paz';
      this.passage[n][m] = 0;
      this.passage[m][n] = 0;
    }

    // ---------- Movimiento, combate y conquista ----------
    /**
     * Resuelve un movimiento entre provincias adyacentes.
     * Diferencia territorio propio, libre, aliado con permiso, enemigo en guerra y enemigo en paz.
     * Puede programar una conquista o un combate como consecuencia del movimiento.
     */
    moveArmy(sourcePos, destPos, data, turn) {
      const src = this.getCell(sourcePos);
      const dst = this.getCell(destPos);
      const factionId = data && Number.isInteger(data.factionId) ? data.factionId : (src ? src.owner : -1);
      if (!src || !dst || src.owner !== factionId || src.troops <= 1) return 'MOVIMIENTO_INVALIDO';
      if (!this.neighbors(src.c, src.r).some(([c, r]) => c === dst.c && r === dst.r)) return 'MOVIMIENTO_INVALIDO';

      const force = Math.max(1, Math.floor(src.troops * 0.60));
      const attackMorale = src.morale;

      if (dst.owner === factionId) {
        const moving = Math.min(force, src.troops - 1);
        src.troops -= moving;
        dst.troops += moving;
        dst.morale = Math.round((dst.morale + attackMorale) / 2);
        this.log(`${this.factions[factionId].name} redistribuye ${moving} tropas.`, 'move');
        return 'PROPIO';
      }

      if (dst.owner < 0) {
        src.troops -= force;
        this.scheduleEvent(turn, PRIORITY.ConquistaProvincia, 'ConquistaProvincia', factionId,
          { c: dst.c, r: dst.r }, { troops: force, morale: attackMorale, source: { c: src.c, r: src.r } });
        this.log(`${this.factions[factionId].name} avanza hacia una provincia Libre.`, 'move');
        return 'LIBRE';
      }

      if (this.relations[factionId][dst.owner] === 'Alianza' && this.passage[factionId][dst.owner] === 1) {
        // La provincia conserva a su propietario. El paso aliado se registra sin ocupar el territorio.
        this.log(`${this.factions[factionId].name} transita por territorio aliado con autorización. El propietario no cambia.`, 'move');
        return 'ALIADO_AUTORIZADO';
      }

      if (this.relations[factionId][dst.owner] !== 'Guerra') {
        this.log(`${this.factions[factionId].name}: movimiento rechazado; no existe estado de guerra.`, 'warning');
        return 'DENEGADO';
      }

      src.troops -= force;
      dst.warThisTurn = true;
      this.scheduleEvent(turn, PRIORITY.Combate, 'Combate', factionId, dst.owner, {
        attackerFactionId: factionId,
        defenderFactionId: dst.owner,
        attackerTroops: force,
        attackerMorale: attackMorale,
        source: { c: src.c, r: src.r },
        destination: { c: dst.c, r: dst.r }
      });
      return 'COMBATE';
    }

    // Devuelve las tropas atacantes sobrevivientes a su provincia de origen después de una retirada.
    returnAttacker(data, troops, morale) {
      const src = this.getCell(data.source);
      if (src && src.owner === data.attackerFactionId && troops > 0) {
        src.troops += troops;
        src.morale = clamp(Math.round((src.morale + morale) / 2), 0, 100);
      }
    }

    // Registra victoria y derrota del turno para el cálculo posterior de felicidad nacional.
    recordWin(winnerId, loserId) {
      if (this.factions[winnerId]) this.factions[winnerId].victoriesTurn++;
      if (this.factions[loserId]) this.factions[loserId].defeatsTurn++;
    }

    /**
     * Resuelve un combate probabilístico en un máximo de N rondas.
     * Usa fuerza, moral, defensa territorial y variación aleatoria para calcular bajas.
     * Contempla aniquilación, victoria, retirada y comparación de fuerzas al llegar al límite.
     */
    resolveCombat(data, turn) {
      const dst = this.getCell(data.destination);
      if (!dst) return;
      let attackerTroops = Math.max(0, Math.floor(data.attackerTroops));
      let defenderTroops = Math.max(0, Math.floor(dst.troops));
      let attackerMorale = clamp(data.attackerMorale ?? 100, 0, 100);
      let defenderMorale = clamp(dst.morale ?? 100, 0, 100);
      let round = 0;
      const defenderId = dst.owner;
      const attackerId = data.attackerFactionId;
      dst.warThisTurn = true;
      this.lastBattleCells.push({ c: dst.c, r: dst.r });
      if (this.onBattle) this.onBattle(dst.c, dst.r, attackerId, defenderId);

      this.log(`Combate: ${this.factions[attackerId].name} vs ${this.factions[defenderId].name}.`, 'battle');

      while (attackerTroops > 0 && defenderTroops > 0 && round < PARAMS.maxCombatRounds) {
        const a0 = attackerTroops;
        const d0 = defenderTroops;
        const forceA = a0 * (attackerMorale / 100);
        const forceD = d0 * (defenderMorale / 100) * (1 + dst.defense / 10);
        const epsilonA = this.rng.uniform(-0.15, 0.15);
        const epsilonD = this.rng.uniform(-0.15, 0.15);
        const lossesA = Math.min(a0, Math.max(0, Math.round(PARAMS.betaDefender * forceD * (1 + epsilonD))));
        const lossesD = Math.min(d0, Math.max(0, Math.round(PARAMS.alphaAttacker * forceA * (1 + epsilonA))));
        attackerTroops = a0 - lossesA;
        defenderTroops = d0 - lossesD;
        attackerMorale = clamp(attackerMorale - PARAMS.moraleSensitivity * (lossesA / Math.max(1, a0)) * 100, 0, 100);
        defenderMorale = clamp(defenderMorale - PARAMS.moraleSensitivity * (lossesD / Math.max(1, d0)) * 100, 0, 100);
        round++;

        if (attackerTroops === 0 && defenderTroops === 0) {
          dst.troops = 0;
          dst.morale = 0;
          this.log('Aniquilación mutua: ambos ejércitos quedaron sin soldados.', 'battle');
          return 'ANIQUILACION_MUTUA';
        }

        if (defenderTroops === 0) {
          dst.troops = 0;
          dst.morale = 0;
          this.recordWin(attackerId, defenderId);
          this.scheduleEvent(turn, PRIORITY.ConquistaProvincia, 'ConquistaProvincia', attackerId,
            { c: dst.c, r: dst.r }, { troops: attackerTroops, morale: attackerMorale, source: data.source });
          this.log(`${this.factions[attackerId].name} vence por eliminación del defensor.`, 'battle');
          return 'ATACANTE_GANA';
        }

        if (attackerTroops === 0) {
          dst.troops = defenderTroops;
          dst.morale = defenderMorale;
          this.recordWin(defenderId, attackerId);
          this.log(`${this.factions[defenderId].name} vence: atacante sin soldados.`, 'battle');
          return 'DEFENSOR_GANA';
        }

        if (attackerMorale <= PARAMS.retreatThreshold) {
          dst.troops = defenderTroops;
          dst.morale = defenderMorale;
          this.returnAttacker(data, attackerTroops, attackerMorale);
          this.recordWin(defenderId, attackerId);
          this.log(`${this.factions[attackerId].name} se retira por baja moral.`, 'battle');
          return 'ATACANTE_RETIRA';
        }

        if (defenderMorale <= PARAMS.retreatThreshold) {
          dst.troops = 0;
          dst.morale = defenderMorale;
          this.recordWin(attackerId, defenderId);
          this.scheduleEvent(turn, PRIORITY.ConquistaProvincia, 'ConquistaProvincia', attackerId,
            { c: dst.c, r: dst.r }, { troops: attackerTroops, morale: attackerMorale, source: data.source });
          this.log(`${this.factions[defenderId].name} se retira por baja moral.`, 'battle');
          return 'DEFENSOR_RETIRA';
        }
      }

      // Si se alcanza Nmax, se comparan las fuerzas restantes.
      const finalA = attackerTroops * (attackerMorale / 100);
      const finalD = defenderTroops * (defenderMorale / 100) * (1 + dst.defense / 10);
      if (finalA > finalD) {
        dst.troops = 0;
        dst.morale = defenderMorale;
        this.recordWin(attackerId, defenderId);
        this.scheduleEvent(turn, PRIORITY.ConquistaProvincia, 'ConquistaProvincia', attackerId,
          { c: dst.c, r: dst.r }, { troops: attackerTroops, morale: attackerMorale, source: data.source });
        this.log(`${this.factions[attackerId].name} gana por mayor fuerza al llegar a ${PARAMS.maxCombatRounds} rondas.`, 'battle');
        return 'ATACANTE_NMAX';
      }

      dst.troops = defenderTroops;
      dst.morale = defenderMorale;
      this.returnAttacker(data, attackerTroops, attackerMorale);
      this.recordWin(defenderId, attackerId);
      this.log(`${this.factions[defenderId].name} resiste tras ${PARAMS.maxCombatRounds} rondas.`, 'battle');
      return 'DEFENSOR_NMAX';
    }

    /**
     * Cambia el propietario de una provincia después de una conquista.
     * Aplica penalización de felicidad y elimina una nación si pierde su último territorio.
     */
    conquer(factionId, pos, data = {}, turn = this.turn) {
      const cell = this.getCell(pos);
      const faction = this.factions[factionId];
      if (!cell || !faction || faction.status !== 'Activa') return;
      const oldOwner = cell.owner;
      cell.owner = factionId;
      cell.troops = Math.max(1, Math.floor(data.troops || 1));
      cell.morale = clamp(data.morale ?? 80, 0, 100);
      if (oldOwner >= 0 && oldOwner !== factionId) {
        cell.happiness = clamp(cell.happiness - PARAMS.conquestPenalty, 0, 100);
      }
      this.log(`${faction.name} conquista la provincia (${cell.c},${cell.r}).`, 'conquest');

      if (oldOwner >= 0 && oldOwner !== factionId && this.ownedCells(oldOwner).length === 0) {
        this.eliminateFaction(oldOwner);
      }
      this.scheduleEvent(turn, PRIORITY.VerificarVictoria, 'VerificarVictoria', 'Partida');
    }

    // Marca una nación como eliminada y limpia las tropas que todavía le pertenezcan.
    eliminateFaction(factionId) {
      const faction = this.factions[factionId];
      if (!faction || faction.status === 'Eliminada') return;
      faction.status = 'Eliminada';
      this.log(`☠ ${faction.name} ha sido eliminada al perder todos sus territorios.`, 'conquest');
    }

    // ---------- Felicidad, rebeliones y victoria ----------
    /**
     * Calcula la felicidad nacional después de combates y conquistas.
     * Usa promedio ponderado por población y ajusta por victorias/derrotas del turno.
     */
    calculateNationalHappiness(factionId) {
      const faction = this.factions[factionId];
      if (!faction || faction.status !== 'Activa') return;
      const cells = this.ownedCells(factionId);
      if (!cells.length) return;
      const pop = cells.reduce((s, c) => s + c.population, 0);
      if (pop <= 0) {
        faction.happiness = 0;
        return;
      }
      const weighted = cells.reduce((s, c) => s + c.population * c.happiness, 0) / pop;
      faction.happiness = clamp(
        weighted + PARAMS.militaryResultEffect * (faction.victoriesTurn - faction.defeatsTurn),
        0,
        100
      );
      this.log(`${faction.name}: felicidad nacional ${faction.happiness.toFixed(1)}.`, 'phase');
    }

    // Revisa provincias con felicidad baja y programa rebeliones según su probabilidad.
    evaluateRebellions(turn) {
      this.log('Evaluación de rebeliones.', 'phase');
      for (let c = 0; c < this.cols; c++) {
        for (let r = 0; r < this.rows; r++) {
          const cell = this.cells[c][r];
          if (cell.owner < 0) continue;
          if (cell.happiness === 0) {
            this.scheduleEvent(turn, PRIORITY.Rebelion, 'Rebelion', { c, r });
          } else if (cell.happiness > 0 && cell.happiness <= PARAMS.rebellionThreshold) {
            const probability = (PARAMS.rebellionThreshold - cell.happiness) / PARAMS.rebellionThreshold;
            if (this.rng.random() < probability) {
              this.scheduleEvent(turn, PRIORITY.Rebelion, 'Rebelion', { c, r });
            }
          }
        }
      }
    }

    /**
     * Procesa una rebelión confirmada.
     * Puede convertir la provincia en Libre y eliminar a la antigua nación si era su último territorio.
     */
    rebel(pos) {
      const cell = this.getCell(pos);
      if (!cell || cell.owner < 0) return;
      const oldOwner = cell.owner;
      cell.population = Math.round(Math.max(0, cell.population * (1 - PARAMS.warPopulationLoss)));
      const success = cell.happiness === 0 || cell.defense < PARAMS.rebelControlThreshold;
      if (success) {
        cell.owner = -1; // Libre: no pertenece a ninguna nación y no recauda impuestos.
        cell.troops = 0;
        cell.morale = 100;
        cell.happiness = 50;
        this.log(`⚑ Rebelión exitosa en (${cell.c},${cell.r}). La provincia queda Libre.`, 'rebellion');
        if (this.ownedCells(oldOwner).length === 0) this.eliminateFaction(oldOwner);
      } else {
        cell.happiness = clamp(cell.happiness + 10, 0, 100);
        this.log(`Rebelión controlada en (${cell.c},${cell.r}).`, 'rebellion');
      }
    }

    // Comprueba victoria por 60 % del mapa o por quedar una sola nación activa.
    verifyVictory() {
      if (this.status !== 'EnCurso') return;
      const active = this.factions.filter(f => f.status === 'Activa');
      if (active.length === 1) {
        this.finishGame(active[0], 'eliminación de las demás naciones');
        return;
      }
      const total = this.cols * this.rows;
      for (const faction of active) {
        const share = this.ownedCells(faction.id).length / total;
        if (share >= PARAMS.victoryShare) {
          this.finishGame(faction, `control de ${(share * 100).toFixed(1)}% del mapa`);
          return;
        }
      }
    }

    // Finaliza la simulación, guarda al ganador y registra la razón de victoria.
    finishGame(faction, reason) {
      this.status = 'Finalizada';
      this.winner = faction.id;
      this.log(`🏆 Victoria de ${faction.name} por ${reason}.`, 'victory');
    }

    /**
     * Cierra el turno: conserva el indicador de guerra para el siguiente turno,
     * reinicia victorias/derrotas y programa el próximo InicioTurno.
     */
    finishTurn(turn) {
      // Los resultados militares afectan la felicidad nacional antes de este punto.
      for (const faction of this.factions.filter(f => f.status === 'Activa')) {
        faction.victoriesTurn = 0;
        faction.defeatsTurn = 0;
      }
      for (let c = 0; c < this.cols; c++) {
        for (let r = 0; r < this.rows; r++) {
          const cell = this.cells[c][r];
          cell.warLastTurn = cell.warThisTurn;
          cell.warThisTurn = false;
        }
      }
      this.completedTurns++;
      this.log(`Fin del turno ${turn}.`, 'phase');
      if (this.status === 'EnCurso') {
        this.scheduleEvent(turn + 1, PRIORITY.InicioTurno, 'InicioTurno', 'Partida');
      }
    }

    // ---------- Entradas del usuario ----------
    // Entrada del usuario: cambia la tasa de impuestos de una nación entre 0 y 100 %.
    setTaxRate(factionId, rate) {
      const f = this.factions[factionId];
      if (!f) return false;
      f.taxRate = clamp(Number(rate) || 0, 0, 1);
      this.log(`${f.name}: tasa de impuestos fijada en ${(f.taxRate * 100).toFixed(0)}%.`, 'system');
      return true;
    }

    // Entrada del usuario: guarda una solicitud de reclutas para el próximo turno.
    requestRecruitment(factionId, amount) {
      const f = this.factions[factionId];
      if (!f) return false;
      f.requestedRecruits = Math.max(0, Math.floor(Number(amount) || 0));
      this.log(`${f.name}: solicitud manual de ${f.requestedRecruits} reclutas para el próximo turno.`, 'system');
      return true;
    }

    // ---------- Información ----------
    // Construye un resumen de una nación para mostrarlo en el panel de la interfaz.
    snapshotFaction(factionId) {
      const f = this.factions[factionId];
      if (!f) return null;
      return {
        id: f.id,
        name: f.name,
        territories: this.ownedCells(f.id).length,
        troops: this.totalTroops(f.id),
        treasury: f.treasury,
        happiness: f.happiness,
        taxRate: f.taxRate,
        status: f.status,
        incomeTurn: f.incomeTurn,
        taxesTurn: f.taxesTurn,
        maintenanceTurn: f.maintenanceTurn,
        recruitedTurn: f.recruitedTurn,
        lastAction: f.lastAction
      };
    }

    // Retorna una vista de los próximos eventos sin modificar la LEF.
    getNextEvents(limit = 8) { return this.lef.slice(0, limit); }

    // Registra un mensaje interno y lo envía a la interfaz mediante el callback onLog.
    log(message, type = '') {
      const item = { turn: this.turn, message, type, index: this.logs.length + 1 };
      this.logs.push(item);
      if (this.logs.length > 300) this.logs.shift();
      if (this.onLog) this.onLog(item);
    }
  }

  // ---------- Pruebas básicas para validación ----------
  /**
   * Pruebas unitarias sencillas sin framework externo.
   * Validan reglas críticas del motor y retornan una lista PASS/FAIL.
   */
  function runBasicTests() {
    const results = [];
    const test = (name, fn) => {
      try {
        const detail = fn();
        results.push({ test: name, pass: true, detail: detail || 'OK' });
      } catch (error) {
        results.push({ test: name, pass: false, detail: error.message });
      }
    };
    const assert = (condition, message) => { if (!condition) throw new Error(message); };

    test('Economía', () => {
      const sim = new Simulation({ seed: 100 });
      const f = sim.factions[0];
      const before = f.treasury;
      const income = sim.ownedCells(0).reduce((s, c) => s + sim.provincialIncome(c), 0);
      const taxes = income * f.taxRate;
      const maintenance = sim.totalTroops(0) * PARAMS.maintenanceCost;
      sim.generateIncome(0);
      sim.payMaintenance(0);
      const expected = before + taxes - maintenance;
      assert(Math.abs(f.treasury - expected) < 1e-8, `Esperado ${expected}, obtenido ${f.treasury}`);
      return `Tesoro ${before.toFixed(2)} -> ${f.treasury.toFixed(2)}`;
    });

    test('Reclutamiento con y sin oro', () => {
      const sim = new Simulation({ seed: 101 });
      const pos = sim.strongestCell(0);
      const beforeTroops = pos.troops;
      sim.factions[0].treasury = 200;
      const recruited = sim.recruit(0, pos, 5);
      assert(recruited > 0 && pos.troops > beforeTroops, 'No reclutó con dinero suficiente');
      const after = pos.troops;
      sim.factions[0].treasury = 0;
      const recruited2 = sim.recruit(0, pos, 5);
      assert(recruited2 === 0 && pos.troops === after, 'Reclutó sin dinero');
      return `${recruited} reclutas con oro; 0 sin oro`;
    });

    test('Combate: límites de bajas y moral', () => {
      const sim = new Simulation({ seed: 102 });
      const a = sim.strongestCell(0);
      const d = sim.strongestCell(1);
      // Colocamos un defensor adyacente al atacante para una prueba controlada.
      const [dc, dr] = sim.neighbors(a.c, a.r)[0];
      const dest = sim.cells[dc][dr];
      dest.owner = 1;
      dest.troops = 15;
      dest.morale = 100;
      sim.relations[0][1] = sim.relations[1][0] = 'Guerra';
      const result = sim.resolveCombat({
        attackerFactionId: 0,
        defenderFactionId: 1,
        attackerTroops: 15,
        attackerMorale: 100,
        source: { c: a.c, r: a.r },
        destination: { c: dest.c, r: dest.r }
      }, 1);
      assert(dest.troops >= 0, 'Tropas defensoras negativas');
      assert(dest.morale >= 0 && dest.morale <= 100, 'Moral fuera de rango');
      return `Resultado ${result}; moral defensora ${dest.morale.toFixed(1)}`;
    });

    test('Rebelión con felicidad cero', () => {
      const sim = new Simulation({ seed: 103 });
      const cell = sim.strongestCell(0);
      cell.happiness = 0;
      cell.defense = 0;
      sim.rebel({ c: cell.c, r: cell.r });
      assert(cell.owner === -1, 'La provincia no quedó Libre');
      return 'Provincia Libre';
    });

    test('Eliminación por pérdida de territorios', () => {
      const sim = new Simulation({ seed: 104 });
      const cells = sim.ownedCells(0);
      cells.forEach(cell => { cell.owner = -1; cell.troops = 0; });
      sim.eliminateFaction(0);
      assert(sim.factions[0].status === 'Eliminada', 'La nación sigue activa');
      return 'Estado Eliminada';
    });

    test('Cinco turnos consecutivos', () => {
      const sim = new Simulation({ seed: 105 });
      sim.runTurns(5);
      assert(sim.completedTurns >= 5 || sim.status === 'Finalizada', 'No ejecutó cinco turnos');
      assert(sim.status !== 'Error', 'La LEF falló');
      return `Turnos completados: ${sim.completedTurns}`;
    });

    test('Expansión automática de la IA', () => {
      const sim = new Simulation({ seed: 12345 });
      sim.runTurns(5);
      const territories = sim.factions.map(f => sim.ownedCells(f.id).length);
      assert(territories.some(n => n > 1), 'La IA no conquistó provincias Libres');
      return `Territorios tras 5 turnos: ${territories.join(', ')}`;
    });

    return results;
  }

  return { Simulation, PARAMS, PRIORITY, LCG, runBasicTests, clamp, keyOf };
});
