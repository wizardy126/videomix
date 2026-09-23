# T21b · Medición de sonoridad de efectos muy cortos

- **Hito**: M7 · **Modelo**: Sonnet · **Depende de**: T21, T23 · **Estado**: pendiente

## Objetivo

Que los efectos de sonido cortos (< ~0,4 s, típicos en pitidos de cuenta atrás) se normalicen y suenen. Ahora `loudnorm` devuelve `-inf` para ellos y se tratan como "sin audio", así que se silencian sin ningún aviso.

## Contexto (leer antes de empezar)

- [T21](T21-overlays-sonido.md) y [T23](T23-overlays-cierre.md), sus notas
- Código: `src/main/videomix/loudness.ts`, `loudnessParse.ts` y `script/videomix/renderOverlaysExample.ts`

## Alcance

1. **Fichero entero más corto de ~3 s** (duración por ffprobe): medir la sonoridad de una versión en bucle, p. ej. `-af aloop=loop=-1:size=<muestras>,atrim=0:3,loudnorm=…`, o bien `-stream_loop` con `-t 3`. La sonoridad integrada de la repetición equivale a la del sonido. Documentar el método elegido y por qué.
2. **Silencio real**: se sigue tratando como "sin audio". Un fichero silencioso en bucle sigue dando `-inf`.
3. **Aviso**: si un efecto de sonido sigue sin poder medirse, se muestra como aviso antes de renderizar en lugar de silenciarse sin más. Se aplica la ganancia manual sin normalizar y se documenta.
4. **Tests**: parseo y lógica de decisión. Test con ffmpeg real, que se omite si falta: un pitido de 0,15 s y otro de 0,3 s se miden con un valor finito y coherente (±1,5 LU) con el mismo tono de 2 s.
5. **Ejemplo**: `generateTestMedia` puede volver a generar un pitido corto (0,2 s) y `renderOverlaysExample.ts` debe hacerlo sonar.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
