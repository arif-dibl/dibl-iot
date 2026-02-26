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

        const res = await fetch(`${APP_PREFIX}/api/friendly-names`);
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
    return date.toLocaleDateString();
}


const OFFLINE_TIMEOUT_MS = 5000;

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
