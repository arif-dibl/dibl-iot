import os

# -------------------------
# OPENREMOTE & KEYCLOAK CONFIG
# -------------------------
OR_HOSTNAME = os.environ.get('OR_HOSTNAME', 'localhost')
OR_ADMIN_PASSWORD = os.getenv("OR_ADMIN_PASSWORD", "secret")
OR_MANAGER_URL = os.getenv("OR_MANAGER_URL", "http://manager:8080")
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080/auth")

# -------------------------
# PATH CONFIGURATION
# -------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_DIR = os.path.join(BASE_DIR, "config")
DATA_DIR = os.path.join(BASE_DIR, "data")

# Hardcoded Realm
DEFAULT_REALM = "dibl-iot"
PREFS_FILE = os.path.join(DATA_DIR, "user_preferences.json")
FRIENDLY_NAMES_FILE = os.path.join(CONFIG_DIR, "friendly_names.json")
IGNORED_USERS_FILE = os.path.join(CONFIG_DIR, "ignored_users.json")

# -------------------------
# ROLE CONFIGURATION
# -------------------------
ASSIGN_ROLE_READ_ALARMS = True
ASSIGN_ROLE_READ_ASSETS = True
ASSIGN_ROLE_READ_INSIGHTS = True
ASSIGN_ROLE_READ_LOGS = True
ASSIGN_ROLE_READ_RULES = True
ASSIGN_ROLE_READ_SERVICES = True
ASSIGN_ROLE_READ_USERS = True

ASSIGN_ROLE_WRITE_ALARMS = True
ASSIGN_ROLE_WRITE_ASSETS = True
ASSIGN_ROLE_WRITE_ATTRIBUTES = True
ASSIGN_ROLE_WRITE_INSIGHTS = True
ASSIGN_ROLE_WRITE_LOGS = True
ASSIGN_ROLE_WRITE_RULES = True
ASSIGN_ROLE_WRITE_SERVICES = True
ASSIGN_ROLE_WRITE_USER = True
