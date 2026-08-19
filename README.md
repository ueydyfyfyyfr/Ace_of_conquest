# Age of Conquest - Simulador académico

Proyecto final de **Simulación de Sistemas**. Implementa un motor lógico simplificado inspirado en *Age of Conquest* y en la formalización matemática desarrollada en el parcial anterior.

El objetivo no es copiar el videojuego comercial, sino demostrar una **simulación de eventos discretos** con economía, población, decisiones, combate, rebeliones y condiciones de victoria.

## Cómo ejecutar

No requiere instalación, servidor ni dependencias externas.

1. Clona o descarga el repositorio.
2. Abre `index.html` con un navegador moderno.
3. Usa los controles superiores para avanzar la simulación.

Para ejecutar las pruebas básicas desde terminal se necesita Node.js:

```bash
node tests.js
```

No es necesario ejecutar `npm install` porque el proyecto no usa paquetes externos ni `package.json`.

## Archivos del repositorio

```text
Age_of_Conquest/
├── index.html   # Estructura de la interfaz y controles visibles
├── style.css    # Diseño visual del mapa, paneles y registros
├── engine.js    # Motor de simulación: LEF, ecuaciones, IA y reglas del sistema
├── ui.js        # Dibujo del mapa y conexión entre controles HTML y engine.js
├── tests.js     # Pruebas básicas PASS/FAIL ejecutables con Node.js
├── README.md    # Documentación principal del proyecto
└── .gitignore   # Evita subir archivos temporales o entregables generados
```

Los archivos de código están comentados por secciones y funciones para facilitar su lectura y defensa.

## Qué hace cada archivo

### `engine.js`

Es el archivo más importante. Contiene el **motor lógico** y no depende de la interfaz gráfica.

Se encarga de:

- crear y reiniciar el escenario;
- mantener el reloj discreto;
- administrar la Lista de Eventos Futuros (LEF);
- actualizar población y felicidad;
- calcular ingresos, impuestos y mantenimiento;
- procesar reclutamiento y bancarrota;
- ejecutar la IA básica;
- manejar relaciones diplomáticas;
- mover tropas;
- resolver combates probabilísticos;
- conquistar provincias;
- evaluar rebeliones;
- calcular felicidad nacional;
- verificar eliminación y victoria;
- ejecutar pruebas básicas del motor.

### `ui.js`

Contiene únicamente la **interfaz gráfica**.

Se encarga de:

- dibujar el mapa hexagonal en Canvas;
- mostrar tropas, felicidad y capitales;
- actualizar los paneles de cada imperio;
- leer impuestos y reclutas ingresados por el usuario;
- ejecutar 1 turno, 5 turnos o modo automático;
- mostrar el registro de eventos;
- seleccionar provincias;
- mostrar la pantalla de victoria.

Las reglas de simulación no se implementan aquí; se llaman desde `engine.js`.

### `index.html`

Define la estructura visible de la aplicación:

- barra de control;
- mapa;
- estado de la LEF;
- panel de imperios;
- entrada manual;
- detalle de provincia;
- registro de eventos;
- parámetros principales.

### `style.css`

Solo contiene presentación visual. No modifica ninguna variable de la simulación.

### `tests.js`

Importa el motor y ejecuta las pruebas básicas definidas en `engine.js`.

Ejecutar:

```bash
node tests.js
```

## Controles principales

- **1 turno:** procesa un turno completo mediante la LEF.
- **5 turnos:** ejecuta cinco turnos consecutivos.
- **Auto:** avanza automáticamente hasta pausar o finalizar.
- **Reiniciar:** vuelve al escenario inicial usando la semilla indicada.
- **Velocidad:** cambia la frecuencia del modo automático.
- **Entrada manual:** permite modificar impuestos y solicitar reclutas.
- **Mapa:** al hacer clic en una provincia se muestran sus datos.

## Orden del turno

1. Actualizar población.
2. Actualizar felicidad provincial.
3. Generar ingresos.
4. Pagar mantenimiento.
5. Ejecutar decisiones.
6. Reclutar cuando corresponda.
7. Resolver movimientos.
8. Resolver combates.
9. Procesar conquistas.
10. Calcular felicidad nacional.
11. Evaluar rebeliones.
12. Verificar victoria.
13. Finalizar el turno.

## Lista de Eventos Futuros (LEF)

Cada evento contiene:

```text
(turno, prioridad, secuencia, tipo, origen, destino, datos)
```

Prioridades:

| Prioridad | Evento |
|---:|---|
| 10 | InicioTurno |
| 20 | ActualizarPoblacion |
| 25 | ActualizarFelicidad |
| 35 | GenerarIngresos |
| 40 | PagarMantenimiento |
| 45 | DecidirAccion |
| 50 | DeclararGuerra |
| 55 | Reclutamiento |
| 60 | MovimientoEjercito |
| 70 | Combate |
| 80 | ConquistaProvincia |
| 83 | CalcularFelicidadNacional |
| 85 | EvaluarRebeliones |
| 87 | Rebelion |
| 90 | VerificarVictoria |
| 100 | FinTurno |

## Parámetros principales adoptados

| Parámetro | Valor |
|---|---:|
| Crecimiento poblacional | 0.03 por turno |
| Mantenimiento | 2 oro/soldado/turno |
| Reclutamiento | 10 oro/soldado |
| Letalidad atacante α | 0.10 |
| Letalidad defensor β | 0.08 |
| Umbral de rebelión | 20 |
| Umbral de retirada | 25 |
| Máximo de rondas | 5 |
| Victoria territorial | 60 % |

Estos valores se adoptan para ejecutar el modelo. No se presentan como valores obtenidos empíricamente y pueden ajustarse posteriormente mediante comparación con partidas observadas del juego original.

## Funcionalidades principales

- mapa hexagonal con cuatro naciones;
- reloj discreto por turnos;
- LEF con prioridad y secuencia;
- crecimiento poblacional logístico;
- felicidad provincial y nacional;
- economía con producción, impuestos y mantenimiento;
- reclutamiento con costo único;
- IA básica mediante `if/else`;
- paz, guerra y alianza básica;
- movimiento y conquista;
- combate probabilístico con moral y defensa;
- rebeliones;
- bancarrota y desmovilización básica;
- eliminación de naciones;
- victoria por 60 % del mapa o por supervivencia;
- semilla reproducible;
- pruebas básicas PASS/FAIL.

## Integrantes

- Jesús Sanchez
- Miguel Alexander Urbina Rangel
- Francisco Javier Villasmil Silva
