# T33 · v2: tests end-to-end de la UI (E3)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T32 · **Estado**: hecha

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

### Cómo se ejecuta

```bash
yarn generate-test-media        # una vez
yarn test-e2e                   # compila (electron-vite build) y ejecuta los escenarios (~35 s + ~15 s de build)
E2E_SKIP_BUILD=1 yarn test-e2e  # sin recompilar
```

- En Linux sin `$DISPLAY`, `e2e/run.ts` lo lanza dentro de `xvfb-run -a` (Xvfb 1600×1000×24). Con pantalla se ve la
  ventana. Electron se lanza con `--no-sandbox --disable-gpu` (en un contenedor no hay *sandbox* de Chromium ni GPU) y
  un directorio temporal para `--config-dir` y `--user-data-dir` (también aísla la recuperación y la caché de render).
- Dependencia nueva: `@playwright/test` 1.63.0 (devDependency; `yarn dedupe --check` limpio). Para Electron no hace
  falta descargar navegadores: usa el Chromium de `node_modules/electron`.
- Capturas de los estados clave en `test-results/e2e-screenshots/` (ignorado por git), `failed-*.png` al fallar y la
  traza de Playwright. Documentado en [06-entorno-desarrollo](../06-entorno-desarrollo.md#tests-end-to-end-t33).
- **Resultado aquí**: 11/11 en verde. En ~25 ejecuciones hubo 2 fallos intermitentes: uno en el escenario 2 (una
  pulsación de `→` justo después de activar una fuente se perdía; el *helper* `seekBy` ahora repite las que falten) y
  uno en el 8a que no se volvió a reproducir en las 17 ejecuciones siguientes (si reaparece, la traza queda en
  `test-results/e2e/`).

### Qué cubre (`e2e/videomix.e2e.ts`)

Los escenarios 1–9 van en orden sobre una misma app y construyen un proyecto como lo haría un usuario; el 10 lanza otra.
Los diálogos nativos de abrir/guardar se sustituyen en main por respuestas fijas; los menús (Nuevo/Abrir proyecto)
se simulan enviando su mensaje IPC. Las comprobaciones son sobre la UI (DOM), el `.vmx` guardado y ffprobe.

1. **Fuentes**: botón **+** con 3 vídeos → 3 filas, la primera cargada en el reproductor, `*` en el título.
2. **Clips**: `I`/`O` en la fuente 1 (0–2 s) y en la 2 (1–3 s, tras activarla), `N` en la vertical (4–9 s); nombres
   `<fuente> #1`. **Rectángulo**: clic en el clip 1 (activa su fuente) y arrastre del tirador derecho del máx. hasta la
   mitad → "Máx. 9xx×1080".
3. **Reordenar**: arrastre del asa `⋮⋮` del 3.º clip encima del 1.º (dnd-kit).
4. **Guardar y reabrir**: `Ctrl+S` → `.vmx` (fuentes, orden, tiempos y rectángulo comprobados en el fichero), título sin
   `*`; Nuevo proyecto → vacío; Abrir proyecto → mismas fuentes y clips en el mismo orden.
5. **Ajustes de montaje** (botón **Ajustes**): columnas 2, resolución 720p, *preset* `ultrafast`, transición
   `dissolve`, relleno de color; `*` en el título y valores en el `.vmx`.
6. **Overlays** (pestaña Montaje): cuenta atrás de 3 s; texto **anclado al fin de un clip** (−0,5 s, 2 s); sonido
   (`overlay-beep.wav`) **anclado al fin de la cuenta atrás**. 3 bloques sin avisos; anclajes comprobados en el `.vmx`.
7. **Previsualización en vivo**: reproduce (el tiempo avanza, el canvas no está en negro), **sin errores de consola**,
   y **el audio de WebAudio no es silencio** (ver abajo); en pausa, silencio; en pausa, buscar dibuja ese fotograma
   (negro al principio por el fundido global, imagen a la mitad).
8. a) **Vista previa** (render 640×360): diálogo con el vídeo reproduciéndose; ffprobe: 640×360 y la duración del
   plan (la del control de la previsualización en vivo). Después, la previsualización en vivo ya suena normalizada
   (desaparece el aviso) y con sonido también tras buscar lejos de un *keyframe* (regresión del fallo 4).
   b) **Render** (`Renderizar`, confirma los avisos si los hay): diálogo "Success!", ffprobe: 1280×720, con audio y la
   duración esperada (±0,5 s).
9. **Deshacer/rehacer**: `Supr` quita el clip seleccionado, `Ctrl+Z` lo devuelve en su sitio, `Ctrl+Shift+Z` lo quita
   otra vez, `Ctrl+Z`.
10. **Español**: título "Proyecto sin título", Fuentes/Fuente/Montaje/Ajustes/Vista previa/Renderizar, "Máx." en el
    rectángulo, secciones del diálogo de ajustes, botones de overlays, aviso de la previsualización; sin restos en
    inglés en esos paneles y sin errores de consola.

`data-testid` añadidos (sin cambiar comportamiento): `source-list`, `source-row`, `add-sources`, `clip-list`,
`clip-row`, `clip-drag-handle`, `rect-overlay`, `rect-label`, `rect-handle-{max|min}-{handle}`, `mix-plan-view`,
`overlay-block` (+ `data-overlay-type`), `overlay-panel`, `mix-live-preview`, `mix-settings`, `working`.

### Audio de WebAudio (riesgo abierto de T32)

