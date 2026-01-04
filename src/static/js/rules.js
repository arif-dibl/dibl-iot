let rules = [];
let ruleIdCounter = 1;
let currentAssetId = null;
let allAttributes = {};
let isRulesPinned = false;

// Load assets on page load
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

    // Load asset attributes
    try {
        const res = await fetch(`/api/asset/${currentAssetId}`);
        const asset = await res.json();
        allAttributes = asset.attributes || {};

        // Load existing rules from localStorage
        const stored = localStorage.getItem(`rules_${assetId}`);
        if (stored) {
            rules = JSON.parse(stored);
            // Migration: Ensure 'enabled' property exists
            rules.forEach(r => { if (r.enabled === undefined) r.enabled = true; });
            ruleIdCounter = Math.max(...rules.map(r => parseInt(r.id.split('_')[1]) || 0), 0) + 1;
        } else {
            rules = [];
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
        // Clear the RuleTargets entry for this specific rule
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

        // Sync target relay mapping with RuleTargets only
        // Sync target relay mapping with RuleTargets only
        if (rule.enabled) {
            // Ensure relayState is defined (default true/ON if undefined)
            const state = rule.relayState !== undefined ? rule.relayState : true;
            await updateRuleTargets(rule.sensor, rule.relay, state, rule.operator, rule.value, ruleId, rule.name);
        } else if (!rule.enabled && rule.sensor) {
            // If disabled, ensure it's removed from backend (just in case)
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
        // NPKData.m01 -> keys are m01, t01, etc.
        // No threshold attribute available for NPK, but we still return the key for identifying the rule target
        return { thresholdAttr: '', key: sensorPath.split('.')[1] };
    }
    return { thresholdAttr: '', key: '' };
}

function saveToLocalStorage() {
    if (currentAssetId) localStorage.setItem(`rules_${currentAssetId}`, JSON.stringify(rules));
}

function getKeysFromAttribute(attrName) {
    if (!allAttributes[attrName]) return [];
    // Backend returns flattened attributes, so value is already the direct value
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

    // EnvData
    getKeysFromAttribute('EnvData').forEach(k =>
        sensors.push({ value: `EnvData.${k}`, label: `EnvData.${k}` }));

    // MoistureData
    getKeysFromAttribute('MoistureData').forEach(k =>
        sensors.push({ value: `MoistureData.${k}`, label: `MoistureData.${k}` }));

    // NPKData
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

    // Update UI immediately (disabled style)
    const card = document.querySelector(`input[onchange*="${ruleId}"][type="checkbox"]`).closest('.rule-card');
    if (card) {
        if (isEnabled) {
            card.classList.remove('rule-disabled');
            // Re-sync to backend
            if (rule.relay) {
                await saveRule(ruleId); // Re-use save logic to push to backend
            }
        } else {
            card.classList.add('rule-disabled');
            // Remove from backend
            if (rule.sensor) {
                await clearRuleTarget(rule.sensor, ruleId);
                toast(`Rule "${rule.name}" disabled`);
            }
        }
    }

    saveToLocalStorage();
    renderRules(); // Re-render to update text label (ENABLED/DISABLED)
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

    container.innerHTML = rules.map(rule => `
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
    // Normalize checking
    const o = op.toLowerCase().trim();
    if (o === '>' || o === 'greater than') return 1;
    if (o === '<' || o === 'less than') return 2;
    if (o === '=' || o === 'equal to') return 3;
    if (o === '!=' || o === 'not equal' || o === 'not') return 4;
    return 0;
}

async function updateRuleTargets(sensorPath, targetRelay, targetState, operator, threshold, ruleId, ruleName) {
    // Store in RuleTargets attribute
    // Format: { "sensorKey_ruleId": "operator:threshold:relay:relayValue:ruleName", ... }
    // Example: { "t0_rule_1": "<:20:r1:0:MyRule" }

    const attrName = "RuleTargets";
    const { key: sensorKey } = parseThresholdAttribute(sensorPath);
    if (!sensorKey) return;

    // Create unique key combining sensor and rule ID
    const uniqueKey = `${sensorKey}_${ruleId}`;

    console.log(`[Rules] Syncing targets...`);

    const asset = await fetch(`/api/asset/${currentAssetId}`).then(r => r.json());
    let targets = asset.attributes[attrName] || {};

    if (typeof targets === 'string') {
        try { targets = JSON.parse(targets); } catch (e) { targets = {}; }
    }

    // Handle null/undefined case
    if (!targets) targets = {};

    targets = { ...targets };
    // Clean target relay string "RelayData.r1" -> "r1"
    let rVal = targetRelay;
    if (rVal.includes('.')) rVal = rVal.split('.')[1];

    // Construct new format: "operator:threshold:relay:relayValue:ruleName"
    // Map UI operator to Groovy-compatible format
    let groovyOp = operator;
    if (operator === '=') groovyOp = '=='; // Groovy uses == for equality

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

    // Use the same unique key format
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
        btn.style.color = '#f1c40f'; // Yellow/Gold
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

    // We can use the same endpoint; if it toggles, we just need to update our local state
    // But since main.js pinWidget is blind, let's implement the specific logic here or handle the UI update after

    // Using the same logic as asset_detail.js -> POST /api/user/preferences/pin toggles if exists
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
            isRulesPinned = !isRulesPinned; // Toggle state
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

// Init
document.addEventListener('DOMContentLoaded', () => {
    init();
});
