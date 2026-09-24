# T36 · v3: modelo v4 (enlaces, secuencia, duración máxima)

- **Hito**: M9 · **Modelo**: Sonnet · **Depende de**: — · **Estado**: hecha

## Contexto

- [01-requisitos](../01-requisitos.md) §11 (E2, E4, E5).
- Patrón de migración: notas de T19 y T24.

## Alcance

1. **`MixProject` versión 4**, con migración v3 → v4 (y las anteriores encadenadas). Campos:
   - `settings.links = { maxGap: 10, transition: 'cut' | 'global' }` (por defecto `'cut'`; `maxGap: 0` = sin enlaces automáticos);
   - `MixClip.link?: 'break' | 'force'`: excepción manual sobre el enlace con el clip **anterior** de su cadena;
   - `settings.maxDuration?: number` (segundos; sin definir = sin límite);
   - `settings.alwaysVisible = { clipIds: string[] }` (secuencia única, en orden).
2. **Función pura `getClipChains(project)`**:
   - agrupa por fuente;
   - ordena por `start` en la fuente;
   - enlaza si `next.start − prev.end ≤ maxGap` (incluidos los solapes, con diferencia negativa), aplicando `break`/`force`;
   - excluye los clips de la secuencia siempre visible;
   - devuelve cadenas ordenadas, cada una con sus clips.

   Se documenta la regla para clips con grupo o fijación (propuesta: un clip fijado o agrupado no se enlaza; confírmalo en las notas si ves algo mejor).
3. **Reducer y hook**:
   - `setClipLink(clipId, 'break' | 'force' | undefined)`;
   - `setAlwaysVisibleClips(ids)`, `addToAlwaysVisible`, `removeFromAlwaysVisible`;
   - `updateSettings` para `links` y `maxDuration`.
   - Al borrar un clip se limpian sus referencias.
4. **Validación**: `maxDuration > 0`, ids de la secuencia existentes y sin duplicados, y un clip que no esté a la vez en la secuencia y en un grupo.
5. **Compatibilidad**: sin estos campos todo se comporta igual. Los planes no cambian hasta T38.
6. **Tests**: migraciones, `getClipChains` (umbral, solapes, excepciones, varias fuentes) y reducer.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

### Resumen de cambios

- `videomix/types.ts`: `MixProject` **v4** (`mixProjectSchema`, `MIX_PROJECT_VERSION = 4`).
  - `mixClipLinkTypes = ['break', 'force']` y `MixClip.link?: 'break' | 'force'` (excepción manual sobre el enlace con el clip *anterior* de su cadena; no tiene efecto en un clip fijado, agrupado o el primero elegible de su fuente).
  - `mixLinksSchema` (`MixLinksSettings = { maxGap, transition: 'cut' | 'global' }`), `defaultLinksSettings = { maxGap: 10, transition: 'cut' }`; `mixAlwaysVisibleSchema` (`MixAlwaysVisible = { clipIds: string[] }`), `defaultAlwaysVisible = { clipIds: [] }`.
  - `MixSettings` gana `links: MixLinksSettings`, `maxDuration?: number` y `alwaysVisible: MixAlwaysVisible`; `defaultMixSettings` los incluye.
  - El resto del modelo (fuentes, clips, overlays) no cambia; el campo `sar` de `MixSource` es de T35 (en paralelo).
- `videomix/project.ts`:
  - migración `3 → 4` (encadenada con `1 → 2 → 3`): trivial (`{ ...json, version: 4 }`), porque todo lo nuevo es aditivo y `parseMixProject` ya rellena los ajustes que faltan desde `defaultMixSettings` (cubre `links`, `alwaysVisible` y la ausencia de `maxDuration`).
  - `getClipChains(project)` y `LINK_GAP_TOLERANCE` (función y constante puras, documentadas en detalle más abajo).
  - `MixProjectIssue` gana los códigos `max-duration-out-of-range`, `always-visible-unknown-clip`, `duplicate-always-visible-id` y `clip-in-sequence-and-group`; `validateLinksAndSequence` los calcula (ver "Validación").
- `videomix/projectReducer.ts`:
  - `setClipLink { clipId, link }` (delega en `updateClip`, como `setClipPinTime`).
  - `setAlwaysVisibleClips { clipIds }`: reemplaza la secuencia completa, quitando duplicados y ids que no son de ningún clip del proyecto (mismo patrón que `reorderClips`/`addMusicTracks`); no-op si no cambia.
  - `removeClip` y `removeSource` quitan de `settings.alwaysVisible.clipIds` los ids que ya no existen (`pruneAlwaysVisible`), conservando la referencia de `settings` si no hay nada que quitar.
  - `clipOptionalKeys` incluye `'link'` (se quita con `undefined` en vez de guardarse, como `pinTime`/`groupId`); `duplicateClip` tampoco copia `link` a la copia (revisión del orquestador, ver "Decisiones").
  - No se ha tocado `relinkSource` ni la lógica de `meta`/SAR (en paralelo con T35).
