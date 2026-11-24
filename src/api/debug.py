import csv
import io
import json
import math
import os
import re
import zipfile
from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Request
from fastapi.responses import Response

from core.auth import get_valid_token
from core.config import DEFAULT_REALM, FRIENDLY_NAMES_FILE, OR_HOSTNAME, OR_MANAGER_URL

router = APIRouter(prefix="/api/debug", tags=["debug"])

# Bangladesh Standard Time (Dhaka, permanent UTC+6, no DST)
DHAKA_TZ = timezone(timedelta(hours=6))

PLACEHOLDER_STRINGS = {
    "",
    "--",
    "-",
    "N/A",
    "NA",
    "NONE",
    "NULL",
    "UNDEFINED",
    "NAN",
}


def _is_placeholder(val) -> bool:
    """Return True if value is empty or a known placeholder (never treats False or 0 as placeholder)."""
    if val is None:
        return True
    if isinstance(val, bool):
        return False
    if isinstance(val, float):
        return math.isnan(val)
    if isinstance(val, int):
        return False
    s = str(val).strip()
    return s.upper() in PLACEHOLDER_STRINGS


def _parse_state_bool(val):
    """Parse relay/valve state values: true/false, on/off, high/low (case-insensitive).
    Explicitly does NOT convert numeric 1/0 to boolean."""
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        s = val.strip().lower()
        if s in ("true", "on", "high"):
            return True
        if s in ("false", "off", "low"):
            return False
    return None


def _format_export_value(val):
    """Format a scalar datapoint value for CSV export. Returns None if placeholder."""
    if _is_placeholder(val):
        return None
    state = _parse_state_bool(val)
    if state is not None:
        return "ON" if state else "OFF"
    if isinstance(val, (dict, list)):
        return json.dumps(val, ensure_ascii=False)
    return str(val).strip()


def _try_parse_json_dict(raw_val):
    """Parse a JSON object string (including double-encoded JSON strings) into a dict."""
    if isinstance(raw_val, dict):
        return raw_val
    if not isinstance(raw_val, str):
        return None
    s = raw_val.strip()
    if not s:
        return None
    try:
        parsed = json.loads(s)
        if isinstance(parsed, str):
            inner = parsed.strip()
            if inner.startswith("{"):
                parsed = json.loads(inner)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None


def _strip_json_scalar_quotes(raw_val):
    """Unwrap JSON-encoded scalar strings like '\"true\"' or '\"25.4\"' if present."""
    if not isinstance(raw_val, str):
        return raw_val
    s = raw_val.strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        try:
            unwrapped = json.loads(s)
            if not isinstance(unwrapped, (dict, list)):
                return unwrapped
        except Exception:
            pass
    return s


def _parse_timestamp_ms(raw_ts):
    """Parse OpenRemote export timestamps (epoch ms, epoch s, or ISO/Postgres datetime) into epoch ms."""
    if raw_ts is None:
        return None
    if isinstance(raw_ts, (int, float)):
        if math.isnan(raw_ts):
            return None
        num = float(raw_ts)
        return int(num) if abs(num) >= 1e11 else int(num * 1000)

    s = str(raw_ts).strip().lstrip("\ufeff")
    if not s:
        return None

    # Numeric epoch string
    try:
        num = float(s)
        if not math.isnan(num):
            return int(num) if abs(num) >= 1e11 else int(num * 1000)
    except ValueError:
        pass

    # ISO-8601 / PostgreSQL timestamp string
    iso = s.replace(" ", "T")
    if iso.endswith("Z") or iso.endswith("z"):
        iso = iso[:-1] + "+00:00"
    elif re.search(r"[+-]\d{2}$", iso):
        iso = iso + ":00"
    elif re.search(r"[+-]\d{4}$", iso):
        iso = iso[:-2] + ":" + iso[-2:]

    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def _format_dhaka_date_time(ts_ms: int):
    """Format epoch milliseconds into (Date, Time) in Asia/Dhaka (UTC+6)."""
    dt = datetime.fromtimestamp(ts_ms / 1000.0, tz=DHAKA_TZ)
    return dt.strftime("%d %b %Y"), dt.strftime("%I:%M:%S %p")


