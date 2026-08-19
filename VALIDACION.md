# Validación básica del simulador

Las pruebas se ejecutaron sobre `engine.js` mediante:

```bash
node tests.js
```

Resultado obtenido:

| Prueba | Resultado observado | Estado |
|---|---|---|
| Economía | Tesoro 500.00 -> 547.38 para el escenario controlado | PASS |
| Reclutamiento | 1 recluta con oro disponible y 0 sin oro | PASS |
| Combate | No produjo tropas negativas; moral defensora 78.5 en la corrida de prueba | PASS |
| Rebelión | Una provincia con felicidad 0 pasó a estado Libre | PASS |
| Eliminación | Una nación sin territorios cambió a Eliminada | PASS |
| Cinco turnos | Se completaron 5 turnos sin vaciar incorrectamente la LEF | PASS |

## Alcance de la validación

Estas pruebas validan la coherencia interna del simulador. No demuestran todavía una calibración contra el videojuego comercial.

Los parámetros son valores adoptados para ejecutar el modelo y pueden ajustarse posteriormente si se registran partidas reales de *Age of Conquest* bajo condiciones iniciales comparables.
