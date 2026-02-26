# DIBL IOT DEVICE USER MANUAL
Model: [Undecided] v1

Serial Number: [Undecided]

Date: 21-02-2026

⏻ ᯤ ⴵ

---

## 1. Safety Information
- Disconnect power before wiring.
- Verify voltage and current ratings before connection.
- Install in a dry, ventilated enclosure.
- Use proper wire gauge and protective fuse.
- Do not open enclosure while powered.

## 2. Package Contents
- Main device unit
- Mounting hardware
- Sensor(s) (if included)
- Quick start guide
- Warranty card

## 3. Hardware Overview
- **Power Input Terminals:** <L/N or VIN/GND>
- **Relay Output Terminals:** <COM/NO/NC>
- **Sensor Ports:** <Connector type>
- **Reset/Pair Button:** <Location>
- **Status LED:** <Color indications>

## 4. Technical Specifications
- **Input Voltage:** <VALUE>
- **Max Relay Load:** <VALUE>
- **Wireless Protocol:** <Wi-Fi/BLE/LoRa>
- **Operating Temperature:** <VALUE>
- **Operating Humidity:** <VALUE>
- **Enclosure Rating (IP):** <VALUE>
- **Data Logging Capacity:** <VALUE>

## 5. Installation & Wiring
1. Turn OFF power supply.
2. Mount device securely.
3. Connect input power to designated terminals.
4. Connect load to relay terminals.
5. Attach sensors to appropriate ports.
6. Restore power and verify LED status.

## 6. Network Setup & Pairing
**Pairing Mode:** <AP/Station/BLE>
1. Power device.
2. Activate pairing mode (hold reset button).
3. Connect via mobile app or web UI.
4. Enter Wi-Fi credentials (if applicable).
5. Confirm device appears online.

### 6.1 Web App Login and Registration
To access the centralized IoT platform, navigate to the web application. Authorization is managed by a secure Keycloak server.
- **Login:** Enter your registered Keycloak username and password. 
- **Sign Up:** New users can securely register by providing their desired username, email, first name, last name, and password. You must agree to the Terms and Conditions (viewable via the terms modal) before proceeding in the platform.
- **Theme Toggle:** You can toggle the complete Web App between Light/Dark modes globally via the moon/sun icon in the top right of the navigation bar. 

### 6.2 Linking a New Device in the Web App
You can self-provision new devices directly to your account:
1. Navigate to the **Assets** tab.
2. Click **+ Link New IoT Device**.
3. Choose either manual entry of the **Claim/Asset ID**, or if accessing the platform via a mobile device, use the built-in **QR Code Scanner** to auto-fill the asset ID directly from the physical hardware tag.
4. Supply a custom **Asset Name** and confirm. The device is now permanently tied to your Keycloak user account.

## 7. Basic Operation
- **Manual Mode:** Toggle relay ON/OFF.
- **Auto Mode:** Configure threshold-based rules.
- **Example Rule:** If Soil Moisture < <VALUE>% → Relay ON.

### 7.1 Web App Dashboard Overview
Upon logging in, you are greeted by the Dashboard, which gives a high-level summary of your linked devices.
- **Total Assets:** Displays the total number of IoT devices linked to your account.
- **Online/Offline Status:** The dashboard summarizes how many devices are currently active. A device is considered **Online** if its boolean `status` attribute evaluates to `true`.
- **Recent Data Chart:** Shows the most recent 5 data points from your active assets using an interactive line chart. You can filter the view easily via the top chart configurations.

### 7.2 Web App Asset Details & Remote Control
Clicking "View Details" on an asset in the Assets tab navigates to its individual management context:
- **Real-time Metrics:** Sensor data is displayed in categorized accordions (e.g., Environment, Nodes). Dynamic icons reflect telemetry metrics (Moisture, Temp, Humidity, Valve States, EC, pH).
- **Attribute Pinning:** To keep your most critical sensors visible without expanding groups, you can click the `Pin` icon next to a metric to stick it to the top of the detail page.
- **Actuator Control (Relays/Valves):** For metrics acting as controls (such as `RelayNode` states or manual modes), you will see interactive switches or buttons. Toggling these acts out API requests to the manager, remotely affecting your physical hardware. You will be prompted with a confirmation dialog to prevent accidental actuations.
- **Editing Bounds/Offsets:** Advanced device configurations like custom threshold bounds limits can be edited directly if the structural schema allows.

## 8. Automation Settings
- **Trigger:** Sensor + Condition
- **Action:** Relay ON/OFF
- **Hysteresis:** <ON threshold / OFF threshold>
- **Minimum Runtime:** <VALUE>

### 8.1 Web App Rules System 
The web interface Rules engine lets you dictate automatic hardware actions when sensor statuses meet precise criteria.
1. Navigate to the **Rules** tab.
2. Select your Target Asset.
3. **Condition:** Choose a sensor (e.g., `Soil Moisture`), an operator (`<`, `>`, `=`, `!=`), and define the threshold value.
4. **Action:** Select the actuator target (e.g., `Valve 1`) and the target state (`ON` or `OFF`).
5. **Save:** Upon saving, the backend synchronizes this configuration as a Groovy-translated rule sequence within the OpenRemote rules engine.
- Active rules appear dynamically formatted. You can toggle a rule's active state, delete it, or **Pin** crucial rules to appear anchored at the top of your layout for quick reference.

## 9. Data Logging & Monitoring
- View real-time sensor values.
- Access historical charts.
- Export data (CSV/JSON if supported).

### 9.1 History Logs (Web App)
To audit historical hardware behavior, utilize the **History Logs** feature.
- Navigate to the **History** tab and select the desired Asset.
- Pick the specific Attribute (and sub-attribute if applicable) you wish to inspect.
- Use the **Start Date/Time** and **End Date/Time** pickers to construct the window. Time inputs are automatically synced over timezone structures.
- The results are displayed structurally in an interactive tabular datatable.

## 10. Troubleshooting
- **Device not pairing** → Check Wi-Fi band.
- **Sensor not reading** → Verify connection.
- **Relay not switching** → Check wiring and load rating.
- **Device offline** → Check power and network.

## 11. Reset & Firmware Update
- **Factory Reset:** Hold reset button 5–10 seconds.
- **Firmware Update:** OTA or manual update if supported.

## 12. Maintenance
- Clean sensors periodically.
- Inspect wiring regularly.
- Replace damaged probes or cables.

## 13. Warranty & Support
- **Warranty Period:** <VALUE>
- **Support Contact:** <EMAIL>
- **Website:** <URL>

## 14. Additional App Functionality

### 14.1 Scheduling: Timers
Timers allow you to execute single parameter state changes strictly based on time schedules without conditional sensor checks.
1. Navigate to the **Timers** tab.
2. Timers are grouped intrinsically by Asset. By selecting an asset, you can add new timer blocks.
3. Configure **Scheduled Days** (Monday-Sunday granularity).
4. Specify the **Target Execution Time** via the localized time-picker.
5. Identify the **Target Output** (e.g., `Relay 2`) and the **Target Status** (`ON/OFF`).

### 14.2 Profile Settings
Within the **Profile** drop-down:
- **Edit Personal Details:** You can amend your First Name, Last Name, and registered Email.
- **Security:** You can execute standard password resets securely tied to Keycloak validation bounds.

### 14.3 Developer Test API
- An integrated **Test API** view provides embedded endpoints tracking. Should an administrative user need to debug specific payloads, this view lists the backend application's primary fetch strings. Users can click routes to instantly copy configurations directly.
