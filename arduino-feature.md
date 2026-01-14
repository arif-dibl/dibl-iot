# DIBL IoT Sensor Controller - Firmware Feature Specification

**Version:** 1.2  
**Author:** Abdullahil Mahmud Arif  
**Target Platform:** ESP32 DevKit (Dual-Core)  
**Last Updated:** 2025-11-29

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Hardware Interface Mapping](#hardware-interface-mapping)
3. [Communication Protocols](#communication-protocols)
4. [Logic Modules](#logic-modules)
5. [Data Payloads](#data-payloads)
6. [Timer and Automation Logic](#timer-and-automation-logic)
7. [Sensor Data Processing](#sensor-data-processing)
8. [User Interface and Display](#user-interface-and-display)
9. [Storage and Persistence](#storage-and-persistence)

---

## 1. System Overview

This firmware operates a modular sensor and relay control system designed for agricultural and environmental monitoring. It features multi-sensor data acquisition, cloud connectivity via MQTT with X.509 certificate-based auto-provisioning, local timer-based automation, and a graphical OLED interface.

### Core Architecture

| Component | Description |
|-----------|-------------|
| **Dual-Core Execution** | Core 0 handles Wi-Fi, MQTT, and OTA; Core 1 handles display, sensors, and local I/O |
| **Non-Blocking Design** | State machines ensure no blocking calls in main loops |
| **Watchdog Safety** | Explicit `yield()` calls prevent watchdog resets during long operations |
| **Graceful Degradation** | Device operates in offline mode when network is unavailable |

---

## 2. Hardware Interface Mapping

### 2.1 ESP32 GPIO Assignments

| Pin | Function | Direction | Notes |
|-----|----------|-----------|-------|
| GPIO36 (VP) | LDR Analog Input | Input | Light sensor (ADC1_CH0) |
| GPIO32 | DHT22 Sensor 0 | Input | Temperature/Humidity |
| GPIO33 | DHT22 Sensor 1 | Input | Temperature/Humidity |
| GPIO19 | DHT22 Sensor 2 | Input | Temperature/Humidity |
| GPIO18 | DHT22 Sensor 3 | Input | Temperature/Humidity |
| GPIO23 | DHT22 Sensor 4 | Input | Temperature/Humidity |
| GPIO26 | Rotary Encoder CLK | Input | Navigation control |
| GPIO27 | Rotary Encoder DT | Input | Navigation direction |
| GPIO25 | Rotary Encoder SW | Input | Button (active low) |
| GPIO16 | Serial2 RX (Modbus) | Input | NPK sensor communication |
| GPIO17 | Serial2 TX (Modbus) | Output | NPK sensor communication |
| GPIO4 | RS485 DE/RE | Output | Modbus direction control |

### 2.2 I2C Bus Devices (SDA: GPIO21, SCL: GPIO22)

| Address | Device | Function |
|---------|--------|----------|
| 0x3C | SH1106G OLED | 128x64 pixel display |
| 0x48 | ADS1115 | 4-channel 16-bit ADC for moisture sensors |
| 0x20 | MCP23017 | 16-bit I/O expander for buttons, LEDs, relays |

### 2.3 MCP23017 Port Mapping

| Port | Pin | Function | Mode |
|------|-----|----------|------|
| GPA0 | 0 | Button 1 | INPUT_PULLUP |
| GPA1 | 1 | Button 2 | INPUT_PULLUP |
| GPA2 | 2 | Button 3 | INPUT_PULLUP |
| GPA3 | 3 | Button 4 | INPUT_PULLUP |
| GPA4 | 4 | LED Timer Status | OUTPUT |
| GPA5 | 5 | LED Server Status | OUTPUT |
| GPA6 | 6 | LED WiFi Status | OUTPUT |
| GPA7 | 7 | Button 5 (Menu) | INPUT_PULLUP |
| GPB0 | 8 | Relay 1 (OUT 01) | OUTPUT (Active LOW) |
| GPB1 | 9 | Relay 2 (OUT 02) | OUTPUT (Active LOW) |
| GPB2 | 10 | Relay 3 (OUT 03) | OUTPUT (Active LOW) |
| GPB3 | 11 | Relay 4 (OUT 04) | OUTPUT (Active LOW) |

### 2.4 ADS1115 Analog Channels

| Channel | Function | Sensor Type |
|---------|----------|-------------|
| AIN0 | Moisture Sensor 1 | Capacitive soil moisture |
| AIN1 | Moisture Sensor 2 | Capacitive soil moisture |
| AIN2 | Moisture Sensor 3 | Capacitive soil moisture |
| AIN3 | Moisture Sensor 4 | Capacitive soil moisture |

### 2.5 NPK 7-in-1 Soil Sensor (RS485 Modbus RTU)

| Parameter | Register | Unit | Resolution |
|-----------|----------|------|------------|
| Moisture | 0x0000 | % | 0.1% |
| Temperature | 0x0001 | °C | 0.1°C |
| EC (Electrical Conductivity) | 0x0002 | µS/cm | 1 µS/cm |
| pH | 0x0003 | - | 0.1 |
| Nitrogen (N) | 0x0004 | mg/kg | 1 mg/kg |
| Phosphorus (P) | 0x0005 | mg/kg | 1 mg/kg |
| Potassium (K) | 0x0006 | mg/kg | 1 mg/kg |

---

## 3. Communication Protocols

### 3.1 Wi-Fi Configuration

| Parameter | Value |
|-----------|-------|
| Mode | Station (STA) or Access Point (AP) |
| AP SSID | DIBL IoT |
| AP Password | 12345678 |
| AP IP Address | 192.168.4.1 |
| Web UI | LittleFS-served HTML/CSS/JS |

### 3.2 MQTT Configuration

| Parameter | Value |
|-----------|-------|
| Transport | TLS 1.2 (WiFiClientSecure) |
| Default Port | 8883 |
| Authentication | X.509 Client Certificate |
| Fallback | Username/Password (optional) |
| Buffer Size | 16384 bytes |
| Socket Timeout | 2 seconds |
| Reconnect Strategy | Exponential backoff (500ms - 60s) |

### 3.3 MQTT Topic Structure

| Purpose | Topic Pattern |
|---------|---------------|
| Provisioning Request | `provisioning/{UNIQUE_ID}/request` |
| Provisioning Response | `provisioning/{UNIQUE_ID}/response` |
| Write Attribute | `{realm}/{client_id}/writeattributevalue/{attribute}/{asset_id}` |
| Read Attribute | `{realm}/{client_id}/attributevalue/{attribute}/{asset_id}` |

### 3.4 Modbus RTU (NPK Sensor)

| Parameter | Value |
|-----------|-------|
| Baud Rate | 4800 bps |
| Data Bits | 8 |
| Parity | None |
| Stop Bits | 1 |
| Frame Format | 8N1 |
| CRC | Modbus CRC-16 |
| Response Timeout | 300 ms |
| Read Command | Function 0x03, 7 registers starting at 0x0000 |

### 3.5 NTP Time Synchronization

| Parameter | Value |
|-----------|-------|
| Primary Server | pool.ntp.org |
| Secondary Server | time.google.com |
| Default Timezone | UTC+6 (Asia/Dhaka) |
| Sync Timeout | 20 seconds |

### 3.6 OTA (Over-The-Air Updates)

| Parameter | Value |
|-----------|-------|
| Protocol | ArduinoOTA (mDNS) |
| Authentication | MD5 Password Hash |
| Update Types | Sketch, Filesystem |

---

## 4. Logic Modules

### 4.1 Module Architecture

| Module | Source Files | Responsibility |
|--------|--------------|----------------|
| Main Controller | `prototype_02.ino` | Dual-core task orchestration |
| Auto Provisioning | `auto_provisioning.cpp/h` | MQTT connection, data publishing, command handling |
| Sensor Manager | `sensors.cpp/h` | DHT22, LDR, moisture sensor readings |
| NPK Manager | `npk_soil_sensor.cpp/h` | Modbus RTU communication with NPK sensor |
| Control Manager | `controls.cpp/h` | Relays, buttons, encoder, status LEDs |
| Timer Logic | `timer_logic.cpp/h` | Schedule-based relay automation |
| Storage Manager | `storage_manager.cpp/h` | NVS persistence for settings |
| Network Setup | `network_setup.cpp/h` | AP mode, web UI, credential management |
| Date/Time | `date_time.cpp/h` | NTP sync, manual time setting |
| Display | `screen.cpp/h` | OLED UI rendering |
| Calibration | `calibration.cpp/h` | Sensor calibration menus |
| OTA Handler | `ota_handler.cpp/h` | Firmware updates |
| Memory Manager | `memory_manager.cpp/h` | Heap monitoring |

### 4.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CORE 1 (Sensors/UI)                       │
├─────────────────────────────────────────────────────────────────┤
│  DHT22 (x5) ──┬── Temp/Humidity Cache                           │
│  ADS1115 ─────┼── Moisture Cache (x4)                           │
│  LDR ─────────┤                                                 │
│  NPK Sensor ──┘── NPK Data Cache                                │
│                       │                                          │
│  Rotary Encoder ──── Navigation ──── OLED Display               │
│  MCP Buttons ────── Relay Toggle                                │
│  Timer Logic ────── Relay State Control                         │
└─────────────────────────────────────────────────────────────────┘
                        │ (Shared Variables)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CORE 0 (Network)                            │
├─────────────────────────────────────────────────────────────────┤
│  WiFi Manager ───── MQTT Client ───── OpenRemote Server         │
│  OTA Handler                                                     │
│  Provisioning State Machine                                      │
│  Sensor Data Publishing (Deadband Filtered)                      │
│  Command Reception (Relay, Timer Updates)                        │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Provisioning State Machine

| State | Description |
|-------|-------------|
| PROV_WIFI | Non-blocking WiFi connection with 60s timeout |
| PROV_TIME | NTP synchronization with 20s timeout |
| PROV_CERTS | Load CA, client certificate, and private key |
| PROV_MQTT_CONNECT | Attempt MQTT connection with exponential backoff |
| PROV_MQTT_LOOP | Maintain connection, process callbacks |
| PROV_DONE | Terminal state (unused) |

---

## 5. Data Payloads

### 5.1 Outbound MQTT Payloads

#### EnvData (Environmental Sensors)

| Field | Type | Description |
|-------|------|-------------|
| `t0` - `t4` | float or "--" | Temperature readings from DHT22 sensors 0-4 (°C) |
| `h0` - `h4` | float or "--" | Humidity readings from DHT22 sensors 0-4 (%) |
| `light` | int | Light level percentage (0-100%) |

**Example:**
```json
{
  "t0": 25.3, "h0": 65.2,
  "t1": "--", "h1": "--",
  "t2": 26.1, "h2": 58.0,
  "t3": "--", "h3": "--",
  "t4": "--", "h4": "--",
  "light": 78
}
```

#### MoistureData (Soil Moisture)

| Field | Type | Description |
|-------|------|-------------|
| `m1` - `m4` | int or "--" | Moisture readings from ADS1115 channels 0-3 (%) |

**Example:**
```json
{"m1": 45, "m2": "--", "m3": 62, "m4": "--"}
```

#### RelayData (Relay States)

| Field | Type | Description |
|-------|------|-------------|
| `r1` - `r4` | boolean | Relay states (true = ON, false = OFF) |

**Example:**
```json
{"r1": true, "r2": false, "r3": true, "r4": false}
```

#### Timer Configuration (Timer01 - Timer12)

| Field | Type | Description |
|-------|------|-------------|
| `Status` | string | "ON" or "OFF" |
| `Days` | string | "EVERYDAY", "NONE", or comma-separated day codes |
| `Outputs` | string | "NONE" or comma-separated output codes |
| `OnHour` | string | Turn-on hour (0-23) |
| `OnMinute` | string | Turn-on minute (0-59) |
| `OffHour` | string | Turn-off hour (0-23) |
| `OffMinute` | string | Turn-off minute (0-59) |

**Day Codes:** SAT, SUN, MON, TUE, WED, THU, FRI  
**Output Codes:** OUT 01, OUT 02, OUT 03, OUT 04

**Example:**
```json
{
  "Status": "ON",
  "Days": "MON,TUE,WED,THU,FRI",
  "Outputs": "OUT 01,OUT 02",
  "OnHour": "06",
  "OnMinute": "30",
  "OffHour": "18",
  "OffMinute": "00"
}
```

### 5.2 Inbound MQTT Payloads

#### Relay Control Command

**Topic:** `{realm}/{client_id}/writeattributevalue/Relay{01-04}/{asset_id}`

| Field | Type | Description |
|-------|------|-------------|
| `value` | boolean | Target relay state |

**Example:**
```json
{"value": true}
```

#### RelayData Sync (Server to Device)

**Topic:** `{realm}/{client_id}/attributevalue/RelayData/{asset_id}`

| Field | Type | Description |
|-------|------|-------------|
| `r1` - `r4` | boolean/string | Relay states |

#### Timer Update

**Topic:** `{realm}/{client_id}/attributevalue/Timer{01-12}/{asset_id}`

Same structure as outbound Timer Configuration payload.

### 5.3 Provisioning Payloads

#### Request

```json
{
  "type": "x509",
  "cert": "<PEM-encoded client certificate>"
}
```

#### Response (Success)

```json
{
  "type": "success",
  "asset": {
    "id": "<asset-uuid>",
    "realm": "<realm-name>"
  },
  "username": "<service-account>",
  "secret": "<service-secret>"
}
```

---

## 6. Timer and Automation Logic

### 6.1 Timer Configuration Structure

| Field | Size | Range | Description |
|-------|------|-------|-------------|
| `onHour` | uint8_t | 0-23 | Activation hour |
| `onMinute` | uint8_t | 0-59 | Activation minute |
| `offHour` | uint8_t | 0-23 | Deactivation hour |
| `offMinute` | uint8_t | 0-59 | Deactivation minute |
| `dayMask` | uint8_t | 0-127 | Bitmask for active days |
| `outputMask` | uint8_t | 0-15 | Bitmask for controlled relays |
| `enabled` | bool | - | Timer enable flag |

### 6.2 Day Mask Encoding

| Bit | Day |
|-----|-----|
| 0 | Saturday |
| 1 | Sunday |
| 2 | Monday |
| 3 | Tuesday |
| 4 | Wednesday |
| 5 | Thursday |
| 6 | Friday |

**Special Values:**
- `127` = EVERYDAY (all bits set)
- `0` = NONE

### 6.3 Timer Execution Logic

1. Timers are processed every loop iteration
2. Current time is obtained from the system clock
3. For each enabled timer:
   - Check if current day matches the day mask
   - Calculate if current time falls within ON-OFF window
   - Handle overnight schedules (e.g., 22:00 to 06:00)
4. Relay states are computed using OR logic (if any timer activates a relay, it turns ON)
5. Relays not claimed by any timer remain in manual control mode

### 6.4 Scheduling Behavior

| Scenario | Behavior |
|----------|----------|
| Normal Range | Relay ON when `startMins <= currentMins < endMins` |
| Overnight Range | Relay ON when `currentMins >= startMins OR currentMins < endMins` |
| Start == End | Timer ignored (no action) |
| Multiple Timers | OR logic - any active timer turns relay ON |

---

## 7. Sensor Data Processing

### 7.1 Reading Intervals

| Sensor Type | Interval | Cache Strategy |
|-------------|----------|----------------|
| DHT22 | 2000 ms | Per-sensor last-read timestamp |
| ADS1115 (Moisture, LDR) | 50 ms | Shared cache for all channels |
| NPK Modbus | 5000 ms | Non-blocking request/response |

### 7.2 Deadband Filtering (MQTT Publish)

| Sensor | Deadband Threshold | Heartbeat Interval |
|--------|-------------------|-------------------|
| Temperature | 0.5°C | 30 s |
| Humidity | 2.0% | 30 s |
| Moisture | 2.0% | 3 s (forced) |
| Light | 5.0% | 30 s |

### 7.3 Calibration Parameters

| Parameter | Default Min | Default Max | Persistence |
|-----------|-------------|-------------|-------------|
| LDR | 0 | 4095 | NVS |
| Moisture | 3000 (dry) | 1880 (wet) | NVS |

### 7.4 Sensor Validation

| Sensor | Invalid Indicator | Behavior |
|--------|-------------------|----------|
| DHT22 | NaN | Display "--", publish "--" |
| Moisture | < 0 or > 100 | Display "--", publish "--" |
| NPK | CRC failure / timeout | Use last valid reading |

---

## 8. User Interface and Display

### 8.1 Display Specifications

| Parameter | Value |
|-----------|-------|
| Controller | SH1106G |
| Resolution | 128 x 64 pixels |
| Interface | I2C (0x3C) |
| Library | Adafruit_SH110X |

### 8.2 Dashboard Screens

| Screen | Navigation | Content |
|--------|------------|---------|
| ENV 0 (Onboard) | Knob = 0 | MQTT status, relay indicators, temp, humidity |
| ENV 1-4 | Knob = 1,3,5,7 | Moisture, temp, humidity for sensor zone |
| NPK 1-4 | Knob = 2,4,6,8 | EC, moisture, temp, pH, N, P, K |

### 8.3 Status LED Indicators

| LED | Function | Behavior |
|-----|----------|----------|
| Timer (GPA4) | Timer Active | Solid ON when any timer is enabled |
| Server (GPA5) | MQTT Status | 1s blink when connected |
| WiFi (GPA6) | Network Status | Blip (100ms ON/2900ms OFF) when connected, fast blink in AP mode |

### 8.4 Menu Structure

```
MAIN MENU
├── Calibration
│   ├── Light
│   │   ├── Set Min
│   │   └── Set Max
│   └── Moisture
│       ├── Set Min
│       └── Set Max
├── Timers
│   └── Timer 01-12 (each with ON/OFF time, days, outputs, enable)
├── System
│   ├── Reset Settings
│   ├── Reset Network
│   ├── Set Time (manual date/time entry)
│   └── Reset All
├── Layout (animated board diagram)
└── About (device ID display)
```

---

## 9. Storage and Persistence

### 9.1 NVS Namespaces

| Namespace | Purpose |
|-----------|---------|
| `calibration` | LDR min/max, moisture min/max, device ID, LED interval |
| `wifi` | SSID, password |
| `mqtt` | Host, port, client ID |
| `network` | WiFi credentials (network_setup module) |
| `timers` | Timer configurations (t0-t11) |

### 9.2 Stored Parameters

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ldr_min` | int16 | 0 | LDR calibration minimum |
| `ldr_max` | int16 | 4095 | LDR calibration maximum |
| `moist_min` | int16 | 3000 | Moisture sensor dry value |
| `moist_max` | int16 | 1880 | Moisture sensor wet value |
| `device_id` | uint8 | 1 | Device identifier |
| `led_interval` | int32 | 500 | LED blink interval (ms) |
| `ssid` | string | - | WiFi network name |
| `password` | string | - | WiFi password |
| `host` | string | - | MQTT broker hostname |
| `port` | uint16 | 8883 | MQTT broker port |
| `t0` - `t11` | bytes | - | Timer configuration structures |

### 9.3 Factory Reset Options

| Option | Effect |
|--------|--------|
| Reset Settings | Calibration values and timers reset to defaults |
| Reset Network | NVS erased, device restarts |
| Reset All | All NVS erased, full factory reset |

---

## Appendix: Task Stack Allocation

| Task | Stack Size | Core | Priority |
|------|------------|------|----------|
| Core0_WiFi_MQTT | 24576 bytes | 0 | 1 |
| Core1_Display_Sensors | 8192 bytes | 1 | 2 |

---

*End of Feature Specification*
