from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import re
import smtplib
from urllib import parse, request
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from redis.asyncio import Redis

from .config import settings

logger = logging.getLogger(__name__)

AGENT_CONFIG_KEY = "property_agent:config"
AGENT_RESULTS_KEY = "property_agent:last_results"
UK_TZ = ZoneInfo("Europe/London")
UK_TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class PropertyAgentConfig(BaseModel):
    websites_to_search: list[str] = Field(min_length=1)
    areas_to_search: list[str] = Field(min_length=1)
    property_criteria: str = Field(min_length=1)
    update_frequency_minutes: int = Field(ge=15)
    run_time_uk: str | None = None
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

    @field_validator("run_time_uk")
    @classmethod
    def validate_run_time_uk(cls, value: str | None) -> str | None:
        if value is None:
            return None

        stripped = value.strip()
        if not stripped:
            return None

        if not UK_TIME_PATTERN.match(stripped):
            raise ValueError("Time (UK) must use 24-hour format HH:MM")

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
    listing_url: str


class PropertySearchResult(BaseModel):
    findings: list[PropertyFinding] = Field(max_length=10)


class PropertyAgentSetRequest(BaseModel):
    websites_to_search: str
    areas_to_search: str
    property_criteria: str
    update_frequency_minutes: int = Field(ge=15)
    run_time_uk: str | None = None
    model: str | None = None

    def to_config(self) -> PropertyAgentConfig:
        websites = [part.strip() for part in self.websites_to_search.split(",") if part.strip()]
        areas = [part.strip() for part in self.areas_to_search.split(",") if part.strip()]
        return PropertyAgentConfig(
            websites_to_search=websites,
            areas_to_search=areas,
            property_criteria=self.property_criteria,
            update_frequency_minutes=self.update_frequency_minutes,
            run_time_uk=self.run_time_uk,
            model=self.model or settings.default_openai_model,
        )


class PropertyAgentSetResponse(BaseModel):
    status: str
    model: str
    update_frequency_minutes: int
    run_time_uk: str | None = None
    notification_channel: str
    recipient: str
    findings: list[PropertyFinding]
    table_markdown: str


