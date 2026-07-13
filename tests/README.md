# Tests de MI NORTE

Suite de regresión end-to-end: levanta un servidor estático sobre el repo,
abre la app en Chromium headless (Playwright) y valida la lógica financiera
real (salud, deudas, conciliación, fijos, metas, respaldo cifrado, hardening).

## Requisitos

- Node 18+
- Playwright instalado global (`npm i -g playwright`) y Chromium disponible.
  Si tu Chromium no está en la ruta por defecto, apúntalo con:
  `CHROME_PATH=/ruta/a/chrome node tests/run-all.js`

## Correr

```bash
node tests/run-all.js        # toda la suite
node tests/07-salud-financiera.test.js   # uno solo
```

Cada test es autocontenido (siembra su propio localStorage) y termina con
`✅ ALL PASS` o `❌ FAIL` (exit code 0/1).

## Fixtures

`fixtures/` contiene estados de cuenta **sintéticos** con la estructura real
de un CSV del BAC (preámbulo + separador `|` o tabs). No hay datos personales.

## Qué cubre cada archivo

| Archivo | Cubre |
|---|---|
| 01 | Pestaña Más, historial de pagos de deuda, parser CSV básico |
| 02 | Detección de separador/encabezado con estados BAC (pipe y tab) |
| 03 | Proyección de amortización de deudas (cuota, interés, "nunca termina") |
| 04 | Conciliación de saldo: ajuste de cuenta al saldo del banco |
| 05 | Pagos divididos interés/capital, edición, compatibilidad con pagos viejos |
| 06 | Proyección de gasto mezclada (no explota con gasto grande temprano) |
| 07 | Salud financiera: pilares, score, próximo paso, colchón |
| 08 | Fijos automáticos/pendientes, próximos pagos, no duplicación |
| 09 | Metas: cuota mensual por fecha, al día/atrasado, cumplida |
| 10 | Respaldo cifrado: ida y vuelta, contraseña incorrecta, recordatorio |
| 11 | Endurecimiento: XSS escapado, normalize coerciona tipos, salud ignora deudas ajenas, dueDate avanza al pagar, CSV sin fórmulas vivas |
