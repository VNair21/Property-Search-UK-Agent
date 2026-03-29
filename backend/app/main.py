from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from redis.asyncio import Redis

from .config import settings

redis_client: Redis | None = None


class KVPayload(BaseModel):
    value: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    yield
    if redis_client:
        await redis_client.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    if redis_client is None:
        raise HTTPException(status_code=500, detail="Redis client not initialized")

    try:
        pong = await redis_client.ping()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=503, detail=f"Redis unavailable: {exc}") from exc

    return {
        "status": "ok",
        "redis": "ok" if pong else "error",
    }


@app.post("/kv/{key}")
async def set_value(key: str, payload: KVPayload) -> dict[str, str]:
    if redis_client is None:
        raise HTTPException(status_code=500, detail="Redis client not initialized")

    await redis_client.set(key, payload.value)
    return {"key": key, "value": payload.value}


@app.get("/kv/{key}")
async def get_value(key: str) -> dict[str, str]:
    if redis_client is None:
        raise HTTPException(status_code=500, detail="Redis client not initialized")

    value = await redis_client.get(key)
    if value is None:
        raise HTTPException(status_code=404, detail="Key not found")

    return {"key": key, "value": value}
