let friendlyNames = { attributes: {}, keys: {} };

const FRIENDLY_NAMES_CACHE_KEY = 'dibl_friendly_names';
const FRIENDLY_NAMES_CACHE_TTL = 5 * 60 * 1000;

async function fetchFriendlyNames() {
    try {
        const cached = sessionStorage.getItem(FRIENDLY_NAMES_CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < FRIENDLY_NAMES_CACHE_TTL) {
                // Only use cache if it actually has keys
                if (data && data.keys && Object.keys(data.keys).length > 0) {
                    friendlyNames = data;
                    console.log('[FriendlyNames] Loaded from cache, keys:', Object.keys(data.keys).length);
                    return;
                } else {
                    // Stale/empty cache - discard and re-fetch
                    sessionStorage.removeItem(FRIENDLY_NAMES_CACHE_KEY);
                    console.log('[FriendlyNames] Cache was empty/invalid, re-fetching');
                }
            }
        }

        // Use BASE_PREFIX (public endpoint, no auth required)
        const prefix = typeof BASE_PREFIX !== 'undefined' ? BASE_PREFIX : APP_PREFIX;
        const res = await fetch(`${prefix}/api/friendly-names`);
        if (!res.ok) {
            console.error('[FriendlyNames] API returned', res.status);
            return;
        }
        const data = await res.json();
        console.log('[FriendlyNames] API response:', data);

        if (data && data.keys && Object.keys(data.keys).length > 0) {
            friendlyNames = data;
            sessionStorage.setItem(FRIENDLY_NAMES_CACHE_KEY, JSON.stringify({
                data: friendlyNames,
                timestamp: Date.now()
            }));
            console.log('[FriendlyNames] Loaded from API, keys:', Object.keys(data.keys).length);
        } else {
            console.warn('[FriendlyNames] API returned empty data:', data);
        }
    } catch (e) {
        console.error('Failed to load friendly names:', e);
    }
}

function getFriendlyLabel(key, isAttribute = false) {
    if (!key) return '';
    const map = isAttribute
        ? (friendlyNames && friendlyNames.attributes ? friendlyNames.attributes : {})
        : (friendlyNames && friendlyNames.keys ? friendlyNames.keys : {});

    if (map[key]) return map[key];

    const lowerKey = key.toLowerCase();
    const found = Object.keys(map).find(k => k.toLowerCase() === lowerKey);
    if (found) return map[found];

    if (/^t(\d+)?$/i.test(key)) return key.replace(/t/i, 'Temperature');
    if (/^h(\d+)?$/i.test(key)) return key.replace(/h/i, 'Humidity');
    if (/^m(\d+)?$/i.test(key)) return key.replace(/m/i, 'Moisture');
    if (/^r(\d+)?$/i.test(key)) return key.replace(/r/i, 'Switch');
    return key;
}

/**
 * Returns the measurement unit for a sensor key based on its parent attribute.
 * @param {string} key - The sensor key (e.g. 't1', 'h', 'm2', 'n1', 'ec1', 'ph1')
 * @param {string} attributeName - Parent attribute name (EnvData, MoistureData, NPKData)
 * @returns {string} The unit string, or '' if unknown
 */
function getSensorUnit(key, attributeName) {
    if (!key) return '';
    const k = key.replace(/[0-9]/g, '').toLowerCase();
    const attr = (attributeName || '').toLowerCase();

    if (attr === 'envdata') {
        if (k === 't' || k === 'temp' || k === 'temperature') return '°C';
        if (k === 'h' || k === 'hum' || k === 'humidity') return '%RH';
        if (k === 'l' || k === 'light') return '%';
    } else if (attr === 'moisturedata') {
        if (k === 'm' || k === 'moisture') return '%RH';
    } else if (attr === 'npkdata') {
        if (k === 'm' || k === 'moisture') return '%RH';
        if (k === 't' || k === 'temp' || k === 'temperature') return '°C';
        if (k === 'ec') return 'µS/cm';
        if (k === 'ph') return '';
        if (k === 'n' || k === 'nitrogen' || k === 'p' || k === 'phosphorus' || k === 'k' || k === 'potassium') return 'mg/kg';
    }

    // Fallback: try to guess from key alone
    if (k === 't' || k === 'temp' || k === 'temperature') return '°C';
    if (k === 'h' || k === 'hum' || k === 'humidity') return '%RH';
    if (k === 'l' || k === 'light') return '%';
    if (k === 'm' || k === 'moisture') return '%RH';
    if (k === 'ec') return 'µS/cm';
    if (k === 'n' || k === 'nitrogen' || k === 'p' || k === 'phosphorus' || k === 'k' || k === 'potassium') return 'mg/kg';

    return '';
}

