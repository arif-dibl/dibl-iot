// ─── State ───────────────────────────────────────────
let selectedDevice = null;       // BluetoothDevice
let selectedServer = null;       // BluetoothRemoteGATTServer
let selectedName = '';
let selectedId = '';

// DIBL IoT BLE Service & Characteristic UUIDs
const DIBL_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const DIBL_CHAR_CONFIG = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const DIBL_CHAR_DATA  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

// ─── Bluetooth Support Check ────────────────────────
function isBluetoothSupported() {
    return 'bluetooth' in navigator;
}

function updateBluetoothStatus() {
    const status = document.getElementById('bleStatus');
    if (!status) return;
    if (!isBluetoothSupported()) {
        status.className = 'ble-status unsupported';
        status.querySelector('.ble-status-icon').textContent = '❌';
        status.querySelector('.ble-status-text').textContent = 'Bluetooth not supported in this browser. Use Chrome/Edge on desktop or Android.';
        document.getElementById('scanBtn').disabled = true;
    }
}

// ─── Step Navigation ────────────────────────────────
function showStep(stepId) {
    document.querySelectorAll('.setup-card').forEach(c => c.classList.add('hidden'));
    document.getElementById(stepId).classList.remove('hidden');
}

// ─── Scan ──────────────────────────────────────────
async function startScan() {
    if (!isBluetoothSupported()) {
        showError('Bluetooth Unsupported', 'Web Bluetooth is not available. Please use Chrome or Edge on desktop or Android.');
        return;
    }

    const btn = document.getElementById('scanBtn');
    const indicator = document.getElementById('scanningIndicator');
    const list = document.getElementById('deviceList');

    btn.disabled = true;
    btn.textContent = 'Scanning...';
    indicator.classList.remove('hidden');

    try {
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [DIBL_SERVICE_UUID]
        });

        selectedDevice = device;
        selectedId = device.id;
        selectedName = device.name || 'Unknown Device';

        indicator.classList.add('hidden');
        btn.textContent = 'Scan for Devices';
        btn.disabled = false;

        // Show the device in the list
        renderDeviceItem(device);

        // Listen for disconnect
        device.addEventListener('gattserverdisconnected', onDisconnected);

    } catch (err) {
        indicator.classList.add('hidden');
        btn.textContent = 'Scan for Devices';
        btn.disabled = false;

        if (err.name === 'NotFoundError') {
            // User cancelled — no action needed
            return;
        }
        showError('Scan Failed', err.message || 'Could not scan for devices.');
    }
}

function renderDeviceItem(device) {
    const list = document.getElementById('deviceList');
    list.innerHTML = '';

    const div = document.createElement('div');
    div.className = 'device-item selected';
    div.innerHTML = `
        <div class="device-item-left">
            <span class="device-item-icon">📡</span>
            <div>
                <div class="device-item-name">${device.name || 'Unknown Device'}</div>
                <div class="device-item-id">${device.id}</div>
            </div>
        </div>
        <span class="select-indicator">✔ Selected</span>
    `;
    div.onclick = () => connectAndConfigure(device);
    list.appendChild(div);
}

// ─── Connect & Configure ──────────────────────────
async function connectAndConfigure(device) {
    try {
        const server = await device.gatt.connect();
        selectedServer = server;

        // Try to read device info from BLE
        let firmware = '-';
        try {
            const service = await server.getPrimaryService(DIBL_SERVICE_UUID);
            const dataChar = await service.getCharacteristic(DIBL_CHAR_DATA);
            const value = await dataChar.readValue();
            const decoder = new TextDecoder();
            const infoStr = decoder.decode(value);
            if (infoStr) {
                try {
                    const info = JSON.parse(infoStr);
                    if (info.firmware) firmware = info.firmware;
                    if (info.name) selectedName = info.name;
                } catch (e) {
                    // Not JSON, use raw string
                }
            }
        } catch (e) {
            console.log('[BLE] Could not read device info, using defaults');
        }

        document.getElementById('configDeviceName').textContent = selectedName;
        document.getElementById('configDeviceId').textContent = selectedId;
        document.getElementById('configFirmware').textContent = firmware;
        document.getElementById('deviceName').value = selectedName;

        showStep('step-config');

    } catch (err) {
        showError('Connection Failed', err.message || 'Could not connect to the device.');
    }
}

