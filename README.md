# Full-stack starter: React Native (Web + iOS) + FastAPI + Redis

This repository is now scaffolded as a full-stack starter with:

- **Frontend:** React Native using **Expo** (runs on Web and iOS)
- **Backend:** **Python + FastAPI**
- **Primary database:** **Redis**

## Project structure

- `frontend/` – Expo React Native app (Web + iOS)
- `backend/` – FastAPI app with Redis-backed endpoints
- `docker-compose.yml` – Redis + backend service orchestration

## 1) Backend setup (FastAPI + Redis)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.dev .env
uvicorn app.main:app --reload --port 8000
```

Backend health check:

- <http://localhost:8000/health>
- <http://localhost:8000/docs>

## 2) Frontend setup (Expo React Native)

```bash
cd frontend
npm install
npm run web
```

To run on iOS (on macOS with Xcode):

```bash
npm run ios
```

By default, the app targets port `8000` on the same host running Metro/Expo (`http://<dev-host>:8000`) so it works for `npm run web` and `npm run ios` development flows.
If your backend runs elsewhere, set `EXPO_PUBLIC_API_BASE_URL` in `frontend/.env` (for example `http://localhost:8000` or your machine's LAN IP).

## 3) Redis + backend with Docker Compose

From repository root:

```bash
docker compose up --build
```

This starts:

- Redis at `localhost:6379`
- FastAPI backend at `localhost:8000`

Development extras included in Compose:

- Backend code is bind-mounted (`./backend:/app`) and runs `uvicorn --reload` for hot reload.
- Redis data is persisted in the named volume `redis_data` (AOF enabled).

## API endpoints included

- `GET /health` – basic service and Redis connectivity status
- `POST /kv/{key}` with JSON body `{ "value": "..." }` – store a value in Redis
- `GET /kv/{key}` – fetch a value from Redis
- `POST /property-agent/set-search` – starts OpenAI-powered property search agent from UI fields
- `POST /property-agent/cancel` – stops running property search agent
- `GET /property-agent/status` – returns running state and latest top-10 findings

## Property agent environment variables

Set these in `backend/.env` for the agentic layer:

- `OPENAI_API_KEY` – required for OpenAI-based search
- `DEFAULT_OPENAI_MODEL` – optional, defaults to `gpt-5`
- `SMTP_HOST` – SMTP server host (required to send results email)
- `SMTP_PORT` – SMTP port (default `587`)
- `SMTP_USE_TLS` – `true`/`false`, default `true`
- `SMTP_USERNAME` – optional SMTP auth username
- `SMTP_PASSWORD` – optional SMTP auth password
- `SMTP_FROM_EMAIL` – required sender email address
- `SMTP_RESULT_RECIPIENT` – required recipient email address for property reports

## Notes

- Redis is being used as the **primary datastore** in this starter.
- The backend uses async Redis client via `redis[hiredis]`.
- The frontend includes a simple screen to exercise backend health and key/value read-write.
