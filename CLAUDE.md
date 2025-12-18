# CLAUDE.md - mrp-5g-session-processor

## Descripción del Proyecto

Aplicación para procesar vídeos de sesiones médicas. Permite subir grabaciones de consultas médicas, transcribirlas automáticamente, identificar los hablantes (doctor/paciente/especialista) y segmentar el contenido en secciones clínicas estructuradas con resúmenes automáticos.

## Stack Técnico

- **Monorepo**: pnpm workspaces
- **Frontend**: React 19 + Vite + Tailwind CSS + TypeScript
- **Backend**: Express.js + TypeScript
- **Base de datos**: SQLite (better-sqlite3)
- **Almacenamiento de vídeos**: S3 (Garage para desarrollo local)
- **Cola de procesamiento**: BullMQ + Redis
- **IA**: OpenAI SDK (gpt-4o-transcribe-diarize para transcripción con identificación de hablantes, gpt-5.1 para segmentación y metadatos)
- **TTS**: ElevenLabs SDK (síntesis de voz para simulador)
- **i18n**: react-i18next (es-ES, en-GB)

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
│   │   │   ├── services/processing/  # Workers de procesamiento
│   │   │   └── services/simulator/   # Simulador de sesiones (TTS)
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

## Comandos Principales

```bash
# Desarrollo
pnpm install              # Instalar dependencias
pnpm dev                  # Ejecutar frontend y backend en paralelo
pnpm dev:backend          # Solo backend
pnpm dev:frontend         # Solo frontend

# Docker
pnpm docker:up            # Levantar Garage S3 + Redis
pnpm docker:down          # Parar servicios

# Base de datos
pnpm db:migrate           # Ejecutar migraciones
pnpm db:seed              # Seedear usuarios (script bash wrapper)

# Build y test
pnpm build                # Build de todos los packages
pnpm test                 # Tests de todos los packages
pnpm lint                 # Linting
```

## Configuración (.env)

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

# ElevenLabs (simulador)
ELEVENLABS_API_KEY=your-elevenlabs-api-key

