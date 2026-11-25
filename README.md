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

## Cómo interpretar los resultados

Distingue la causa antes de contar un fallo como bug:

| Síntoma | Causa probable |
|---|---|
| `/estado` da **503** y `database: error` | El backend no alcanza MongoDB (infraestructura) |
| Varios endpoints dan **500** a la vez | Misma causa de conexión: es una cascada, no varios bugs |
| `ECONNREFUSED 127.0.0.1:3000` | El backend no está corriendo |
| **401** en pruebas con `x-user-id` | El backend corre con `NODE_ENV=production` |
| **404** en `/usuarios/me/cuenta` | El usuario de prueba no existe o no tiene cuenta |
| `/estado` tarda más de 1 s | Conexión en frío de Prisma con Atlas en la primera petición |

## Ejecución programada y limitaciones

`npm run watch` lanza las pruebas según `QA_CRON` mientras el proceso esté vivo.

- Las corridas solo se ejecutan si el equipo está **encendido y despierto**. Durante una suspensión, el script y el backend se congelan y las corridas de ese lapso se pierden.
- Para dejarlo corriendo en una laptop: conectada al cargador, tapa en "No haga nada" y suspensión en "Nunca" (con corriente). Mantén abiertas las terminales del backend y del script.
- Un reinicio, cierre de sesión o corte de luz mata los procesos; hay que volver a lanzarlos.
- Un hueco en el historial no implica necesariamente una caída del backend.

Para una ejecución permanente, lo recomendable es un servidor siempre encendido (VM, Raspberry Pi) con el backend accesible.

## Solución de problemas

**`Cannot find module './scripts/dns-config.js'`**
Hay una variable de entorno `NODE_OPTIONS` apuntando a un archivo que no existe en este proyecto. Revísala con `echo %NODE_OPTIONS%` y elimínala:

```
set NODE_OPTIONS=
setx NODE_OPTIONS ""
```

**`querySrv ECONNREFUSED _mongodb._tcp...`**
El DNS local no resuelve los registros SRV de `mongodb+srv://`. Opciones:

1. Cambiar el DNS de Windows a `8.8.8.8` y `1.1.1.1`, y ejecutar `ipconfig /flushdns`.
2. Usar en Atlas una URI sin SRV (*Connect → Drivers → "2.2.12 or earlier"*).
3. Para los scripts de este proyecto, agregar al inicio: `require('node:dns').setServers(['8.8.8.8', '1.1.1.1'])`. Esto **no** afecta al backend, que usa Prisma.

**Timeout o `No available servers`**
Agrega tu IP en *Network Access* de Atlas.

**`bad auth`**
Revisa usuario y contraseña de la URI (y codifica caracteres especiales).

## Agregar nuevas pruebas

1. Agrega un request a `collections/liferpg.postman_collection.json` (puedes editarlo en Postman y volver a exportarlo).
2. Escribe sus aserciones en la pestaña *Tests* con `pm.test(...)`.
3. Si usa un usuario autenticado, incluye el encabezado `x-user-id: {{testUserId}}`.
4. Ejecuta `npm test` y verifica que pase.

Ideas de cobertura pendiente: flujos de escritura (crear misión con `POST /misiones` y consultarla) y los módulos M05, M08, M09 y M12.