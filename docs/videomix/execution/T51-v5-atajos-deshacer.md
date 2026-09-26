# T51 · v5: atajos con cualquier foco y deshacer en todas las acciones (G4)

- **Hito**: M12 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§13 (v5)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `src/renderer/src/hooks/useKeyboard.ts` (`if (e.target !== document.body) return;` y la alternativa comentada), `videomix/hooks/useMixClips.ts` (`dispatchMerged`/`dispatchStep`, `undo`), `useMixProject.ts`, `projectHistory.ts`, `useMixClipPins.ts`, `useClipKeyframes.ts`, `MixPlanView.tsx`, `e2e/app.ts` (`pressShortcut` quita el foco antes de pulsar: por eso los e2e no lo detectaban).

## Alcance

1. **Reproducir primero** en un e2e (sin quitar el foco): pulsar "Ajustar a 1/2" (o cualquier botón) y después Ctrl+Z → hoy no deshace.
2. **Atajos con cualquier foco salvo edición de texto**: se ignoran solo si el foco está en `input` de texto/número, `textarea`, `select` o `contentEditable` (incluidos los *sliders* `input[type=range]` y *checkboxes* si capturan teclas: decide y documenta). Con el foco en un botón u otro elemento activable, **Espacio e Intro** los maneja el elemento (no se disparan también los atajos ligados a esas teclas); el resto de atajos sí funcionan. Revisa que no haya dobles disparos (menú nativo con acelerador y atajo propio) ni regresiones en diálogos (Esc, Radix).
3. **Auditoría de deshacer** en VideoMix: cada acción de usuario crea exactamente un paso de historial y Ctrl+Z / Ctrl+Mayús+Z la deshacen/rehacen, sea cual sea el foco. Mínimo: arrastres y fijaciones en la vista Mix (A4: mover, fijar, agrupar, secuencia), edición de clips (tiempos, nombre, color, audio, ganancia, enlaces, giro, ampliar), rectángulos (arrastre, teclas, barra del editor), keyframes (Animar, auto-key, añadir, borrar, interpolación), overlays, ajustes del proyecto. Lo que falte o esté mal, se corrige. Lista de la auditoría en las notas.
4. **e2e**: `pressShortcut` deja de quitar el foco por defecto (opción explícita solo donde haga falta y justificado). Escenario nuevo que cubra deshacer tras clic en botones de la barra del editor, en la vista Mix y en keyframes.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Reproducción

- Escenario e2e nuevo **21** ("VideoMix (shortcuts with the focus on a button)") con `pressShortcut` sin quitar el foco: pulsar "Fit to 1/2" y luego Ctrl+Z. Ejecutado contra una copia del árbol con la comprobación antigua de `useKeyboard.ts` (`e.target !== document.body`), **falla**: el rect sigue en `Max 960×1080`. Con el arreglo pasa.
- Los e2e antiguos no lo veían porque `pressShortcut` hacía `blur()` antes de cada tecla.

### Causa raíz

1. **Foco** (causa principal): `useKeyboard.ts` ignoraba cualquier tecla si el foco no estaba en `document.body`. Tras un clic, el foco se queda en el elemento pulsado o en su antecesor enfocable más cercano:
   - los `<button>` de la barra del editor (Ajustar a, girar, Animar, keyframes…);
   - en la vista Mix, la calle (`div role="button" tabIndex={-1}`) que contiene los bloques: por eso "mover cosas y Ctrl+Z" no hacía nada;
   - la fila de la lista de clips (al pulsar el icono de silencio, la paleta de color…);
   - el `svg` del rectángulo tras arrastrarlo o moverlo con flechas (tampoco se podía deshacer el empujón con teclado sin hacer clic fuera).
2. **Deslizadores** (causa secundaria, "ajustes del proyecto"): los `input type="range"` hacían `onInput` transitorio + `onChange` como confirmación, pero en React `onChange` de un *range* (y de un *color*) salta en **cada** movimiento, como `input`. Cada paso del arrastre era un paso de deshacer: Ctrl+Z solo retrocedía un poquito. Comprobado también en la copia con el código antiguo (el e2e falla: CRF 7 en vez de 20).

### Cambios

