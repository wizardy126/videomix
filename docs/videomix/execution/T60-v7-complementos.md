# T60 · v7: planificador consciente de los complementos (I1)

- **Hito**: M14 · **Modelo**: Opus · **Depende de**: — · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§15 (v7)**, §4, §11 (E2, E4, E5, E7, E8), §13 (G1, G2); [03-convenciones](../03-convenciones.md); [04-diseno](../04-diseno.md) §2–§3 (planificador, §3.10 red de seguridad).
- Notas de ejecución de T10, T10b, T38, T38b, T38c, T44b y **T52** (causa de la ventana ilimitada, clips pendientes, red de seguridad, banco de pruebas).

## Alcance

1. **Reproducir** el caso del usuario en un test y en el banco de T52: 40 clips (16 de 1/3, 6 de 1/2, 18 de 2/3, con duraciones variadas y realistas), en órdenes de lista que agrupen los de cada tipo (p. ej. bloques de 1/3 seguidos) y en órdenes mezclados; ventana 3, 10 e ilimitada; ambas prioridades. Métricas: duración, relleno × tiempo, tiempo con columnas vacías, nº de 2/3 que salen sin pareja. Calcula también una cota de referencia (emparejamiento ideal ignorando duraciones) para saber cuánto margen hay.
2. **Mejora**: que el coste de cada decisión tenga en cuenta la demanda futura de complementos (qué clips pendientes solo encajan con qué otros, y cuántos quedan de cada tipo) para no gastar compañeros escasos en combinaciones que no los necesitan, y para favorecer emparejar primero a los que tienen menos opciones. Debe respetar las restricciones existentes (fijaciones, grupos, cadenas, secuencia, duración máxima, clips pendientes de T52) y seguir siendo determinista y rápido (medir; mismo orden de magnitud que hoy).
3. Banco de regresión: el caso del usuario mejora claramente; el banco general de T52 no empeora (tabla antes/después); la garantía "ilimitado nunca peor que 3/10" se mantiene.
4. Documentar en [04-diseno](../04-diseno.md).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde; tablas de métricas en las notas.

## Notas de ejecución

## Revisión
