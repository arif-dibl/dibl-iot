// State
let currentAssetId = null;
let currentAttribute = null;
let realm = 'master';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Priority: window.USER_REALM passed from template
    realm = window.USER_REALM || 'master';
    await loadAssets();
});

async function loadAssets() {
    const select = document.getElementById('assetSelect');
    select.innerHTML = '<option>Loading...</option>';

    try {
        const res = await fetch('/api/user/assets');
        const data = await res.json();

        if (data.error) {
            select.innerHTML = `<option value="">Error: ${data.error}</option>`;
            return;
        }

        const assets = Array.isArray(data) ? data : (data.assets || []);

        if (assets.length === 0) {
            select.innerHTML = '<option value="">No linked assets</option>';
            return;
        }

        select.innerHTML = '<option value="">Select asset...</option>';
        assets.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name || a.id;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error loading assets</option>';
    }
}

async function loadAttributes(assetId) {
    const select = document.getElementById('attributeSelect');
    select.innerHTML = '<option value="">Loading...</option>';
    select.disabled = true;
    currentAssetId = assetId || null;
    currentAttribute = null;

    if (!assetId) {
        select.innerHTML = '<option value="">Select asset first...</option>';
        return;
    }

    try {
        const res = await fetch(`/api/asset/${assetId}`);
        const asset = await res.json();
        const attrs = asset.attributes || {};

        select.innerHTML = '<option value="">Select attribute...</option>';

        // Only use actual attribute keys, do not expand JSON
        Object.keys(attrs).sort().forEach(key => {
            const el = document.createElement('option');
            el.value = key;
            el.textContent = key;
            select.appendChild(el);
        });

        select.disabled = false;

        select.onchange = () => {
            currentAttribute = select.value;
        };

    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error</option>';
    }
}

function getTimeRange() {
    const sel = document.getElementById('timeSelect').value;
    const now = Date.now();
    let start = now - 24 * 3600000; // default 24h

    if (sel === 'last_hour') start = now - 3600000;
    else if (sel === 'last_7d') start = now - 7 * 24 * 3600000;
    else if (sel === 'today') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        start = d.getTime();
    }
    return { start, end: now };
}

function showOutput(data, isError = false) {
    const out = document.getElementById('responseOutput');
    out.style.color = isError ? '#f55' : '#0f0';
    out.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function fetchDatapoints() {
    if (!currentAssetId || !currentAttribute) {
        return showOutput('Please select an asset and attribute.', true);
    }
    showOutput('Fetching...');

    const { start, end } = getTimeRange();
    // Official API: GET /api/{realm}/asset/datapoint/{assetId}/{attributeName}
    const endpoint = `/api/${realm}/asset/datapoint/${currentAssetId}/${currentAttribute}`;

    try {
        const res = await fetch('/api/debug/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'GET',
                endpoint: `${endpoint}?fromTimestamp=${start}&toTimestamp=${end}`,
                body: null
            })
        });
        const data = await res.json();
        showOutput(data.data || data, data.status >= 400);
    } catch (e) {
        showOutput('Request failed: ' + e.message, true);
    }
}

async function fetchDatapointPeriod() {
    if (!currentAssetId || !currentAttribute) {
        return showOutput('Please select an asset and attribute.', true);
    }
    showOutput('Fetching...');

    const { start, end } = getTimeRange();
    // Official API: POST /api/{realm}/asset/datapoint/period
    const endpoint = `/api/${realm}/asset/datapoint/period`;
    const body = {
        assetId: currentAssetId,
        attribute: currentAttribute,
        fromTimestamp: start,
        toTimestamp: end
    };

    try {
        const res = await fetch('/api/debug/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'POST', endpoint, body })
        });
        const data = await res.json();
        showOutput(data.data || data, data.status >= 400);
    } catch (e) {
        showOutput('Request failed: ' + e.message, true);
    }
}

async function exportDatapoints() {
    if (!currentAssetId || !currentAttribute) {
        return showOutput('Please select an asset and attribute.', true);
    }
    showOutput('Exporting...');

    const { start, end } = getTimeRange();
    // Official API: POST /api/{realm}/asset/datapoint/export
    const endpoint = `/api/${realm}/asset/datapoint/export`;
    const body = {
        attributeRefs: [{
            id: currentAssetId,
            name: currentAttribute
        }],
        fromTimestamp: start,
        toTimestamp: end
    };

    try {
        const res = await fetch('/api/debug/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'POST', endpoint, body })
        });
        const data = await res.json();
        showOutput(data.data || data, data.status >= 400);
    } catch (e) {
        showOutput('Request failed: ' + e.message, true);
    }
}
