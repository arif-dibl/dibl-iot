# System Features Overview

## Dashboard Monitoring
The central hub provides real-time monitoring and immediate access to essential device controls.

| Component | Functionality |
| :--- | :--- |
| **Overview Statistics** | Provides real-time counts of total devices, online/offline status, and active automation rules. |
| **Customizable Widgets** | Persistent pinning of switches, sensor readings, and timers for quick access. |
| **Direct Control** | Toggle states for relays and automation rules directly from the home screen. |

## Device Management
A comprehensive interface for managing and configuring IoT hardware assets.

### Asset Administration
- **Device Lifecycle**: Operations to link new hardware or remove existing associations from the account.
- **Connectivity Tracking**: Real-time heartbeat monitoring with visual status indicators.

### Data Categorization
Device attributes are logically grouped to streamline navigation:

| Group | Typical Content |
| :--- | :--- |
| **Switches** | Relay controls for power and hardware toggles. |
| **Sensors** | Environmental readings (Temperature, Humidity, Light). |
| **Soil/NPK** | Sub-surface nutrient and moisture analysis data. |
| **Timers** | Scheduled operations specific to the device. |

## Automation and Scheduling
Tools for creating autonomous device behaviors and time-based operations.

### Automation Rules (Logic Engine)
Create conditional "If-Then" logic to automate environmental responses.

| Logic Element | Description |
| :--- | :--- |
| **Conditions (WHEN)** | Sensor-based triggers using comparison operators (Greater Than, Less Than, etc.). |
| **Actions (THEN)** | Predetermined relay states (ON/OFF) triggered by the condition. |
| **Management** | Rules can be named, enabled/disabled, or pinned for dashboard visibility. |

### Precision Timers
Each device supports up to 12 independent scheduling slots.

| Parameter | Configuration Detail |
| :--- | :--- |
| **Time Format** | Independent Start (ON) and End (OFF) time selection via high-precision picker. |
| **Recurrence** | Day-of-week selection for repetitive weekly cycles. |
| **Mapping** | Ability to link a single timer to multiple hardware relay outputs. |

## Data Analytics and Logging
Historical performance monitoring with comprehensive data accessibility.

### Visualization Modes
| Mode | Description |
| :--- | :--- |
| **Interactive Chart** | Graphical trend analysis with hover-based tooltips for precise values. |
| **System Table** | Chronological list of all recorded datapoints and status changes. |
| **Raw Data** | Structural view of the data payload for technical verification. |

### Data Portability
- **Custom Queries**: Filter historical logs by device, specific attribute, and precise date/time windows.
- **CSV Export**: Native capability to download queried datasets for external reporting or analysis.

## User and Security Management
Administration of user profiles, security credentials, and shared access.

- **Security Verification**: Password updates require current credential validation to prevent unauthorized changes.
- **Profile Customization**: Management of display names and personal identifiers.
- **Collaborative View**: Identification of other verified accounts with shared access to the same hardware group.

## System Architecture Features
- **Responsive Layout**: Interface adjusts between mobile and desktop environments.
- **Real-Time Polling**: Automatic data synchronization at 1-3 second intervals.
- **Friendly Naming**: Mapping of technical hardware keys to human-readable labels.
- **Unified Authentication**: Integrated signup flow with mandatory Terms and Conditions compliance and session persistence.
