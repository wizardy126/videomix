# T36 · v3: modelo v4 (enlaces, secuencia, duración máxima)

- **Hito**: M9 · **Modelo**: Sonnet · **Depende de**: — · **Estado**: pendiente

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

## Revisión
