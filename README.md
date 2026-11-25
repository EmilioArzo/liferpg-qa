# RPG-life-api-test

Pruebas automatizadas de la API de **Life-RPG** con **Postman + Newman**. Cada corrida se guarda en una base de MongoDB Atlas independiente (`liferpg_qa`) para llevar historial de resultados. Se puede ejecutar a mano o de forma programada con cron.

## Estructura

```
RPG-life-api-test/
├── collections/
│   └── liferpg.postman_collection.json   # Casos de prueba (requests + aserciones)
├── environments/
│   └── local.postman_environment.json    # Variables del entorno local
├── scripts/
│   ├── setup-db.js                       # Crea los índices de la base de QA (una sola vez)
│   ├── run.js                            # Ejecuta la colección y guarda el resultado
│   └── schedule.js                       # Ejecuta run.js periódicamente (node-cron)
├── .env                                  # Configuración local (no se sube a Git)
└── package.json
```

## Requisitos

- Node.js 18 o superior (probado con Node 22).
- El **backend de Life-RPG** corriendo y conectado a su base (`pnpm dev` en el repo del backend).
- Una base de MongoDB Atlas para guardar los resultados. **No uses la base de la app.**

## Instalación

```bash
npm install
cp .env.example .env     # o crea el archivo .env a mano
npm run setup:db         # crea los índices, solo la primera vez
```

## Configuración (`.env`)

| Variable | Descripción | Ejemplo |
|---|---|---|
| `QA_BASE_URL` | URL base de la API a probar (sobrescribe la del environment) | `http://localhost:3000/api/v1` |
| `QA_MONGODB_URI` | URI de Atlas donde se guardan los resultados | `mongodb+srv://user:password@cluster0.xxxx.mongodb.net/` |
| `QA_DB_NAME` | Nombre de la base de QA | `liferpg_qa` |
| `QA_CRON` | Frecuencia de las corridas automáticas | `*/30 * * * *` |
| `QA_RESULTS_TTL_DAYS` | Días que se conserva el detalle por petición | `90` |

> Si la contraseña de la URI tiene caracteres especiales (`@ # / :`), codifícala con `encodeURIComponent`.

## Uso

| Comando | Qué hace |
|---|---|
| `npm run setup:db` | Crea los índices de `liferpg_qa` (una sola vez) |
| `npm test` | Una corrida con el environment por defecto |
| `npm run test:local` | Una corrida con el environment `local` |
| `npm run watch` | Corridas automáticas según `QA_CRON` |

Antes de correr las pruebas, confirma que `http://localhost:3000/api/v1/estado` responde `"database": "ok"`. Si no, las pruebas fallarán por infraestructura y no por errores de la API.

## Qué se prueba

La colección tiene **11 casos (requests)** con **24 aserciones**, agrupados en tres capas:

| Capa | Casos | Qué valida |
|---|---|---|
| **Salud** | `GET /estado`, `GET /health` | 200, `status: ok`, `database: ok`, tiempo de respuesta |
| **Contrato** | Ruta inexistente, JSON inválido, Bearer inválido | 404 `NOT_FOUND`, 400 `BAD_REQUEST`, 401 `UNAUTHORIZED` con el formato `{ error, code }` |
| **Funcionales** | M00 cuenta, M02 hábitos, M03 misiones, M04 tienda, M04 inventario, M06 ánimo | 200 y estructura esperada de la respuesta |

Los códigos 404, 400 y 401 de la capa de contrato son **respuestas esperadas**: la prueba pasa cuando la API los devuelve.

### Datos de prueba que se asumen

Las pruebas funcionales usan el usuario definido en `environments/local.postman_environment.json`:

| Variable | Valor |
|---|---|
| `testUserId` | `6b0356a060aaa347e384ceb7` |
| `testUserEmail` | `dev.yess@liferpg.test` |

Ese usuario debe existir en la base del backend **con su cuenta creada** (`POST /usuarios/me/cuenta`). Si no, `GET /usuarios/me/cuenta` responde 404.

