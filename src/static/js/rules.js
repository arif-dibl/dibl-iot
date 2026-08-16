let rules = [];
let ruleIdCounter = 1;
let currentAssetId = null;
let allAttributes = {};
let isRulesPinned = false;
let rulesTimestamp = null;
let allUserAssets = [];


async function init() {
    try {
        const res = await fetch(`${APP_PREFIX}/api/user/assets`);
        const data = await res.json();
        const assets = Array.isArray(data) ? data : (data.assets || []);
        allUserAssets = assets;

        const select = document.getElementById('assetSelect');
        assets.forEach(asset => {
            const option = document.createElement('option');
            option.value = asset.id;
            option.textContent = asset.name;
            select.appendChild(option);
        });
    } catch (e) {
        console.error('Failed to load assets:', e);
    }
}

async function loadAsset(assetId) {
    if (!assetId) {
        currentAssetId = null;
        document.getElementById('addRuleBtn').disabled = true;
        document.getElementById('pinRulesBtn').disabled = true;
        document.getElementById('rulesContainer').innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--text-muted);">Select an asset to view or configure rules.</div>';
        return;
    }

    currentAssetId = assetId;
    document.getElementById('addRuleBtn').disabled = false;
    document.getElementById('pinRulesBtn').disabled = false;

    try {
        const res = await fetch(`${APP_PREFIX}/api/asset/${currentAssetId}`);
        const asset = await res.json();
        allAttributes = asset.attributes || {};

        let rTargets = asset.attributes['RuleTargets'];
        rulesTimestamp = null;

        // Parse server RuleTargets
        if (typeof rTargets === 'string') {
            try { rTargets = JSON.parse(rTargets); } catch (e) { rTargets = {}; }
        }
        if (!rTargets) rTargets = {};

        // Parse localStorage
        let localRules = [];
        const stored = localStorage.getItem(`rules_${assetId}`);
        if (stored) {
            try { localRules = JSON.parse(stored); } catch (e) {}
        }

        rules = [];
        let maxRuleIdNum = 0;
        let serverRuleIds = new Set();

        // 1. Recover rules from server RuleTargets
        if (typeof rTargets === 'object') {
            Object.entries(rTargets).forEach(([key, valStr]) => {
                try {
                    if (key.startsWith('_')) return; // skip metadata keys
                    let ruleId = `rule_${ruleIdCounter++}`;
                    const keyParts = key.split('_rule_');
                    let sensorKey = keyParts[0];

                    if (keyParts.length > 1) {
                        ruleId = `rule_${keyParts[1]}`;
                    }
                    const numId = parseInt(ruleId.split('_')[1]);
                    if (!isNaN(numId) && numId > maxRuleIdNum) maxRuleIdNum = numId;

                    serverRuleIds.add(ruleId);

                    const parts = valStr.split(':');
                    if (parts.length >= 4) {
                        let op = parts[0];
                        if (op === '==') op = '=';

                        const rName = parts.length > 4 ? parts[4] : `Rule ${numId || ruleIdCounter}`;
                        const rVal = parts[3] === '1';

                        // Parse whenDeviceId (field 5)
                        const rawWhenId = parts.length > 5 ? parts[5] : null;
                        const whenDeviceId = (rawWhenId && rawWhenId.length > 0) ? rawWhenId : null;

                        // Parse schedule limit fields (fields 6, 7, 8)
                        const timeType = parts.length > 6 ? parts[6] : 'N';
                        const rawStart = parts.length > 7 ? parts[7] : '';
                        const rawEnd = parts.length > 8 ? parts[8] : '';
                        const timeStart = rawStart ? rawStart.substring(0,2) + ':' + rawStart.substring(2) : '';
                        const timeEnd = rawEnd ? rawEnd.substring(0,2) + ':' + rawEnd.substring(2) : '';

                        // Fix sensorPath lookup for cross-device rules
                        let targetAsset = asset;
                        if (whenDeviceId && whenDeviceId !== currentAssetId) {
                            targetAsset = allUserAssets.find(a => a.id === whenDeviceId) || asset;
                        }

                        let sensorPath = '';
                        if (targetAsset.attributes?.EnvData && targetAsset.attributes.EnvData[sensorKey] !== undefined) sensorPath = `EnvData.${sensorKey}`;
                        else if (targetAsset.attributes?.MoistureData && targetAsset.attributes.MoistureData[sensorKey] !== undefined) sensorPath = `MoistureData.${sensorKey}`;
                        else if (targetAsset.attributes?.NPKData && targetAsset.attributes.NPKData[sensorKey] !== undefined) sensorPath = `NPKData.${sensorKey}`;
                        else {
                            // Fallback based on prefix
                            if (sensorKey.startsWith('m')) sensorPath = `MoistureData.${sensorKey}`;
                            else if (['n', 'p', 'k', 'ec', 'ph'].some(prefix => sensorKey.startsWith(prefix))) sensorPath = `NPKData.${sensorKey}`;
                            else sensorPath = `EnvData.${sensorKey}`;
                        }

                        if (sensorPath) {
                            rules.push({
                                id: ruleId,
                                name: rName,
                                sensor: sensorPath,
                                operator: op,
                                value: parseFloat(parts[1]),
                                relay: `RelayData.${parts[2]}`,
                                relayState: rVal,
                                enabled: true,
                                whenDeviceId: whenDeviceId,
                                timeType: timeType !== 'N' ? timeType : 'N',
                                timeStart: timeStart,
                                timeEnd: timeEnd
                            });
                        }
                    }
                } catch (e) { console.error('Error parsing rule recovery:', e); }
            });
        }

        // 2. Add local rules that aren't on the server (disabled or unsaved)
        localRules.forEach(lr => {
            const numId = parseInt(lr.id.split('_')[1]);
            if (!isNaN(numId) && numId > maxRuleIdNum) maxRuleIdNum = numId;

            if (!serverRuleIds.has(lr.id)) {
                lr.enabled = false;
                if (!lr.sensor) lr.enabled = true; // New, unsaved rule
                rules.push(lr);
            }
        });

        ruleIdCounter = maxRuleIdNum + 1;
        localStorage.setItem(`rules_${assetId}`, JSON.stringify(rules));

        renderRules();
        checkPinStatus();
    } catch (e) {
        console.error('Failed to load asset:', e);
        toast('Failed to load asset data');
    }
}

