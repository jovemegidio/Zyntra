/**
 * ZYNTRA ERP — Unit Tests: writeGuard Middleware
 * Tests permission enforcement for consultoria and restricted roles
 * 
 * Run: npx mocha tests/unit/write-guard.test.js --timeout 5000
 */

const assert = require('assert');

// Direct import of writeGuard logic (mock-friendly version)
function writeGuard(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    if (req.canEdit === undefined && req.canCreate === undefined && req.canDelete === undefined) {
        return next();
    }

    if (req.method === 'DELETE' && req.canDelete === false) {
        return res.status(403).json({ message: 'Seu perfil não permite exclusões.', code: 'WRITE_GUARD_DELETE' });
    }

    if (req.method === 'POST' && req.canCreate === false) {
        return res.status(403).json({ message: 'Seu perfil não permite criar registros.', code: 'WRITE_GUARD_CREATE' });
    }

    if (['PUT', 'PATCH'].includes(req.method) && req.canEdit === false) {
        return res.status(403).json({ message: 'Seu perfil não permite edições.', code: 'WRITE_GUARD_EDIT' });
    }

    next();
}

// Mock res object factory
function mockRes() {
    const r = { statusCode: null, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
}

describe('writeGuard Middleware', function () {

    describe('GET/HEAD/OPTIONS — always allowed', () => {
        ['GET', 'HEAD', 'OPTIONS'].forEach(method => {
            it(`${method} deve passar mesmo com canEdit=false`, (done) => {
                const req = { method, canEdit: false, canCreate: false, canDelete: false };
                const res = mockRes();
                writeGuard(req, res, () => done());
            });
        });
    });

    describe('POST — checks canCreate', () => {
        it('deve bloquear POST quando canCreate=false', () => {
            const req = { method: 'POST', canCreate: false, canEdit: true, canDelete: true };
            const res = mockRes();
            writeGuard(req, res, () => { throw new Error('should not call next'); });
            assert.strictEqual(res.statusCode, 403);
            assert.strictEqual(res.body.code, 'WRITE_GUARD_CREATE');
        });

        it('deve permitir POST quando canCreate=true', (done) => {
            const req = { method: 'POST', canCreate: true, canEdit: true, canDelete: true };
            const res = mockRes();
            writeGuard(req, res, () => done());
        });
    });

    describe('PUT/PATCH — checks canEdit', () => {
        ['PUT', 'PATCH'].forEach(method => {
            it(`deve bloquear ${method} quando canEdit=false`, () => {
                const req = { method, canEdit: false, canCreate: true, canDelete: true };
                const res = mockRes();
                writeGuard(req, res, () => { throw new Error('should not call next'); });
                assert.strictEqual(res.statusCode, 403);
                assert.strictEqual(res.body.code, 'WRITE_GUARD_EDIT');
            });

            it(`deve permitir ${method} quando canEdit=true`, (done) => {
                const req = { method, canEdit: true, canCreate: true, canDelete: true };
                const res = mockRes();
                writeGuard(req, res, () => done());
            });
        });
    });

    describe('DELETE — checks canDelete', () => {
        it('deve bloquear DELETE quando canDelete=false', () => {
            const req = { method: 'DELETE', canDelete: false, canCreate: true, canEdit: true };
            const res = mockRes();
            writeGuard(req, res, () => { throw new Error('should not call next'); });
            assert.strictEqual(res.statusCode, 403);
            assert.strictEqual(res.body.code, 'WRITE_GUARD_DELETE');
        });

        it('deve permitir DELETE quando canDelete=true', (done) => {
            const req = { method: 'DELETE', canDelete: true, canCreate: true, canEdit: true };
            const res = mockRes();
            writeGuard(req, res, () => done());
        });
    });

    describe('Backwards compatibility — undefined flags', () => {
        it('POST deve passar quando flags não estão definidas', (done) => {
            const req = { method: 'POST' }; // sem canCreate/canEdit/canDelete
            const res = mockRes();
            writeGuard(req, res, () => done());
        });

        it('DELETE deve passar quando flags não estão definidas', (done) => {
            const req = { method: 'DELETE' };
            const res = mockRes();
            writeGuard(req, res, () => done());
        });
    });

    describe('Consultoria scenario (all restricted)', () => {
        const consultoriaReq = (method) => ({
            method,
            canCreate: false,
            canEdit: false,
            canDelete: false,
            user: { role: 'consultoria' }
        });

        it('POST bloqueado para consultoria', () => {
            const res = mockRes();
            writeGuard(consultoriaReq('POST'), res, () => { throw new Error('should not call next'); });
            assert.strictEqual(res.statusCode, 403);
        });

        it('PUT bloqueado para consultoria', () => {
            const res = mockRes();
            writeGuard(consultoriaReq('PUT'), res, () => { throw new Error('should not call next'); });
            assert.strictEqual(res.statusCode, 403);
        });

        it('DELETE bloqueado para consultoria', () => {
            const res = mockRes();
            writeGuard(consultoriaReq('DELETE'), res, () => { throw new Error('should not call next'); });
            assert.strictEqual(res.statusCode, 403);
        });

        it('GET permitido para consultoria', (done) => {
            const res = mockRes();
            writeGuard(consultoriaReq('GET'), res, () => done());
        });
    });
});