- `src/renderer/src/util/shortcutFocus.ts` (nuevo, puro, con tests): `isShortcutKeptByFocus(target, code)` decide si el elemento con foco se queda la tecla. `useKeyboard.ts` lo usa en lugar de `e.target !== document.body`.
- **Política de foco** (decisión, la opción más conservadora que cumple G4):
  - **Se ignoran todas las teclas** con el foco en:
    - edición de texto: `input` de texto/número/fecha…, `textarea`, `contentEditable`;
    - un `select` nativo, salvo las combinaciones con **Ctrl/Cmd**, que sí llegan a los atajos (el `select` no las usa; decisión del orquestador). Así Ctrl+Z funciona justo después de elegir una opción. Alt o Mayús solos no cuentan. Dentro de un diálogo se siguen ignorando;
    - dentro de un diálogo o de un menú/lista emergente (`[role=dialog|alertdialog|menu|menubar|listbox]`). Mantiene el comportamiento anterior en diálogos (Radix, sweetalert2, el de asignar atajos, que no debe cerrarse con su propio atajo) y la búsqueda por letra de menús y `Select` de Radix.
  - **Espacio e Intro** los maneja el elemento si es activable: `button`, `a[href]`, `summary`, `input` checkbox/radio/botón/color/file, o un rol ARIA activable (`button`, `switch`, `checkbox`, `tab`, `menuitem`…) **en el orden de tabulación** (`tabIndex >= 0`).
  - **Flechas, Inicio/Fin y RePág/AvPág** las maneja el elemento si las usa: `input type="range"` y `radio`, o los roles `slider`, `spinbutton`, `radio`, `tab`, `combobox` (p. ej. el disparador de un `Select` de Radix) con `tabIndex >= 0`. El resto de atajos (Ctrl+Z incluido) sí funcionan con el foco en un *slider* o en un *checkbox*.
  - Los `role="button" tabIndex={-1}` de la app (calles y bloques de la vista Mix, filas de la lista, lienzo de la vista previa) son solo de ratón y no manejan teclas, así que no se quedan ninguna: con el foco ahí, Espacio sigue siendo reproducir.
  - Sin dobles disparos: cuando un atajo se ejecuta, `preventDefault()` evita que Electron pase la tecla al menú nativo (el acelerador de `role: 'undo'`). Ningún atajo por defecto coincide con otro acelerador del menú (Ctrl+O, Ctrl+W, Ctrl+,).
- `videomix/components/TransientInputs.tsx` (nuevo): `RangeInput` y `ColorInput`. Transitorio en cada movimiento (`onChange` de React) y confirmación con el evento **nativo** `change` (al soltar, por cada pulsación de flecha, o al cerrar el selector de color). Un arrastre = un paso. Se usan en:
  - `MixSettingsDialog.tsx`: CRF, duración de la transición, color del hueco y color de relleno (los colores antes eran un paso por movimiento, sin transitorio);
  - `MixMusicSection.tsx`: volumen de pista, fundido cruzado y cantidad de *ducking*.
- `e2e/app.ts`: `pressShortcut(page, key, { blur })` ya **no** quita el foco por defecto. Solo `seekBy` pasa `blur: true`, justificado: con el foco en el rectángulo (tras arrastrarlo) las flechas lo mueven, y en un campo mueven el cursor de texto.
- `e2e/videomix.e2e.ts`, escenario **21**. Deshacer/rehacer con el foco donde lo deja el clic:
  - barra del editor: Ajustar a 1/2, Espacio sobre el botón (no reproduce ni crea paso), giro;
  - empujones con flechas del rectángulo (un paso);
  - keyframes: Animar, añadir, quitar;
  - silencio en la lista de clips;
  - arrastre de un bloque en la vista Mix (fijar), comprobando que el foco no está en el cuerpo;
  - añadir un overlay;
  - arrastre del deslizador CRF (un solo paso).
- Comentario de "Keyboard testing points" de `useKeyboard.ts` actualizado.

### Auditoría de deshacer

Revisado en código: `useMixClips`, `useMixClipPins`, `useClipKeyframes`, `useMixOverlays`, `useBlackBars`, `useMixWorkspace`, `MixPlanView`, `ClipList`, `ClipRectEditor`/`RectOverlay`, `OverlayPanel`, `MixSettingsDialog`, `MixMusicSection` y el reductor. El reductor devuelve el mismo objeto en las ediciones sin cambios (`hasChanges` con `isEqual`), así que la confirmación final de un gesto transitorio no añade un paso vacío. Leyenda: ✔ = bien; **arreglado** = corregido en esta tarea; e2e = cubierto por un escenario.