function addRule() {
    if (!currentAssetId) return;

    rules.push({
        id: `rule_${ruleIdCounter++}`,
        name: 'New Rule',
        sensor: '',
        operator: '>',
        value: 30,
        relay: '',
        relayState: true,
        enabled: true,
        timeType: 'N',
        timeStart: '',
        timeEnd: ''
    });

    renderRules();
}

async function deleteRule(ruleId) {
    if (!confirm('Delete this rule?')) return;

    const rule = rules.find(r => r.id === ruleId);
    if (rule && rule.sensor) {
        await clearRuleTarget(rule.sensor, ruleId);
    }

    rules = rules.filter(r => r.id !== ruleId);
    saveToLocalStorage();
    renderRules();
    toast('Rule deleted');
}

async function saveRule(ruleId) {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;

    if (!rule.name || !rule.sensor || (rule.value === null || rule.value === undefined || rule.value === '')) {
        return toast('Please fill in all required fields');
    }

    try {
        const btn = document.querySelector(`button[onclick="saveRule('${ruleId}')"]`);
        if (btn) {
            btn.textContent = 'Saving...';
            btn.disabled = true;
        }

        if (rule.enabled) {
            const state = rule.relayState !== undefined ? rule.relayState : true;
            await updateRuleTargets(rule.sensor, rule.relay, state, rule.operator, rule.value, ruleId, rule.name, rule.whenDeviceId);
        } else if (!rule.enabled && rule.sensor) {
            await clearRuleTarget(rule.sensor, ruleId);
        }

        saveToLocalStorage();
        toast(`Rule "${rule.name}" saved successfully`);

        if (btn) {
            btn.textContent = 'Save Changes';
            btn.disabled = false;
        }

    } catch (e) {
        console.error('Save error:', e);
        toast('Failed to save rule');
        const btn = document.querySelector(`button[onclick="saveRule('${ruleId}')"]`);
        if (btn) {
            btn.textContent = 'Save Changes';
            btn.disabled = false;
        }
    }
}

function parseThresholdAttribute(sensorPath) {
    if (sensorPath.startsWith('EnvData.')) {
        return { thresholdAttr: 'EnvThresholds', key: sensorPath.split('.')[1] };
    } else if (sensorPath.startsWith('MoistureData.')) {
        return { thresholdAttr: 'MoistureThresholds', key: sensorPath.split('.')[1] };
    } else if (sensorPath.startsWith('NPKData.')) {
        return { thresholdAttr: '', key: sensorPath.split('.')[1] };
    }
    return { thresholdAttr: '', key: '' };
}