El test envuelve `AudioNode.prototype.connect` antes de que el motor cree su `AudioContext` (el motor vive lo que la app
y lo crea una vez, al entrar por primera vez en Montaje): todo nodo que se conecta al `destination` alimenta además un
`AnalyserNode`, y se mide el RMS de la salida. Con el **build de producción** (`webSecurity` activado, página y medios
`file://`) la salida **no es silencio**: RMS ≈ 0,02–0,04 sin normalizar (el nivel propio de los tonos de prueba, −33 y
−21 dBFS) y ≈ 0,06–0,08 normalizada; en pausa, 0. Es decir, `MediaElementAudioSourceNode` con `file://` funciona en
Electron: no hay problema de CORS. Queda sin comprobar solo el caso empaquetado (asar), que carga la página igual por
`file://`.

### Fallos encontrados y corregidos

1. **ffmpeg no arrancaba en la app sin empaquetar en Linux** (`src/main/ffmpeg.ts`): `LD_LIBRARY_PATH` solo se ponía
   con `!isDev`, y entonces a `process.resourcesPath` aunque la app no estuviera empaquetada. Ni `yarn dev` ni el build
   sin empaquetar (`yarn start`, e2e) podían ejecutar ffmpeg ("libavdevice.so.62: cannot open shared object file";
   detección de codificadores, ffprobe, renders…). Ahora: empaquetada, `resourcesPath`; si no, la carpeta del ffmpeg
   de desarrollo. Lo cubren todos los escenarios (cargar fuentes, render).
2. **La ruta de la app se abría como fichero** (`src/main/index.ts` → `src/main/cliArgs.ts`): sin empaquetar se
   ignoraban los 2 primeros argumentos, pero los *switches* de Chromium pueden ir antes de la ruta
   (`electron --no-sandbox . video.mp4`; Playwright siempre añade `--inspect=0 --remote-debugging-port=0`). Entonces
   "." se tomaba por un fichero a abrir: la app recorría su propia carpeta (con `node_modules`), encontraba algún `.vmx`
   y al rato preguntaba "¿Guardar cambios?" en mitad de la sesión. Ahora se salta hasta el primer argumento que no es
   un *switch* (lo mismo que hace Electron para elegir la app). Test: `cliArgs.test.ts`.
3. **Tooltips con el atajo de macOS en Linux/Windows** (`useActionTitle.ts` → `util/actionTitleBinding.ts`): con dos
   atajos para una acción (Ctrl+E y ⌘E) el tooltip mostraba el último, "Meta+E", en los botones Ajustes / Vista previa
   / Renderizar y en los demás con esa pareja (deshacer, guardar…). Ahora el de la plataforma (Meta solo en macOS).
   Test: `actionTitleBinding.test.ts`.
4. **Previsualización en vivo: un clip se quedaba congelado y en silencio tras buscar** (`preview/previewClock.ts`,
   `previewEngine.ts`): al saltar lejos de un *keyframe* (aquí, ~7,5 s dentro de un GOP de 8,3 s de un vídeo
   1080×1920, sin decodificación por hardware) el salto tarda más que `SEEK_LEAD` (0,1 s) + el umbral (0,15 s), así que
   el elemento siempre acababa atrasado y volvía a saltar, indefinidamente: fotograma congelado y audio a 0 hasta el fin
   del clip. Ahora cada elemento mide lo que tardan sus saltos durante la reproducción y apunta ese tiempo por delante
   (`getSeekLead`, entre 0,1 y 3 s); si queda adelantado menos de eso, espera en pausa a que el reloj llegue (`wait`) en
   vez de volver a saltar hacia atrás. Con saltos rápidos (lo normal) el comportamiento no cambia. Tests:
   `previewClock.test.ts` (converge en 2 saltos; antes nunca) y el escenario 8a (con el arreglo desactivado dio 0 de
   RMS en una de dos ejecuciones).

### Desviaciones y limitaciones

- **Render a 320×180**: la app no ofrece esa salida (resoluciones 720p/1080p/4K, `mixOutputResolutions`); añadirla
  cambiaría el producto. Se renderiza a la mínima, 1280×720 con `ultrafast` (~4 s aquí), y se comprueba además la vista
  previa a 640×360.
- Los diálogos nativos (abrir/guardar, el "¿Seguro que quieres salir?" de main) no se pueden manejar desde Playwright:
  se sustituyen o se evitan (`app.exit(0)` al cerrar). La barra de menús nativa tampoco: se envía su mensaje IPC.
- Sin GPU la previsualización dibuja por software; los umbrales de los tests (RMS, píxeles iluminados) tienen margen.
- Se ignoran en consola los errores de D-Bus y GPU propios del contenedor (`e2e/app.ts`).
- Observaciones sin corregir (no son fallos o son menores): en la lista de clips el campo del nombre queda muy estrecho
  con el ancho por defecto ("h-10…"); hacer clic en el centro de una fila de clip cae en el campo del nombre y no la
  selecciona (por diseño, para poder editarlo); el manual dice que el `.vmx` es JSON, pero es JSON5 (claves sin
  comillas).

## Revisión

- **Resultado**: aceptada. `yarn test-e2e` pasa 11/11 en la app Electron real (Xvfb). `tsc`, `lint`, tests (786), `build`, `dedupe` y licencias en verde.
- **4 bugs reales corregidos**:
  - ffmpeg no arrancaba sin empaquetar en Linux;
  - la app abría su propia carpeta por los argumentos de Chromium;
  - los *tooltips* mostraban los atajos de macOS;
  - la previsualización se congelaba tras un seek lento.
- El audio de la previsualización suena de verdad en el build de producción.
- **Pasa a T34**: campo de nombre del clip demasiado estrecho; el manual dice JSON y es JSON5.
