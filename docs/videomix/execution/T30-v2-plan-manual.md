# T30 · v2: fijar clips a un momento y grupos (A4)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T29 · **Estado**: pendiente

## Alcance

1. **Planificador**:
   - **`pinTime`**: el clip empieza en ese instante del vídeo final.
     - Hay que liberar una columna en ese momento: si hace falta, un re-layout o relleno.
     - Los clips fijados no cuentan para la ventana de orden.
     - Si dos clips fijados no caben a la vez (más que `maxColumns`), se desplaza el posterior y se avisa.
   - **Grupos**: los clips de un grupo empiezan juntos, con un re-layout que abre sitio para todos (limitado por `maxColumns`; si no caben, se avisa y se divide). El grupo ocupa la posición del primero de sus clips en la lista.
   - Invariantes nuevas en `validatePlan` y tests, incluidos los de propiedades.
2. **UI**:
   - en la lista de clips y en la vista Mix: "Fijar aquí" (en el cursor de Mix), "Quitar fijación", "Agrupar seleccionados" y "Desagrupar";
   - indicadores visuales: chincheta y color de grupo;
   - arrastrar un bloque de clip en la vista Mix fija su `pinTime`.
3. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
