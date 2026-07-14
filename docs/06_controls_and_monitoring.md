# Controls & Monitoring — OpenRemote Manager & Custom UI

This document explains how both System Administrators and End-Users interact with the DIBL IoT platform to monitor real-time telemetry, control physical devices (relays, valves), and configure automation schedules.

---

## Table of Contents
- [Core Concept: Attribute Modification](#core-concept-attribute-modification)
- [Admin Workflow: OpenRemote Manager](#admin-workflow-openremote-manager)
  - [Monitoring Device Status](#monitoring-device-status)
  - [Controlling Devices](#controlling-devices)
  - [Admin Data History](#admin-data-history)
- [End-User Workflow: Custom UI](#end-user-workflow-custom-ui)
  - [The Dashboard & Pinning](#the-dashboard--pinning)
  - [Relay & Valve Control](#relay--valve-control)
  - [Configuring Timers](#configuring-timers)
  - [Historical Data Export & Charts](#historical-data-export--charts)

---

## Core Concept: Attribute Modification

In the DIBL IoT ecosystem, "Control" and "Monitoring" are two sides of the same coin, governed by **Asset Attributes**.
- **Monitoring** is simply reading the current value of an attribute (e.g., reading `EnvData.t1` for temperature).
- **Controlling** a device means writing a new value to an attribute (e.g., changing `ValveState.r1` from `false` to `true`).

When an attribute is modified via the UI, OpenRemote automatically publishes that new state via MQTT to the physical ESP32 device, which executes the command.

---

## Admin Workflow: OpenRemote Manager

Administrators have full access to the native OpenRemote Manager UI (`https://<OR_HOSTNAME>/manager`). This provides a raw, unfiltered view of every device in the system.

### Monitoring Device Status
1. Navigate to the **Assets** tab on the left sidebar.
2. Select a specific device (e.g., a "FarmHub" or "Valve").
3. Go to the **Attributes** panel. Here you will see the raw JSON payloads being reported by the device in real-time.
   - For example, you will see `EnvData` updating with the latest temperature (`t1`), humidity (`h1`), and light readings.
   - A green connectivity indicator usually signifies recent MQTT activity.

### Controlling Devices
Admins can manually override device states directly from the Manager:
1. In the **Attributes** panel of a device, locate a writeable attribute like `RelayData`.
2. Click on the value (e.g., `{"r1": false, "r2": false}`).
3. Change the value to `true` and click the checkmark to save.
4. The OpenRemote rules engine instantly pushes this change to the physical device over MQTT, turning the relay on.

### Admin Data History
1. To view historical data, an admin can go to the **History** tab of a specific asset.
2. Select the attributes to chart (e.g., `EnvData`).
3. The Manager provides a native line-chart visualization of how the data has fluctuated over time.

---

## End-User Workflow: Custom UI

End-users (like farmers or site managers) use the **DIBL Custom UI** (`https://<OR_CUSTOMUI_HOSTNAME>`). This interface abstracts away the raw JSON and provides a clean, mobile-friendly experience.

### The Dashboard & Pinning
When a user logs in, they are greeted by their Dashboard.
- **Pinning:** Users can navigate to their linked devices, select a specific sensor (e.g., "Soil Moisture 1"), and click **"Pin to Dashboard"**. 
- This creates a quick-access widget on the home screen, allowing the user to monitor critical telemetry at a glance without navigating through menus.
- The UI translates raw keys like `t1` into friendly names like "Temperature Port 1" using the system's `friendly_names.json` configuration.

### Relay & Valve Control
To control a physical output:
1. The user navigates to a specific device in the **My Devices** tab.
2. The UI renders physical attributes (like `RelayData` or `ValveState`) as **Toggle Switches**.
3. Clicking a toggle instantly sends a secure API request to the backend, which forwards it to OpenRemote, switching the physical relay.
4. The toggle visually updates to reflect the new state, confirming the command was successful.

### Configuring Timers
Instead of editing raw JSON like an admin, users configure watering schedules via a dedicated UI modal:
1. The user clicks on a Timer attribute (e.g., `Timer01`).
2. A graphical form appears allowing them to select:
   - **Start Time / End Time** (e.g., 06:30 to 07:00).
   - **Active Days** (e.g., Monday, Wednesday, Friday).
   - **Target Outputs** (e.g., Valve 1 and Valve 2).
3. Upon saving, the Custom UI packages this into the required JSON format and writes it to the OpenRemote attribute, which syncs to the ESP32 for offline execution.

### Historical Data Export & Charts
Users have access to a dedicated **Data History** page.
1. The user selects a device and a specific data group (e.g., "NPK Sensor Data").
2. They select a date/time range.
3. The UI queries OpenRemote's historical database and offers three ways to view the data:
   - **Interactive Chart:** A line graph powered by Chart.js.
   - **Data Table:** A sortable list of timestamps and values.
   - **Export:** A button to download the data as a `.zip` archive containing CSV files for use in Excel or custom analytics tools.
