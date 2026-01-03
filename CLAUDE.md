# CLAUDE.md - mrp-5g-session-processor

## Quick Reference

**Tech Stack:** pnpm monorepo | React 19 + Vite + Tailwind | Express.js 5 | SQLite (better-sqlite3) | BullMQ + Redis | S3 (Garage) | OpenAI SDK | ElevenLabs SDK

**Node Requirements:** Node >=22.0.0 | pnpm >=9.0.0

**Key Commands:**
```bash
pnpm install          # Install all dependencies
pnpm dev              # Run frontend (5173) + backend (3001)
pnpm build            # Build all packages
pnpm lint             # Lint all packages
pnpm docker:up        # Start Garage S3 + Redis
pnpm db:seed          # Seed test users
```

## Project Description

Medical session video processing application. Upload consultation recordings, automatically transcribe with speaker identification (doctor/patient/specialist), segment into clinical sections, and generate AI summaries.

## Project Structure

```
mrp-5g-session-processor/
├── packages/
│   ├── backend/              # Express.js API (port 3001)
│   │   ├── src/
│   │   │   ├── controllers/  # REST controllers
│   │   │   ├── routes/       # Route definitions
│   │   │   ├── services/     # Business logic
│   │   │   │   ├── processing/   # BullMQ workers (transcription, segmentation, metadata)
│   │   │   │   └── simulator/    # Session simulator (TTS)
│   │   │   ├── middleware/   # Auth, upload, RBAC, rate-limit
│   │   │   ├── db/           # schema.sql + connection.ts (embedded migrations)
│   │   │   └── config/       # Config + Pino logger
│   │   └── scripts/          # seed-users.ts
│   ├── frontend/             # React SPA (port 5173)
│   │   └── src/
│   │       ├── api/          # Axios HTTP client
│   │       ├── components/   # UI components (layout/, ui/, sessions/, videos/, simulator/, users/)
│   │       ├── pages/        # Route pages
│   │       ├── hooks/        # React Query hooks
│   │       ├── context/      # AuthContext
│   │       ├── i18n/         # es-ES.json, en-GB.json
│   │       └── utils/        # cn.ts (Tailwind), format.ts
│   └── shared/               # Shared TypeScript types + constants
│       └── src/
│           ├── types/        # User, Session, Processing, Simulator, etc.
│           └── constants/    # languages.ts, sections.ts
├── docker/
│   ├── docker-compose.yml      # Development (Garage S3 + Redis)
│   └── docker-compose.prod.yml # Production
├── Dockerfile                  # Multi-stage production build
├── tsconfig.base.json          # Base TS config (strict mode)
└── .prettierrc                 # semi: true, singleQuote: false, tabWidth: 2
```

## Code Conventions

### TypeScript
- Strict mode enabled across all packages
- Import types from `@mrp/shared` for consistency
- Prefer interfaces over types for objects

### Backend
- Thin controllers, business logic in services
- Repositories pattern not used - services access DB directly
- Validation with Zod on endpoints
- Pino for structured logging

### Frontend
- Functional components with hooks
- React Query for server state (`useQuery`, `useMutation`)
- Tailwind for styles (no custom CSS files)
- Use `cn()` utility from `utils/cn.ts` for conditional classes
- react-i18next for translations

## Database

SQLite with better-sqlite3. WAL mode and foreign keys enabled.

**Schema location:** `packages/backend/src/db/schema.sql`

**Migrations:** Embedded in `packages/backend/src/db/connection.ts` (run on startup)

### Main Tables
- `users` - email, password_hash (Argon2), role (admin/user/readonly)
- `medical_sessions` - video/audio, status, metadata, detected_language, is_simulated
- `transcript_sections` - speaker, section_type, text, start_time, end_time
- `section_summaries` - section_type, summary (GPT-generated)
- `clinical_indicators` - urgency, diagnosis, treatment, etc.
- `simulations` - simulator state and progress
- `session_assignments` - user session sharing (read/write permissions)
- `transcript_fts` - FTS5 virtual table for full-text search

### Medical Sections
`introduction` | `symptoms` | `diagnosis` | `treatment` | `closing`

### Speaker Types
`DOCTOR` | `PATIENT` | `SPECIALIST` | `OTHER`

