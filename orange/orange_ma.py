#!/usr/bin/env python3
import argparse
import base64
import getpass
import json
import os
import re
import sys
import tempfile
import tomllib
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


BASE_URL = "https://maxit.orange.ma"
API_VERSION = "v10.9"
DEFAULT_CONFIG = Path(__file__).resolve().with_name("config.toml")
MOROCCO_TIMEZONE = ZoneInfo("Africa/Casablanca")
PROGRESS_WIDTH = 20


class CliError(Exception):
    pass


class ApiError(CliError):
    def __init__(self, status, detail):
        self.status = status
        self.detail = detail
        super().__init__(f"Orange API returned HTTP {status}: {detail}")


class InvalidCredentials(CliError):
    pass


class MaxItClient:
    def __init__(self, email, password, timeout=30):
        self.email = email
        self.password = password
        self.timeout = timeout
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Maxit/10.9.0",
            "X-OS": "android",
            "X-OS-Version": "Android 12",
            "X-OS-Model": "SM-A115F",
            "X-firebase-Id": "",
            "X-Line-Type": "PO",
        }

    def _request(self, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            BASE_URL + path,
            data=data,
            headers=self.headers | (headers or {}),
            method="POST" if body is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace").strip()
            try:
                payload = json.loads(detail)
                detail = payload.get("message") or payload.get("error") or detail
            except (json.JSONDecodeError, AttributeError):
                pass
            raise ApiError(error.code, detail) from error
        except urllib.error.URLError as error:
            raise CliError(f"Could not reach Orange API: {error.reason}") from error

        try:
            return json.loads(raw)
        except json.JSONDecodeError as error:
            raise CliError("Orange API returned an invalid response") from error

    def login(self):
        try:
            user = self._request(
                f"/moncompte/{API_VERSION}/login",
                {
                    "login": self.email,
                    "password": base64.b64encode(self.password.encode()).decode(),
                    "culture": "fr",
                    "remember_me": True,
                    "channel": 2,
                    "checkByEmail": True,
                },
            )
        except ApiError as error:
            if error.status in (400, 401, 403):
                raise InvalidCredentials("Email or password is incorrect.") from error
            raise

        try:
            user["token"]
            user["msisdn"]
        except (KeyError, TypeError) as error:
            raise CliError("Login response did not contain a session token and line number") from error
        return user

    def balances(self, user):
        return self._request(
            f"/fiche-client/{API_VERSION}/balances/{user['msisdn']}",
            headers={
                "Accept-Language": user.get("language", "fr"),
                "X-SSO-TOKEN": user["token"],
            },
        )


def load_config(path):
    try:
        with path.open("rb") as config_file:
            config = tomllib.load(config_file)
    except FileNotFoundError:
        return {"email": "", "password": ""}
    except tomllib.TOMLDecodeError as error:
        raise CliError(f"Invalid TOML in {path}: {error}") from error
    return {
        "email": str(config.get("email") or ""),
        "password": str(config.get("password") or ""),
    }


def save_config(path, email, password):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as config_file:
            config_file.write(f"email = {json.dumps(email, ensure_ascii=False)}\n")
            config_file.write(f"password = {json.dumps(password, ensure_ascii=False)}\n")
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def confirm(question):
    return input(f"{question} [y/N] ").strip().lower() in ("y", "yes")


def interactive_login(config_path, current_email=""):
    while True:
        prompt = f"Email [{current_email}]: " if current_email else "Email: "
        email = input(prompt).strip() or current_email
        password = getpass.getpass("Password: ")
        if not email or not password:
            print("Email and password cannot be blank.", file=sys.stderr)
            continue

        client = MaxItClient(email, password)
        try:
            user = client.login()
        except InvalidCredentials as error:
            print(f"orange: {error}", file=sys.stderr)
            if confirm("Try again?"):
                current_email = email
                continue
            raise CliError("Login cancelled.") from error

        save_config(config_path, email, password)
        return client, user


def selected_balance(balance, command):
    metadata = {
        key: balance[key]
        for key in ("msisdn", "balanceAt", "billingCycle", "tariffPlan")
        if key in balance
    }
    if command in ("all", "plan"):
        metadata["items"] = balance.get("items", [])
    if command in ("all", "topups"):
        metadata["categories"] = balance.get("categories", [])
    return metadata


def balance_value_text(value):
    if not isinstance(value, dict):
        return ""
    amount = value.get("value")
    if amount is None:
        return ""
    return f"{amount} {value.get('unit', '')}".strip()


def item_text(item):
    if item.get("message"):
        text = item["message"]
    elif item.get("rawValue"):
        text = item["rawValue"]
    else:
        values = item.get("valueItems") or []
        text = " ".join(balance_value_text(value) for value in values).strip()

    gauge = item.get("gauge") or {}
    consumed = balance_value_text(gauge.get("consumed"))
    initial = balance_value_text(gauge.get("initial"))
    if consumed and initial:
        text = f"{text or 'Usage'} (used {consumed} of {initial})"
    elif gauge.get("consumedPercentage"):
        text = f"{text or 'Usage'} ({gauge['consumedPercentage']} used)"
    return humanize_text(text or "Unavailable")


def humanize_text(text):
    return re.sub(r"\bIllimit(?:e|é)s?\b", "Unlimited", str(text), flags=re.IGNORECASE)


def subscription_total_gb(plan_name):
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:GO|GB)\b", plan_name or "", re.IGNORECASE)
    return float(match.group(1).replace(",", ".")) if match else None