- `hooks/useMixProject.ts`: `setClipLink(clipId, link, options?)`; `setAlwaysVisibleClips(clipIds)`; `addToAlwaysVisible(clipId, index?)` y `removeFromAlwaysVisible(clipId)` (envoltorios sobre `setAlwaysVisibleClips`, calculando la lista a partir de `historyRef.current.present`, como el resto de envoltorios "de conveniencia" del hook). `updateSettings` ya acepta `links`/`maxDuration` sin cambios, al ser parte de `Partial<MixSettings>`.
- `renderDialogs.tsx#getIssueText`: textos nuevos para los 4 códigos, con `es` en `locales/es/translation.json` (y `scan-i18n` ejecutado para `en`).
- `01-requisitos.md` §11 (fila E2): corregida tras la revisión del orquestador para no decir que los solapes se enlazan (ver "Decisiones").
- Tests: migración v3 → v4, `getClipChains` (umbral 0/positivo, solapes nunca enlazados, tolerancia de contacto, `break`/`force` incluido sobre solapes y con `maxGap: 0`, varias fuentes, exclusión de fijados/agrupados/secuencia), validación (`max-duration-out-of-range`, secuencia) y reducer (`setClipLink`, `setAlwaysVisibleClips`, limpieza al borrar, `duplicateClip` sin `link`).

### `getClipChains(project)` (API final)

```ts
function getClipChains(project: Pick<MixProject, 'clips' | 'settings'>): MixClip[][]
```

- Recibe el proyecto (solo necesita `clips` y `settings`) y devuelve las cadenas: un array de arrays de `MixClip`, cada cadena ya ordenada (los clips de una misma cadena, por `start` en la fuente).
- Agrupa por `sourceId` (con `clipsBySource`) y, dentro de cada fuente, ordena por `start`.
- Un clip se enlaza automáticamente con el **anterior elegible** de su fuente (en ese orden) si `0 ≤ start − prev.end ≤ maxGap` (`settings.links.maxGap`), con un poco de margen por debajo de 0 (`LINK_GAP_TOLERANCE = 0.05` s, un par de fotogramas) para que dos clips que solo se **tocan** (redondeo, o el propio recorte del usuario) cuenten como adyacentes en vez de como solape.
  - **`maxGap: 0` desactiva el enlace automático por completo** (01-requisitos §11 E2: "0 = desactivado"), incluso para clips que se tocan: solo `link: 'force'` sigue enlazando.
  - **Los clips que se solapan de verdad** (por encima de la tolerancia) **nunca se enlazan automáticamente**, sea cual sea `maxGap`: E6 los crea a propósito (duplicar un clip, "nuevo clip desde aquí") para encuadrar el mismo metraje de otra forma, y encadenarlos repetiría contenido.
  - `MixClip.link` anula la regla en ambos sentidos: `'break'` nunca enlaza con el anterior; `'force'` siempre lo hace, incluso con `maxGap: 0` o sobre un solape (es la única forma de enlazar un par solapado).
- **Quedan fuera de las cadenas por completo** (ni siquiera como cadena de un solo clip) los clips fijados (`pinTime != null`), agrupados (`groupId != null`) o de la secuencia siempre visible (`settings.alwaysVisible.clipIds`): tienen sus propias reglas de colocación (T30 para fijados/agrupados; E5 para la secuencia, que reserva su propio hueco). `link` no tiene efecto en ellos.
- Cadenas devueltas agrupadas por fuente (en el orden en que la fuente aparece por primera vez entre los clips elegibles) y, dentro de una fuente, por el `start` del primer clip de la cadena. Toda cadena tiene al menos un clip (un clip elegible sin enlaces es una cadena de uno).
- No usa el plan ni información de columnas: es una función sobre el modelo, previa al planificador. T38 la usará para decidir qué clips comparten hueco.

### Validación (`validateMixProject`)

- `max-duration-out-of-range` (error): `settings.maxDuration` definido pero no finito o ≤ 0.
- `always-visible-unknown-clip` (error): un id de `alwaysVisible.clipIds` no es el de ningún clip del proyecto.
- `duplicate-always-visible-id` (error): un id se repite en la secuencia.
- `clip-in-sequence-and-group` (warning): un clip está a la vez en la secuencia y en un grupo (criterio del punto 4 del alcance). Se deja como aviso, no error, porque el clip sigue siendo válido por separado en cada mecanismo; T38 decidirá cuál prevalece (probablemente la secuencia, que fija su propio hueco).
- El esquema no limita `maxGap`, `maxDuration` ni el contenido de `alwaysVisible.clipIds`: como el resto de validaciones de v3, un valor fuera de rango no debe impedir abrir el proyecto.

