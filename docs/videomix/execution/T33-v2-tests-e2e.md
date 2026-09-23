# T33 · v2: tests end-to-end de la UI (E3)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T32 · **Estado**: pendiente

## Alcance

1. **Playwright + Electron** (`_electron.launch`), ejecutado **en local**: `yarn test-e2e`. No se añade a CI.
   - Usa el build (`out/`), un directorio de configuración temporal (`--config-dir`) y los medios de T02.
   - En Linux sin pantalla, con Xvfb si está disponible; se documenta.
2. **Escenarios mínimos**:
   1. añadir 3 fuentes;
   2. crear clips (atajos I/O/N) y editar un rectángulo arrastrando;
   3. reordenar clips;
   4. guardar y reabrir el `.vmx`;
   5. ajustes de montaje;
   6. overlays: añadir contador, texto y sonido, y anclar;
   7. previsualización en vivo (reproduce sin errores de consola);
   8. render a 320×180 (el fichero existe y ffprobe da la duración esperada);
   9. deshacer y rehacer;
   10. idioma español.
3. **Helpers**: `data-testid` mínimos donde haga falta, sin cambiar el comportamiento.
4. **Documentación** en `06-entorno-desarrollo.md`.

## Criterios de aceptación

- Los escenarios pasan en este entorno, o se documenta exactamente qué impide ejecutarlos y cómo lanzarlos en local.

## Notas de ejecución

## Revisión
