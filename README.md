# MRP 5G Session Processor

Aplicación para procesar vídeos de sesiones médicas. Permite subir grabaciones de consultas médicas, transcribirlas automáticamente, identificar los hablantes (doctor/paciente/especialista) y segmentar el contenido en secciones clínicas estructuradas con resúmenes automáticos.

## Capturas de Pantalla

### Panel de Control
![Panel de Control](screenshots/20251214T002128-Screenshot.png)
*Dashboard con estadísticas de sesiones, listado de consultas recientes con estado, duración, etiquetas y keywords.*

### Detalle de Sesión
![Detalle de Sesión](screenshots/20251214T002026-Screenshot.png)
*Vista de sesión con reproductor de vídeo, transcripción segmentada por secciones médicas, resúmenes automáticos e información general.*

## Características

- **Transcripción automática** con identificación de hablantes usando GPT-4o Transcribe Diarize
- **Segmentación inteligente** en secciones médicas (presentación, síntomas, diagnóstico, tratamiento, despedida)
- **Resúmenes automáticos** por sección y general usando GPT-5.1
- **Generación de metadatos**: título, keywords y etiquetas automáticas
- **Búsqueda full-text** en transcripciones y metadatos
- **Streaming de vídeo** con sincronización de transcripción
- **Procesamiento asíncrono** con cola de trabajos

## Stack Técnico

| Componente | Tecnología |
|------------|------------|
| Frontend | React 19 + Vite + Tailwind CSS + TypeScript |
| Backend | Express.js + TypeScript |
| Base de datos | SQLite (better-sqlite3) |
| Almacenamiento | S3 (Garage para desarrollo local) |
| Cola | BullMQ + Redis |
| IA | OpenAI SDK (gpt-4o-transcribe-diarize, gpt-5.1) |

## Requisitos Previos

- Node.js 20+
- pnpm 9+
- Docker y Docker Compose
- ffmpeg (instalado y accesible en el PATH)

## Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd mrp-5g-session-processor

# Instalar dependencias
pnpm install

# Levantar servicios Docker (Garage S3 + Redis)
pnpm docker:up

# Inicializar Garage S3
pnpm docker:init

# Ejecutar migraciones
pnpm db:migrate

# Seedear usuarios
pnpm db:seed
```

## Configuración

Crear un archivo `.env` en la raíz del proyecto:

```env
# Backend
PORT=3001
NODE_ENV=development
SESSION_SECRET=your-secret-key

# SQLite
DATABASE_PATH=./data/mrp.db

# S3 (Garage)
S3_ENDPOINT=http://localhost:3900
S3_BUCKET=mrp-videos
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=garage

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# OpenAI
OPENAI_API_KEY=sk-...
```

## Uso

```bash
# Desarrollo (frontend + backend en paralelo)
pnpm dev

# Solo backend
pnpm dev:backend

# Solo frontend
pnpm dev:frontend

# Build de producción
pnpm build

# Tests
pnpm test

