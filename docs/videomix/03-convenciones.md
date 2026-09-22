# 03 · Convenciones

El código nuevo debe parecer escrito por los autores del as-built. Si una convención de este documento choca con el código que se está tocando, **manda el estilo del fichero circundante**.

## 1. Idiomas

| Ámbito | Idioma |
|---|---|
| Código (identificadores), comentarios, JSDoc | Inglés |
| Textos de UI | Inglés como clave i18n, más traducción en `locales/es/translation.json` |
| Mensajes de commit | Inglés |
| `docs/videomix/**` (incluidos los task-docs) | Español |

## 2. TypeScript

- **Configuración**: `@tsconfig/strictest`, con `exactOptionalPropertyTypes` y `noUncheckedIndexedAccess`.
  - Las propiedades opcionales se declaran `foo?: T | undefined` cuando se les puede asignar `undefined` explícitamente.
  - El acceso por índice devuelve `T | undefined`: se usa `invariant(x != null)` o `arr[i]!` cuando el valor está garantizado.
- **Imports de tipos** con `import type { … }`. En `src/common` y `src/main` los imports relativos llevan extensión `.ts`/`.js` (ver ficheros vecinos); en el renderer normalmente van sin extensión.
- **`interface`** para formas de objeto; **`type`** para uniones, alias y `z.infer`.
- **Esquemas zod** junto a los tipos: `fooSchema = z.object(…)` y `type Foo = z.infer<typeof fooSchema>`.
- **`tiny-invariant`** para descartar `null`/`undefined` y verificar precondiciones.
- **Sin `any`**. Los `// eslint-disable-next-line <regla>` solo cuando esté justificado, como hace el as-built.

## 3. React

- **Componentes**:
  - Función con props tipadas inline, `function ClipList({ clips, onSelect }: { clips: Clip[], onSelect: (id: string) => void }) {`, y al final `export default memo(ClipList);`.
  - Subcomponentes memoizados dentro del fichero: `const Row = memo(({ … }: { … }) => …)` con `// eslint-disable-next-line react/display-name`.
- **Hooks**:
  - Export por defecto; reciben **un objeto** desestructurado y devuelven un objeto.
  - Si el tipo de retorno se usa fuera, se exporta: `export type UseX = ReturnType<typeof useX>`.
- **`useCallback` / `useMemo`** en prácticamente todos los handlers y valores derivados, con dependencias completas (lo exige el plugin `react-hooks`).
  - Para leer estado en callbacks estables se usan **refs espejo** (`workingRef`, `playbackModeRef`).
- **Estado**:
  - No se introducen librerías de estado global (zustand, redux…). Se usan `useState`, hooks y contextos (`contexts.ts`).
  - Para actualizaciones inmutables complejas está disponible `immer` (`produce`).
- **Estilos**:
  - Inline (`style={{ … }}`, memoizado con `useMemo<CSSProperties>` si es costoso) y variables CSS de Radix (`var(--gray-12)`, `var(--cyan-9)`).
  - CSS module (`X.module.css`, acceso `styles['x']`) solo si hace falta pseudo-clases o bastante CSS.
- **Componentes base** de `components/`: `Button`, `Select`, `Switch`, `Checkbox`, `Dialog`, `TextInput`, `Warning`… Se reutilizan en vez de crear nuevos.
- **Iconos** de `react-icons` (preferentemente `fa`/`md`, como el resto). **Animaciones** con `motion/react`.
- **Listas reordenables** con dnd-kit, siguiendo el patrón de `SegmentList.tsx` / `BatchFilesList.tsx`.

## 4. Nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Componentes | PascalCase `.tsx` | `ClipList.tsx` |
| Hooks | `hooks/useX.ts(x)` o `videomix/hooks/useX.ts` | `useMixProject.ts` |
| Utilidades | camelCase `.ts`, exports con nombre | `geometry.ts` |
| Handlers en props | `onX` | `onClipSelect` |
| Handlers locales | `handleX` | `handleDragEnd` |
| Flujos iniciados por el usuario | `userX` | `userOpenProject` |
| Toggles | `toggleX` | `toggleMute` |
| Diálogos | `askForX` / `showX` | `askForMusicFile` |

## 5. Ubicación del código de VideoMix

