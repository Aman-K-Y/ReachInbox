# Plan

## Current status
- The project has been converted to a local no-Docker setup using SQLite and in-memory scheduling.
- Backend startup issues were fixed, including Prisma env loading and startup crashes.
- Local validation succeeded: backend tests pass, typechecks pass, and the API register flow works.

## Next steps
1. Run the app locally with: `npm install`, `npm --workspace backend exec prisma migrate dev`, and `npm run dev`.
2. Verify the frontend at http://localhost:3000 and backend health at http://localhost:4000/api/health.
3. Use the registration flow and schedule a test email locally via the UI or API.
4. If production-like SMTP is needed later, configure Ethereal or a real SMTP provider in the app env file.
