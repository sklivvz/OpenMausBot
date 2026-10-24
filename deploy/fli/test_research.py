import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from pydantic import ValidationError

spec = importlib.util.spec_from_file_location("research", Path(__file__).with_name("research.py"))
research = importlib.util.module_from_spec(spec)
spec.loader.exec_module(research)


class ResearchTests(unittest.TestCase):
    def flight(self, **kwargs):
        return research.FlightQuery(origin="TLL", destination="HEL", departure_date="2026-11-10", **kwargs)

    def test_defaults_and_unsupported_constraints(self):
        self.assertEqual(self.flight().currency, "EUR")
        self.assertEqual(self.flight().top_n, 3)
        for extra in ({"checked_bags": 1}, {"carry_on": True}, {"exclude_basic_economy": True}, {"emissions": "LESS"}, {"unknown": True}, {"top_n": 6}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                self.flight(**extra)

    def test_calendar_bound(self):
        base = dict(origin="TLL", destination="HEL", start_date="2026-11-10")
        self.assertEqual(research.DateQuery(**base, end_date="2026-11-16").currency, "EUR")
        for end in ("2026-11-09", "2026-11-17", "not-a-date"):
            with self.subTest(end=end), self.assertRaises(ValidationError):
                research.DateQuery(**base, end_date=end)

    def test_evidence_and_errors_are_preserved(self):
        for result in ({"success": True, "flights": [{"price": 100, "currency": "XXX"}], "booking_url": "https://www.google.com/travel/flights"}, {"success": False, "error_type": "transport", "retryable": False}):
            with patch.object(research.upstream, "_execute_flight_search", return_value=result) as execute:
                actual = research.search_flights(self.flight())
                execute.assert_called_once()
                for key, value in result.items():
                    self.assertEqual(actual[key], value)
                self.assertIn("observedAt", actual)
                self.assertIn("limitations", actual)

    def test_concurrent_search_does_not_start_second_fetch(self):
        research.search_lock.acquire()
        try:
            with patch.object(research.upstream, "_execute_flight_search") as execute:
                self.assertEqual(research.search_flights(self.flight())["error_type"], "search_in_progress")
                execute.assert_not_called()
        finally:
            research.search_lock.release()

    def test_lock_released_on_exception(self):
        with patch.object(research.upstream, "_execute_flight_search", side_effect=ValueError("fixture")):
            with self.assertRaises(ValueError):
                research.search_flights(self.flight())
        self.assertFalse(research.search_lock.locked())


if __name__ == "__main__":
    unittest.main()
