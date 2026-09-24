# T39 · v3: UI de cadenas y secuencia, y render cortado al límite (E2, E4, E5)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T37, T38 · **Estado**: hecha

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
5. ~~**Pendiente de T35**: refrescar con ffprobe los metadatos (tamaño de visualización y SAR) de todas las fuentes al abrir un proyecto (en segundo plano) y antes de renderizar. Así, un proyecto antiguo con una fuente anamórfica que no se ha activado en la sesión no falla con `max-rect-outside-frame`. Hay que respetar la regla de no reescalar de T35 (`sourceResize.ts`).~~ **Hecho en [T35b](T35b-refresco-metadatos.md).**
6. **Pendientes de T38**:
   - `truncatePlan` en el render y la previsualización;
   - overlays y sonidos resueltos con los *placements* del plan completo y la duración truncada;
   - audio sin bajada de volumen en las uniones de cadena con corte directo (crossfade mínimo de pocos ms en lugar del antichasquido por separado).
7. **Pendientes de T38b**:
   - texto del aviso `truncated` en el tooltip de la vista Mix (hoy cae en el de "transición acortada");
   - `script/videomix/renderVerticalExample.ts` debe pasar `sources` a `planRender`.
8. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` y `yarn test-e2e` en verde.

## Notas de ejecución

### Resumen

- **Render con duración máxima (E4)**:
  - `renderOutput.planRender` aplica `truncatePlan(plan, settings.maxDuration)` (render final y previsualización) y devuelve `{ plan, fullPlan }` (`fullPlan === plan` si no hay corte).
  - `getOverlayTimesPlan(renderPlan)` da `{ duration: plan.duration, placements: fullPlan.placements }`, lo que pedía T38 para resolver overlays y sonidos. Lo usan `useMixRender` (confirmación y render), `useMixOverlays` (vista Mix y previsualización en vivo) y `overlayRemoval`.
  - `useMixOverlays` expone `plan` (cortado: vista Mix y previsualización en vivo) y `fullPlan`. `useMixDuration` (E3) usa `fullPlan`, así que sigue mostrando la duración completa y "→ se corta en m:ss".
  - Aviso previo: `RenderWarning` `truncated` (primero de la lista) con el texto "El montaje dura más que su duración máxima: se corta en m:ss con el fundido de salida y quedan fuera N s", más los clips que quedan fuera y los cortados.
  - El *fade* global de vídeo y audio, el recorte de la música, de los sonidos y de los overlays salen solos de `plan.duration` (ya era así en `buildVideoGraph`/`buildAudioGraph`). La caché no necesita cambios.
- **Unión de audio sin bajada en los cortes directos** (pendiente de T38):
  - `getPlacementFades` detecta un corte directo con el clip siguiente de la columna (`transitionIn` = 0 y empieza justo al acabar el anterior) y devuelve `joinedIn`/`joinedOut` y `tail`.
  - En vez de dos antichasquidos de 10 ms (que bajan a silencio en el corte), un fundido cruzado de `CUT_CROSSFADE` = 20 ms: el audio del saliente sigue 20 ms tras su fin (`atrim` = `dur + tail`) mientras entra el siguiente.
  - Curva lineal (`tri`) si el entrante continúa al saliente en la misma fuente (la suma es la fuente, muestra a muestra) y `qsin` si no (`getJoinCurve`).
  - La compensación de simultaneidad no cambia en el corte.
  - La previsualización en vivo cambia de clip en el corte sin fundidos: aplica las ganancias una vez por fotograma, así que 20 ms no se notarían.
- **Cadenas en la lista (E2)**, con `clipLinks.ts` (puro, con tests):
  - `getClipLinkInfos` da, para cada clip encadenable, su posición y longitud de cadena, su clip anterior y lo que decide la regla automática. Usa las mismas cadenas que el planificador (`getClipChains` sobre los clips válidos).
  - `getSetClipLinkAction` enlaza o rompe; solo guarda `link` cuando difiere de la regla, así que volver a enlazar un par que la regla ya enlaza quita el campo.
  - Fila de `ClipList`: icono de enlace con "posición/longitud" (el icono de un clip enlazado rompe el enlace) e icono de "enlace roto" que lo rehace. Están en la primera línea de la fila, junto al nombre.
  - Menú contextual (lista y vista Mix): "Romper enlace con el anterior" / "Enlazar con el anterior".
- **Secuencia siempre visible (E5)**:
  - Sección "Siempre visible" encima de la lista: clips en orden con miniatura, duración y botón ×; se reordena arrastrando.
  - Se añaden clips arrastrándolos desde la lista (al final, o delante del clip de la secuencia sobre el que se suelta) o con el menú contextual: "Añadir a la secuencia siempre visible" / "Quitar…", que actúa sobre los clips seleccionados si el clip lo está.
  - Indicador (ojo y número) en las filas.
  - Todo en `useMixClipPins`, que ahora recibe `settings`: `linkInfos`, `sequence`, `sequenceIndexes` y las acciones `userSetClipLink`, `userAddToSequence`, `userRemoveFromSequence` y `userReorderSequence`. Un paso de deshacer por edición.
- **Ajustes** (`MixSettingsDialog`, sección nueva "Clips enlazados"): umbral N en segundos (0 = desactivado; borrador local como la ventana de reorden) y "Entre clips enlazados": corte directo o la transición del montaje.
- **Vista Mix**:
  - las cadenas ya van seguidas en el mismo carril (planificador); el bloque enlazado lleva borde izquierdo discontinuo, sin redondeo, e icono de enlace;
  - los bloques de la secuencia llevan una franja verde e icono de ojo;
  - el *tooltip* de un clip cortado dice "Se corta en m:ss: el montaje llega a su duración máxima" (antes caía en "transición acortada");
  - la barra muestra "Se corta en m:ss (−N s)".
- **`script/videomix/renderVerticalExample.ts`**: pasa `sources` a `planRender` y resuelve los overlays con `getOverlayTimesPlan`. Además, sus ajustes no tenían `links`/`alwaysVisible` (v4): desde T38 el script fallaba en `getClipChains`. Probado: renderiza 720×1280, 8,00 s.
- **i18n**: 25 claves (`scan-i18n`) y su traducción en `locales/es`.
- **Diseño**: 04-diseno §3.7 (integración), §5.2 (corte directo) y §6.5 (cadenas y secuencia en la UI). El manual es de T40.

### Verificación con ffmpeg real

- `render/chainJoin.ffmpeg.test.ts`: ruido blanco, corte en 3 s, niveles RMS en ventanas de 5 ms cada 1 ms alrededor del corte, respecto al nivel estable. Las ventanas estables varían ±0,8 dB por el propio ruido.

  | Caso | Mínimo | Máximo |
  |---|---|---|
  | Clips seguidos de la misma fuente (lineal) | −0,53 dB | +0,52 dB |
  | Clips de momentos distintos (`qsin`) | −0,61 dB | +0,50 dB |
  | Control: los mismos a 1 ms (antichasquidos por separado, lo de antes) | **−16,0 dB** | +0,52 dB |

  En el caso continuo, las muestras alrededor del corte coinciden con las de la fuente (diferencia máxima 7·10⁻⁹).
- `render/truncatedRender.ffmpeg.test.ts`: plan de 6 s cortado a 4 s, a 320×180, con música, un pitido (sonido superpuesto a 3,9 s) y un logo anclado a 3 s del inicio de un clip (5,5 s, tras el corte). Primero se renderiza el plan completo con caché y después el cortado:
  - 120 fotogramas, vídeo de 4,000 s y audio de 4,000 s;
  - luma media del último fotograma ≈ 7 frente a ≈ 128 antes del *fade*;
  - audio: −33,5 dB en 3,0–3,4 s y −53,6 dB en los últimos 20 ms (el plan completo tiene −20,6 dB en ese mismo tramo);
  - caché: 3 de 4 fragmentos reutilizados, y los mismos fotogramas que sin caché;
  - el logo queda `outside-video` (con su ancla real, 5,5 s) y el pitido, `clipped` a 4 s.

### Tests

- `clipLinks.test.ts` (8): posiciones y regla, mismas cadenas que el planificador, fijados, agrupados y secuencia fuera, `break`/`force` de ida y vuelta, y acciones de la secuencia (añadir, insertar, mover, quitar, sin cambios).
- `buildAudioGraph.test.ts`: fundidos de un corte directo (cadena de 3, con curva lineal y `qsin`), casos que no son corte (xfade o hueco), clip entrante muy corto, grafo (`atrim` con `tail`, curvas y compensación constante) validado con `verifyFilterGraph`.
- `previewAudio.test.ts`: en el corte, la suma de ganancias es 1 y la compensación no cambia.
- `renderOutput.test.ts`: `planRender` corta el plan (render y previsualización) y conserva `fullPlan`; `getOverlayTimesPlan`; el aviso `truncated` va primero y con los nombres.
- **e2e, escenario 14**, independiente de los demás, con capturas 14a–14d revisadas:
  - dos clips seguidos de una fuente vertical se enlazan ("1/2", "2/2"); se rompe y se rehace el enlace desde la fila;
  - un clip de otra fuente se arrastra a la sección "Siempre visible";
  - en la vista Mix, la cadena va en un carril (corte directo: bloques contiguos) y la secuencia en otro, con sus marcas;
  - en los ajustes: límite de 0:06 y "la transición del montaje" entre enlazados;
  - la vista Mix muestra "Se corta en 0:06 (−4 s)" y el *tooltip* del clip cortado; E3 muestra "→ se corta en 0:06";
  - el `.vmx` guarda `maxDuration`, `links` y `alwaysVisible`, y ningún `link` (el enlace rehecho vuelve a la regla);
  - la previsualización pide confirmación con el corte y los clips cortados y dura 6 s.

### Decisiones

- **Qué plan ve cada parte**: la vista Mix y la previsualización en vivo muestran el plan cortado, como el render. La estimación de E3 sigue mostrando la duración completa, con "→ se corta en m:ss", como en T37.
- **Corte directo = cualquier `transitionIn` 0 contiguo en la columna**, no solo las cadenas: con una transición acortada a 0 también es mejor unir sin bajada. Con transiciones normales nada cambia (snapshots iguales).
- **Fundido cruzado después del corte** (el saliente sigue 20 ms), no centrado en él: el entrante no necesita material antes de su inicio y el desfase con la imagen (20 ms) no se nota.
- **Curva lineal para audio continuo**: con `qsin` dos señales idénticas suben 3 dB en el centro del fundido. Se considera continuo si el entrante empieza a menos de 1 ms de donde acaba el saliente en la misma fuente.
- **Arrastrar a la secuencia**: un clip de la lista soltado sobre la sección se añade al final; soltado sobre un clip de la secuencia, delante de él. Arrastrar dentro de la secuencia la reordena. Arrastrar de la secuencia a la lista no hace nada (para quitar está el botón × y el menú).
- **Indicadores de la fila en la primera línea**: en la segunda no cabían. Además, al hacer clic en uno que se salía por la derecha, el navegador desplazaba el panel en horizontal: lo detectó el e2e.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (81 ficheros, 983 tests) y `yarn build` en verde.
- `yarn test-e2e`: 16/16 en verde (los 15 anteriores y el 14 nuevo).
- `yarn scan-i18n` ejecutado.
- Snapshots sin cambios.

### Dudas

- Ninguna bloqueante. Para quitar clips de la secuencia hay un botón × y el menú contextual, no "arrastrar fuera".

## Revisión

- **Resultado**: aceptada.
  - Render truncado exacto, con *fade* y caché.
  - Uniones de cadena con −0,5/−0,6 dB, dentro del ruido (antes −16 dB).
  - UI de cadenas y de la secuencia.

  `tsc`, `lint`, tests (983), `build` y `test-e2e` (16/16) en verde.
- **Se aceptan sus decisiones**:
  - crossfade de 20 ms en todo corte directo;
  - sacar clips de la secuencia con ×.