function saveToLocalStorage() {
    if (currentAssetId) localStorage.setItem(`rules_${currentAssetId}`, JSON.stringify(rules));
}

function getKeysFromAsset(assetId, attrName) {
    let attrs = allAttributes;
    if (assetId && assetId !== currentAssetId) {
        const asset = allUserAssets.find(a => a.id === assetId);
        attrs = asset ? (asset.attributes || {}) : {};
    }

    if (!attrs[attrName]) return [];
    let val = attrs[attrName];

    if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) { return []; }
    }

    if (val && typeof val === 'object') {
        return Object.keys(val);
    }
    return [];
}

function getSensorOptions(assetId) {
    const sensors = [];

    const groupNames = {
        'EnvData': typeof getFriendlyLabel === 'function' ? getFriendlyLabel('EnvData', true) : 'Environment Data',
        'MoistureData': typeof getFriendlyLabel === 'function' ? getFriendlyLabel('MoistureData', true) : 'Moisture Data',
        'NPKData': typeof getFriendlyLabel === 'function' ? getFriendlyLabel('NPKData', true) : 'NPK Data'
    };

    getKeysFromAsset(assetId, 'EnvData').forEach(k => {
        const keyLabel = typeof getFriendlyLabel === 'function' ? getFriendlyLabel(k) : k;
        sensors.push({ value: `EnvData.${k}`, label: `${groupNames['EnvData']} → ${keyLabel}` });
    });

    getKeysFromAsset(assetId, 'MoistureData').forEach(k => {
        const keyLabel = typeof getFriendlyLabel === 'function' ? getFriendlyLabel(k) : k;
        sensors.push({ value: `MoistureData.${k}`, label: `${groupNames['MoistureData']} → ${keyLabel}` });
    });

    getKeysFromAsset(assetId, 'NPKData').forEach(k => {
        const keyLabel = typeof getFriendlyLabel === 'function' ? getFriendlyLabel(k) : k;
        sensors.push({ value: `NPKData.${k}`, label: `${groupNames['NPKData']} → ${keyLabel}` });
    });

    return sensors.sort((a, b) => a.label.localeCompare(b.label));
}

function getKeysFromAttribute(attrName) {
    return getKeysFromAsset(currentAssetId, attrName);
}

function getRelayOptions() {
    const relays = [];
    getKeysFromAttribute('RelayData').forEach(k => {
        const keyLabel = typeof getFriendlyLabel === 'function' ? getFriendlyLabel(k) : k;
        relays.push({ value: `RelayData.${k}`, label: keyLabel });
    });

    // Fallback for cdvalve assets: if no relays, check for ValveState
    if (relays.length === 0 && allAttributes['ValveState'] !== undefined) {
        const valveLabel = typeof getFriendlyLabel === 'function' ? getFriendlyLabel('valve') : 'Valve';
        relays.push({ value: 'ValveState', label: valveLabel });
    }

    return relays;
}

function updateRule(ruleId, field, value) {
    const rule = rules.find(r => r.id === ruleId);
    if (rule) rule[field] = value;
}

async function toggleRuleState(ruleId, isEnabled) {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;

    rule.enabled = isEnabled;

    const card = document.querySelector(`input[onchange*="${ruleId}"][type="checkbox"]`).closest('.rule-card');
    if (card) {
        if (isEnabled) {
            card.classList.remove('rule-disabled');
            if (rule.relay) {
                await saveRule(ruleId);
            }
        } else {
            card.classList.add('rule-disabled');
            if (rule.sensor) {
                await clearRuleTarget(rule.sensor, ruleId);
                toast(`Rule "${rule.name}" disabled`);
            }
        }
    }

    saveToLocalStorage();
    renderRules();
}