```
src/common/videomix/       Tipos y lógica pura compartida (si main los necesita).
src/main/videomix/         Funciones que ejecutan ffmpeg (loudness, render) → expuestas vía remoteApiLegacy o RPC.
src/renderer/src/videomix/
  types.ts                 Tipos + esquemas zod del proyecto.
  geometry.ts              Rectángulos, recortes, aspect ratios (puro).
  planner/                 Algoritmo de montaje (puro, con tests).
  render/                  Generador del grafo ffmpeg (puro, con tests) + orquestación.
  hooks/                   useMixProject, useMixRender, …
  components/              UI de VideoMix.
```

- Las modificaciones a ficheros existentes (`App.tsx`, `Timeline.tsx`, `configStore.ts`…) se hacen **mínimas y localizadas**. Se prefiere añadir props o *hooks* y montar un componente nuevo antes que reescribir.
- **La lógica pura no importa React ni Electron**: debe poder testearse con vitest en Node.

## 6. Comentarios

- En inglés, **cortos y prácticos**. Explican el *por qué* (una restricción de ffmpeg, un bug de Chromium, una decisión del algoritmo), no el *qué*.
- Densidad moderada. Se enlazan referencias externas cuando ayudan (`// https://trac.ffmpeg.org/…`).
- JSDoc (`/** … */`) en funciones o tipos públicos del planificador y del generador del grafo, porque son el contrato entre módulos.
- **No** comentar cada línea, **no** usar banners decorativos y **no** dejar TODOs sin contexto. Un `// todo …` breve es aceptable, como en el as-built.

## 7. i18n

- Texto de UI: `const { t } = useTranslation()` y `t('Add clip')`. Fuera de React: `i18n.t('…')` (import de `i18next`). Interpolación: `t('Clip {{index}}', { index })`. Con JSX, `<Trans>`.
- **La clave es la frase completa en inglés** (no hay `keySeparator` ni `nsSeparator`).
- Tras añadir textos:
  - `yarn scan-i18n` actualiza `locales/en/translation.json`.
  - Añadir la traducción al español en `locales/es/translation.json`.
- No se tocan los demás idiomas.

## 8. Errores, carga y logs

- Operaciones de usuario:
  - `withErrorHandling(async () => { … }, i18n.t('Failed to …'))` o `handleError({ title, err })`.
  - Errores esperables para el usuario: `throw new UserFacingError(i18n.t('…'))`.
- Operaciones largas:
  - Patrón `if (workingRef.current) return; try { setWorking({ text, abortController }); … } finally { setWorking(undefined); setProgress(undefined); }`.
  - La cancelación reutiliza `abortFfmpegs` / `AbortController`.
- Logs: `console.*` en el renderer y `logger` (winston) en main.
- Cada comando ffmpeg que se ejecute se registra con `appendFfmpegCommandLog`.

## 9. Tests

- vitest, fichero `*.test.ts` **junto al código**, estilo `describe` / `test` / `expect`, como en `segments.test.ts`.
- **Obligatorios** para:
  - geometría;
  - planificador;
  - generador del grafo ffmpeg (snapshots de los argumentos y comprobaciones de invariantes);
  - esquema del proyecto (parseo y migraciones).
- Solo funciones puras. Los tests que ejecuten ffmpeg real van aparte (script manual o `*.ffmpeg.test.ts`, que se omiten si no hay ffmpeg).

## 10. Estilo y lint

- **eslint** (`eslint-config-mifi`, estilo airbnb): 2 espacios, comillas simples, comas finales, `;` obligatorios.
- **Lodash** con import por función: `import sortBy from 'lodash/sortBy'`.
- **Antes de dar una tarea por hecha**, deben pasar:
  - `yarn tsc`
  - `yarn lint`
  - `yarn test run`

## 11. Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `tipo(ámbito): descripción`, en inglés, en imperativo, en minúscula y **cortos** (≤ 72 caracteres).
  - Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, `perf`, `style`.
  - Ámbitos habituales: `videomix`, `planner`, `render`, `audio`, `ui`, `project`, `i18n`, `docs`, `ci`.
  - Ejemplos:
    - `feat(planner): add continuous slot scheduling`
    - `docs(videomix): add execution task docs`
- Cuerpo opcional con el *por qué*, si aporta.
- **Prohibido** incluir atribuciones: nada de `Co-Authored-By`, `Generated with…`, enlaces de sesión ni similares.
- Un commit por tarea revisada; en tareas grandes, varios commits coherentes.
- **Solo el orquestador hace commits.** Los agentes dejan los cambios en el árbol de trabajo.
