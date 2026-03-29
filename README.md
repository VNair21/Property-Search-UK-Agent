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
cp .env.example .env
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

By default, the app calls `http://localhost:8000`.
For a physical device, update `EXPO_PUBLIC_API_BASE_URL` in `frontend/.env` to your machine's LAN IP.

## 3) Redis + backend with Docker Compose

From repository root:

```bash
docker compose up --build
```

This starts:

- Redis at `localhost:6379`
- FastAPI backend at `localhost:8000`

## API endpoints included

- `GET /health` – basic service and Redis connectivity status
- `POST /kv/{key}` with JSON body `{ "value": "..." }` – store a value in Redis
- `GET /kv/{key}` – fetch a value from Redis

## Notes

- Redis is being used as the **primary datastore** in this starter.
- The backend uses async Redis client via `redis[hiredis]`.
- The frontend includes a simple screen to exercise backend health and key/value read-write.
