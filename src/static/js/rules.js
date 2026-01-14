let rules = [];
let ruleIdCounter = 1;
let currentAssetId = null;
let allAttributes = {};
let isRulesPinned = false;
let rulesTimestamp = null;


async function init() {
    try {
        const res = await fetch('/api/user/assets');
        const data = await res.json();
        const assets = Array.isArray(data) ? data : (data.assets || []);

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
    currentAssetId = assetId;
    document.getElementById('addRuleBtn').disabled = false;
    document.getElementById('pinRulesBtn').disabled = false;

    try {
        const res = await fetch(`/api/asset/${currentAssetId}`);
        const asset = await res.json();
        allAttributes = asset.attributes || {};

        let rTargets = asset.attributes['RuleTargets'];
        if (rTargets && rTargets._timestamp) {
            rulesTimestamp = rTargets._timestamp;
        } else {
            rulesTimestamp = null;
        }

        const stored = localStorage.getItem(`rules_${assetId}`);
        if (stored) {
            rules = JSON.parse(stored);
            rules.forEach(r => { if (r.enabled === undefined) r.enabled = true; });
            ruleIdCounter = Math.max(...rules.map(r => parseInt(r.id.split('_')[1]) || 0), 0) + 1;
        } else {
            rules = [];

            if (typeof rTargets === 'string') {
                try { rTargets = JSON.parse(rTargets); } catch (e) { rTargets = {}; }
            }

            if (rTargets && typeof rTargets === 'object') {
                console.log('Recovering rules from RuleTargets...', rTargets);

                Object.entries(rTargets).forEach(([key, valStr]) => {
                    try {
                        let ruleId = `rule_${ruleIdCounter++}`;
                        const keyParts = key.split('_rule_');
                        let sensorKey = keyParts[0];

                        if (keyParts.length > 1) {
                            ruleId = `rule_${keyParts[1]}`;
                            const numId = parseInt(keyParts[1]);
                            if (!isNaN(numId) && numId >= ruleIdCounter) ruleIdCounter = numId + 1;
                        }

                        const parts = valStr.split(':');
                        if (parts.length >= 4) {
                            let op = parts[0];
                            if (op === '==') op = '=';

                            const rName = parts.length > 4 ? parts[4] : `Rule ${ruleIdCounter}`;
                            const rVal = parts[3] === '1';

                            let sensorPath = '';
                            if (asset.attributes.EnvData && asset.attributes.EnvData[sensorKey] !== undefined) sensorPath = `EnvData.${sensorKey}`;
                            else if (asset.attributes.MoistureData && asset.attributes.MoistureData[sensorKey] !== undefined) sensorPath = `MoistureData.${sensorKey}`;
                            else if (asset.attributes.NPKData && asset.attributes.NPKData[sensorKey] !== undefined) sensorPath = `NPKData.${sensorKey}`;

                            if (sensorPath) {
                                rules.push({
                                    id: ruleId,
                                    name: rName,
                                    sensor: sensorPath,
                                    operator: op,
                                    value: parseFloat(parts[1]),
                                    relay: `RelayData.${parts[2]}`,
                                    relayState: rVal,
                                    enabled: true
                                });
                            }
                        }
                    } catch (e) { console.error('Error parsing rule recovery:', e); }
                });

                if (rules.length > 0) {
                    localStorage.setItem(`rules_${assetId}`, JSON.stringify(rules));
                    toast('Restored rules from device');
                }
            }
        }

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
        enabled: true
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
            await updateRuleTargets(rule.sensor, rule.relay, state, rule.operator, rule.value, ruleId, rule.name);
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

function getKeysFromAttribute(attrName) {
    if (!allAttributes[attrName]) return [];
    let val = allAttributes[attrName];

    if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) { return []; }
    }

    if (val && typeof val === 'object') {
        return Object.keys(val);
    }
    return [];
}

function getSensorOptions() {
    const sensors = [];

    getKeysFromAttribute('EnvData').forEach(k =>
        sensors.push({ value: `EnvData.${k}`, label: `EnvData.${k}` }));

    getKeysFromAttribute('MoistureData').forEach(k =>
        sensors.push({ value: `MoistureData.${k}`, label: `MoistureData.${k}` }));

    getKeysFromAttribute('NPKData').forEach(k =>
        sensors.push({ value: `NPKData.${k}`, label: `NPKData.${k}` }));

    return sensors.sort((a, b) => a.label.localeCompare(b.label));
}

function getRelayOptions() {
    const relays = [];
    getKeysFromAttribute('RelayData').forEach(k =>
        relays.push({ value: `RelayData.${k}`, label: `RelayData.${k}` }));
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

    const sensors = getSensorOptions();
    const relays = getRelayOptions();

    let timestampHtml = '';
    if (rulesTimestamp) {
        const date = new Date(rulesTimestamp);
        const formatted = date.toLocaleString();
        timestampHtml = `<div style="grid-column: 1/-1; text-align: right; color: var(--text-muted); font-size: 0.8rem; margin-bottom: 0.5rem;">Last Updated: ${formatted}</div>`;
    }

    container.innerHTML = timestampHtml + rules.map(rule => `
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
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <span style="color: var(--text-dark);">Set</span>
                        <select class="form-control" style="flex: 1;" onchange="updateRule('${rule.id}', 'relay', this.value)">
                            <option value="">Select relay...</option>
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
                
                <div style="margin-top: 0.5rem; text-align: right;">
                     <button class="btn-sm" style="width: 100%; margin-top: 1rem;" onclick="saveRule('${rule.id}')">Save Changes</button>
                </div>
            </div>
        </div>
    `).join('');
}

function getOperatorCode(op) {
    const o = op.toLowerCase().trim();
    if (o === '>' || o === 'greater than') return 1;
    if (o === '<' || o === 'less than') return 2;
    if (o === '=' || o === 'equal to') return 3;
    if (o === '!=' || o === 'not equal' || o === 'not') return 4;
    return 0;
}

async function updateRuleTargets(sensorPath, targetRelay, targetState, operator, threshold, ruleId, ruleName) {
    const attrName = "RuleTargets";
    const { key: sensorKey } = parseThresholdAttribute(sensorPath);
    if (!sensorKey) return;

    const uniqueKey = `${sensorKey}_${ruleId}`;

    console.log(`[Rules] Syncing targets...`);

    const asset = await fetch(`/api/asset/${currentAssetId}`).then(r => r.json());
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

    const valToStore = `${groovyOp}:${threshold}:${rVal}:${targetState ? '1' : '0'}:${ruleName || ''}`;

    targets[uniqueKey] = valToStore;

    console.log(`[Rules] Setting ${attrName}.${uniqueKey} = ${valToStore}`);

    await fetch(`/api/asset/${currentAssetId}/attribute/${attrName}`, {
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

    const asset = await fetch(`/api/asset/${currentAssetId}`).then(r => r.json());
    let targets = asset.attributes[attrName] || {};

    if (typeof targets === 'string') {
        try { targets = JSON.parse(targets); } catch (e) { targets = {}; }
    }

    if (!targets) targets = {};

    targets = { ...targets };
    delete targets[uniqueKey];

    console.log(`[Rules] Removed ${uniqueKey} from ${attrName}`);

    await fetch(`/api/asset/${currentAssetId}/attribute/${attrName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: targets })
    });
}

async function checkPinStatus() {
    if (!currentAssetId) return;
    try {
        const res = await fetch('/api/user/preferences');
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

        const res = await fetch('/api/user/preferences/pin', {
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

document.addEventListener('DOMContentLoaded', () => {
    init();
});
