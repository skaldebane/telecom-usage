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
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


API_URL = "https://api.win.ma/api"
WEBSITE_URL = "https://win.ma/"
DEFAULT_CONFIG = Path(__file__).resolve().with_name("config.toml")
PROGRESS_WIDTH = 20


class CliError(Exception):
    pass


class ApiError(CliError):
    def __init__(self, status, detail):
        self.status = status
        self.detail = detail
        super().__init__(f"win API returned HTTP {status}: {detail}")


class InvalidCredentials(CliError):
    pass


class WinClient:
    def __init__(self, timeout=30):
        self.timeout = timeout

    def request(self, path, method="GET", body=None, token=None):
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Referer": WEBSITE_URL,
            "User-Agent": "Mozilla/5.0",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            API_URL + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method=method,
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
            raise CliError(f"Could not reach win API: {error.reason}") from error

        try:
            return json.loads(raw)
        except json.JSONDecodeError as error:
            raise CliError("win API returned an invalid response") from error

    def login(self, email, password):
        try:
            return self.request(
                "/v1/auth/login",
                method="POST",
                body={"email": email, "password": password},
            )
        except ApiError as error:
            if error.status in (400, 401, 403):
                raise InvalidCredentials("Email or password is incorrect.") from error
            raise

    def refresh(self, refresh_token):
        return self.request(
            "/v2/auth/refresh-token",
            method="POST",
            body={"token": refresh_token},
        )

    def subscriptions(self, access_token):
        return self.request("/v1/subscriptions", token=access_token)

    def offer_detail(self, subscription_id, access_token):
        return self.request(
            f"/v1/subscriptions/{subscription_id}/offer-detail",
            token=access_token,
        )

    def passes(self, subscription_id, access_token):
        return self.request(
            f"/v2/subscriptions/{subscription_id}/offer-detail/pass",
            token=access_token,
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


def atomic_write(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(contents)
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def save_config(path, email, password):
    atomic_write(
        path,
        f"email = {json.dumps(email, ensure_ascii=False)}\n"
        f"password = {json.dumps(password, ensure_ascii=False)}\n",
    )


def load_auth_state(path):
    try:
        with path.open(encoding="utf-8") as state_file:
            state = json.load(state_file)
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as error:
        raise CliError(f"Invalid auth state in {path}: {error}") from error
    return state if isinstance(state, dict) else {}


def save_auth_state(path, state):
    atomic_write(path, json.dumps(state, indent=2, ensure_ascii=False) + "\n")


def clear_auth_state(path):
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def confirm(question):
    return input(f"{question} [y/N] ").strip().lower() in ("y", "yes")


def jwt_expiration(token):
    try:
        encoded = token.split(".")[1]
        encoded += "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded))
        return float(payload["exp"])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return 0


def token_is_valid(token):
    return bool(token) and jwt_expiration(token) > datetime.now(timezone.utc).timestamp() + 30


def interactive_login(config_path, auth_path, current_email=""):
    while True:
        prompt = f"Email [{current_email}]: " if current_email else "Email: "
        email = input(prompt).strip() or current_email
        password = getpass.getpass("Password: ")
        if not email or not password:
            print("Email and password cannot be blank.", file=sys.stderr)
            continue

        client = WinClient()
        try:
            response = client.login(email, password)
        except InvalidCredentials as error:
            print(f"win: {error}", file=sys.stderr)
            if confirm("Try again?"):
                current_email = email
                continue
            raise CliError("Login cancelled.") from error

        save_config(config_path, email, password)
        save_auth_state(auth_path, {"tokens": response["tokens"], "account": response.get("account", {})})
        return client, response


def authenticated_data(config_path, auth_path):
    config = load_config(config_path)
    email = config["email"]
    password = config["password"]
    client = WinClient()
    state = load_auth_state(auth_path)
    tokens = state.get("tokens") or {}

    if not email or not password:
        client, response = interactive_login(config_path, auth_path, email)
        return client, response["tokens"]["accessToken"]

    if token_is_valid(tokens.get("accessToken")):
        return client, tokens["accessToken"]

    if tokens.get("refreshToken"):
        try:
            refreshed = client.refresh(tokens["refreshToken"])
            save_auth_state(auth_path, {"tokens": refreshed, "account": state.get("account", {})})
            return client, refreshed["accessToken"]
        except ApiError:
            pass

    try:
        response = client.login(email, password)
    except InvalidCredentials as error:
        print(f"win: {error}", file=sys.stderr)
        if not confirm(f"Login failed for {email}. Log in again?"):
            raise CliError("Login cancelled.") from error
        client, response = interactive_login(config_path, auth_path, email)
    else:
        save_auth_state(auth_path, {"tokens": response["tokens"], "account": response.get("account", {})})
    return client, response["tokens"]["accessToken"]


def fetch_data(config_path, auth_path):
    client, access_token = authenticated_data(config_path, auth_path)
    try:
        subscriptions = client.subscriptions(access_token)
    except ApiError as error:
        if error.status != 401:
            raise
        state = load_auth_state(auth_path)
        refreshed = client.refresh((state.get("tokens") or {}).get("refreshToken", ""))
        save_auth_state(auth_path, {"tokens": refreshed, "account": state.get("account", {})})
        access_token = refreshed["accessToken"]
        subscriptions = client.subscriptions(access_token)
    if not subscriptions:
        raise CliError("No active subscriptions found.")

    subscription = next(
        (item for item in subscriptions if item.get("status") == "ACTIVE"),
        subscriptions[0],
    )
    subscription_id = subscription.get("id")
    if not subscription_id:
        raise CliError("The win API returned a subscription without an ID.")
    return {
        "account": load_auth_state(auth_path).get("account", {}),
        "subscription": subscription,
        "offer": client.offer_detail(subscription_id, access_token),
        "passes": client.passes(subscription_id, access_token),
    }


def parse_datetime(value):
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%f%z")
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def format_datetime(value):
    parsed = parse_datetime(value)
    if parsed is None:
        return str(value)
    return parsed.astimezone().strftime("%Y-%m-%d %-I:%M %p")


def humanize_text(value):
    text = str(value)
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\bIllimites?\b", "Unlimited", folded, flags=re.IGNORECASE)


def numeric(value):
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


def balance_amount(balance, field, unit_field):
    value = numeric(balance.get(field))
    if value is None:
        return None
    unit = str(balance.get(unit_field) or "").upper()
    if unit in ("BYTE", "BYTES"):
        return value / 1_000_000_000
    if unit in ("MEGABYTE", "MEGABYTES", "MB"):
        return value / 1_000
    if unit in ("GIGABYTE", "GIGABYTES", "GB"):
        return value
    return value


def find_asset(assets, name):
    return next((asset for asset in assets if asset.get("name", "").lower() == name.lower()), None)


def format_number(value):
    return f"{value:.2f}".rstrip("0").rstrip(".")


def pace_line(total_gb, used_gb, cycle_start, cycle_end, observed_at=None):
    start = parse_datetime(cycle_start)
    end = parse_datetime(cycle_end)
    observed = observed_at or datetime.now(timezone.utc)
    if not start or not end or end <= start or total_gb <= 0:
        return None
    if observed < start or observed >= end:
        return None
    elapsed = max(0, min((observed - start).total_seconds(), (end - start).total_seconds()))
    expected = elapsed / (end - start).total_seconds() * 100
    actual = max(0, min(100, used_gb / total_gb * 100))
    delta = actual - expected
    if expected < 3:
        return None

    expected_gb = total_gb * expected / 100
    if abs(delta) <= 2:
        return f"  Pace: On pace - {int(expected + 0.5)}% expected ({format_number(expected_gb)} GB)"

    difference_gb = total_gb * abs(delta) / 100
    difference_percent = int(abs(delta) + 0.5)
    if delta > 0:
        status = f"{difference_percent}% in deficit ({format_number(difference_gb)} GB)"
    else:
        status = f"{difference_percent}% in reserve ({format_number(difference_gb)} GB)"
    return f"  Pace: {status} - {int(expected + 0.5)}% expected ({format_number(expected_gb)} GB)"


def internet_lines(asset, offer_asset=None, observed_at=None):
    balance = asset.get("balance") or {}
    total_gb = balance_amount(balance, "defaultValue", "defaultUnitValue")
    consumed_gb = balance_amount(balance, "consumedValue", "consumedUnit")
    remaining_gb = balance_amount(balance, "restValue", "restUnit")
    if consumed_gb is None and total_gb is not None and remaining_gb is not None:
        consumed_gb = max(0, total_gb - remaining_gb)
    if total_gb is None or consumed_gb is None or total_gb <= 0:
        return ["  Internet: Unavailable"]

    used_percent = max(0, min(100, consumed_gb / total_gb * 100))
    filled = round(used_percent / 100 * PROGRESS_WIDTH)
    bar = "█" * filled + "░" * (PROGRESS_WIDTH - filled)
    lines = [
        f"  Internet: [{bar}] {used_percent:.1f}% used "
        f"({format_number(consumed_gb)} / {format_number(total_gb)} GB)"
    ]
    # Internet balances may keep last cycle's dates after renewal. Billing
    # dates belong to the plan's OFFER asset, not its individual balances.
    cycle = offer_asset or {}
    pace = pace_line(total_gb, consumed_gb, cycle.get("dateCycleStart"), cycle.get("dateCycleEnd"), observed_at)
    if pace:
        lines.append(pace)
    return lines


def format_duration(seconds):
    seconds = max(0, int(seconds or 0))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    parts = []
    if hours or not parts:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}min")
    if seconds:
        parts.append(f"{seconds}s")
    return " ".join(parts)


def human_balance_line(asset):
    name = asset.get("name", "")
    balance = asset.get("balance") or {}
    name_lower = name.lower()
    if "sms" in name_lower:
        value = "Unlimited" if balance.get("unlimited") else f"{format_number(numeric(balance.get('restValue')) or 0)} SMS"
        return f"  SMS: {value}"
    if "appel" in name_lower:
        seconds = numeric(balance.get("restValue")) or 0
        if str(balance.get("restUnit") or "").upper() in ("HOUR", "HOURS"):
            seconds *= 3600
        return f"  Calls: {format_duration(seconds)}"
    if "reseaux sociaux" in humanize_text(name).lower():
        if balance.get("unlimited"):
            return "  Social networks: Unlimited"
        return None
    return None


def render_human(data, command="all"):
    offer = data["offer"]
    assets = offer.get("assets") or []
    offer_asset = next((asset for asset in assets if asset.get("type") == "OFFER"), None)
    internet = find_asset(assets, "Internet")
    lines = [humanize_text((offer_asset or {}).get("name") or "win")]

    if command in ("all", "plan"):
        lines.extend(("", "Plan"))
        plan_lines = []
        if internet:
            plan_lines.extend(internet_lines(internet, offer_asset))

        calls_line = None
        sms_line = None
        other_lines = []
        for asset in assets:
            if asset is internet or asset.get("type") == "SIM":
                continue
            balance_line = human_balance_line(asset)
            if not balance_line:
                continue
            if balance_line.startswith("  Calls:"):
                calls_line = balance_line
            elif balance_line.startswith("  SMS:"):
                sms_line = balance_line
            else:
                other_lines.append(balance_line)

        if plan_lines and (calls_line or sms_line or other_lines):
            plan_lines.append("")
        plan_lines.extend(line for line in (calls_line, sms_line, *other_lines) if line)
        lines.extend(plan_lines or ["  No plan balances."])

    if command in ("all", "topups"):
        lines.extend(("", "Top-ups:"))
        topup_lines = []
        for group in data.get("passes") or []:
            for balance in group.get("balances") or []:
                remaining = balance_amount(balance, "restValue", "restUnit")
                if remaining and remaining > 0:
                    label = humanize_text(group.get("name") or balance.get("labelBalanceFr") or "Top-up")
                    topup_lines.append(f"  {label}: {format_number(remaining)} GB")
        lines.extend(topup_lines or ["  No top-up balances."])
    lines.extend(("", f"Updated: {datetime.now().astimezone().strftime('%Y-%m-%d %-I:%M %p')}"))
    return "\n".join(lines)


def without_secrets(value):
    if isinstance(value, dict):
        return {
            key: without_secrets(item)
            for key, item in value.items()
            if key.lower() not in {"password", "puk", "accesstoken", "refreshtoken"}
        }
    if isinstance(value, list):
        return [without_secrets(item) for item in value]
    return value


def parse_args():
    parser = argparse.ArgumentParser(
        prog="win",
        description="Show win by inwi plan and top-up balances.",
    )
    parser.add_argument("command", nargs="?", choices=("all", "plan", "topups", "login", "logout"), default="all")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help=f"TOML credentials file (default: {DEFAULT_CONFIG})")
    parser.add_argument("--json", action="store_true", help="print JSON")
    return parser.parse_args()


