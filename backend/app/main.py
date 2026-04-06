from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from redis.asyncio import Redis

from .config import settings
from .property_agent import PropertyAgentSetRequest, PropertyAgentStatus, PropertySearchAgent

redis_client: Redis | None = None
property_search_agent = PropertySearchAgent()


class KVPayload(BaseModel):
    value: str


class KVBulkPayload(BaseModel):
    values: dict[str, str]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    yield
    if redis_client:
        await property_search_agent.cancel()
        await redis_client.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.post("/property-agent/set-search")
async def set_property_agent_search(payload: PropertyAgentSetRequest):
    if redis_client is None:
        raise HTTPException(status_code=500, detail="Redis client not initialized")

    try:
        return await property_search_agent.configure_and_start(redis_client, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to run property search agent: {exc}") from exc


@app.get("/property-agent/status", response_model=PropertyAgentStatus)
async def property_agent_status() -> PropertyAgentStatus:
    if redis_client is None:
        raise HTTPException(status_code=500, detail="Redis client not initialized")
    return await property_search_agent.get_status(redis_client)


@app.post("/property-agent/cancel")
async def cancel_property_agent() -> dict[str, str]:
    if redis_client is None:
        raise HTTPException(status_code=500, detail="Redis client not initialized")
    await property_search_agent.cancel()
    return {"status": "stopped"}


@app.post("/kv/bulk")
async def set_values_bulk(payload: KVBulkPayload) -> dict[str, int]:
    if redis_client is None:
        raise HTTPException(status_code=500, detail="Redis client not initialized")

    if not payload.values:
        raise HTTPException(status_code=400, detail="No values provided")

    async with redis_client.pipeline(transaction=True) as pipe:
        for key, value in payload.values.items():
            pipe.set(key, value)
        await pipe.execute()

    return {"saved": len(payload.values)}


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
