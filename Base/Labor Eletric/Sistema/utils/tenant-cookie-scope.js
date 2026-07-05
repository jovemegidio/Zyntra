'use strict';

const AUTH_COOKIE_NAMES = [
    'authToken',
    'token',
    'refreshToken',
    'rememberToken',
    'trusted_device_2fa'
];

const PATH_SCOPED_COOKIE_NAMES = new Set([
    ...AUTH_COOKIE_NAMES,
    'csrf_token'
]);

function normalizeMountPath(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '/') return '';
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
    return withSlash.replace(/\/+$/, '');
}

function suffixFromMountPath(mountPath) {
    return normalizeMountPath(mountPath)
        .replace(/^\/+/, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function scopedCookieName(name, mountPath = process.env.MOUNT_PATH) {
    const suffix = suffixFromMountPath(mountPath);
    return suffix ? `${name}_${suffix}` : name;
}

function scopedCookiePath(mountPath, cookiePath) {
    const mount = normalizeMountPath(mountPath);
    if (!mount) return cookiePath;

    const rawPath = normalizeMountPath(cookiePath || '/');
    if (!rawPath || rawPath === '/') return mount;
    if (rawPath === mount || rawPath.startsWith(`${mount}/`)) return rawPath;
    return `${mount}${rawPath}`;
}

function tenantCookieScopeMiddleware(req, res, next) {
    const mountPath = normalizeMountPath(process.env.MOUNT_PATH);
    if (!mountPath) return next();

    const scopedName = (name) => scopedCookieName(name, mountPath);
    const allowLegacyRootAuth = process.env.ALLOW_LEGACY_ROOT_AUTH_COOKIE === 'true';
    const cookies = req.cookies || {};
    const originalCookies = Object.assign({}, cookies);

    for (const name of AUTH_COOKIE_NAMES) {
        const tenantName = scopedName(name);
        if (originalCookies[tenantName]) {
            cookies[name] = originalCookies[tenantName];
        } else if (!allowLegacyRootAuth) {
            delete cookies[name];
        }
    }

    req.tenantCookieScope = {
        mountPath,
        scopedName,
        scopedPath: (cookiePath) => scopedCookiePath(mountPath, cookiePath)
    };

    const originalCookie = res.cookie.bind(res);
    res.cookie = function scopedTenantCookie(name, value, options) {
        if (!PATH_SCOPED_COOKIE_NAMES.has(name)) {
            return originalCookie(name, value, options);
        }

        const scopedOptions = Object.assign({}, options || {});
        scopedOptions.path = scopedCookiePath(mountPath, scopedOptions.path);
        const cookieName = AUTH_COOKIE_NAMES.includes(name) ? scopedName(name) : name;
        return originalCookie(cookieName, value, scopedOptions);
    };

    const originalClearCookie = res.clearCookie.bind(res);
    res.clearCookie = function clearScopedTenantCookie(name, options) {
        if (!PATH_SCOPED_COOKIE_NAMES.has(name)) {
            return originalClearCookie(name, options);
        }

        const baseOptions = Object.assign({}, options || {});
        const scopedOptions = Object.assign({}, baseOptions, {
            path: scopedCookiePath(mountPath, baseOptions.path)
        });
        const cookieName = AUTH_COOKIE_NAMES.includes(name) ? scopedName(name) : name;
        originalClearCookie(cookieName, scopedOptions);

        const legacyOptions = Object.assign({}, baseOptions, {
            path: baseOptions.path || '/'
        });
        originalClearCookie(name, legacyOptions);

        if (name === 'refreshToken') {
            originalClearCookie(scopedName(name), Object.assign({}, baseOptions, {
                path: scopedCookiePath(mountPath, '/api/auth')
            }));
            originalClearCookie(name, Object.assign({}, baseOptions, { path: '/api/auth' }));
        }

        return res;
    };

    return next();
}

module.exports = {
    tenantCookieScopeMiddleware,
    normalizeMountPath,
    scopedCookieName,
    scopedCookiePath
};
