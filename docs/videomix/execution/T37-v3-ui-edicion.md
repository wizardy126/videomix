# T37 · v3: contador, "Nuevo clip desde aquí", duración estimada y máxima en UI (E1, E3, E4, E6)

- **Hito**: M9 · **Modelo**: Sonnet · **Depende de**: T36 · **Estado**: pendiente

## Alcance

1. **E1 · Contador de duración**:
   - Con un inicio marcado (marcador sin fin), se muestra inicio → cursor como etiqueta junto al cabezal en el `Timeline` y como texto en `BottomBar`.
   - Con un clip seleccionado, se muestra su duración y "→ m:ss si el fin fuera el cursor".
   - Formato según el ajuste de timecode del usuario. Se actualiza durante la reproducción sin coste apreciable.
2. **E6 · "Nuevo clip desde aquí"**:
   - `KeyboardAction` nueva con atajo por defecto (propuesta: Shift+I; comprueba conflictos) y botón en `BottomBar`.
   - Crea un marcador de inicio en el cursor **aunque el cursor esté dentro de otro clip**, sin modificar ese clip. "Marcar fin" (O) lo cierra como clip nuevo.
   - Revisa cómo se comportan hoy I/O dentro de un clip (T16 dice que I crea un marcador) y documenta la diferencia.
3. **E3 · Duración estimada**:
   - "≈ m:ss" en `MixRenderButtons` (barra inferior), visible en ambas pestañas;
   - calculada con `planRender` y *debounce*, reutilizando el plan de `useMixOverlays` si ya existe; ojo, ese plan solo se calcula con la pestaña Mix abierta;
   - tooltip con el número de clips.
4. **E4 · UI de la duración máxima**:
   - en `MixSettingsDialog`, sección Salida: interruptor más campo m:ss;
   - si la estimación supera el límite, el indicador de E3 se muestra resaltado con "→ se corta en m:ss".
   - El corte real y el aviso previo al render se hacen en T39.
5. **i18n**: español.
6. **Tests** de la lógica pura (formateo, cálculo del contador).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde, y `yarn test-e2e` sigue en verde.

## Notas de ejecución

## Revisión