| Área | Acción | Paso de historial | Estado |
|---|---|---|---|
| Vista Mix (A4) | Arrastrar bloque (fijar) | `userPinClip` → `dispatchStep`, 1 al soltar | ✔ (foco arreglado, e2e 21) |
| Vista Mix (A4) | Fijar aquí / Desfijar / Agrupar / Desagrupar (menú) | `dispatchStep` | ✔ |
| Vista Mix (A4) | Secuencia: añadir / quitar / reordenar | `dispatchStep` | ✔ |
| Vista Mix (A4) | Enlazar / romper enlace | `dispatchStep` | ✔ |
| Vista Mix | Arrastre de bloque de overlay o de su caja | transitorio + `commitTransient` al soltar | ✔ |
| Vista Mix | Añadir overlay | `addOverlay` | ✔ (e2e 21) |
| Clips | Tiempos en la línea de tiempo, I/O | fusionado por clip (`dispatchMerged`, 700 ms o al soltar) | ✔ (e2e 9) |
| Clips | Nombre | al salir o con Intro | ✔ |
| Clips | Color, silencio | `dispatchStep` | ✔ (silencio: e2e 21) |
| Clips | Ganancia | `select` que se desenfoca al cambiar | ✔ |
| Clips | Ampliar más allá del máx. | `dispatchStep` | ✔ |
| Clips | Girar | `dispatchStep` | ✔ (e2e 21) |
| Clips | Añadir, duplicar, borrar, dividir, reordenar | `dispatchStep` | ✔ |
| Clips | Pegar encuadre, quitar bandas negras | `dispatchStep` | ✔ |
| Rectángulos | Arrastre | transitorio + 1 paso al soltar | ✔ |
| Rectángulos | Flechas | fusionadas (1 s sin pulsar) | ✔ (foco arreglado, e2e 21) |
| Rectángulos | Barra: aspecto, Ajustar a, Llenar, mín. | `onEdit` → `dispatchStep` | ✔ (e2e 21) |
| Keyframes | Animar (on/off), añadir, borrar, interpolación | `dispatchStep` | ✔ (e2e 21 salvo interpolación) |
| Keyframes | Auto-key al arrastrar | transitorio + 1 paso al soltar | ✔ (e2e 19) |
| Overlays | Campos numéricos y de texto | al salir o con Intro | ✔ |
| Overlays | Colores | transitorio, confirmado al salir | ✔ |
| Overlays | Resto de controles | 1 paso | ✔ |
| Ajustes del proyecto | Deslizadores (CRF, transición, volumen de pista, fundido, *ducking*) | antes 1 paso por movimiento | **arreglado**: 1 por arrastre (e2e 21) |
| Ajustes del proyecto | Colores de hueco y relleno | antes 1 paso por movimiento | **arreglado** |
| Ajustes del proyecto | `select`, *switches*, campos con borrador | 1 paso | ✔ |

### Dudas y limitaciones (para el orquestador)

- ~~Con el foco en un `select`, los atajos se ignoraban hasta hacer clic fuera.~~ **Resuelto** (decisión del orquestador): las combinaciones con Ctrl/Cmd pasan; las teclas sin modificador se quedan en el `select`. Tests en `shortcutFocus.test.ts`.
- El ancho del hueco (`input type=number` sin borrador) crea un paso por cada cambio: uno por clic en las flechas, pero uno por dígito tecleado. Se deja; el orquestador lo planificará.
- Soltar a la vez vídeos y un audio crea dos pasos (añadir fuentes y, tras confirmar, la música). Se deja; el orquestador lo planificará.
- Con el foco en el disparador de un `Select` de Radix, las flechas abren el desplegable en vez de buscar (comportamiento nativo del control).

### Validación

- Tras el cambio del `select`: `yarn tsc` ✔, eslint de mis ficheros ✔, `shortcutFocus.test.ts` (7 tests) ✔. Los e2e no se han vuelto a ejecutar tras este cambio.
- **Copia aislada** del árbol con solo los cambios de T51 (los ficheros de T52/T53 restaurados a `HEAD`): `yarn tsc`, `yarn lint`, `yarn test run` (1142 tests), `yarn build` y todos los e2e (salvo el de T53, que depende de su código) ✔.
- **Árbol compartido** (con T52/T53 a medias):
  - `yarn tsc` y `yarn build` ✔.
  - `yarn lint`: 6 errores, todos en `planner/planMix.ts` y `planner/types.ts` (T52).
  - `yarn test run`: fallan 3 tests de `planMix.test.ts` y `reorderWindow.test.ts` (T52).
  - `yarn test-e2e`: 21 y el resto en verde. Los 7 y 14 fallaron una vez y pasaron al repetir. El 8a falla de forma estable en la búsqueda del final (`Pause` ya no está: la reproducción llega al final antes); pasa en la copia aislada, así que viene de los cambios del plan de T52. Hay que revalidarlo cuando T52 termine.
- Reproducción: el escenario 21 falla con la comprobación antigua de `useKeyboard.ts` (el rect se queda en 960×1080) y con el `MixSettingsDialog` de `HEAD` (CRF 7 en vez de 20 tras un Ctrl+Z).

## Revisión

## Revisión

- **Resultado**: aceptada. Decisión del orquestador: los atajos con Ctrl/Cmd atraviesan un `select` con foco. El campo numérico de separación (un paso por dígito) pasa a T54.
- **Validación del orquestador** (junto con T52 y T53): tsc, lint, 1175 tests, e2e 24/24 dos veces.
