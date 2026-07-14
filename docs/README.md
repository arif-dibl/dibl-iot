# DIBL IoT Project Documentation

Comprehensive documentation for the DIBL IoT platform — covering OpenRemote setup, certificate infrastructure, device provisioning, deployment, and more.

---

## 📖 Document Index

| # | Document | Status | Description |
|---|----------|--------|-------------|
| 01 | [OpenRemote Setup & Overview](01_openremote_setup_and_overview.md) | ✅ Complete | Downloading, deploying, and exploring OpenRemote locally |
| 02 | [Certificate Setup](02_certificate_setup.md) | ✅ Complete | Multi-CA mTLS certificate infrastructure for IoT provisioning |
| 03 | [Auto Provisioning](03_auto_provisioning.md) | 🔲 Planned | X.509 device onboarding via MQTT |
| 04 | [Asset Management](04_asset_management.md) | ✅ Complete | Asset types, attributes, templates, and data models |
| 05 | [User Management](05_user_management.md) | ✅ Complete | Keycloak users, roles, and access control |
| 06 | [Controls & Monitoring](06_controls_and_monitoring.md) | ✅ Complete | Relay control, rules, scheduling, data visualization |
| 07 | [Docker & Deployment](07_docker_and_deployment.md) | ✅ Complete | Local and production (Coolify) Docker Compose stacks |
| 08 | [OTA Updates](08_ota_updates.md) | 🔲 Planned | HawkBit firmware delivery system |
| 09 | [Custom UI Architecture](09_custom_ui_architecture.md) | ✅ Complete | FastAPI + Jinja2 web application design |
| 10 | [ESP32 Firmware](10_esp32_firmware.md) | 🔲 Planned | Device-side MQTT, mTLS, telemetry, and OTA client |

---

## Quick Start

If you're new to the project, read the documents in order. Start with **01** for server setup, then **02** for certificates — these are foundational to everything else.

## Contributing to Docs

- Use the numbered prefix convention (`01_`, `02_`, etc.) for ordering
- Mark document status: ✅ Complete, 🔲 Planned, 🚧 In Progress
- All information must be evidence-based — reference actual project files, configs, and commands
