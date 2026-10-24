import os
from datetime import date, datetime, timezone
from threading import Lock
from typing import Annotated

os.environ.setdefault("FLI_TIMEOUT", "15")
os.environ["FLI_MCP_MAX_RESULTS"] = "6"
os.environ["FLI_MCP_DEFAULT_CURRENCY"] = "XXX"

from fastmcp import FastMCP
from pydantic import ConfigDict, Field, model_validator

from fli.mcp import server as upstream
from fli.search._concurrency import configure_concurrency

configure_concurrency(3)
search_lock = Lock()
mcp = FastMCP("Gustave Flight Research")


class FlightQuery(upstream.FlightSearchParams):
    model_config = ConfigDict(extra="forbid")
    currency: str = "EUR"
    top_n: int = Field(3, ge=1, le=5, description="Round-trip outbound candidates to expand; each candidate adds a fetch.")
    checked_bags: int = Field(0, ge=0, le=0, description="Unsupported: must be zero; baggage is not verified.")
    carry_on: bool = Field(False, description="Unsupported: true is rejected; carry-on fees are not verified.")
    exclude_basic_economy: bool = Field(False, description="Unsupported: true is rejected; fare class must be checked with the seller.")
    emissions: str = Field("ALL", description="Only ALL is supported; emissions filtering is rejected.")

    @model_validator(mode="after")
    def supported_filters(self):
        if self.checked_bags or self.carry_on or self.exclude_basic_economy or self.emissions != "ALL":
            raise ValueError("Baggage, basic-economy exclusion and emissions cannot be verified by this transport; research the schedule here and verify fare conditions with the seller.")
        return self


class DateQuery(upstream.DateSearchParams):
    model_config = ConfigDict(extra="forbid")
    currency: str = "EUR"
    sort_by_price: bool = True
    end_date: str = Field(description="Last departure date, YYYY-MM-DD; inclusive window is at most seven dates.")

    @model_validator(mode="after")
    def bounded_dates(self):
        days = (date.fromisoformat(self.end_date) - date.fromisoformat(self.start_date)).days + 1
        if not 1 <= days <= 7:
            raise ValueError("Use a date window of 1–7 days. Each date fetches a full search page; narrow the relevant window first.")
        return self


def research_result(run, query):
    if not search_lock.acquire(blocking=False):
        return {"success": False, "error_type": "search_in_progress", "retryable": True,
                "error": "Another flight search is running; await its result before starting another."}
    try:
        result = run(query)
        return {**result, "observedAt": datetime.now(timezone.utc).isoformat(),
                "source": "Google Flights public search page via punitarani/fli",
                "limitations": ["Research price, not a held fare or booking.",
                                "Baggage, refunds, basic-economy exclusion and emissions are not verified.",
                                "XXX means the provider currency could not be established."]}
    finally:
        search_lock.release()


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False, "openWorldHint": True})
def search_flights(query: FlightQuery) -> dict:
    """Research one-way or round-trip flights; return up to six results and provider links. No purchase. Unsupported fare filters are rejected rather than silently ignored."""
    return research_result(upstream._execute_flight_search, query)


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False, "openWorldHint": True})
def search_dates(query: DateQuery) -> dict:
    """Compare prices across 1–7 departure dates. Price each promising itinerary with search_flights. No calendar-wide sweep or purchase."""
    return research_result(upstream._execute_date_search, query)


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False})
def find_airports(query: str, limit: Annotated[int, Field(ge=1, le=10)] = 5) -> dict:
    """Resolve city, airport, IATA or ICAO names from the packaged airport catalog. No network call."""
    return upstream._find_airports_impl(query, limit=limit)


if __name__ == "__main__":
    mcp.run(transport="stdio", show_banner=False)
