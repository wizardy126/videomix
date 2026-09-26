# T55 · v5: manual, i18n y cierre

- **Hito**: M12 · **Modelo**: Sonnet · **Depende de**: T51–T54 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§13 (v5)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).

## Alcance

1. Manual: atajos y foco, "Priorizar", filas de la vista Mix, zoom/scroll, "Ajustar a" con mín.
2. Revisión del español; `07-propuestas.md` (A3 y G1–G5 → ✅).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Alcance real de esta tarea

Solo documentación: `docs/videomix/manual-usuario.md` y `docs/videomix/07-propuestas.md`. No se ha tocado código (`src/`) ni `locales/`: la revisión de las traducciones nuevas de T51–T54 (ver más abajo) no encontró errores que corregir.

### Auditoría línea a línea del manual contra §12/§13 de requisitos y la UI real

Revisado contrastando cada párrafo con `01-requisitos.md` §12/§13, las cadenas de `locales/es/translation.json`, los bindings por defecto de `src/main/configStore.ts` y los componentes (`RectOverlayToolbar.tsx`, `ClipRectEditor.tsx`, `MixSettingsDialog.tsx`, `MixPlanView.tsx`, `useKeyboard.ts`, `shortcutFocus.ts`). Estado de cada punto del alcance de T55 antes de esta tarea y cambio aplicado:

| Punto | Estado antes | Cambio |
|---|---|---|
| Atajos con cualquier foco salvo campos de texto (G4) | **Ausente.** El manual no explicaba en absoluto la política de foco de T51 (solo listaba la tabla de atajos, sin decir cuándo se ignoran). | Añadido bloque al principio de §9: qué se ignora (texto, diálogos/menús), el caso especial del `select` con Ctrl/Cmd, y que Espacio/Intro activan un botón con foco en vez de disparar su atajo. Se aclara que cada acción es un solo paso de deshacer sin importar el foco. |
| Tolerancia del 1 % (crop → extend → stretch) | **Ausente.** T44b no tocó el manual (no era su tarea) y ninguna tarea posterior la documentó; el párrafo de "Ajustar a" de T54 no la menciona. | Párrafo nuevo en §3, junto al de encaje en fracciones: explica el orden de las tres estrategias con lenguaje de usuario (recortar un poco → ampliar si el clip lo permite → estirar como último recurso) y que los chips ✓ ya la incluyen. |
| "Priorizar" (duración/relleno, letterbox breve) | **Ausente.** El ajuste no aparecía ni en la tabla de §5 ni en ningún otro sitio del manual (nota de T52: "el manual de usuario queda para T55"). | Dos párrafos nuevos en §4 (antes de los Ajustes) explicando las dos opciones y que "Duración más corta" puede aceptar un letterbox breve para acortar el vídeo (aviso pedido por el orquestador en la revisión de T52); fila "Orden" de la tabla de §5 actualizada con "Priorizar". |
| Ventana ilimitada "nunca peor" (red de seguridad, G1) | **Parcial.** §4 explicaba la ventana y "Ilimitado", pero no que ahora se compara con ventanas menores para garantizar que ilimitado nunca da un resultado peor. | Párrafo nuevo en §4 explicando la red de seguridad (se calculan varias ventanas y gana la mejor según "Priorizar"), en términos de qué nota el usuario (nunca sale peor que elegir 3 o 10). |
| Filas compactas de la vista Mix (G3) | **Desactualizado.** §6 seguía diciendo "un carril por columna (o por fila)", que es justo el bug que corrigió G3. | Reescrito el primer párrafo de §6: carriles compactos, número = máximo de columnas simultáneas, orden arriba-abajo ≈ izquierda-derecha. |
| Zoom/scroll de la vista Mix (A3): Ctrl+rueda, rueda/Mayús+rueda, −/+/Ajustar, clic en el eje, seguimiento del cursor | **Ausente por completo.** | Sección nueva "Zoom y desplazamiento horizontal" en §6, con los cinco puntos pedidos y que el zoom no se guarda en el proyecto. |
| "Ajustar a" con mín. (G5) | **Ya documentado** (lo añadió T54 en §3, con nota de que T55 revisaría que estuviera completo). | Sin cambios de contenido; solo queda justo antes del párrafo nuevo de tolerancia (ambos tratan el mismo botón). |
| Bandas negras | **Ya documentado** (§2: detección automática y ajuste para desactivarla; §3: botón "Quitar bandas negras"; §5: ajuste en Composición). | Sin cambios: cobertura correcta, verificada contra `RectOverlayToolbar.tsx` y el ajuste `removeBlackBarsOnCreate` de `MixSettingsDialog.tsx`. |
| Keyframes | **Ya documentado** (§3: "Animar el encuadre", con cronómetro, auto-key, navegación e interpolación). | Sin cambios: verificado contra los botones y atajos reales de `RectOverlayToolbar.tsx` y la tabla de atajos de §9. |
| Filas de la lista de clips en la vista Mix / compactas en la lista de clips (chips) | Ya documentado en §3 ("La lista de clips muestra lo mismo de forma compacta"). | Sin cambios. |
| Tabla de atajos (§9) | Se comprobó cada fila contra `allDefaultKeyBindings` de `configStore.ts`: coincide (incluidas las teclas de giro `R`/`Mayús+R`/`Alt+R`, que en VideoMix sustituyen a la rotación heredada de LosslessCut, y las de keyframes `Mayús+,`/`Mayús+.`/`Mayús+Retroceso`). | Sin cambios en la tabla; se añadió el bloque de foco delante de ella (ver arriba). |

### Revisión de las traducciones nuevas de T51–T54

Comprobadas contra `locales/en/translation.json` / `locales/es/translation.json`, sin encontrar errores:

- G2 (T52): `"Prioritize"` → "Priorizar", `"Shortest video"` → "Duración más corta", `"Least fill"` → "Menos relleno", y los dos textos de ayuda largos (uno por opción) — traducción fiel y coherente con el orden de criterios del código.
- G5 (T54): los dos tooltips de "Ajustar a" (con y sin mín.) y los dos avisos de fallo (`no-room`, `min-too-large`) — traducción correcta, incluida la referencia a "el máx. se ensancha antes" en el caso con mín.
- A3 (T53): `"Zoom in/out (Ctrl + mouse wheel)"`, `"Fit"` / `"Fit the whole mix in the view"` — traducción correcta; se comprobó que "Ajustar" (botón) no choca en el manual con "Ajustar a" (fracciones), que son acciones distintas.
- G4 (T51): sin textos de UI nuevos que traducir (es un cambio de comportamiento, no de textos).

No se ha encontrado ningún bug de código durante la auditoría; solo faltaba documentación.

### Validación

- `yarn tsc`, `yarn lint` (solo el ruido preexistente de `jsx-ast-utils` con `satisfies`, no relacionado) y `yarn test run` (96 ficheros, 1182 tests) en verde.
- `yarn build` en verde.
- `yarn test-e2e`: primera pasada 24/25 (falla el escenario 10 "the UI is in Spanish" por un timeout esperando la fila de clip tras `N`, sin relación con estos cambios —solo documentación—; repetido en solitario, pasa en 5,1 s). Segunda pasada completa: **25/25**.

## Revisión

- **Resultado**: aceptada. M12 cerrado.
- **Validación del orquestador**: e2e 25/25 en tres pasadas seguidas; el fallo aislado del escenario 10 no se reprodujo (queda anotado por si vuelve).
