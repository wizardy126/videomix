# T39 · v3: UI de cadenas y secuencia, y render cortado al límite (E2, E4, E5)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T37, T38 · **Estado**: pendiente

## Alcance

1. **Cadenas en `ClipList`**:
   - indicador de enlace entre clips encadenados;
   - acción "Romper enlace con el anterior" / "Enlazar con el anterior" (`setClipLink`).
   - **Ajustes**: umbral N s y "corte directo / transición" en `MixSettingsDialog`.
   - En la vista Mix, las cadenas se ven como bloques contiguos en el mismo carril.
2. **Secuencia siempre visible**:
   - panel o sección "Siempre visible", ordenable;
   - añadir y quitar clips desde la lista (menú contextual y arrastrar);
   - indicador en las filas.
   - En la vista Mix se distingue el carril o hueco de la secuencia.
3. **Render con duración máxima**:
   - `useMixRender`, la previsualización en vivo y el render usan `truncatePlan`;
   - aviso previo al render con segundos y clips perdidos;
   - *fade* global de vídeo y audio en el corte;
   - música y efectos recortados;
   - la caché incremental sigue funcionando.
   - Test con ffmpeg real: la duración es exactamente el límite y hay *fade* al final.
4. **Previsualización en vivo**: respeta cadenas (corte directo), secuencia y límite.
5. **Pendiente de T35**: refrescar con ffprobe los metadatos (tamaño de visualización y SAR) de todas las fuentes al abrir un proyecto (en segundo plano) y antes de renderizar. Así, un proyecto antiguo con una fuente anamórfica que no se ha activado en la sesión no falla con `max-rect-outside-frame`. Hay que respetar la regla de no reescalar de T35 (`sourceResize.ts`).
6. **Pendientes de T38**:
   - `truncatePlan` en el render y la previsualización;
   - overlays y sonidos resueltos con los *placements* del plan completo y la duración truncada;
   - audio sin bajada de volumen en las uniones de cadena con corte directo (crossfade mínimo de pocos ms en lugar del antichasquido por separado).
7. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` y `yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
