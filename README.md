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

By default, native clients call `http://localhost:8000`, while the web build uses a relative API path (`/kv/...`) to avoid cross-origin issues in browser workflows.
If your frontend and backend are running on different origins, set `EXPO_PUBLIC_API_BASE_URL` in `frontend/.env` (for example `http://localhost:8000` or your machine's LAN IP).

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

## Notes

- Redis is being used as the **primary datastore** in this starter.
- The backend uses async Redis client via `redis[hiredis]`.
- The frontend includes a simple screen to exercise backend health and key/value read-write.
