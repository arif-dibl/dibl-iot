import os
import json
from core.config import PREFS_FILE

def load_preferences():
    if os.path.exists(PREFS_FILE):
        try:
            with open(PREFS_FILE, "r") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_preferences(data):
    try:
        with open(PREFS_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[PREFS] Save error: {e}")

def get_friendly_names():
    try:
        if os.path.exists("friendly_names.json"):
            with open("friendly_names.json", "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"[API] Error loading friendly names: {e}")
    return {"attributes": {}, "keys": {}}
