# T14 · Diálogo de ajustes de montaje

- **Hito**: M4 · **Modelo**: Sonnet · **Depende de**: T04 · **Estado**: hecha

## Objetivo

Diálogo para editar todos los `MixSettings` del proyecto.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4, §5, §6
- [04-diseno](../04-diseno.md) §1.2 (`MixSettings` y valores por defecto)
- [02-as-built](../02-as-built.md) §9: patrón de `components/Settings.tsx` y componentes base `Select`, `Switch`, `Button`, `TextInput` y `Dialog`
- [03-convenciones](../03-convenciones.md) §3, §7

## Alcance

1. **`videomix/components/MixSettingsDialog.tsx`** (`Dialog` de Radix controlado por estado), organizado por secciones.

   | Sección | Ajustes |
   |---|---|
   | Salida | resolución (720p / 1080p / 4K), fps, CRF (0–51, con explicación breve), preset |
   | Composición | máximo de columnas (1–6), separación (px pares, paso 2, + color), relleno (desenfoque o color + color) |
   | Orden | lista o aleatorio, semilla con botón "Barajar de nuevo", ventana de reorden (0–10) |
   | Transición | tipo (lista de `TransitionType` con nombres legibles) y duración (0,1–2 s), fade in/out global |
   | Música | seleccionar o quitar fichero (diálogo con filtro de audio), volumen en dB (−30…+6) y "Repetir" |

2. Cada cambio pasa por `updateSettings`, así que queda en el historial y marca el proyecto como sucio.
3. Se abre desde el menú Project → "Mix settings…" y desde un botón de la UI VideoMix.
4. Textos con `t()` en inglés; la traducción al español se hace en T17.

## Criterios de aceptación

- Los cambios se guardan en el `.vmx` y se restauran al abrir.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

**Ajuste de alcance del orquestador**: solo se ha construido `videomix/components/MixSettingsDialog.tsx` (componente controlado). No se ha tocado `App.tsx` ni `menu.ts`; el punto 3 del alcance ("se abre desde el menú Project… y desde un botón") queda para el agente que monte el componente (T05/T07).

### Fichero

- `src/renderer/src/videomix/components/MixSettingsDialog.tsx`

### Props (contrato para quien lo monte)

```ts
{
  open: boolean,
  onOpenChange: (isOpen: boolean) => void,
  settings: MixSettings,               // p. ej. project.settings de useMixProject()
  onChange: (patch: Partial<MixSettings>, options?: EditOptions) => void, // pásese updateSettings
  onPickMusicFile?: () => Promise<string | undefined>, // opcional; por defecto usa showOpenDialog con filtro de audio
}
```

Uso previsto (en el componente que integre, p. ej. App.tsx o un contenedor de VideoMix):

```tsx
<MixSettingsDialog
  open={mixSettingsDialogOpen}
  onOpenChange={setMixSettingsDialogOpen}
  settings={mixProject.project.settings}
  onChange={mixProject.updateSettings}
/>
```

- `onChange` es literalmente `updateSettings` de `useMixProject`: cada cambio se despacha como acción `updateSettings` (histórico + `dirty`), tal como pide el criterio de aceptación.
- Los campos anidados (`gap`, `fill`, `order`, `transition`, `music`) se actualizan enviando el objeto completo ya fusionado (el reducer hace *shallow merge* de nivel superior, ver `projectReducer.ts` case `updateSettings`).
- Para quitar la música: `onChange({ music: undefined })`.
- Al elegir música se guarda `path === absolutePath` (la ruta absoluta elegida); `projectFile.ts` la relativiza al guardar el `.vmx`, igual que las fuentes.

### Ediciones continuas (transient)

CRF, duración de transición y volumen de música son `<input type="range">`: en `onInput` se llama `onChange(patch, { transient: true })` y en `onChange` (nativo, al soltar) se llama `onChange(patch)` sin opciones. Por cómo funciona `applyEdit`/`commitTransient` en `projectHistory.ts`, esa segunda llamada sin `transient` ya hace `commitTransient` internamente (fusiona el gesto en un solo paso de historial) sin que el diálogo necesite una prop adicional para ello.