### Compatibilidad

- Un proyecto v1/v2/v3 se migra a v4 sin pérdida: los campos nuevos llegan por el relleno de valores por defecto de `parseMixProject` (mismo mecanismo que ya rellenaba `encoder` o `musicPlaylist` en la migración v2 → v3). Sin usar enlaces, fijación, secuencia o `maxDuration`, el comportamiento no cambia (los planes no cambian hasta T38, según el alcance).
- `createEmptyMixProject()` incluye `links`/`alwaysVisible` por defecto (clonados, no comparten referencia con `defaultMixSettings`).

### Decisiones y dudas

- **Regla para clips fijados/agrupados** (punto 2 del alcance, "confírmalo si ves algo mejor"): se ha implementado la propuesta tal cual — un clip fijado o agrupado **no se enlaza automáticamente en absoluto** (queda fuera de `getClipChains`, ni siquiera como cadena de un solo clip), igual que los de la secuencia siempre visible. La alternativa de incluirlos como cadena de un solo clip no aporta nada (el consumidor, T38, ya sabe tratarlos aparte por sus propios campos) y complicaría la firma sin necesidad; se ha preferido la exclusión total para que "cadena" signifique siempre "grupo de clips que comparten hueco por enlace automático".
- **`maxGap: 0` y solapes (corregido tras revisión del orquestador)**: la primera implementación usaba una sola comparación (`next.start − prev.end ≤ maxGap`), que enlazaba los solapes siempre (incluso con `maxGap: 0`) porque una diferencia negativa es `≤` cualquier `maxGap` no negativo. El orquestador señaló que eso contradice 01-requisitos §11 E2 ("0 = desactivado") y, más importante, que un solape entre clips de la misma fuente es el resultado de E6 (duplicar un clip o "nuevo clip desde aquí" para encuadrar el mismo metraje de otra forma): encadenarlos repetiría contenido en el vídeo final. Corregido a dos reglas independientes: el enlace automático exige `maxGap > 0` y `0 ≤ gap ≤ maxGap` (con `LINK_GAP_TOLERANCE` de margen por debajo de 0, para que tocarse cuente como adyacente); un solape real nunca se enlaza solo. `link: 'force'` sigue siendo la única forma de enlazar un par solapado o de enlazar con `maxGap: 0`. También corregida la fila E2 de `01-requisitos.md` §11, que decía "o si se solapan" como si fuera una condición adicional de enlace automático.
- **`clip-in-sequence-and-group` como aviso, no error**: un clip puede estar definido en ambos sitios sin que el esquema lo impida (aditivo); se avisa en vez de bloquear el proyecto porque T38 puede decidir una prioridad razonable (probablemente la secuencia) en vez de que sea un estado inválido.
- **`link` no se copia al duplicar un clip (corregido tras revisión del orquestador)**: la primera implementación lo copiaba (a diferencia de `pinTime`/`groupId`, con el razonamiento de que es una excepción sobre el enlace con el clip anterior, no una posición). El orquestador pidió tratarlo igual que `pinTime`/`groupId`: la copia no hereda `link`, porque es un estado nuevo, sin enlace propio, hasta que el usuario la retemporice.
- **Orden de las cadenas devueltas**: no se ordenan por tiempo del vídeo final (eso no existe todavía a este nivel, es tarea del planificador); se devuelven agrupadas por fuente en orden de primera aparición y, dentro de la fuente, por `start`. Es determinista y evita que `getClipChains` tenga que decidir un criterio de "primero" que no le compete.

### Validación ejecutada

- `yarn tsc`, `yarn lint`, `yarn test run` (838 tests) y `yarn build` en verde, tras las correcciones de la revisión del orquestador.
- `yarn scan-i18n` ejecutado; traducciones `es` añadidas a mano para los 4 códigos nuevos.
- Trabajo en paralelo con T35 (SAR): mismos ficheros (`types.ts`, `projectReducer.ts`, `hooks/useMixProject.ts`) tocados por ambos agentes sin solaparse (T35 en `MixSource.sar`, `relinkSource`, `setSourceMeta`, `workspace.ts`; T36 en clips/settings/always-visible). Verificado con `tsc`/`lint`/`test`/`build` tras el trabajo conjunto.

## Revisión

- **Resultado**: aceptada tras una corrección:
  - `maxGap: 0` desactiva los enlaces automáticos;
  - los solapes nunca se enlazan solos;
  - duplicar no copia `link`.

  `tsc`, `lint`, tests (838) y `build` en verde.
