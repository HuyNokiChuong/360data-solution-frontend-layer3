# 360data-solution Backend Architecture

> **Version**: 1.0.0  
> **Last Updated**: 2026-02-10  
> **Stack**: Node.js + Express + TypeScript + Prisma + PostgreSQL

---

## Quick Start

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Start development server
npm run dev
```

---

## Database Configuration

| Parameter | Value |
|-----------|-------|
| Host | `103.249.116.116` |
| Port | `5433` |
| Database | `bidata` |
| Username | `admin` |
| Password | `admin123` |

**Connection String** (in `.env`):
```
DATABASE_URL="postgresql://admin:admin123@103.249.116.116:5433/bidata?schema=public"
```

---

## Architecture Overview

```mermaid
graph TB
    subgraph Client
        FE[Frontend - React/Vite]
    end

    subgraph "API Gateway (Port 3001)"
        EXP[Express Server]
        CORS[CORS Middleware]
        AUTH[Auth Middleware]
        ERR[Error Handler]
    end

    subgraph "Route Handlers"
        R1[/api/auth]
        R2[/api/users]
        R3[/api/connections]
        R4[/api/dashboards]
        R5[/api/folders]
        R6[/api/sessions]
    end

    subgraph "Services"
        EMAIL[Email Service - Resend]
        PRISMA[Prisma ORM]
    end

    subgraph "PostgreSQL Database"
        DB[(bidata)]
    end

    FE --> CORS --> EXP
    EXP --> R1
    EXP --> AUTH --> R2 & R3 & R4 & R5 & R6
    R1 --> EMAIL
    R1 & R2 & R3 & R4 & R5 & R6 --> PRISMA
    PRISMA --> DB
    EXP --> ERR
```

---

## Directory Structure

```
backend/
├── .env                    # Environment variables
├── .env.example            # Example env file
├── package.json            # Dependencies & scripts
├── tsconfig.json           # TypeScript config
├── prisma/
│   └── schema.prisma       # Database schema (14 models)
└── src/
    ├── index.ts            # App entry point
    ├── lib/
    │   └── prisma.ts       # Prisma client singleton
    ├── middleware/
    │   ├── auth.ts         # JWT auth + RBAC
    │   └── errorHandler.ts # Global error handler
    ├── routes/
    │   ├── auth.ts         # Authentication (public)
    │   ├── users.ts        # User management
    │   ├── connections.ts  # Data connections
    │   ├── dashboards.ts   # BI dashboards
    │   ├── folders.ts      # Folder management
    │   └── sessions.ts     # Chat/Report sessions
    └── services/
        └── email.ts        # Email via Resend
```

---

## Multi-Tenant Architecture

The system uses **email domain-based workspace isolation**:

```mermaid
graph LR
    subgraph "Workspace: company-a.com"
        UA1[User A1]
        UA2[User A2]
        DA[Dashboards A]
        CA[Connections A]
    end

    subgraph "Workspace: company-b.com"
        UB1[User B1]
        DB[Dashboards B]
        CB[Connections B]
    end

    UA1 & UA2 --> DA & CA
    UB1 --> DB & CB