def item_data_gb(item):
    factors = {"GO": 1, "GB": 1, "MO": 1 / 1024, "MB": 1 / 1024}
    for value in item.get("valueItems") or []:
        unit = str(value.get("unit") or "").upper()
        if unit in factors:
            try:
                return float(str(value["value"]).replace(",", ".")) * factors[unit]
            except (KeyError, ValueError):
                return None

    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(GO|GB|MO|MB)\b", item.get("rawValue") or "", re.IGNORECASE)
    if not match:
        return None
    return float(match.group(1).replace(",", ".")) * factors[match.group(2).upper()]


def monthly_pace(total_gb, remaining_gb, observed_at):
    if not observed_at:
        return None
    observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=MOROCCO_TIMEZONE)
    else:
        observed = observed.astimezone(MOROCCO_TIMEZONE)

    start = observed.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)

    elapsed = observed.timestamp() - start.timestamp()
    duration = end.timestamp() - start.timestamp()
    expected = max(0, min(100, elapsed / duration * 100))
    actual = max(0, min(100, (total_gb - remaining_gb) / total_gb * 100))
    return actual - expected, expected


def format_number(value):
    return f"{value:.2f}".rstrip("0").rstrip(".")


def format_updated_at(value):
    try:
        updated_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=MOROCCO_TIMEZONE)
        return updated_at.astimezone().strftime("%Y-%m-%d %-I:%M %p")
    except (AttributeError, ValueError):
        return str(value)


def internet_lines(item, total_gb, observed_at):
    remaining_gb = item_data_gb(item)
    if remaining_gb is None or not total_gb:
        return [f"Internet: {item_text(item)}"]

    used_gb = max(0, total_gb - remaining_gb)
    used_percent = max(0, min(100, used_gb / total_gb * 100))
    filled = round(used_percent / 100 * PROGRESS_WIDTH)
    bar = "█" * filled + "░" * (PROGRESS_WIDTH - filled)
    lines = [
        f"  Internet: [{bar}] {used_percent:.1f}% used "
        f"({format_number(used_gb)} / {format_number(total_gb)} GB)"
    ]

    pace = monthly_pace(total_gb, remaining_gb, observed_at)
    if pace is not None:
        delta, expected = pace
        if expected >= 3:
            if abs(delta) <= 2:
                description = "On pace"
            elif delta > 0:
                difference_gb = total_gb * abs(delta) / 100
                description = (
                    f"{int(abs(delta) + 0.5)}% in deficit ({format_number(difference_gb)} GB)"
                )
            else:
                difference_gb = total_gb * abs(delta) / 100
                description = (
                    f"{int(abs(delta) + 0.5)}% in reserve ({format_number(difference_gb)} GB)"
                )
            expected_gb = total_gb * expected / 100
            lines.append(
                f"  Pace: {description} - {int(expected + 0.5)}% expected "
                f"({format_number(expected_gb)} GB)"
            )
    return lines