La autenticación se hace con el encabezado `x-user-id`, que el backend solo acepta si `NODE_ENV` **no** es `production`.

## Resultados en MongoDB

Base `liferpg_qa`:

| Colección | Contenido | Retención |
|---|---|---|
| `test_runs` | Resumen de cada corrida | Permanente |
| `test_results` | Detalle por petición, ligado a la corrida por `runId` | Se borra solo tras `QA_RESULTS_TTL_DAYS` días (índice TTL) |

Al terminar cada corrida, la consola indica el id guardado y si fue exitosa o con fallas.


## Ejecución programada y limitaciones

`npm run watch` lanza las pruebas según `QA_CRON` mientras el proceso esté vivo.

- Las corridas solo se ejecutan si el equipo está **encendido y despierto**. Durante una suspensión, el script y el backend se congelan y las corridas de ese lapso se pierden.
- Para dejarlo corriendo en una laptop: conectada al cargador, tapa en "No haga nada" y suspensión en "Nunca" (con corriente). Mantén abiertas las terminales del backend y del script.
- Un reinicio, cierre de sesión o corte de luz mata los procesos; hay que volver a lanzarlos.
- Un hueco en el historial no implica necesariamente una caída del backend.

Para una ejecución permanente, lo recomendable es un servidor siempre encendido (VM, Raspberry Pi) con el backend accesible.

## Uso

| Comando | Qué hace |
|---|---|
| `npm test` | Una corrida contra el entorno `local` |
| `npm run watch` | Corre ahora y luego según `QA_CRON` |
| `npm run setup:db` | Crea índices y la expiración automática |

Códigos de salida de `npm test`:

- `0`: todas las pruebas pasaron y se guardaron.
- `1`: alguna prueba falló.
- `2`: las pruebas se ejecutaron, pero no se pudo guardar en MongoDB (el resultado queda en `reports/last-run.json`).

## Rutas probadas

Todas usan `{{baseUrl}}` (por defecto `http://localhost:3000/api/v1`).
Las peticiones marcadas con `x-user-id` usan el usuario de prueba `{{testUserId}}`; solo funcionan si la API **no** está en `NODE_ENV=production`.
Todas son de lectura, salvo el JSON inválido, que la API rechaza sin guardar nada. Ninguna prueba modifica datos.

| # | Petición | Método y ruta | Módulo | Qué verifica |
|---|---|---|---|---|
| 1 | Estado · GET /estado | `GET /estado` | Base del servidor | 200, `status: ok`, `database: ok`, respuesta en menos de 1 s |
| 2 | Estado · alias GET /health | `GET /health` | Base del servidor | 200 y `database: ok` |
| 3 | Contrato · ruta inexistente | `GET /no-existe` | Base del servidor | 404, `code: NOT_FOUND` y mensaje `error` |
| 4 | Contrato · JSON inválido | `POST /health` | Base del servidor | 400 y `code: BAD_REQUEST` |
| 5 | Auth · Bearer inválido | `GET /animo/hoy` con `Authorization: Bearer token-invalido` | M00 · Usuarios y autenticación | 401 y `code: UNAUTHORIZED` |
| 6 | M00 · cuenta | `GET /usuarios/me/cuenta` (`x-user-id`) | M00 · Usuarios y autenticación | 200 y el `email` es el del usuario de prueba |
| 7 | M02 · hábitos de hoy | `GET /habitos/hoy` (`x-user-id`) | M02 · Hábitos | 200 y respuesta tipo lista |
| 8 | M03 · misiones activas | `GET /misiones?estado=activa` (`x-user-id`) | M03 · Misiones y enfoque | 200 y respuesta tipo lista |
| 9 | M04 · escaparate | `GET /tienda/articulos` (`x-user-id`) | M04 · Tienda | 200 y respuesta tipo lista |
| 10 | M04 · inventario | `GET /inventario` (`x-user-id`) | M04 · Tienda e inventario | 200 y claves `rewards`, `consumables`, `clothing` |
| 11 | M06 · ánimo de hoy | `GET /animo/hoy` (`x-user-id`) | M06 · Estado de ánimo | 200 |