class PropertyAgentStatus(BaseModel):
    is_running: bool
    update_frequency_minutes: int | None = None
    run_time_uk: str | None = None
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
        self._validate_schedule_inputs(config)
        findings, table = await self._run_single_search(config)
        await self._save_config(redis_client, config)
        await self._save_results(redis_client, findings)
        recipient = await self._send_results(findings, table, config)
        first_run_at_utc = datetime.now(timezone.utc)

        async with self._state.lock:
            if self._state.task:
                self._state.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._state.task

            self._state.config = config
            self._state.task = asyncio.create_task(
                self._scheduler_loop(redis_client, config, first_run_at_utc),
                name="property-search-agent",
            )

        return PropertyAgentSetResponse(
            status="running",
            model=config.model,
            update_frequency_minutes=config.update_frequency_minutes,
            run_time_uk=config.run_time_uk,
            notification_channel=settings.notification_channel,
            recipient=recipient,
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
            run_time_uk=self._state.config.run_time_uk if self._state.config else None,
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

    async def _scheduler_loop(self, redis_client: Redis, config: PropertyAgentConfig, first_run_at_utc: datetime) -> None:
        last_run_at_utc = first_run_at_utc
        while True:
            try:
                await asyncio.sleep(self._seconds_until_next_run(config, last_run_at_utc))
                findings, table = await self._run_single_search(config)
                await self._save_results(redis_client, findings)
                await self._send_results(findings, table, config)
                last_run_at_utc = datetime.now(timezone.utc)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover
                logger.exception("Property search agent run failed: %s", exc)
                last_run_at_utc = datetime.now(timezone.utc)

    def _validate_schedule_inputs(self, config: PropertyAgentConfig) -> None:
        if config.update_frequency_minutes != 60 and not config.run_time_uk:
            raise ValueError("Time (UK) is required for daily, weekly, and monthly schedules")

    def _seconds_until_next_run(self, config: PropertyAgentConfig, last_run_at_utc: datetime) -> float:
        if config.update_frequency_minutes == 60 or not config.run_time_uk:
            return float(config.update_frequency_minutes * 60)

        target_utc = self._next_scheduled_utc(last_run_at_utc, config.update_frequency_minutes, config.run_time_uk)
        now_utc = datetime.now(timezone.utc)
        return max((target_utc - now_utc).total_seconds(), 0.0)

    def _next_scheduled_utc(self, last_run_at_utc: datetime, frequency_minutes: int, run_time_uk: str) -> datetime:
        if frequency_minutes % (24 * 60) != 0:
            return last_run_at_utc + timedelta(minutes=frequency_minutes)

        cadence_days = frequency_minutes // (24 * 60)
        hours, minutes = [int(part) for part in run_time_uk.split(":", maxsplit=1)]
        scheduled_time = time(hour=hours, minute=minutes, tzinfo=UK_TZ)
        last_run_london = last_run_at_utc.astimezone(UK_TZ)
        target_date = last_run_london.date() + timedelta(days=cadence_days)
        target_london = datetime.combine(target_date, scheduled_time)
        return target_london.astimezone(timezone.utc)

    async def _run_single_search(self, config: PropertyAgentConfig) -> tuple[list[PropertyFinding], str]:
        prompt = self._build_prompt(config)
        response = await self._client.responses.create(
            model=config.model,
            input=prompt,
            tools=[{"type": "web_search_preview"}],
        )

        raw_text = self._extract_json_payload(response.output_text)
        parsed = PropertySearchResult.model_validate_json(raw_text)
        findings = sorted(parsed.findings, key=lambda item: item.rank)[:10]
        renumbered = [item.model_copy(update={"rank": index}) for index, item in enumerate(findings, start=1)]
        return renumbered, self._to_markdown_table(renumbered)

    def _extract_json_payload(self, output_text: str) -> str:
        cleaned = output_text.strip().removeprefix("```json").removesuffix("```").strip()
        if cleaned.startswith("{") and cleaned.endswith("}"):
            return cleaned

        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise ValueError("Model response did not contain valid JSON")
        return match.group(0)

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

    async def _send_results(self, findings: list[PropertyFinding], table_markdown: str, config: PropertyAgentConfig) -> str:
        if settings.notification_channel == "email":
            await self._send_email(findings, table_markdown, config)
            return settings.smtp_result_recipient

        await self._send_telegram(findings, table_markdown, config)
        return settings.telegram_chat_id

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
            try:
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
                    if settings.smtp_use_tls:
                        smtp.starttls()
                    self._authenticate_smtp(smtp)
                    smtp.send_message(message)
            except smtplib.SMTPAuthenticationError as exc:
                server_message = exc.smtp_error.decode("utf-8", errors="ignore")
                if "basic authentication is disabled" in server_message.lower():
                    raise ValueError(
                        "SMTP authentication failed: provider rejected basic username/password auth. "
                        "Switch SMTP_AUTH_METHOD=xoauth2 and provide SMTP_OAUTH2_USER + SMTP_OAUTH2_ACCESS_TOKEN."
                    ) from exc
                raise ValueError(f"SMTP authentication failed: {server_message}") from exc

        await asyncio.to_thread(_send)

    TELEGRAM_MAX_MESSAGE_LENGTH = 4096

    async def _send_telegram(self, findings: list[PropertyFinding], table_markdown: str, config: PropertyAgentConfig) -> None:
        telegram_table = self._to_telegram_table(findings)
        text = "\n".join(
            [
                "🏠 Property Search Agent Results",
                f"Model: {config.model}",
                f"Websites: {', '.join(config.websites_to_search)}",
                f"Areas: {', '.join(config.areas_to_search)}",
                f"Criteria: {config.property_criteria}",
                "",
                telegram_table,
            ]
        )

        def _send() -> None:
            if not settings.telegram_bot_token:
                raise ValueError("TELEGRAM_BOT_TOKEN must be configured for Telegram notifications")

            bot_token = settings.telegram_bot_token.get_secret_value()
            base_url = settings.telegram_api_base_url.rstrip("/")
            endpoint = f"{base_url}/bot{bot_token}/sendMessage"
            messages = self._split_for_telegram(text)

            for index, message in enumerate(messages):
                escaped_message = self._escape_telegram_html(message)
                wrapped_text = (
                    f"<pre>{escaped_message}</pre>"
                    if len(messages) == 1
                    else f"<pre>(Part {index + 1}/{len(messages)})\n{escaped_message}</pre>"
                )
                payload = parse.urlencode(
                    {
                        "chat_id": settings.telegram_chat_id,
                        "text": wrapped_text,
                        "parse_mode": "HTML",
                    }
                ).encode("utf-8")
                req = request.Request(endpoint, data=payload, method="POST")
                with request.urlopen(req, timeout=20) as response:
                    body = response.read().decode("utf-8", errors="ignore")
                    parsed = json.loads(body)
                    if not parsed.get("ok"):
                        raise ValueError(f"Telegram API error: {parsed.get('description', 'Unknown error')}")

        await asyncio.to_thread(_send)

    def _split_for_telegram(self, text: str) -> list[str]:
        wrapper_length = len("<pre></pre>")

        chunks = self._split_for_telegram_by_escaped_length(
            text,
            self.TELEGRAM_MAX_MESSAGE_LENGTH - wrapper_length,
        )
        if len(chunks) == 1:
            return chunks

        previous_count = -1
        for _ in range(5):
            total_parts = len(chunks)
            max_prefix_len = max(
                len(f"(Part {index + 1}/{total_parts})\n")
                for index in range(total_parts)
            )
            chunks = self._split_for_telegram_by_escaped_length(
                text,
                self.TELEGRAM_MAX_MESSAGE_LENGTH - wrapper_length - max_prefix_len,
            )
            if len(chunks) == previous_count:
                break
            previous_count = len(chunks)

        return chunks

    def _split_for_telegram_by_escaped_length(self, text: str, max_escaped_length: int) -> list[str]:
        if max_escaped_length <= 0:
            raise ValueError("Telegram max escaped message length must be positive")

        chunks: list[str] = []
        current = ""

        def escaped_length(value: str) -> int:
            return len(self._escape_telegram_html(value))

        def split_long_segment(segment: str) -> list[str]:
            parts: list[str] = []
            part = ""
            for char in segment:
                candidate = part + char
                if escaped_length(candidate) > max_escaped_length:
                    if part:
                        parts.append(part.rstrip())
                    part = char
                    if escaped_length(part) > max_escaped_length:
                        raise ValueError("Unable to split Telegram message within escaped length limit")
                else:
                    part = candidate
            if part:
                parts.append(part.rstrip())
            return parts

        for line in text.splitlines(keepends=True):
            if escaped_length(line) > max_escaped_length:
                if current:
                    chunks.append(current.rstrip())
                    current = ""
                chunks.extend(split_long_segment(line))
                continue

            if escaped_length(current + line) > max_escaped_length:
                if current:
                    chunks.append(current.rstrip())
                current = line
            else:
                current += line

        if current:
            chunks.append(current.rstrip())

        return chunks or [""]

    def _authenticate_smtp(self, smtp: smtplib.SMTP) -> None:
        if settings.smtp_auth_method == "none":
            return

        if settings.smtp_auth_method == "basic":
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
            return

        if settings.smtp_auth_method == "xoauth2":
            oauth_user = settings.smtp_oauth2_user or settings.smtp_username or settings.smtp_from_email
            if not oauth_user or not settings.smtp_oauth2_access_token:
                raise ValueError("SMTP_OAUTH2_USER and SMTP_OAUTH2_ACCESS_TOKEN must be configured for xoauth2 auth")

            auth_string = f"user={oauth_user}\x01auth=Bearer {settings.smtp_oauth2_access_token.get_secret_value()}\x01\x01"
            encoded_auth = base64.b64encode(auth_string.encode("utf-8")).decode("ascii")
            code, response = smtp.docmd("AUTH", "XOAUTH2 " + encoded_auth)
            if code != 235:
                decoded = response.decode("utf-8", errors="ignore")
                raise smtplib.SMTPAuthenticationError(code, response if isinstance(response, bytes) else decoded.encode())

    def _build_prompt(self, config: PropertyAgentConfig) -> str:
        domains = "\n".join([f"- {site}" for site in config.websites_to_search])
        areas = "\n".join([f"- {area}" for area in config.areas_to_search])
        return (
            "Search for residential properties to buy and return JSON only.\n"
            "Rules:\n"
            "1) Use only the websites listed below as sources.\n"
            "2) Search only within the areas listed below.\n"
            "3) Include only properties matching the criteria exactly.\n"
            "4) Perform a deep search: run multiple targeted queries across each site, open and read each candidate listing page in detail, and review any linked floorplan documents/images before deciding whether to include it.\n"
            "5) Return at most 10 results.\n"
            "6) For every included result, provide the exact live listing URL where it was found.\n"
            "7) Output must match this JSON schema: "
            '{"findings":[{"rank":1,"property":"...","price":"...","size_sqm":"...","pounds_per_sqm":"...","service_charge":"...","ground_rent":"...","location":"...","key_strengths":"...","main_issues":"...","listing_url":"https://..."}]}.\n'
            "Websites to Search:\n"
            f"{domains}\n"
            "Areas to Search:\n"
            f"{areas}\n"
            "Property Criteria:\n"
            f"{config.property_criteria}\n"
            "If exact data for a field is unavailable, write 'Not listed'. Never use 'Not listed' for listing_url."
        )

    def _to_markdown_table(self, findings: list[PropertyFinding]) -> str:
        header = (
            "| Rank | Property | Price | Size (sqm) | £/sqm | Service Charge | Ground Rent | Location | "
            "Key Strengths | Main Issues | Listing URL |"
        )
        divider = "|---|---|---|---|---|---|---|---|---|---|---|"
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
                    item.main_issues,
                    f"{item.listing_url} |",
                ]
            )
            for item in findings
        ]
        return "\n".join([header, divider, *rows])

    def _to_telegram_table(self, findings: list[PropertyFinding]) -> str:
        if not findings:
            return "No results returned."

        columns = [
            ("#", 2, lambda item: str(item.rank)),
            ("Property", 28, lambda item: item.property),
            ("Price", 12, lambda item: item.price),
            ("Size", 10, lambda item: item.size_sqm),
            ("£/sqm", 10, lambda item: item.pounds_per_sqm),
            ("Location", 18, lambda item: item.location),
        ]

        def fit(value: str, width: int) -> str:
            single_line = re.sub(r"\s+", " ", value.strip())
            if len(single_line) <= width:
                return single_line.ljust(width)
            return f"{single_line[: max(width - 1, 0)]}…"

        header = " | ".join([name.ljust(width) for name, width, _ in columns])
        divider = "-+-".join(["-" * width for _, width, _ in columns])
        rows = [
            " | ".join([fit(extractor(item), width) for _, width, extractor in columns])
            for item in findings
        ]
        return "\n".join([header, divider, *rows])

    def _escape_telegram_html(self, text: str) -> str:
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    def _validate_runtime_settings(self) -> None:
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY must be configured")
        if settings.notification_channel == "telegram":
            if not settings.telegram_bot_token or not settings.telegram_chat_id:
                raise ValueError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured for Telegram notifications")
            return

        if not settings.smtp_host or not settings.smtp_from_email or not settings.smtp_result_recipient:
            raise ValueError("SMTP settings must be configured, including SMTP_RESULT_RECIPIENT")
        if settings.smtp_auth_method == "basic" and settings.smtp_username and not settings.smtp_password:
            raise ValueError("SMTP_PASSWORD must be configured when SMTP_AUTH_METHOD=basic and SMTP_USERNAME is set")
        if settings.smtp_auth_method == "xoauth2":
            oauth_user = settings.smtp_oauth2_user or settings.smtp_username or settings.smtp_from_email
            if not oauth_user or not settings.smtp_oauth2_access_token:
                raise ValueError("SMTP_OAUTH2_USER (or SMTP_USERNAME/SMTP_FROM_EMAIL) and SMTP_OAUTH2_ACCESS_TOKEN are required for SMTP_AUTH_METHOD=xoauth2")