def _natural_sort_key(text: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", str(text))]


def _load_friendly_names() -> dict:
    try:
        if os.path.exists(FRIENDLY_NAMES_FILE):
            with open(FRIENDLY_NAMES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(f"[DEBUG PROXY] Failed to load friendly names: {e}")
    return {"attributes": {}, "keys": {}}


def _resolve_column_header(key: str, labels_map: dict, units_map: dict, friendly_names: dict) -> str:
    label = None
    if isinstance(labels_map, dict) and labels_map.get(key):
        label = str(labels_map[key]).strip()
    if not label:
        keys_map = friendly_names.get("keys", {})
        attrs_map = friendly_names.get("attributes", {})
        label = keys_map.get(key) or attrs_map.get(key) or key

    unit = ""
    if isinstance(units_map, dict) and units_map.get(key):
        unit = str(units_map[key]).strip()

    return f"{label} ({unit})" if unit else label


def _sanitize_filename_part(text: str, fallback: str = "export") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", str(text or "").strip()).strip("_")
    return cleaned[:60] if cleaned else fallback


def _parse_csv_text_rows(csv_text: str):
    """Parse a CSV string from OpenRemote export into a list of (ts_ms, raw_value) tuples."""
    rows = []
    reader = csv.reader(io.StringIO(csv_text))
    ts_idx = None
    val_idx = None
    first_row = True

    for row in reader:
        if not row or not any(cell.strip() for cell in row):
            continue

        if first_row:
            first_row = False
            norm = [c.strip().lower().lstrip("\ufeff") for c in row]

            # Detect header columns by name
            detected_ts = None
            detected_val = None
            for idx, col in enumerate(norm):
                if detected_ts is None and col in ("timestamp", "time", "date", "datetime", "date/time", "x"):
                    detected_ts = idx
                if detected_val is None and col in ("value", "val", "y"):
                    detected_val = idx

            if detected_ts is not None and detected_val is not None:
                ts_idx = detected_ts
                val_idx = detected_val
                continue  # Header row consumed

            # If first row is not parseable as timestamp in col 0, treat it as a header row
            if _parse_timestamp_ms(row[0]) is None:
                ts_idx = 0
                val_idx = len(row) - 1 if len(row) >= 2 else 0
                continue

            # Headerless CSV fallback
            ts_idx = 0
            if len(row) >= 4:
                val_idx = 3
            elif len(row) == 3:
                val_idx = 2
            elif len(row) == 2:
                val_idx = 1
            else:
                continue

        if ts_idx is None or val_idx is None:
            continue
        if len(row) <= max(ts_idx, val_idx):
            continue

        ts_ms = _parse_timestamp_ms(row[ts_idx])
        if ts_ms is None:
            continue

        rows.append((ts_ms, row[val_idx]))

    return rows


def _extract_rows_from_export_bytes(raw_bytes: bytes):
    """Extract (ts_ms, raw_value) tuples from OpenRemote export bytes (ZIP or plain CSV)."""
    if not raw_bytes:
        return []

    all_rows = []
    if raw_bytes.startswith(b"PK\x03\x04") or raw_bytes.startswith(b"PK\x05\x06"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    fname = info.filename
                    if fname.startswith("__MACOSX/") or os.path.basename(fname).startswith("."):
                        continue
                    if not fname.lower().endswith(".csv"):
                        continue
                    with zf.open(info, "r") as f:
                        text = f.read().decode("utf-8-sig", errors="replace")
                        all_rows.extend(_parse_csv_text_rows(text))
        except zipfile.BadZipFile:
            pass
    else:
        text = raw_bytes.decode("utf-8-sig", errors="replace")
        all_rows.extend(_parse_csv_text_rows(text))

    return all_rows


def _build_clean_csv(raw_bytes: bytes, export_options: dict):
    """Transform OpenRemote exported ZIP/CSV bytes into a clean UTF-8-BOM CSV in Dhaka time.
    Returns (csv_bytes, row_count, filename)."""
    rows = _extract_rows_from_export_bytes(raw_bytes)
    rows.sort(key=lambda item: item[0])

    attr_name = str(export_options.get("attributeName") or "Data").strip()
    sub_attr = str(export_options.get("subAttribute") or "").strip()
    device_name = str(export_options.get("deviceName") or "device").strip()
    range_label = str(export_options.get("rangeLabel") or "").strip()
    labels_map = export_options.get("labels") or {}
    units_map = export_options.get("units") or {}
    key_order = export_options.get("keyOrder") or []
    friendly_names = _load_friendly_names()

    output = io.StringIO()
    writer = csv.writer(output)
    written_rows = 0

    if sub_attr:
        # Single element extracted from a grouped textMap attribute
        col_header = _resolve_column_header(sub_attr, labels_map, units_map, friendly_names)
        writer.writerow(["Date (Dhaka)", "Time (Dhaka)", col_header])

        for ts_ms, raw_val in rows:
            parsed_dict = _try_parse_json_dict(raw_val)
            if parsed_dict is None or sub_attr not in parsed_dict:
                continue
            formatted = _format_export_value(parsed_dict.get(sub_attr))
            if formatted is None:
                continue
            date_str, time_str = _format_dhaka_date_time(ts_ms)
            writer.writerow([date_str, time_str, formatted])
            written_rows += 1
    else:
        # Determine whether rows contain grouped JSON textMap objects or scalar/primitive values
        parsed_dicts = []
        has_json_objects = False
        for ts_ms, raw_val in rows:
            d = _try_parse_json_dict(raw_val)
            if d is not None:
                has_json_objects = True
            parsed_dicts.append((ts_ms, raw_val, d))

        if has_json_objects:
            # Ungroup textMap into separate columns, keeping ONLY active non-placeholder keys & rows
            cleaned_records = []
            discovered_keys = set()

            for ts_ms, _raw_val, d in parsed_dicts:
                if d is None:
                    continue
                cleaned_row = {}
                for k, v in d.items():
                    formatted = _format_export_value(v)
                    if formatted is not None:
                        cleaned_row[k] = formatted
                        discovered_keys.add(k)
                if cleaned_row:
                    cleaned_records.append((ts_ms, cleaned_row))

            # Order columns using preferred key_order, then natural sort for any extra keys
            ordered_keys = [k for k in key_order if k in discovered_keys]
            remaining_keys = sorted(discovered_keys - set(ordered_keys), key=_natural_sort_key)
            active_keys = ordered_keys + remaining_keys

            headers = ["Date (Dhaka)", "Time (Dhaka)"] + [
                _resolve_column_header(k, labels_map, units_map, friendly_names)
                for k in active_keys
            ]
            writer.writerow(headers)

            for ts_ms, cleaned_row in cleaned_records:
                date_str, time_str = _format_dhaka_date_time(ts_ms)
                writer.writerow([date_str, time_str] + [cleaned_row.get(k, "") for k in active_keys])
                written_rows += 1
        else:
            # Primitive / standalone attribute (e.g., ValveState1, ValveState2)
            col_header = _resolve_column_header(attr_name, labels_map, units_map, friendly_names)
            writer.writerow(["Date (Dhaka)", "Time (Dhaka)", col_header])

            for ts_ms, raw_val, _d in parsed_dicts:
                unwrapped = _strip_json_scalar_quotes(raw_val)
                formatted = _format_export_value(unwrapped)
                if formatted is None:
                    continue
                date_str, time_str = _format_dhaka_date_time(ts_ms)
                writer.writerow([date_str, time_str, formatted])
                written_rows += 1

    # Build clean ASCII filename for Content-Disposition
    parts = [_sanitize_filename_part(device_name, "device"), _sanitize_filename_part(attr_name, "history")]
    if sub_attr:
        parts.append(_sanitize_filename_part(sub_attr, "element"))
    if range_label:
        parts.append(_sanitize_filename_part(range_label, ""))
    filename = "_".join(p for p in parts if p) + ".csv"

    if written_rows == 0:
        return None, 0, filename

    # UTF-8 with BOM (utf-8-sig) so Excel opens °C, µS/cm, and Bangla custom names cleanly
    csv_bytes = output.getvalue().encode("utf-8-sig")
    return csv_bytes, written_rows, filename


def _clean_datapoint_list(raw_data, filter_options: dict):
    """Filter '--' / placeholder entries server-side before returning JSON to the browser.
    Dramatically shrinks payload size (e.g. 17 MB raw textMap -> ~1.7 MB active readings)."""
    if not isinstance(raw_data, list):
        return raw_data

    sub_attr = str(filter_options.get("subAttribute") or "").strip()
    cleaned = []

    if sub_attr:
        for pt in raw_data:
            if not isinstance(pt, dict) or "x" not in pt:
                continue
            parsed = _try_parse_json_dict(pt.get("y"))
            if parsed is None or sub_attr not in parsed:
                continue
            sub_val = parsed.get(sub_attr)
            if _is_placeholder(sub_val):
                continue
            cleaned.append({"x": pt["x"], "y": sub_val})
    else:
        for pt in raw_data:
            if not isinstance(pt, dict) or "x" not in pt:
                continue
            raw_y = pt.get("y")
            parsed = _try_parse_json_dict(raw_y)
            if parsed is not None:
                filtered_obj = {k: v for k, v in parsed.items() if not _is_placeholder(v)}
                if filtered_obj:
                    cleaned.append({"x": pt["x"], "y": filtered_obj})
            elif not _is_placeholder(raw_y):
                cleaned.append({"x": pt["x"], "y": raw_y})

    return cleaned


def _extract_safe_error_detail(res) -> str:
    """Extract a short sanitized diagnostic message from an upstream OpenRemote error."""
    try:
        err_json = res.json()
        if isinstance(err_json, dict):
            for key in ("error", "message", "detail", "title"):
                val = err_json.get(key)
                if val and isinstance(val, str):
                    return val.strip()[:160]
    except Exception:
        pass
    text = (res.text or "").strip()
    if text and not text.lstrip().startswith("<"):
        return re.sub(r"\s+", " ", text)[:160]
    return ""


@router.post("/proxy")
async def debug_proxy(username: str, request: Request, payload: dict):
    realm = request.session.get("realm", DEFAULT_REALM)
    access_token = get_valid_token(request)

    if not access_token:
        return {"status": 401, "data": "No access token found in session"}

    endpoint = payload.get("endpoint", "")
    method = payload.get("method", "GET").upper()
    body = payload.get("body")
    export_options = payload.get("exportOptions")
    filter_options = payload.get("filterOptions")

    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    url = f"{OR_MANAGER_URL}{endpoint}"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Host": OR_HOSTNAME,
    }
    if isinstance(export_options, dict) and export_options.get("mode") == "clean_csv":
        headers["Accept"] = "application/zip, text/csv, application/json, */*"

    try:
        if method == "GET":
            res = requests.get(url, headers=headers)
        elif method == "POST":
            res = requests.post(url, json=body, headers=headers)
        elif method == "PUT":
            res = requests.put(url, json=body, headers=headers)
        elif method == "DELETE":
            res = requests.delete(url, headers=headers)
        else:
            return {"status": 400, "data": "Method not supported"}

        if res.status_code >= 400:
            detail = _extract_safe_error_detail(res)
            print(f"[DEBUG PROXY] Upstream error {res.status_code} on {endpoint}: {res.text[:250]}")
            resp_payload = {"status": res.status_code, "data": "Unable to complete request."}
            if detail:
                resp_payload["detail"] = detail
            return resp_payload

        # Clean CSV transformation mode for History Logs export (in-memory 5B)
        if isinstance(export_options, dict) and export_options.get("mode") == "clean_csv":
            if res.status_code == 204 or not res.content:
                return {
                    "status": 200,
                    "empty": True,
                    "data": "No recorded data found for the selected time range.",
                }

            csv_bytes, row_count, filename = _build_clean_csv(res.content, export_options)
            if row_count == 0 or not csv_bytes:
                return {
                    "status": 200,
                    "empty": True,
                    "data": "No valid sensor readings found for the selected time range.",
                }

            return Response(
                content=csv_bytes,
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Export-Row-Count": str(row_count),
                },
            )

        # Default binary passthrough (preserves backward compatibility for Test API / raw proxy)
        content_type = res.headers.get("Content-Type", "")
        is_zip = res.content.startswith(b"PK\x03\x04")

        if "application/zip" in content_type or "application/octet-stream" in content_type or is_zip:
            media_type = content_type if content_type else "application/zip"
            filename = "export.zip"

            cd = res.headers.get("Content-Disposition", "")
            if "filename=" in cd:
                try:
                    filename = cd.split("filename=")[1].strip('"')
                except Exception:
                    pass

            return Response(
                content=res.content,
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        try:
            data = res.json()
        except Exception:
            data = res.text

        # Server-side placeholder filtering for History Logs Fetch Data
        if isinstance(filter_options, dict) and filter_options.get("mode") == "clean_datapoints":
            data = _clean_datapoint_list(data, filter_options)

        return {"status": res.status_code, "data": data}
    except Exception as e:
        print(f"[DEBUG PROXY] Error on {endpoint}: {e}")
        return {"status": 500, "data": "Service temporarily unavailable."}