/**
 * Formats a sensor value with its unit.
 * Returns '--' for empty/placeholder values, appends unit for numeric values.
 * @param {*} value - The raw sensor value
 * @param {string} key - The sensor key
 * @param {string} attributeName - Parent attribute name
 * @returns {string} Formatted value string
 */
function formatSensorValue(value, key, attributeName) {
    if (value === '' || value === '--' || value === null || value === undefined) return '--';
    const unit = getSensorUnit(key, attributeName);
    if (!unit) return String(value);
    // Only append unit if the value looks numeric
    const num = Number(value);
    if (!isNaN(num) && String(value).trim() !== '') {
        return `${value} ${unit}`;
    }
    return String(value);
}

function isBooleanLike(val) {
    if (typeof val === 'boolean') return true;
    if (typeof val === 'string') {
        const lower = val.toLowerCase().trim();
        return ['true', 'false', 'on', 'off'].includes(lower);
    }
    return false;
}

function toBool(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
        const lower = val.toLowerCase().trim();
        return lower === 'true' || lower === 'on';
    }
    return false;
}

function timeAgo(dateOrTimestamp) {
    const date = (typeof dateOrTimestamp === 'number') ? new Date(dateOrTimestamp) : dateOrTimestamp;
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
}


const OFFLINE_TIMEOUT_MS = 10000;

function getAssetStatus(lastActivityTimestamp) {
    if (!lastActivityTimestamp) {
        return { status: 'Offline', color: 'var(--danger)', dot: '🔴', isOffline: true };
    }

    const diffMs = Date.now() - lastActivityTimestamp;

    if (diffMs <= OFFLINE_TIMEOUT_MS) {
        return { status: 'Active', color: 'var(--success)', dot: '🟢', isOffline: false };
    } else {
        return { status: 'Offline', color: 'var(--danger)', dot: '🔴', isOffline: true };
    }
}

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

let _friendlyNamesPromise = null;
function ensureFriendlyNames() {
    if (!_friendlyNamesPromise) {
        _friendlyNamesPromise = fetchFriendlyNames().catch(() => { });
    }
    return _friendlyNamesPromise;
}
ensureFriendlyNames();

function clearDiblCache() {
    sessionStorage.removeItem(FRIENDLY_NAMES_CACHE_KEY);
}

async function pinWidget(assetId, attrName, key, defaultName) {
    try {
        let displayName = defaultName || key || attrName;

        if (attrName !== 'RuleTargets' && !attrName.toLowerCase().startsWith('timer')) {
            const customName = prompt('Enter a display name for this dashboard widget:', displayName);
            if (customName === null) return;
            if (customName && customName.trim() !== '') displayName = customName.trim();
        } else {
            if (attrName === 'RuleTargets') displayName = 'My Rules';
        }

        const payload = {
            assetId: assetId,
            attributeName: attrName,
            displayName: displayName
        };

        if (key) payload.key = key;

        const res = await fetch(`${APP_PREFIX}/api/user/preferences/pin`, {
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

// ── Smart Navbar: hide on scroll-up, show on scroll-down (mobile only) ──
(function () {
    const MOBILE_QUERY = '(max-width: 1024px)';
    let lastScrollY = window.scrollY;

    window.addEventListener('scroll', function () {
        // Re-check on every scroll so orientation changes are handled correctly
        if (!window.matchMedia(MOBILE_QUERY).matches) return;

        const navbar = document.querySelector('.top-nav');
        if (!navbar) return;

        const currentScrollY = window.scrollY;

        if (currentScrollY > lastScrollY && currentScrollY > 50) {
            // Scrolling DOWN → hide navbar (slide it above viewport)
            navbar.classList.add('nav-hidden');
        } else {
            // Scrolling UP → show navbar immediately
            navbar.classList.remove('nav-hidden');
        }

        lastScrollY = currentScrollY;
    }, { passive: true });
})();
