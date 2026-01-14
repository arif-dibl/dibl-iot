# DIBL IoT Custom UI

A custom Internet of Things (IoT) user interface built for the DIBL platform, designed to interact with an OpenRemote backend. This application provides a user-friendly dashboard for monitoring environmental sensors (NPK, Moisture, Environment), controlling actuators (relays), managing automation rules, and visualizing historical data.

## Project Overview

The **DIBL IoT Custom UI** serves as a specialized frontend for end-users, abstracted away from the complexity of the core OpenRemote Manager. It features a responsive design, role-based access control (proxying permissions), and specific workflows for device linking and configuration.

### Key Features
*   **Interactive Dashboard:** Real-time monitoring of connected assets with status indicators.
*   **Asset Management:** Link/Unlink IoT devices (assets) to user accounts securely.
*   **Device Control:** Manual control of relay switches with real-time feedback.
*   **Automation Rules:** Custom "If This Then That" style rules engine for sensor-based automation.
*   **Timers & Scheduling:** Configure detailed ON/OFF schedules for devices.
*   **Historical Data:** View and export sensor data logs (Table, Chart, JSON formats).
*   **Profile Management:** User profile updates and password management via Keycloak integration.
*   **Custom Maps:** Map visualization support with configurable layers.

## Technology Stack

*   **Backend:** Python 3.9, FastAPI
*   **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+)
*   **Templating:** Jinja2
*   **Containerization:** Docker, Docker Compose
*   **IoT Platform:** OpenRemote (Manager, Keycloak, PostgreSQL, Proxy)

## Project Structure

```
DIBL_IOT/
├── config/                 # Configuration files
│   ├── asset_template.json # Template for new device provisioning
│   ├── friendly_names.json # UI display name mappings
│   └── ignored_users.json  # User filter configs
├── deploy/
│   └── Dockerfile          # Build definition for Custom UI service
├── src/                    # Application Source Code
│   ├── api/                # API Route Handlers (Assets, Users, Rules)
│   ├── core/               # Core Logic (Auth, Config, Utils)
│   ├── routes/             # HTML/Page Route Handlers
│   ├── static/             # Static Assets (CSS, JS, Images)
│   ├── templates/          # Jinja2 HTML Templates
│   └── main.py             # FastAPI Entry Point
└── docker-compose.yml      # Orchestration for full stack
```

## Setup & Deployment

### Prerequisites
*   Docker & Docker Compose installed on the host machine.

### Running the Application

1.  **Start the Stack:**
    Navigate to the project directory and run:
    ```bash
    docker-compose up -d --build
    ```

2.  **Access the application:**
    *   **Custom UI:** `https://<OR_HOSTNAME>` (Served via Proxy/Traefik as configured in docker-compose)
    *   **OpenRemote Manager:** `https://<OR_HOSTNAME>/manager`

### Environment Variables

Configuration is handled primarily through `docker-compose.yml` and `src/core/config.py`. Key variables include:

*   `OR_HOSTNAME`: The hostname for the OpenRemote instance.
*   `OR_ADMIN_PASSWORD`: Password for the `admin` user.
*   `KC_DB_PASSWORD`: Keycloak database password.
*   `POSTGRES_PASSWORD`: PostgreSQL password.

## Development

The application is built with **FastAPI**.
*   **Backend Entry:** `src/main.py`
*   **Authentication:** Handles interaction with Keycloak/OpenRemote to obtain and refresh tokens (`src/core/auth.py`).
*   **Proxying:** The backend acts as a proxy for specific OpenRemote API calls to ensure secure access to asset data.

### Adding New Features
1.  **Backend:** Add new API endpoints in `src/api/` and include them in `main.py`.
2.  **Frontend:** Create new templates in `src/templates/` and add corresponding static assets in `src/static/`.

## Contribution

Please ensure all code follows the project's structure (Separation of API, Core, and Routes).