### Cobertura por módulo

| Módulo | Estado de las pruebas |
|---|---|
| Base del servidor | Cubierto (4 pruebas) |
| M00 Usuarios y autenticación | Cubierto parcialmente (cuenta y rechazo de token) |
| M01 Tamagotchi y perfil | Pendiente |
| M02 Hábitos | Solo lectura. Falta check-in y su repetición |
| M03 Misiones y enfoque | Solo lectura. Falta crear y completar misión |
| M04 Tienda e inventario | Solo lectura. Falta comprar con y sin saldo |
| M05 Logros | Pendiente (reclamo doble de recompensa) |
| M06 Estado de ánimo | Solo lectura. Falta registrar |
| M07 Visualizador de usuarios | Sin rutas en la API |
| M08 Botín | Pendiente (enviar regalo) |
| M09 Diario de aventura | Pendiente |
| M10 Notificaciones | Sin montar en el router principal |
| M11 Resumen de progreso | Pendiente |
| M12 Retos de grupo | Pendiente |
| M13 Sincronización y red | Sin rutas en la API |
| M14 Economía global | Pendiente (requiere usuario ADMIN) |
| M15 Gestión de base de datos | Sin rutas en la API |

Las pruebas más importantes que faltan son las que modifican datos y comprueban que no se dupliquen: doble check-in, compra sin saldo, doble reclamo de logro. Conviene hacerlas con un usuario QA distinto al de desarrollo.

## Datos que se guardan en MongoDB

Base `liferpg_qa`. No se guardan headers, cuerpos de petición ni de respuesta, ni tokens.

**`test_runs`** (un documento por corrida):

| Campo | Descripción |
|---|---|
| `startedAt`, `finishedAt`, `durationMs` | Cuándo corrió y cuánto tardó |
| `environment`, `baseUrl` | Entorno y URL probada |
| `apiVersion` | Versión de la API, tomada de `/estado` |
| `passed` | `true` si todas las pruebas pasaron |
| `requests` | `{ total, failed }` |
| `assertions` | `{ total, failed }` |
| `avgResponseMs`, `maxResponseMs` | Tiempos de respuesta |

**`test_results`** (un documento por petición, enlazado con `runId`):

| Campo | Descripción |
|---|---|
| `runId`, `environment`, `createdAt` | Corrida a la que pertenece |
| `request`, `method`, `path` | Qué se probó |
| `statusCode`, `responseTimeMs` | Respuesta obtenida |
| `passed`, `assertionsTotal` | Resultado de la petición |
| `failures` | Solo las aserciones que fallaron, con su mensaje (o el error de conexión) |

El resumen de cada corrida se conserva siempre. El detalle de `test_results` se borra solo después de `QA_RESULTS_TTL_DAYS` días.

## Cómo agregar una prueba

1. Agrega la petición a `collections/liferpg.postman_collection.json` (o impórtala en Postman, edítala y vuelve a exportarla).
2. Escribe sus aserciones en el evento `test` con `pm.test(...)`.
3. Si usa el usuario de prueba, agrega el header `x-user-id: {{testUserId}}`.
4. Ejecuta `npm test` y revisa que aparezca en `reports/last-run.json`.
5. Actualiza la tabla de rutas de este README.

## Notas

- El usuario de prueba es `dev.yess@liferpg.test`. Su ID y su email están en el environment; nunca guardes contraseñas o tokens en el repositorio.
- Con la API en `NODE_ENV=production` se desactiva `x-user-id`. Para probar un servidor desplegado hará falta un token de Firebase real.
- Para otro entorno, copia `environments/local.postman_environment.json` con otro nombre (por ejemplo `staging`) y ejecuta `node scripts/run.js staging`.
- Los resultados se pueden visualizar conectando `liferpg_qa` a MongoDB Atlas Charts.