def main():
    args = parse_args()
    auth_path = args.config.with_name("auth-state.json")
    try:
        config = load_config(args.config)
        if args.command == "logout":
            if not config["email"] or not config["password"]:
                print("Not logged in.")
                return 0
            if not confirm(f"Log out {config['email']}?"):
                print("Logout cancelled.")
                return 0
            save_config(args.config, "", "")
            clear_auth_state(auth_path)
            print("Logged out.")
            return 0

        if args.command == "login":
            if config["email"] and config["password"] and not confirm(
                f"Already logged in as {config['email']}. Log in again?"
            ):
                print("Login unchanged.")
                return 0
            client, response = interactive_login(args.config, auth_path, config["email"])
            account = response.get("account") or {}
            print(f"Logged in as {account.get('firstName', '')} {account.get('lastName', '')}".strip() + ".")
            return 0

        data = fetch_data(args.config, auth_path)
        if args.json:
            if args.command == "plan":
                data = {key: data[key] for key in ("account", "subscription", "offer")}
            elif args.command == "topups":
                data = {key: data[key] for key in ("account", "subscription", "passes")}
            print(json.dumps(without_secrets(data), indent=2, ensure_ascii=False))
        else:
            print(render_human(data, args.command))
    except (EOFError, KeyboardInterrupt):
        print("\nwin: Cancelled.", file=sys.stderr)
        return 1
    except CliError as error:
        print(f"win: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
