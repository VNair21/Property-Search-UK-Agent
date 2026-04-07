from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import smtplib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.mime.text import MIMEText

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from redis.asyncio import Redis

from .config import settings

logger = logging.getLogger(__name__)

AGENT_CONFIG_KEY = "property_agent:config"
AGENT_RESULTS_KEY = "property_agent:last_results"


class PropertyAgentConfig(BaseModel):
    websites_to_search: list[str] = Field(min_length=1)
    areas_to_search: list[str] = Field(min_length=1)
    property_criteria: str = Field(min_length=1)
    update_frequency_minutes: int = Field(ge=15)
    model: str = Field(default=settings.default_openai_model)

    @field_validator("websites_to_search", "areas_to_search")
    @classmethod
    def strip_items(cls, value: list[str]) -> list[str]:
        clean = [item.strip() for item in value if item.strip()]
        if not clean:
            raise ValueError("Must include at least one non-empty value")
        return clean

    @field_validator("property_criteria")
    @classmethod
    def strip_criteria(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Property criteria cannot be empty")
        return stripped


class PropertyFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rank: int = Field(ge=1, le=10)
    property: str
    price: str
    size_sqm: str
    pounds_per_sqm: str
    service_charge: str
    ground_rent: str
    location: str
    key_strengths: str
    main_issues: str


class PropertySearchResult(BaseModel):
    findings: list[PropertyFinding] = Field(max_length=10)


class PropertyAgentSetRequest(BaseModel):
    websites_to_search: str
    areas_to_search: str
    property_criteria: str
    update_frequency_minutes: int = Field(ge=15)
    model: str | None = None

    def to_config(self) -> PropertyAgentConfig:
        websites = [part.strip() for part in self.websites_to_search.split(",") if part.strip()]
        areas = [part.strip() for part in self.areas_to_search.split(",") if part.strip()]
        return PropertyAgentConfig(
            websites_to_search=websites,
            areas_to_search=areas,
            property_criteria=self.property_criteria,
            update_frequency_minutes=self.update_frequency_minutes,
            model=self.model or settings.default_openai_model,
        )


class PropertyAgentSetResponse(BaseModel):
    status: str
    model: str
    update_frequency_minutes: int
    recipient: str
    findings: list[PropertyFinding]
    table_markdown: str


class PropertyAgentStatus(BaseModel):
    is_running: bool
    update_frequency_minutes: int | None = None
    model: str | None = None
    last_results_at: str | None = None
    findings: list[PropertyFinding] = Field(default_factory=list)


@dataclass
class AgentRunState:
    task: asyncio.Task[None] | None = None
    config: PropertyAgentConfig | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class PropertySearchAgent:
    def __init__(self) -> None:
        self._state = AgentRunState()
        api_key = settings.openai_api_key.get_secret_value() if settings.openai_api_key else None
        self._client = AsyncOpenAI(api_key=api_key)

    async def configure_and_start(self, redis_client: Redis, request: PropertyAgentSetRequest) -> PropertyAgentSetResponse:
        self._validate_runtime_settings()
        config = request.to_config()
        findings, table = await self._run_single_search(config)
        await self._save_config(redis_client, config)
        await self._save_results(redis_client, findings)
        await self._send_email(findings, table, config)

        async with self._state.lock:
            if self._state.task:
                self._state.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._state.task

            self._state.config = config
            self._state.task = asyncio.create_task(
                self._scheduler_loop(redis_client, config),
                name="property-search-agent",
            )

        return PropertyAgentSetResponse(
            status="running",
            model=config.model,
            update_frequency_minutes=config.update_frequency_minutes,
            recipient=settings.smtp_result_recipient,
            findings=findings,
            table_markdown=table,
        )

    async def get_status(self, redis_client: Redis) -> PropertyAgentStatus:
        raw_results = await redis_client.get(AGENT_RESULTS_KEY)
        findings: list[PropertyFinding] = []
        last_results_at: str | None = None

        if raw_results:
            payload = json.loads(raw_results)
            last_results_at = payload.get("timestamp")
            for item in payload.get("findings", []):
                try:
                    findings.append(PropertyFinding.model_validate(item))
                except ValidationError:
                    logger.warning("Skipping invalid finding from cache")

        return PropertyAgentStatus(
            is_running=self._state.task is not None and not self._state.task.done(),
            update_frequency_minutes=self._state.config.update_frequency_minutes if self._state.config else None,
            model=self._state.config.model if self._state.config else None,
            last_results_at=last_results_at,
            findings=findings,
        )

    async def cancel(self) -> None:
        async with self._state.lock:
            task = self._state.task
            self._state.task = None
            self._state.config = None

            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    async def _scheduler_loop(self, redis_client: Redis, config: PropertyAgentConfig) -> None:
        while True:
            try:
                await asyncio.sleep(config.update_frequency_minutes * 60)
                findings, table = await self._run_single_search(config)
                await self._save_results(redis_client, findings)
                await self._send_email(findings, table, config)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover
                logger.exception("Property search agent run failed: %s", exc)

    async def _run_single_search(self, config: PropertyAgentConfig) -> tuple[list[PropertyFinding], str]:
        prompt = self._build_prompt(config)
        response = await self._client.responses.create(
            model=config.model,
            input=prompt,
            tools=[{"type": "web_search_preview"}],
            text={"format": {"type": "json_object"}},
        )

        raw_text = response.output_text.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = PropertySearchResult.model_validate_json(raw_text)
        findings = sorted(parsed.findings, key=lambda item: item.rank)[:10]
        renumbered = [item.model_copy(update={"rank": index}) for index, item in enumerate(findings, start=1)]
        return renumbered, self._to_markdown_table(renumbered)

    async def _save_config(self, redis_client: Redis, config: PropertyAgentConfig) -> None:
        await redis_client.set(AGENT_CONFIG_KEY, config.model_dump_json())

    async def _save_results(self, redis_client: Redis, findings: list[PropertyFinding]) -> None:
        await redis_client.set(
            AGENT_RESULTS_KEY,
            json.dumps(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "findings": [finding.model_dump() for finding in findings],
                }
            ),
        )

    async def _send_email(self, findings: list[PropertyFinding], table_markdown: str, config: PropertyAgentConfig) -> None:
        message = MIMEText(
            "\n".join(
                [
                    "Property Search Agent Results",
                    f"Model: {config.model}",
                    f"Websites: {', '.join(config.websites_to_search)}",
                    f"Areas: {', '.join(config.areas_to_search)}",
                    f"Criteria: {config.property_criteria}",
                    "",
                    table_markdown,
                ]
            ),
            "plain",
            "utf-8",
        )
        message["Subject"] = "Property Search Agent Results"
        message["From"] = settings.smtp_from_email
        message["To"] = settings.smtp_result_recipient

        def _send() -> None:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
                if settings.smtp_use_tls:
                    smtp.starttls()
                if settings.smtp_username and settings.smtp_password:
                    smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
                smtp.send_message(message)

        await asyncio.to_thread(_send)

    def _build_prompt(self, config: PropertyAgentConfig) -> str:
        domains = "\n".join([f"- {site}" for site in config.websites_to_search])
        areas = "\n".join([f"- {area}" for area in config.areas_to_search])
        return (
            "Search for residential properties to buy and return JSON only.\n"
            "Rules:\n"
            "1) Use only the websites listed below as sources.\n"
            "2) Search only within the areas listed below.\n"
            "3) Include only properties matching the criteria exactly.\n"
            "4) Return at most 10 results.\n"
            "5) Output must match this JSON schema: "
            '{"findings":[{"rank":1,"property":"...","price":"...","size_sqm":"...","pounds_per_sqm":"...","service_charge":"...","ground_rent":"...","location":"...","key_strengths":"...","main_issues":"..."}]}.\n'
            "Websites to Search:\n"
            f"{domains}\n"
            "Areas to Search:\n"
            f"{areas}\n"
            "Property Criteria:\n"
            f"{config.property_criteria}\n"
            "If exact data for a field is unavailable, write 'Not listed'."
        )

    def _to_markdown_table(self, findings: list[PropertyFinding]) -> str:
        header = (
            "| Rank | Property | Price | Size (sqm) | £/sqm | Service Charge | Ground Rent | Location | "
            "Key Strengths | Main Issues |"
        )
        divider = "|---|---|---|---|---|---|---|---|---|---|"
        rows = [
            " | ".join(
                [
                    f"| {item.rank}",
                    item.property,
                    item.price,
                    item.size_sqm,
                    item.pounds_per_sqm,
                    item.service_charge,
                    item.ground_rent,
                    item.location,
                    item.key_strengths,
                    f"{item.main_issues} |",
                ]
            )
            for item in findings
        ]
        return "\n".join([header, divider, *rows])

    def _validate_runtime_settings(self) -> None:
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY must be configured")
        if not settings.smtp_host or not settings.smtp_from_email or not settings.smtp_result_recipient:
            raise ValueError("SMTP settings must be configured, including SMTP_RESULT_RECIPIENT")
