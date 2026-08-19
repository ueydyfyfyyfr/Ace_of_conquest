/*
 * Pruebas básicas del motor de Age of Conquest.
 *
 * Este archivo se ejecuta con Node.js:
 *   node tests.js
 *
 * No necesita npm ni librerías externas. Importa el motor y ejecuta las
 * validaciones definidas en runBasicTests(). Si alguna falla, devuelve
 * código de salida 1 para que Git/GitHub pueda detectar el error.
 */

const { runBasicTests } = require('./engine.js');

// Ejecuta todas las pruebas y recibe un arreglo con nombre, estado y detalle.
const results = runBasicTests();

// console.table permite leer rápidamente qué prueba pasó o falló.
console.table(results);

// Filtramos únicamente las pruebas que no cumplieron la condición esperada.
const failed = results.filter(result => !result.pass);

console.log(`\nResultado: ${results.length - failed.length}/${results.length} pruebas PASS`);

// Si hay fallos, Node termina con código distinto de cero.
if (failed.length) process.exitCode = 1;