```

**Key Rules**:
- Users from the same email domain share a workspace
- All data is isolated by `workspaceId`
- First user in a domain becomes `Admin`
- Only corporate domains allowed (no gmail.com, etc.)

---

## Database Schema (ERD)

```mermaid
erDiagram
    Workspace ||--o{ User : has
    Workspace ||--o{ Connection : has
    Workspace ||--o{ BIFolder : has
    Workspace ||--o{ BIDashboard : has
    Workspace ||--o{ ReportSession : has
    Workspace ||--o{ SystemLog : has

    User ||--o{ Session : has
    User ||--o{ BIDashboard : creates
    User ||--o{ BIFolder : creates
    User ||--o{ Connection : creates
    User ||--o{ SharePermission : has

    Connection ||--o{ SyncedTable : has

    BIFolder ||--o{ BIDashboard : contains
    BIFolder ||--o{ BIFolder : "parent-child"

    BIDashboard ||--o{ DashboardPage : has
    BIDashboard ||--o{ GlobalFilter : has
    BIDashboard ||--o{ SharePermission : has

    DashboardPage ||--o{ BIWidget : has

    ReportSession ||--o{ ChatMessage : has

    User {
        uuid id PK
        string email UK
        string passwordHash
        string name
        string role "Admin/Editor/Viewer"
        string status "Pending/Active/Disabled"
        string phoneNumber
        string jobTitle
    }

    BIDashboard {
        uuid id PK
        string title
        json layout
        json theme
        json calculatedFields
        json quickMeasures
    }

    BIWidget {
        uuid id PK
        string type "chart/table/card/pivot/..."
        int x
        int y
        int w
        int h
        json config
    }
```

---

## API Reference

### Authentication (`/api/auth`) - PUBLIC

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Register new user (corporate email only) |
| POST | `/verify` | Verify email with 6-digit code |
| POST | `/resend-code` | Resend verification code |
| POST | `/login` | Login with email/password |
| POST | `/logout` | Invalidate current session |
| GET | `/me` | Get current user info |

### Users (`/api/users`) - PROTECTED

| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | `/` | List workspace users | Any |
| PUT | `/:id` | Update user | Admin |
| DELETE | `/:id` | Delete user | Admin |

### Connections (`/api/connections`) - PROTECTED

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List data connections |
| POST | `/` | Create new connection |
| PUT | `/:id` | Update connection |
| DELETE | `/:id` | Delete connection |
| GET | `/:id/tables` | List synced tables |
| POST | `/:id/tables` | Upsert synced tables |

### Dashboards (`/api/dashboards`) - PROTECTED

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List dashboards |
| GET | `/:id` | Get dashboard with pages/widgets |
| POST | `/` | Create dashboard |
| PUT | `/:id` | Update dashboard |
| DELETE | `/:id` | Delete dashboard |
| POST | `/:id/pages` | Add page |
| PUT | `/:id/pages/:pageId` | Update page |
| DELETE | `/:id/pages/:pageId` | Delete page |
| POST | `/:id/widgets` | Add widget |
| PUT | `/:id/widgets/:widgetId` | Update widget |
| DELETE | `/:id/widgets/:widgetId` | Delete widget |
| POST | `/:id/global-filters` | Add global filter |
| DELETE | `/:id/global-filters/:filterId` | Delete filter |

### Folders (`/api/folders`) - PROTECTED

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List folders |
| POST | `/` | Create folder |
| PUT | `/:id` | Update folder |
| DELETE | `/:id` | Delete folder (cascade) |

### Sessions (`/api/sessions`) - PROTECTED (AI Chat)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List chat sessions |
| POST | `/` | Create session |
| GET | `/:id` | Get session with messages |
| PUT | `/:id` | Update session title |
| DELETE | `/:id` | Delete session |
| GET | `/:id/messages` | Get messages |
| POST | `/:id/messages` | Add message |

---

## Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Backend API
    participant DB as PostgreSQL
    participant EMAIL as Resend

    C->>API: POST /api/auth/register
    API->>API: Validate corporate domain
    API->>DB: Create user (status: Pending)
    API->>EMAIL: Send verification code
    API-->>C: 201 { email, status: Pending }

    C->>API: POST /api/auth/verify { email, code }
    API->>DB: Validate code & activate user
    API->>DB: Create session
    API-->>C: 200 { token, user }

    C->>API: GET /api/dashboards (Bearer token)
    API->>API: authMiddleware validates JWT
    API->>DB: Check session exists
    API->>DB: Query dashboards by workspaceId
    API-->>C: 200 { dashboards }
```

---

## Role-Based Access Control (RBAC)

| Role | Users | Dashboards | Connections | Folders |
|------|-------|------------|-------------|---------|
| **Admin** | ✅ CRUD | ✅ CRUD | ✅ CRUD | ✅ CRUD |
| **Editor** | ❌ Read | ✅ CRUD | ✅ CRUD | ✅ CRUD |
| **Viewer** | ❌ Read | ✅ Read | ✅ Read | ✅ Read |

---

## Security Features

### 1. Corporate Domain Restriction
```typescript
const PUBLIC_DOMAINS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 
    'outlook.com', 'icloud.com', 'me.com', ...
];

function isCorporateDomain(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    return !PUBLIC_DOMAINS.includes(domain);
}
```

### 2. Password Hashing
- **Algorithm**: bcrypt with 12 rounds
- **Storage**: `passwordHash` column

### 3. JWT Token
- **Secret**: `JWT_SECRET` env variable
- **Expiry**: 7 days default
- **Payload**: `{ userId, email, workspaceId, role }`

### 4. Session Management
- Tokens stored in `sessions` table
- Auto-expiry check on every request
- `lastActive` updated on each API call

---

## NPM Scripts

```json
{
  "dev": "tsx watch src/index.ts",     // Hot-reload dev server
  "build": "tsc",                       // Compile TypeScript
  "start": "node dist/index.js",        // Production start
  "db:generate": "prisma generate",     // Generate Prisma client
  "db:push": "prisma db push",          // Push schema to DB
  "db:migrate": "prisma migrate dev",   // Create migration
  "db:seed": "tsx prisma/seed.ts"       // Seed data
}
```

---

## Dependencies

### Production
| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.18.2 | Web framework |
| @prisma/client | ^5.10.0 | Database ORM |
| bcryptjs | ^2.4.3 | Password hashing |
| jsonwebtoken | ^9.0.2 | JWT tokens |
| resend | ^6.9.1 | Email service |
| zod | ^3.22.4 | Schema validation |
| cors | ^2.8.5 | CORS handling |
| dotenv | ^16.4.5 | Env variables |

### Development
| Package | Version | Purpose |
|---------|---------|---------|
| typescript | ^5.3.3 | TypeScript |
| tsx | ^4.7.0 | TS execution |
| prisma | ^5.10.0 | Prisma CLI |
| @types/* | Various | Type definitions |

---

## Environment Variables

```bash
# Database
DATABASE_URL="postgresql://admin:admin123@103.249.116.116:5433/bidata?schema=public"

# JWT
JWT_SECRET="your-super-secret-key-change-in-production"
JWT_EXPIRES_IN="7d"

# Server
PORT=3001
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL="http://localhost:8080"

# Email Service
RESEND_API_KEY="re_your_api_key_here"
```

> [!CAUTION]
> The `JWT_SECRET` in production MUST be a strong, random secret. Never commit real secrets to version control.

---

## Health Check

```bash
curl http://localhost:3001/api/health
# Response: { "status": "ok", "timestamp": "2026-02-10T..." }
```

---

## Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "error": {
    "message": "Human readable error",
    "code": "ERROR_CODE",
    "stack": "..." // Only in development
  }
}
```

Common error codes:
- `NO_TOKEN` - Missing authorization header
- `INVALID_TOKEN` - JWT verification failed
- `INVALID_SESSION` - Session expired/revoked
- `DOMAIN_RESTRICTED` - Non-corporate email
- `USER_EXISTS` - Email already registered
- `INVALID_CREDENTIALS` - Wrong email/password
- `FORBIDDEN` - Insufficient role permissions

---

## Deployment Notes

### Production Checklist
- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Set `NODE_ENV=production`
- [ ] Configure HTTPS/TLS
- [ ] Set up database backup schedule
- [ ] Configure proper CORS origins
- [ ] Enable rate limiting
- [ ] Set up monitoring/logging

### Database Migration
```bash
# Create new migration
npm run db:migrate -- --name "migration_name"

# Apply pending migrations
npx prisma migrate deploy
```

---

*Document generated by Antigravity Agent*