### User Roles (RBAC)
- `admin` - Full access: user management, all sessions, simulator, assignments
- `user` - Own sessions, simulator
- `readonly` - Only view assigned sessions

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Current user

### Sessions
- `GET /api/sessions` - List user sessions
- `POST /api/sessions` - Create + upload video
- `GET /api/sessions/:id` - Detail with transcript/summaries
- `GET /api/sessions/:id/status` - Processing status
- `GET /api/sessions/:id/video/stream` - Video streaming (S3 proxy)
- `PATCH /api/sessions/:id` - Update metadata
- `DELETE /api/sessions/:id` - Delete
- `GET /api/sessions/:id/accuracy` - Accuracy metrics (simulated only)

### Search
- `GET /api/search?q=` - Full-text search (FTS5 + LIKE)

### Simulator
- `GET /api/simulator/voices` - List ElevenLabs voices
- `POST /api/simulator` - Start simulation
- `GET /api/simulator/:id/status` - Simulation progress

### Assignments (admin)
- `GET /api/users/:userId/assignments` - List assignments
- `GET /api/users/:userId/available-sessions` - Available sessions
- `POST /api/users/:userId/assignments` - Create assignment
- `DELETE /api/users/:userId/assignments/:sessionId` - Remove

## Processing Flow

1. Upload video/audio → S3 (`/{user_uuid}/{session_id}/`)
2. BullMQ job created
3. Worker extracts audio with ffmpeg (must be in PATH)
4. **Transcription** - `gpt-4o-transcribe-diarize`: speaker identification (A, B, C...), timestamps, language detection
5. **Segmentation** - `gpt-5.1`: classify sections, re-label speakers semantically, generate summaries
6. **Metadata** - `gpt-5.1`: title, keywords, tags, clinical indicators, general summary
7. Status → "completed"

## Simulator Flow

1. User provides context, language, voices
2. GPT-5.1 generates dialogue JSON (DOCTOR, PATIENT, SPECIALIST required)
3. ElevenLabs generates MP3 segments (concurrent)
4. ffmpeg concatenates with silences
5. Creates `medical_session` with `is_simulated = 1`
6. Enqueues normal processing

## Environment Variables (.env)

```env
PORT=3001
NODE_ENV=development
SESSION_SECRET=your-secret-key
DATABASE_PATH=./data/mrp.db

# S3 (Garage)
S3_ENDPOINT=http://localhost:3900
S3_BUCKET=mrp-videos
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_REGION=garage

# Redis
REDIS_URL=redis://localhost:6379

# AI
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...

# Simulator
SIMULATOR_VOICES=voice-id-1:Dr. Rodriguez;voice-id-2:Patient;voice-id-3:Specialist
SIMULATOR_PAUSE_BETWEEN_SEGMENTS_MS=1000
SIMULATOR_AUDIO_CONCURRENCY=3
```

## Docker

**Development:**
```bash
pnpm docker:up    # Garage S3 (3900) + Redis (6379)
pnpm docker:down
```

**Production:** Multi-stage Dockerfile
- Builder: Node 22-alpine, compiles TS, deploys deps
- Runner: Node 22-alpine + ffmpeg, non-root user, port 3001

## Key Middleware

- `auth.middleware.ts` - Session authentication check
- `admin.middleware.ts` - Admin role required
- `write-access.middleware.ts` - Write permission check
- `session-access.middleware.ts` - Session ownership/assignment check
- `rate-limit.middleware.ts` - Rate limiting
- `upload.middleware.ts` - Multer file upload

## Internationalization

- Languages: `es-ES`, `en-GB`
- Translations: `packages/frontend/src/i18n/{es-ES,en-GB}.json`
- Backend prompts in English, content generated in transcript language
- Language constants: `packages/shared/src/constants/languages.ts`

## Important Notes

- No public registration - users via seed script or admin
- All endpoints (except login) require authentication
- Media files stored in S3: `/{user_uuid}/{session_id}/`
- Accepted formats: MP4, WebM, MOV, AVI, MKV, MP3, M4A, WAV, OGG
- Video streaming proxied through backend (CORS)
- Processing is async - frontend polls for status
- Auth sessions stored in Redis (connect-redis)
- Dates displayed in user timezone (dayjs + utc plugin)
- Simulated sessions show "Simulated" badge

## Testing

**Status:** No test framework currently configured. Tests not implemented.
