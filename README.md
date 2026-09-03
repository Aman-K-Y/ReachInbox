# ReachInbox Email Scheduler

A production-shaped email scheduling workspace: Next.js App Router frontend, Express/TypeScript API, Prisma/Postgres persistence, BullMQ delayed delivery, Redis throttling, Elasticsearch search with a PostgreSQL fallback, Ethereal SMTP, and Slack notifications.

## Quick start

1. Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`.
2. Install dependencies: `npm install`.
3. Create the local SQLite database and tables: `npm --workspace backend exec prisma migrate dev`.
4. (Optional) Seed a demo user and two Ethereal senders: `npm run prisma:seed`.
5. Start both apps: `npm run dev`.

The dashboard is at http://localhost:3000 and the API at http://localhost:4000. Register through the API (`POST /api/auth/register`) before signing in. No Docker is required for local development. For real delivery, provide Ethereal credentials; without them the worker uses a JSON transport suitable for local development.

## API

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/health`
- Authenticated sender CRUD: `GET/POST /api/senders`, `PATCH/DELETE /api/senders/:id`
- Authenticated `POST /api/emails/schedule` (also available as `POST /api/emails`) with
  `{ senderId?, to, subject, body, scheduledAt, idempotencyKey? }`
- Authenticated `GET /api/emails?q=`, `GET /api/emails/:id`, `DELETE /api/emails/:id`
- Authenticated `POST /api/uploads/parse` for CSV validation, then `POST /api/emails/upload`
  (CSV columns: `to,subject,body,scheduledAt`; optional `senderId` form field)
- `GET /api/slack/connect`, `GET /api/slack/status`, `POST /api/slack/test`
  and `DELETE /api/slack/connect`; OAuth incoming-webhook credentials are stored per user.

Each schedule is assigned a unique idempotency key and BullMQ job ID. Every sender has an
hourly Redis cap (`MAX_EMAILS_PER_HOUR_PER_SENDER`, default 30; the legacy
`SENDER_HOURLY_LIMIT` remains supported), and the worker also applies the global
`MAX_EMAILS_PER_HOUR` cap. Jobs over a cap are delayed until capacity is available.
`MIN_DELAY_MS` controls the minimum queue delay and `WORKER_CONCURRENCY` controls the
number of simultaneous deliveries. On startup, the worker reconciles scheduled database
rows and re-enqueues missing jobs. Delivery rows are claimed atomically and duplicate
attempts are safe.

## Production notes

Set a strong `JWT_SECRET`, configure Google OAuth and Slack incoming-webhook OAuth
(`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`) in deployment, and put the
API behind TLS. Sender SMTP credentials can be supplied through the sender endpoints.
Bull Board is available behind auth at `/admin/queues`; the queue is `scheduled-email`.