# Simulador - Voces (formato: ID:Nombre;ID:Nombre;...)
SIMULATOR_VOICES=voice-id-1:Dr. Rodriguez;voice-id-2:Patient Voice;voice-id-3:Specialist
SIMULATOR_PAUSE_BETWEEN_SEGMENTS_MS=1000
SIMULATOR_AUDIO_CONCURRENCY=3
```

## Modelo de Datos

### Tablas principales:
- `users` - Usuarios del sistema (email, password_hash con Argon2)
- `auth_sessions` - Sesiones de autenticación (almacenadas en Redis)
- `medical_sessions` - Sesiones médicas (vídeo/audio, estado, metadatos, idioma detectado, `is_simulated`)
- `transcript_sections` - Secciones de transcripción segmentadas
- `section_summaries` - Resúmenes por tipo de sección (generados por GPT-5.1)
- `clinical_indicators` - Indicadores clínicos extraídos (urgencia, diagnóstico, tratamiento, etc.)
- `simulations` - Estado y progreso de simulaciones (contexto, voces, segmentos completados)

### Secciones médicas:
1. `introduction` - Presentación inicial
2. `symptoms` - Exposición de síntomas
3. `diagnosis` - Diagnóstico médico
4. `treatment` - Asignación de tratamiento
5. `closing` - Despedida

### Tipos de hablantes:
- `DOCTOR` - El médico de cabecera o general
- `PATIENT` - El paciente
- `SPECIALIST` - Un médico especialista
- `OTHER` - Acompañante u otra persona

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
- `GET /api/sessions/:id/video/stream` - Streaming de vídeo (proxy S3 con soporte Range)
- `PATCH /api/sessions/:id` - Actualizar metadatos manuales
- `DELETE /api/sessions/:id` - Eliminar sesión

### Búsqueda
- `GET /api/search?q=` - Búsqueda en transcripciones, título, resumen, keywords y etiquetas

### Simulador
- `GET /api/simulator/voices` - Listar voces disponibles
- `POST /api/simulator` - Iniciar simulación (contexto, idioma, voces)
- `GET /api/simulator/:id/status` - Estado y progreso de la simulación

## Flujo de Procesamiento

1. Usuario sube vídeo o audio → se guarda en S3
2. Se crea job en cola BullMQ
3. Worker descarga vídeo, extrae audio con ffmpeg via child_process.exec (ffmpeg debe estar instalado y accesible en el PATH)
4. **Transcripción** con `gpt-4o-transcribe-diarize`:
   - Identifica hablantes automáticamente (Speaker A, Speaker B, etc.):
      {
         type: 'transcript.text.segment',
         text: 'Hola qué tal?',
         speaker: 'A',
         start: 300.904,
         end: 301.854,
         id: 'seg_72'
      },
      {
         type: 'transcript.text.segment',
         text: 'Bien, gracias',
         speaker: 'B',
         start: 301.954,
         end: 302.504,
         id: 'seg_73'
      },
      ...
   - Genera timestamps por segmento
   - Detecta idioma automáticamente (código ISO 639-1, ej: `es`, `en`)
5. **Segmentación** con `gpt-5.1`:
   - Clasifica en secciones médicas (introduction, symptoms, diagnosis, treatment, closing)
   - Re-etiqueta speakers semánticamente (DOCTOR, PATIENT, SPECIALIST, OTHER)
   - Genera resumen por cada tipo de sección en el idioma de la transcripción
6. **Generación de metadatos** con `gpt-5.1`:
   - Resumen general de la consulta
   - Keywords para búsqueda
   - Título automático (si no se proporcionó)
   - Etiquetas automáticas (si no se proporcionaron)
   - Indicadores clínicos estructurados (urgencia, hipótesis diagnósticas, plan de tratamiento, etc.)
   - Todo el contenido generado en el idioma de la transcripción
7. Estado actualizado a "completed"

## Flujo del Simulador

El simulador genera sesiones médicas sintéticas a partir de un contexto textual:

1. Usuario proporciona contexto (descripción del escenario médico), idioma y voces para cada hablante
2. **Generación de conversación** con GPT-5.1:
   - Genera JSON con segmentos de diálogo
   - Obligatoriamente incluye 3 hablantes: DOCTOR, PATIENT, SPECIALIST
   - Se guarda en S3
3. **Generación de audio** con ElevenLabs (concurrente, configurable):
   - Cada segmento se convierte a MP3 con la voz seleccionada
   - Los archivos se nombran `segment_0000.mp3`, `segment_0001.mp3`, etc. para mantener orden
   - Frontend muestra progreso en tiempo real (polling)
4. **Concatenación** con ffmpeg:
   - Une todos los segmentos con silencios configurables entre ellos
   - Genera `audio.mp3` final
5. **Creación de sesión**:
   - Se crea `medical_session` con `is_simulated = 1`
   - Se encola el procesamiento normal (transcripción → segmentación → metadatos)
6. Frontend redirige a la vista de sesión

## Convenciones de Código

### TypeScript
- Strict mode habilitado
- Usar tipos del package `shared` para consistencia
- Preferir interfaces sobre types para objetos

### Backend
- Controladores delgados, lógica en servicios
- Repositorios para acceso a datos
- Validación con Zod en endpoints

### Frontend
- Componentes funcionales con hooks
- React Query para estado del servidor
- Tailwind para estilos (no CSS custom)

## Testing

```bash
pnpm test                    # Todos los tests
pnpm --filter backend test   # Solo backend
pnpm --filter frontend test  # Solo frontend
```

## Notas Importantes

- Los usuarios se crean únicamente via script de seed (no hay registro)
- Todos los endpoints (excepto login) requieren autenticación
- Las sesiones de autenticación se almacenan en Redis (connect-redis con cliente oficial `redis`)
- Los archivos multimedia se almacenan en S3 bajo `/{user_uuid}/{session_id}/`
- Se aceptan vídeos (MP4, WebM, MOV, AVI, MKV) y audios (MP3, M4A, WAV, OGG)
- El streaming de vídeo/audio pasa por el backend (proxy) para evitar problemas CORS con S3
- El procesamiento es asíncrono; el frontend hace polling del estado
- La búsqueda usa FTS5 de SQLite para transcripciones + LIKE para metadatos (incluye indicadores clínicos)
- Las fechas se muestran en la zona horaria local del usuario (dayjs con plugin utc)
- El frontend resalta automáticamente la sección de transcripción durante la reproducción del vídeo
- Los resultados de búsqueda muestran el origen del match (transcripción, título, resumen, keywords, etiquetas, indicadores clínicos) con highlighting
- Las sesiones simuladas se marcan con `is_simulated` y muestran badge "Simulada" en la UI

## Internacionalización (i18n)

- Frontend localizado con react-i18next (idiomas: es-ES, en-GB)
- Traducciones en `packages/frontend/src/i18n/{es-ES,en-GB}.json`
- Fechas relativas localizadas con dayjs (sincronizado con idioma de UI)
- Prompts del backend en inglés, con instrucción de generar contenido en el idioma de la transcripción
- Constantes compartidas en `packages/shared/src/constants/languages.ts` para mapeo de códigos ISO a nombres de idioma
- Los identificadores de secciones y speakers son claves neutrales (inglés) traducidas en frontend