# Linting
pnpm lint
```

## Estructura del Proyecto

```
mrp-5g-session-processor/
├── docker/                   # Docker Compose (Garage S3 + Redis)
├── packages/
│   ├── shared/               # Tipos TypeScript compartidos
│   ├── backend/              # API Express.js
│   │   ├── src/
│   │   │   ├── controllers/  # Controladores REST
│   │   │   ├── db/           # Schema, migraciones, repositorios
│   │   │   ├── middleware/   # Auth, upload, errors
│   │   │   ├── routes/       # Definición de rutas
│   │   │   ├── services/     # Lógica de negocio
│   │   │   └── services/processing/  # Workers de procesamiento
│   │   └── scripts/          # seed-users.ts
│   └── frontend/             # React SPA
│       └── src/
│           ├── api/          # Cliente HTTP
│           ├── components/   # UI components
│           ├── context/      # AuthContext
│           ├── hooks/        # Custom hooks
│           └── pages/        # Páginas de la app
├── pnpm-workspace.yaml
└── .env                      # Configuración (no commitear)
```

## API Endpoints

### Autenticación
- `POST /api/auth/login` - Login con email/password
- `POST /api/auth/logout` - Cerrar sesión
- `GET /api/auth/me` - Usuario autenticado actual

### Sesiones médicas
- `GET /api/sessions` - Listar sesiones del usuario
- `POST /api/sessions` - Crear sesión + subir vídeo
- `GET /api/sessions/:id` - Detalle con transcripción y resúmenes
- `GET /api/sessions/:id/status` - Estado de procesamiento
- `GET /api/sessions/:id/video/stream` - Streaming de vídeo
- `PATCH /api/sessions/:id` - Actualizar metadatos
- `DELETE /api/sessions/:id` - Eliminar sesión

### Búsqueda
- `GET /api/search?q=` - Búsqueda difusa en transcripciones y metadatos

## Flujo de Procesamiento

1. Usuario sube vídeo → se guarda en S3
2. Se crea job en cola BullMQ
3. Worker descarga vídeo y extrae audio con ffmpeg
4. Transcripción con identificación de hablantes (gpt-4o-transcribe-diarize)
5. Segmentación en secciones médicas y re-etiquetado de speakers (gpt-5.1)
6. Generación de resúmenes y metadatos (gpt-5.1)
7. Estado actualizado a "completed"

## Despliegue en Producción

La aplicación se despliega con Docker Compose. Express sirve tanto la API como el frontend estático.

### 1. Clonar y configurar

```bash
git clone <repo-url> mrp-5g-session-processor
cd mrp-5g-session-processor/docker
cp .env.prod.example .env
```

### 2. Editar variables de entorno

Editar `docker/.env` con los valores reales:

| Variable | Descripción |
|----------|-------------|
| `SESSION_SECRET` | Clave secreta de 32+ caracteres |
| `S3_ACCESS_KEY` | Credencial de Garage (ver paso 4) |
| `S3_SECRET_KEY` | Credencial de Garage (ver paso 4) |
| `OPENAI_API_KEY` | API key de OpenAI |
| `ELEVENLABS_API_KEY` | API key de ElevenLabs |
| `SIMULATOR_VOICES` | IDs de voces de ElevenLabs (formato: `id1:Nombre1;id2:Nombre2`) |
| `BASE_PATH` | Subruta de despliegue (ej: `/mrp-5g-session-processor`) |
| `CORS_ORIGIN` | Dominio permitido (ej: `https://airproy.esi.uclm.es`) |

### 3. Construir la imagen

```bash
docker compose -f docker/docker-compose.prod.yml build
```

### 4. Inicializar Garage S3 (primera vez)

```bash
# Iniciar solo Garage
docker compose -f docker/docker-compose.prod.yml up -d garage

# Esperar unos segundos y ejecutar el script de inicialización
bash docker/init-garage.sh
```

El script mostrará las credenciales S3. Copiarlas a `docker/.env`:

```
S3_ACCESS_KEY=GK...
S3_SECRET_KEY=...
```

### 5. Iniciar todos los servicios

```bash
docker compose -f docker/docker-compose.prod.yml up -d
```

### 6. Crear usuarios

```bash
docker exec mrp-app node scripts/seed-users.js
```

### 7. Configurar reverse proxy

Ejemplo de configuración nginx para servir bajo una subruta:

```nginx
location /mrp-5g-session-processor {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 500M;
}
```

Recargar nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Comandos de gestión

```bash
# Desde la raíz del proyecto
docker compose -f docker/docker-compose.prod.yml up -d      # Iniciar
docker compose -f docker/docker-compose.prod.yml down       # Detener
docker compose -f docker/docker-compose.prod.yml logs -f    # Ver logs
docker compose -f docker/docker-compose.prod.yml build      # Reconstruir
```

### Verificar funcionamiento

```bash
# Health check
curl http://localhost:3001/mrp-5g-session-processor/health

# Acceder a la aplicación
# https://<dominio>/mrp-5g-session-processor/
```

### Estructura de datos

Los datos se persisten en bind mounts locales:

```
docker/data/
├── app/        # Base de datos SQLite
├── redis/      # Persistencia de Redis
└── garage/     # Almacenamiento S3
    ├── data/
    └── meta/
```
