"""Regression tests for authoritative plan dates versus stale balance dates."""
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import win_ma


class BillingCycleTests(unittest.TestCase):
    def setUp(self):
        self.at = datetime(2026, 10, 28, 9, 28, tzinfo=timezone.utc)
        self.plan = {
            "type": "OFFER", "name": "Synthetic plan",
            "dateCycleStart": "2026-10-27T04:05:46.000+0000",
            "dateCycleEnd": "2026-11-27T04:05:46.000+0000",
        }
        self.internet = {
            "name": "Internet", "type": "OTHER",
            "dateCycleStart": "2026-09-27T04:04:32.000+0000",
            "dateCycleEnd": "2026-10-27T04:05:46.000+0000",
            "dateCycleFutureStart": "2026-10-27T04:05:46.000+0000",
            "dateCycleFutureEnd": "2026-11-27T04:05:46.000+0000",
            "balance": {
                "defaultValue": 20, "defaultUnitValue": "GB",
                "consumedValue": 13, "consumedUnit": "GB",
                "restValue": 7, "restUnit": "GB",
                "expireDate": "2026-11-27T04:05:46.000+0000",
            },
        }

    def test_current_plan_cycle_controls_pace_not_previous_balance_cycle(self):
        lines = win_ma.internet_lines(self.internet, self.plan, self.at)
        self.assertIn("13 / 20 GB", lines[0])
        self.assertIn("in deficit", lines[1])
        self.assertNotIn("in reserve", lines[1])

    def test_render_human_passes_the_offer_asset_to_internet_lines(self):
        data = {"offer": {"assets": [self.plan, self.internet]}}
        with patch.object(win_ma, "internet_lines", return_value=[]) as render:
            win_ma.render_human(data, "plan")
        render.assert_called_once_with(self.internet, self.plan)

    def test_missing_or_invalid_plan_dates_do_not_fall_back_to_balance_dates(self):
        for plan in (None, {}, {"dateCycleStart": "invalid", "dateCycleEnd": self.plan["dateCycleEnd"]}):
            with self.subTest(plan=plan):
                self.assertEqual(len(win_ma.internet_lines(self.internet, plan, self.at)), 1)

    def test_pace_is_hidden_outside_the_authoritative_cycle(self):
        start = self.plan["dateCycleStart"]
        end = self.plan["dateCycleEnd"]
        for at in (datetime(2026, 10, 26, tzinfo=timezone.utc), win_ma.parse_datetime(end)):
            with self.subTest(at=at):
                self.assertIsNone(win_ma.pace_line(20, 13, start, end, at))


if __name__ == "__main__":
    unittest.main()