def item_label(item):
    units = {str(value.get("unit") or "").upper() for value in item.get("valueItems") or []}
    if units & {"H", "MIN", "S"}:
        return "Calls"
    if "SMS" in (item.get("message") or "").upper():
        return "SMS"
    return "Balance"


def render_human(balance, command):
    lines = []
    tariff_plan = balance.get("tariffPlan")
    if tariff_plan:
        lines.append(str(tariff_plan))

    if command in ("all", "plan"):
        if lines:
            lines.append("")
        lines.append("Plan")
        items = balance.get("items", [])
        internet_item = next((item for item in items if item_data_gb(item) is not None), None)
        if internet_item:
            lines.extend(
                internet_lines(
                    internet_item,
                    subscription_total_gb(tariff_plan),
                    balance.get("balanceAt"),
                )
            )
            if len(items) > 1:
                lines.append("")
        for item in items:
            if item is internet_item:
                continue
            value = humanize_text(item.get("rawValue")) if item.get("rawValue") else item_text(item)
            lines.append(f"  {item_label(item)}: {value}")
        if not items:
            lines.append("  No plan balances.")

    if command in ("all", "topups"):
        if lines:
            lines.append("")
        lines.append("Top-ups:")
        categories = balance.get("categories", [])
        if not categories:
            lines.append("  No top-up balances.")
        for category in categories:
            lines.append(f"  {humanize_text(category.get('name') or 'Additional balance')}")
            items = category.get("items", [])
            lines.extend(f"    {item_text(item)}" for item in items)
            if not items:
                lines.append("    No balances.")

    if balance.get("balanceAt"):
        lines.extend(("", f"Updated: {format_updated_at(balance['balanceAt'])}"))
    return "\n".join(lines)


def parse_args():
    parser = argparse.ArgumentParser(
        prog="orange",
        description="Show Orange Maroc plan and top-up balances.",
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=("all", "plan", "topups", "login", "logout"),
        default="all",
        help="balance section to show (default: all)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"TOML credentials file (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument("--json", action="store_true", help="print JSON")
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        config = load_config(args.config)
        email = config["email"]
        password = config["password"]

        if args.command == "logout":
            if not email or not password:
                print("Not logged in.")
                return 0
            if not confirm(f"Log out {email}?"):
                print("Logout cancelled.")
                return 0
            save_config(args.config, "", "")
            print("Logged out.")
            return 0

        if args.command == "login":
            if email and password and not confirm(f"Already logged in as {email}. Log in again?"):
                print("Login unchanged.")
                return 0
            client, _ = interactive_login(args.config, email)
            print(f"Logged in as {client.email}.")
            return 0

        if not email or not password:
            client, user = interactive_login(args.config, email)
        else:
            client = MaxItClient(email, password)
            try:
                user = client.login()
            except InvalidCredentials as error:
                print(f"orange: {error}", file=sys.stderr)
                if not confirm(f"Login failed for {email}. Log in again?"):
                    raise CliError("Login cancelled.") from error
                client, user = interactive_login(args.config, email)

        balance = client.balances(user)
        if args.json:
            print(json.dumps(selected_balance(balance, args.command), indent=2, ensure_ascii=False))
        else:
            print(render_human(balance, args.command))
    except (EOFError, KeyboardInterrupt):
        print("\norange: Cancelled.", file=sys.stderr)
        return 1
    except CliError as error:
        print(f"orange: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
