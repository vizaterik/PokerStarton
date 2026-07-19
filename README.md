# PokerLedger

Track preflop strategy deviations from PokerStars hand histories.

## Stack

- **Backend:** FastAPI, SQLAlchemy, Alembic, PostgreSQL
- **Frontend:** React, Vite, TypeScript

## Quick start

```bash
# Start Postgres (Docker)
docker compose up -d db

# Backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# .env is already present for local defaults; or copy from ../.env.example
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

API docs: http://localhost:8000/docs  
App: http://localhost:5173

### Auth notes

- Email registration sends a 6-digit code (SMTP via `SMTP_*` in `.env`).  
  Without SMTP the code is printed in the backend console and shown on the verify page in local mode.
- After first successful login/verify the user must pick a unique nickname.
- Google sign-in: set `GOOGLE_CLIENT_ID` (OAuth Web client, origin `http://localhost:5173`).

## Project layout

```
PokerLedger/
├── docker-compose.yml
├── docs/schema.sql          # canonical PostgreSQL DDL
├── backend/                 # FastAPI + Alembic
└── frontend/                # React + Vite
```

## API (stubs / CRUD)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register`, `/api/auth/login` | users / JWT |
| CRUD | `/api/strategies`, `.../spots`, `.../cells` | strategy tree + matrix |
| POST | `/api/uploads` | upload PokerStars HH file |
| GET | `/api/uploads/{id}/hands`, `.../deviations` | reports |

Parser and deviation engine are stubs for the next implementation step.
