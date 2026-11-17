# FinFlow Backend API

A high-performance, modular REST API and real-time synchronization backend powering the **FinFlow** personal finance platform. Built with Express 5, TypeScript (ESM), Prisma 7 with PostgreSQL, Redis for distributed caching and rate-limiting, and Google Gemini AI for monthly financial reflections.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Key Features & Domain Modules](#key-features--domain-modules)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Installation](#local-installation)
  - [Database Setup & Migrations](#database-setup--migrations)
  - [Running the Application](#running-the-application)
- [API Conventions & Response Format](#api-conventions--response-format)
- [API Endpoints Overview](#api-endpoints-overview)
- [Serverless & Scale-to-Zero Optimization](#serverless--scale-to-zero-optimization)
- [Available Scripts](#available-scripts)

---

## Overview

FinFlow organizes personal finances on a strict monthly cycle. Every month has a baseline **Starting Allowance** that serves as the single source of truth for budget tracking. The backend exposes RESTful endpoints and a Server-Sent Events (SSE) synchronization pipeline that enables real-time, low-latency updates across open browser tabs and devices.

---

## Tech Stack

- **Runtime & Language:** Node.js (v20+), Native ES Modules (`"type": "module"`), TypeScript (`tsc` + `tsc-alias`)
- **Web Framework:** Express 5 (`^5.2.1`)
- **Database & ORM:** PostgreSQL, Prisma ORM 7 (`@prisma/client`, `@prisma/adapter-pg` with `pg` driver adapter)
- **Caching & Pub/Sub:** Redis (`ioredis` v6) for cache-aside reads, distributed sliding-window rate limiting, and real-time SSE event relay
- **Authentication & Security:** Stateless JWT with `jose` (HS256), `bcryptjs` password hashing, multi-device session management and token revocation tracking in Redis
- **Validation:** Zod v3 for fail-fast schema validation across requests and environment variables
- **AI & Analytics:** Google Gemini API (`@google/genai`) for monthly spending reflections and contextual financial companion chat
- **Media Uploads:** Multer with Cloudinary stream upload for profile avatars
- **Logging & Tracing:** Structured JSON logging with UUID `X-Request-Id` request tracing and graceful shutdown handlers

---

## System Architecture

The backend strictly adheres to a layered, decoupled architecture:

```
Incoming Request
      │
      ▼
┌────────────────────────────────────────────────────────┐
│  Middleware Pipeline                                   │
│  • Request ID (UUID) & Correlation Header              │
│  • Structured JSON Request Logger                      │
│  • Response Formatter (res.success, standard errors)   │
│  • Redis Sliding-Window Rate Limiter                   │
│  • JWT Authentication & Session Revocation Check       │
└────────────────────────────────────────────────────────┘
      │
      ▼
┌────────────────────────────────────────────────────────┐
│  Zod Validation Layer (src/validators)                 │
│  Validates query params, URL route params, & body      │
└────────────────────────────────────────────────────────┘
      │
      ▼
┌────────────────────────────────────────────────────────┐
│  Controllers (src/controllers)                         │
│  Extracts params/auth session; invokes service layer;  │
│  returns standardized response envelopes.              │
└────────────────────────────────────────────────────────┘
      │
      ▼
┌────────────────────────────────────────────────────────┐
│  Services (src/services)                               │
│  Pure business logic, transactional consistency,       │
│  cache invalidation, and Pub/Sub event dispatching.   │
└────────────────────────────────────────────────────────┘
      │
      ├──► Redis (Cache-aside reads, TTL with jitter, rate-limit keys)
      ├──► PostgreSQL / Prisma (Soft-delete filtered queries, transactions)
      └──► Gemini API (AI reflections & conversational stream)
```

---

## Key Features & Domain Modules

1. **Authentication & Session Management (`/api/v1/auth`, `/api/v1/profile`):**
   - Secure registration, login, and token verification.
   - Per-device session tracking (`user:sessions:<userId>:<sessionId>`) with remote revocation support.
   - Onboarding milestone enforcement: birth date, primary currency symbol, and initial positive monthly starting allowance (default: `2000`).

2. **Monthly Allowance Management (`/api/v1/allowance`):**
   - Monthly scoped starting budget as the single source of truth.
   - Auto-initialization from the user's baseline allowance preferences.
   - Immutability guards preventing negative or zero budgets.

3. **Incomes & Expenses (`/api/v1/income`, `/api/v1/expense`, `/api/v1/transactions`):**
   - Granular tracking with custom categories, payment methods, dates, amounts, and personal notes.
   - Soft-delete pattern across all records (`isDeleted`, `deletedAt`, `deletedBy`).
   - Combined master transaction ledger with multi-parameter filtering (date ranges, amounts, search terms) and pagination.

4. **Dashboard & Analytics (`/api/v1/dashboard`):**
   - Aggregated monthly totals: starting allowance, extra income, total expenses, remaining balance, and transaction count.
   - Daily income vs. expense breakdowns.
   - Categorical distribution metrics for expense categories and income sources.
   - Redis caching with active invalidation on transaction mutations.

5. **AI Reflection Reports & Financial Companion (`/api/v1/reflect`):**
   - Unlocked once 15+ transactions are logged in a month.
   - Generates personalized spending archetype, wins, areas to improve, and actionable goals using Google Gemini.
   - Interactive Q&A chat grounded on the user's monthly report data.

6. **Custom Categories & Payment Methods (`/api/v1/categories`, `/api/v1/payment-methods`):**
   - User-defined categories with customized colors and Lucide/Hugeicons icons.
   - Support for custom payment methods alongside defaults (Cash, Credit Card, Debit Card, Bank Transfer).

7. **Real-time SSE Synchronization (`/api/v1/sync`):**
   - Server-Sent Events (SSE) delivering instant UI cache invalidation (`type: "INVALIDATE"`, `scope: "EXPENSE" | "INCOME" | "ALLOWANCE" | ...`).
   - Redis Pub/Sub integration for horizontal multi-instance scaling.

---

## Project Structure

```
backend/
├── prisma/
│   ├── migrations/          # SQL migration history
│   ├── schema.prisma        # Prisma data models and relations
│   └── prisma.config.ts     # Prisma CLI configuration
├── src/
│   ├── app.ts               # Express application setup & middleware assembly
│   ├── server.ts            # Server entry point & graceful shutdown hooks
│   ├── config/
│   │   └── env.ts           # Zod-validated environment configuration
│   ├── controllers/         # Thin HTTP request handlers
│   ├── errors/              # Custom ApiError hierarchy (BadRequest, NotFound, etc.)
│   ├── generated/           # Generated Prisma client output
│   ├── lib/
│   │   ├── cloudinary.ts    # Cloudinary stream uploader
│   │   ├── gemini.ts        # Google Gemini AI client
│   │   ├── jwt.ts           # Jose JWT signing and verification
│   │   ├── logger.ts        # Structured JSON logger
│   │   ├── prisma.ts        # Shared Prisma client with pg adapter
│   │   ├── redis.ts         # Lazy Redis proxy with 60s idle scale-to-zero
│   │   ├── routes.ts        # Route path constants
│   │   ├── session.ts       # Redis-backed session helper
│   │   └── sync.ts          # SSE sync manager and Pub/Sub relays
│   ├── middleware/          # Rate limiting, request ID, error handling, auth guards
│   ├── routes/              # Express route declarations
│   ├── services/            # Core business logic and database orchestration
│   ├── types/               # TypeScript type definitions and interfaces
│   ├── utils/               # Date parsing, formatters, and utility helpers
│   └── validators/          # Zod input validation schemas
├── package.json
├── tsconfig.json
└── README.MD
```

---

## Environment Variables

Create a `.env` file in the `backend/` root directory:

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | string | `development` | Application mode (`development`, `test`, `production`) |
| `PORT` | number | `5000` | Port on which Express listens |
| `DATABASE_URL` | string | *(Required)* | PostgreSQL connection string |
| `JWT_SECRET` | string | *(Required)* | Secret key for signing session JWTs |
| `JWT_REFRESH_SECRET` | string | `default_...` | Optional secret for refresh tokens |
| `REDIS_URL` | string | `redis://localhost:6379` | Redis connection URL |
| `GEMINI_API_KEY` | string | `""` | Google Gemini API key for AI Reflect reports |
| `ENABLE_VERBOSE_LOGS` | boolean | `false` | Enables verbose debug logging |
| `TZ` | string | `Asia/Kolkata` | Application timezone identifier |
| `CLOUDINARY_CLOUD_NAME` | string | `""` | Cloudinary account cloud name |
| `CLOUDINARY_API_KEY` | string | `""` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | string | `""` | Cloudinary API secret |

---

## Getting Started

### Prerequisites

- **Node.js** v20.x or higher
- **npm** v10+
- **PostgreSQL** v15+ (local or containerized)
- **Redis** v7+ (local or containerized)

### Local Installation

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your PostgreSQL, Redis, and JWT secrets
   ```

### Database Setup & Migrations

Apply database migrations:
```bash
npx prisma migrate dev
```

Inspect database records visually with Prisma Studio:
```bash
npm run studio
```

### Running the Application

- **Development Mode** (with live reload via `tsx`):
  ```bash
  npm run dev
  ```
- **Production Build:**
  ```bash
  npm run build
  npm start
  ```
- **Production Deployment (with automatic migration deploy):**
  ```bash
  npm run start:prod
  ```

---

## API Conventions & Response Format

The API uses standard HTTP status codes and responds strictly in JSON with an `X-Request-Id` header for end-to-end tracing.

### Success Response (`200 OK`, `201 Created`)
```json
{
  "success": true,
  "status": 200,
  "message": "Allowance updated successfully.",
  "data": {
    "id": "e4b2d354-9a1b-4f91-893d-47209cb14c6e",
    "year": 2026,
    "month": 10,
    "amount": 2000,
    "isRollover": false
  }
}
```

### Error Response (`400`, `401`, `403`, `404`, `409`, `422`, `500`)
```json
{
  "success": false,
  "status": 400,
  "error": {
    "type": "api_error",
    "code": "INVALID_ALLOWANCE",
    "message": "Monthly starting allowance must be greater than zero."
  }
}
```

### Rate-Limited Response (`429 Too Many Requests`)
```json
{
  "success": false,
  "status": 429,
  "error": {
    "type": "rate_limit_error",
    "code": "TOO_MANY_REQUESTS",
    "message": "API rate limit exceeded. Please try again in 45 seconds.",
    "retryAfter": "2026-10-19T03:00:45.000Z",
    "retryAfterSeconds": 45
  }
}
```

---

## API Endpoints Overview

All routes are prefixed under `/api/v1`:

| Route Prefix | Description | Auth Required |
|---|---|---|
| `GET /health` | Basic service uptime and health check | No |
| `/api/v1/auth` | User registration, login, logout, token verification | Public / Optional |
| `/api/v1/profile` | Profile details, preferences, avatar upload, account deletion | Yes |
| `/api/v1/allowance` | Get and update monthly starting budget | Yes |
| `/api/v1/income` | Log, query, update, and soft-delete income records | Yes |
| `/api/v1/expense` | Log, query, update, and soft-delete expense records | Yes |
| `/api/v1/transactions`| Unified chronological ledger with multi-filters and pagination | Yes |
| `/api/v1/dashboard` | Monthly summary metrics, analytics charts, and category breakdowns | Yes |
| `/api/v1/categories` | Custom income and expense category management | Yes |
| `/api/v1/payment-methods` | Custom payment method registry | Yes |
| `/api/v1/reflect` | AI spending analysis report generation and companion chat | Yes |
| `/api/v1/sync` | Server-Sent Events (SSE) stream for real-time invalidations | Yes |

---

## Serverless & Scale-to-Zero Optimization

To optimize hosting expenses on platforms such as **Railway** that support scale-to-zero / serverless sleeping:

1. **Demand-Driven Redis Proxy:** The main `ioredis` client operates behind a Proxy. It connects only when a command is executed and automatically disconnects after **60 seconds of inactivity** (`c.quit()`).
2. **Dynamic SSE Subscriber:** The Pub/Sub subscriber socket is initialized only while active browser client connections exist and drops the TCP connection the moment active connections reach `0`.
3. **Database Idle Pool:** PostgreSQL connections are dropped when idle via `@prisma/adapter-pg`.

When no requests are received for a consecutive period, all outbound network traffic ceases, enabling both the API container and the Redis container to scale down to zero.

---

## Available Scripts

- `npm run dev`: Starts the development server with live reload via `tsx`.
- `npm run build`: Compiles TypeScript to `dist/` and rewrites path aliases via `tsc-alias`.
- `npm start`: Runs the compiled production server from `dist/server.js`.
- `npm run start:prod`: Executes pending Prisma migrations and starts the production server.
- `npm run studio`: Opens Prisma Studio web interface on port 5555.