function renderRules() {
    const container = document.getElementById('rulesContainer');
    if (rules.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 4rem; background: white; border-radius: 8px; border: 1px dashed var(--border);">
                <h3 style="color: var(--text-dark); margin-bottom: 0.5rem;">No Rules Configured</h3>
                <p style="color: var(--text-muted);">Create your first automation rule to control relays based on sensor data.</p>
            </div>`;
        return;
    }

    const relays = getRelayOptions();

    let timestampHtml = '';
    if (rulesTimestamp) {
        const date = new Date(rulesTimestamp);
        const formatted = date.toLocaleString();
        timestampHtml = `<div style="grid-column: 1/-1; text-align: right; color: var(--text-muted); font-size: 0.8rem; margin-bottom: 0.5rem;">Last Updated: ${formatted}</div>`;
    }

    container.innerHTML = timestampHtml + rules.map(rule => {
        const sensors = getSensorOptions(rule.whenDeviceId || currentAssetId);
        return `
        <div class="rule-card">
            <div class="rule-card-header">
                <input type="text" class="rule-name-input" value="${rule.name || ''}" 
                       placeholder="Rule Name"
                       onchange="updateRule('${rule.id}', 'name', this.value)">
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <div style="display: flex; align-items: center; margin-right: 12px;" title="Enable/Disable Rule">
                        <label class="toggle-switch" style="transform: scale(0.8);">
                            <input type="checkbox" ${rule.enabled ? 'checked' : ''} 
                                   onchange="toggleRuleState('${rule.id}', this.checked)">
                            <span class="slider"></span>
                        </label>
                        <span style="font-size: 0.75rem; font-weight: 700; margin-left: 6px; color: ${rule.enabled ? 'var(--success)' : 'var(--text-muted)'};">
                            ${rule.enabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                    </div>
                    <button class="btn-sm btn-ghost" onclick="deleteRule('${rule.id}')" title="Delete" style="color:var(--danger); width: auto;">Delete</button>
                </div>
            </div>
            
            <div class="rule-card-body">
                <div class="logic-block">
                    <span class="logic-label">When Condition</span>
                    <div class="device-selector-row" id="deviceRow_when_${rule.id}">
                        <div class="device-label-group">
                            <span class="device-chip">${getWhenDeviceLabel(rule)}</span>
                        </div>
                        <button class="btn-device-change" onclick="showDeviceChangeConfirm('${rule.id}')">Change</button>
                    </div>
                    <div class="device-confirm" id="deviceConfirm_${rule.id}" style="display:none;">
                        <span class="device-confirm-text">Are you sure?</span>
                        <div class="device-confirm-actions">
                            <button class="btn-confirm-yes" onclick="showDeviceList('${rule.id}')">Yes</button>
                            <button class="btn-confirm-no" onclick="hideDeviceChangeConfirm('${rule.id}')">No</button>
                        </div>
                    </div>
                    <div class="device-list" id="deviceList_${rule.id}" style="display:none;"></div>
                    <div class="start-controls">
                        <select class="form-control" style="flex: 2; min-width: 140px;" onchange="updateRule('${rule.id}', 'sensor', this.value)">
                            <option value="">Select sensor...</option>
                            ${sensors.map(s => `<option value="${s.value}" ${rule.sensor === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
                        </select>
                        <select class="form-control" style="flex: 1; min-width: 100px;" onchange="updateRule('${rule.id}', 'operator', this.value)">
                            <option value=">" ${rule.operator === '>' ? 'selected' : ''}>Greater Than</option>
                            <option value="<" ${rule.operator === '<' ? 'selected' : ''}>Less Than</option>
                            <option value="=" ${rule.operator === '=' ? 'selected' : ''}>Equal To</option>
                            <option value="!=" ${rule.operator === '!=' ? 'selected' : ''}>Not</option>
                        </select>
                        <input type="number" class="form-control" style="flex: 1; min-width: 80px;" value="${rule.value}" step="0.1" 
                               onchange="updateRule('${rule.id}', 'value', parseFloat(this.value))">
                    </div>
                </div>
                
                <div class="logic-block">
                    <span class="logic-label">Then Action</span>
                    <div class="device-selector-row device-readonly">
                        <div class="device-label-group">
                            <span class="device-chip device-chip-muted">This Device</span>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <span style="color: var(--text-dark);">Set</span>
                        <select class="form-control" style="flex: 1;" onchange="updateRule('${rule.id}', 'relay', this.value)">
                            <option value="">Select output...</option>
                            ${relays.map(r => `<option value="${r.value}" ${rule.relay === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
                        </select>
                        <span style="color: var(--text-dark);">to</span>
                        <div style="display: flex; align-items: center;">
                            <label class="toggle-switch">
                                <input type="checkbox" ${rule.relayState ? 'checked' : ''} 
                                       onchange="updateRule('${rule.id}', 'relayState', this.checked)">
                                <span class="slider"></span>
                            </label>
                            <span style="font-weight: 700; font-size: 0.9rem; margin-left: 8px; color: ${rule.relayState ? 'var(--primary)' : 'var(--text-muted)'};">
                                ${rule.relayState ? 'ON' : 'OFF'}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="logic-block schedule-limit-block">
                    <div class="schedule-limit-header">
                        <span class="logic-label" style="margin: 0;">Schedule Limit</span>
                        <label class="toggle-switch" style="transform: scale(0.7);">
                            <input type="checkbox" ${rule.timeType !== 'N' ? 'checked' : ''}
                                   onchange="toggleScheduleLimit('${rule.id}', this.checked)">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div id="scheduleConfig_${rule.id}" class="schedule-config" style="display: ${rule.timeType !== 'N' ? 'flex' : 'none'};">
                        <select class="form-control" style="flex: 1.2; min-width: 120px;" onchange="updateRule('${rule.id}', 'timeType', this.value)">
                            <option value="I" ${rule.timeType === 'I' ? 'selected' : ''}>Skip during</option>
                            <option value="A" ${rule.timeType === 'A' ? 'selected' : ''}>Run during</option>
                        </select>
                        <input type="time" class="form-control" style="flex: 1; min-width: 90px;" value="${rule.timeStart || ''}" 
                               onchange="updateRule('${rule.id}', 'timeStart', this.value)">
                        <span style="color: var(--text-muted); font-size: 0.85rem; white-space: nowrap;">to</span>
                        <input type="time" class="form-control" style="flex: 1; min-width: 90px;" value="${rule.timeEnd || ''}" 
                               onchange="updateRule('${rule.id}', 'timeEnd', this.value)">
                    </div>
                </div>
                
                <div style="margin-top: 0.5rem; text-align: right;">
                     <button class="btn-sm" style="width: 100%; margin-top: 1rem;" onclick="saveRule('${rule.id}')">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function getDeviceListHtml(ruleId) {
    return allUserAssets.map(asset => {
        const isCurrent = asset.id === currentAssetId;
        return `<div class="device-list-item ${isCurrent ? 'current' : ''}" onclick="selectWhenDevice('${ruleId}', '${asset.id}')">
            <span class="device-list-name">${asset.name}</span>
            ${isCurrent ? '<span class="device-list-badge">This Device</span>' : ''}
        </div>`;
    }).join('');
}

function showDeviceChangeConfirm(ruleId) {
    document.getElementById(`deviceRow_when_${ruleId}`).style.display = 'none';
    document.getElementById(`deviceConfirm_${ruleId}`).style.display = 'flex';
}

function hideDeviceChangeConfirm(ruleId) {
    document.getElementById(`deviceConfirm_${ruleId}`).style.display = 'none';
    document.getElementById(`deviceList_${ruleId}`).style.display = 'none';
    document.getElementById(`deviceRow_when_${ruleId}`).style.display = 'flex';
}

function showDeviceList(ruleId) {
    document.getElementById(`deviceConfirm_${ruleId}`).style.display = 'none';
    const listEl = document.getElementById(`deviceList_${ruleId}`);
    listEl.innerHTML = getDeviceListHtml(ruleId);
    listEl.style.display = 'block';
}

function selectWhenDevice(ruleId, assetId) {
    const rule = rules.find(r => r.id === ruleId);
    if (rule) {
        rule.whenDeviceId = assetId;
        rule.sensor = ''; // reset sensor selection when device changes
    }
    hideDeviceChangeConfirm(ruleId);
    renderRules();
}

function getWhenDeviceLabel(rule) {
    if (!rule.whenDeviceId || rule.whenDeviceId === currentAssetId) {
        return 'This Device';
    }
    const asset = allUserAssets.find(a => a.id === rule.whenDeviceId);
    return asset ? asset.name : 'Unknown Device';
}

function getOperatorCode(op) {
    const o = op.toLowerCase().trim();
    if (o === '>' || o === 'greater than') return 1;
    if (o === '<' || o === 'less than') return 2;
    if (o === '=' || o === 'equal to') return 3;
    if (o === '!=' || o === 'not equal' || o === 'not') return 4;
    return 0;
}

async function updateRuleTargets(sensorPath, targetRelay, targetState, operator, threshold, ruleId, ruleName, whenDeviceId) {
    const attrName = "RuleTargets";
    const { key: sensorKey } = parseThresholdAttribute(sensorPath);
    if (!sensorKey) return;

    const uniqueKey = `${sensorKey}_${ruleId}`;

    console.log(`[Rules] Syncing targets...`);

    const asset = await fetch(`${APP_PREFIX}/api/asset/${currentAssetId}`).then(r => r.json());
    let targets = asset.attributes[attrName] || {};

    if (typeof targets === 'string') {
        try { targets = JSON.parse(targets); } catch (e) { targets = {}; }
    }

    if (!targets) targets = {};

    targets = { ...targets };
    let rVal = targetRelay;
    if (rVal.includes('.')) rVal = rVal.split('.')[1];

    let groovyOp = operator;
    if (operator === '=') groovyOp = '==';

    // Build the whenDeviceId field (field 5) — empty string if same device
    const deviceField = (whenDeviceId && whenDeviceId !== currentAssetId) ? whenDeviceId : '';

    // Build schedule limit fields (fields 6, 7, 8)
    const rule = rules.find(r => r.id === ruleId);
    const timeType = (rule && rule.timeType && rule.timeType !== 'N') ? rule.timeType : 'N';
    const timeStart = (rule && rule.timeStart) ? rule.timeStart.replace(':', '') : '';
    const timeEnd = (rule && rule.timeEnd) ? rule.timeEnd.replace(':', '') : '';

    let valToStore = `${groovyOp}:${threshold}:${rVal}:${targetState ? '1' : '0'}:${ruleName || ''}:${deviceField}:${timeType}:${timeStart}:${timeEnd}`;

    targets[uniqueKey] = valToStore;

    console.log(`[Rules] Setting ${attrName}.${uniqueKey} = ${valToStore}`);

    await fetch(`${APP_PREFIX}/api/asset/${currentAssetId}/attribute/${attrName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: targets })
    });
}

async function clearRuleTarget(sensorPath, ruleId) {
    const attrName = "RuleTargets";
    const { key: sensorKey } = parseThresholdAttribute(sensorPath);
    if (!sensorKey) return;

    const uniqueKey = `${sensorKey}_${ruleId}`;

    console.log(`[Rules] Clearing target for ${uniqueKey}...`);

    const asset = await fetch(`${APP_PREFIX}/api/asset/${currentAssetId}`).then(r => r.json());
    let targets = asset.attributes[attrName] || {};

    if (typeof targets === 'string') {
        try { targets = JSON.parse(targets); } catch (e) { targets = {}; }
    }

    if (!targets) targets = {};

    targets = { ...targets };
    delete targets[uniqueKey];

    console.log(`[Rules] Removed ${uniqueKey} from ${attrName}`);

    await fetch(`${APP_PREFIX}/api/asset/${currentAssetId}/attribute/${attrName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: targets })
    });
}

async function checkPinStatus() {
    if (!currentAssetId) return;
    try {
        const res = await fetch(`${APP_PREFIX}/api/user/preferences`);
        const prefs = await res.json();
        const pinned = prefs.pinned || [];

        isRulesPinned = pinned.some(p => p.assetId === currentAssetId && p.attributeName === 'RuleTargets');
        updatePinButton();
    } catch (e) { console.error(e); }
}

function updatePinButton() {
    const btn = document.getElementById('pinRulesBtn');
    if (!btn) return;

    if (isRulesPinned) {
        btn.style.color = '#f1c40f';
        btn.style.fontWeight = 'bold';
        btn.innerHTML = 'Pinned';
    } else {
        btn.style.color = '';
        btn.style.fontWeight = '';
        btn.innerHTML = 'Pin to Dashboard';
    }
}

async function pinRulesToDashboard() {
    if (!currentAssetId) return;

    try {
        const payload = {
            assetId: currentAssetId,
            attributeName: 'RuleTargets',
            displayName: 'My Rules'
        };

        const res = await fetch(`${APP_PREFIX}/api/user/preferences/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.status === 'success') {
            isRulesPinned = !isRulesPinned;
            updatePinButton();
            toast(isRulesPinned ? 'Pinned to dashboard' : 'Removed from dashboard');
        } else {
            toast('Failed to update pin');
        }
    } catch (e) {
        console.error(e);
        toast('Action failed');
    }
}

function toggleScheduleLimit(ruleId, isEnabled) {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;

    const panel = document.getElementById(`scheduleConfig_${ruleId}`);
    if (isEnabled) {
        rule.timeType = rule.timeType === 'N' ? 'I' : rule.timeType;
        if (panel) panel.style.display = 'flex';
    } else {
        rule.timeType = 'N';
        rule.timeStart = '';
        rule.timeEnd = '';
        if (panel) panel.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof ensureFriendlyNames === 'function') await ensureFriendlyNames();
    init();
});
