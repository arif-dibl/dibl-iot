// Utilities
let friendlyNames = { attributes: {}, keys: {} };

async function fetchFriendlyNames() {
    try {
        const res = await fetch('/api/friendly-names');
        friendlyNames = await res.json();
    } catch (e) { console.error('Failed to load friendly names:', e); }
}

// Helper: Friendly Labels
function getFriendlyLabel(key, isAttribute = false) {
    if (!key) return '';
    const map = isAttribute ? friendlyNames.attributes : friendlyNames.keys;

    // Exact match first
    if (map[key]) return map[key];

    // Case-insensitive match second
    const lowerKey = key.toLowerCase();
    const found = Object.keys(map).find(k => k.toLowerCase() === lowerKey);
    if (found) return map[found];

    // Fallback patterns for those not explicitly in JSON
    if (/^t(\d+)?$/i.test(key)) return key.replace(/t/i, 'Temperature');
    if (/^h(\d+)?$/i.test(key)) return key.replace(/h/i, 'Humidity');
    if (/^m(\d+)?$/i.test(key)) return key.replace(/m/i, 'Moisture');
    if (/^r(\d+)?$/i.test(key)) return key.replace(/r/i, 'Switch');
    return key;
}

// Helper: Check if value is boolean-like (true/false/on/off)
function isBooleanLike(val) {
    if (typeof val === 'boolean') return true;
    if (typeof val === 'string') {
        const lower = val.toLowerCase().trim();
        return ['true', 'false', 'on', 'off'].includes(lower);
    }
    return false;
}

// Helper: Convert boolean-like value to actual boolean
function toBool(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
        const lower = val.toLowerCase().trim();
        return lower === 'true' || lower === 'on';
    }
    return false;
}

// Helper: Time Ago
function timeAgo(dateOrTimestamp) {
    const date = (typeof dateOrTimestamp === 'number') ? new Date(dateOrTimestamp) : dateOrTimestamp;
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
}

// Global Toast
function toast(msg) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#333;color:white;padding:12px 24px;border-radius:8px;z-index:99999;animation:fadeIn 0.3s;';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transition = 'opacity 0.3s';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

// Auto-fetch on load
fetchFriendlyNames();
// Shared Pinning Logic
async function pinWidget(assetId, attrName, key, defaultName) {
    try {
        let displayName = defaultName || key || attrName;

        // Prompt for custom name UNLESS it is RuleTargets
        if (attrName !== 'RuleTargets') {
            const customName = prompt('Enter a display name for this dashboard widget:', displayName);
            if (customName === null) return; // Cancelled
            if (customName && customName.trim() !== '') displayName = customName.trim();
        } else {
            // Force default name for rules if not provided
            displayName = 'My Rules';
        }

        const payload = {
            assetId: assetId,
            attributeName: attrName,
            displayName: displayName
        };

        if (key) payload.key = key;

        const res = await fetch('/api/user/preferences/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.status === 'success') {
            toast('Pinned to dashboard successfully');
        } else {
            toast('Failed to pin widget: ' + (data.message || 'Unknown error'));
        }
    } catch (e) {
        console.error(e);
        toast('Action failed');
    }
}
