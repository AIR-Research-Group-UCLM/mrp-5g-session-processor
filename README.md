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