- Separación entre columnas: `<input type="number" step={2}>` con `toEvenNonNegative()` que redondea al par no negativo más cercano (coincide con el warning `odd-gap` de `validateMixProject`).
- Máximo de columnas: `<Select>` con opciones 1–6 (no rango libre).
- Ventana de reorden: `<input type="range" min={0} max={10}>`.

### Textos i18n nuevos (clave = frase en inglés; no se ha ejecutado `scan-i18n`, lo harán los agentes que sí tocan i18n)

Mix settings; Output; Frame rate; {{fps}} fps; Quality (CRF); Lower is higher quality and a larger file. 18–23 is typically visually lossless.; Encoding speed preset; Slower presets compress better at the same quality, but take longer to render.; Composition; Maximum visible columns; Gap between columns (px); Gap color; Fill empty space with; Blurred background; Solid color; Fill color; Order; Clip order; List order; Random; Pick a new random seed; Shuffle again; Reorder window (± positions); How far a clip may move from its position in the list to fit the layout.; Transition; Transition type; Fade; Dissolve; Fade to black; Wipe left; Wipe right; Wipe up; Wipe down; Slide left; Slide right; Slide up; Slide down; Smooth left; Smooth right; Smooth up; Smooth down; Circle open; Transition duration; {{seconds}}s; Fade in/out at the start/end of the video; Music; Choose music file…; Choose a music file; Audio files; Remove music; Music volume; {{db}} dB; Loop if shorter than the video; Close.

(`Resolution` ya existe como clave en el proyecto original de LosslessCut; se reutiliza.)

### Decisiones / desviaciones

- El picker de música por defecto se implementa dentro del propio diálogo con `showOpenDialog` (filtro `mp3, m4a, aac, wav, flac, ogg, opus`, según 01-requisitos §5), pero se acepta una prop `onPickMusicFile` para que el integrador reutilice su propio flujo de diálogos si lo prefiere.
- El relleno (`fill`) se modela como un `<Select>` "desenfoque/color sólido" + un `<input type="color">` para el color, deshabilitado cuando el modo es "blur" (el color solo aplica al modo "color").
- Separación (`gap`) usa `<input type="color">` nativo; no existe un componente de color en `components/`, así que no se ha creado uno nuevo (fuera de alcance).
- CRF, duración de transición y volumen de música son *sliders* (`<input type="range">`) por ser rangos continuos; el resto de campos usa `<Select>`/`<input type="number">` discretos.

### Validación

- `yarn tsc`: sin errores en este fichero (hay errores preexistentes en `videomix/planner/*.ts` de T10, en curso en paralelo, no relacionados).
- `yarn lint` (ejecutado también solo sobre el fichero con `eslint` directo, ya que el script `lint` de package.json ignora el argumento y lintea todo el repo): sin errores en `MixSettingsDialog.tsx`; los errores que aparecen al correr `yarn lint` completo pertenecen a `videomix/planner/*.ts` (T10, en curso).
- `yarn test run`: 200/200 tests en verde (no se han añadido tests: el componente no tiene lógica pura relevante que testear con vitest fuera de `toEvenNonNegative`, trivial).

### Prueba manual sugerida

1. Montar el componente en un contenedor de prueba (o temporalmente en `App.tsx`) con `open` controlado por un `useState`, `settings={mixProject.project.settings}` y `onChange={mixProject.updateSettings}`.
2. Abrir el diálogo, cambiar resolución/fps/CRF/preset, columnas máx., separación (comprobar que un valor impar se redondea a par), color de separación, modo de relleno + color, orden aleatorio + "Barajar de nuevo" (la semilla cambia), ventana de reorden, tipo/duración de transición, fade in/out, elegir un fichero de música (mp3/wav/…), volumen, "Repetir", y quitar la música.
3. Cerrar el diálogo, guardar el proyecto (`.vmx`) y volver a abrirlo: todos los ajustes deben persistir.
4. Comprobar Ctrl+Z tras arrastrar un slider (CRF/duración/volumen): debe deshacer el gesto completo en un solo paso, no un paso por cada evento `input`.

## Revisión

- **Resultado**: aceptada con el alcance reducido: solo el componente.
- **Pendiente**:
  - montarlo en la UI y en el menú (se hará en T13);
  - hacer `scan-i18n` y la traducción al español (T13/T17).