function onDisconnected() {
    selectedServer = null;
    toast('Bluetooth device disconnected');
}

// ─── Provision ────────────────────────────────────
async function provisionDevice() {
    const deviceName = document.getElementById('deviceName').value.trim();
    const deviceType = document.getElementById('deviceType').value;
    const wifiSsid = document.getElementById('wifiSsid').value.trim();
    const wifiPassword = document.getElementById('wifiPassword').value.trim();

    if (!deviceName) {
        toast('Please enter a device name');
        return;
    }

    showStep('step-progress');
    markProvisionStep('prov-connect', 'active');

    try {
        if (!selectedServer || !selectedServer.connected) {
            if (selectedDevice) {
                markProvisionStep('prov-connect', 'active');
                const server = await selectedDevice.gatt.connect();
                selectedServer = server;
            } else {
                throw new Error('No Bluetooth device connected');
            }
        }

        markProvisionStep('prov-connect', 'done');
        markProvisionStep('prov-config', 'active');

        // Build configuration payload
        const config = {
            name: deviceName,
            type: deviceType,
            id: selectedId,
            timestamp: Date.now()
        };
        if (wifiSsid) config.wifi_ssid = wifiSsid;
        if (wifiPassword) config.wifi_password = wifiPassword;

        // Send config via BLE
        try {
            const service = await selectedServer.getPrimaryService(DIBL_SERVICE_UUID);
            const configChar = await service.getCharacteristic(DIBL_CHAR_CONFIG);
            const encoder = new TextEncoder();
            const data = encoder.encode(JSON.stringify(config));
            await configChar.writeValue(data);
        } catch (e) {
            console.warn('[BLE] Could not write config to device, sending via API only');
        }

        markProvisionStep('prov-config', 'done');
        markProvisionStep('prov-wifi', 'active');

        // Send provisioning request to backend
        const res = await fetch(`${APP_PREFIX}/api/user/provision-device`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await res.json();

        if (!res.ok || result.status !== 'success') {
            throw new Error(result.message || 'Backend provisioning failed');
        }

        markProvisionStep('prov-wifi', 'done');
        markProvisionStep('prov-done', 'active');

        // Small delay for UX
        await new Promise(r => setTimeout(r, 800));

        markProvisionStep('prov-done', 'done');

        // Disconnect BLE
        if (selectedServer && selectedServer.connected) {
            selectedServer.disconnect();
        }

        // Show success
        document.getElementById('successDeviceName').textContent = deviceName;
        document.getElementById('successDeviceId').textContent = result.assetId || selectedId;
        showStep('step-success');

    } catch (err) {
        console.error('[Provision] Error:', err);
        showError('Provisioning Failed', err.message || 'Could not complete device setup.');
        showStep('step-config');
    }
}

function markProvisionStep(stepId, state) {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.className = 'provision-step ' + state;

    const icon = el.querySelector('.prov-icon');
    if (state === 'done') icon.textContent = '✅';
    else if (state === 'fail') icon.textContent = '❌';
    else if (state === 'active') icon.textContent = '⏳';
    else icon.textContent = '⏳';
}

// ─── WiFi Password Toggle ─────────────────────────
function toggleWiFiPassword() {
    const input = document.getElementById('wifiPassword');
    const btn = document.querySelector('.toggle-password');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
    } else {
        input.type = 'password';
        btn.textContent = 'Show';
    }
}

// ─── Error Modal ──────────────────────────────────
function showError(title, msg) {
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorMsg').textContent = msg;
    document.getElementById('errorModal').classList.add('show');
}

function closeErrorModal() {
    document.getElementById('errorModal').classList.remove('show');
}

// ─── Reset ────────────────────────────────────────
function resetSetup() {
    if (selectedServer && selectedServer.connected) {
        selectedServer.disconnect();
    }
    selectedDevice = null;
    selectedServer = null;
    selectedName = '';
    selectedId = '';

    document.getElementById('deviceList').innerHTML = '';
    document.getElementById('scanBtn').disabled = false;
    document.getElementById('scanBtn').textContent = 'Scan for Devices';
    document.getElementById('scanningIndicator').classList.add('hidden');

    showStep('step-scan');
}

// ─── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateBluetoothStatus();
});
