/**
 * ALUFORCE ERP - Unit Tests: Authentication Middleware
 * Tests for JWT authentication and authorization logic
 */

const assert = require('assert');
const jwt = require('jsonwebtoken');

// Mock environment
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests';
process.env.DEV_MOCK = '1';

const { authenticateToken, requireAdmin, checkPermission } = require('../../middleware/auth');

describe('Authentication Middleware', function() {
  
  describe('authenticateToken', function() {
    
    it('should reject request without token', function(done) {
      const req = { cookies: {}, headers: {} };
      const res = {
        status: function(code) { 
          this.statusCode = code; 
          return this; 
        },
        json: function(data) { 
          this.body = data;
          assert.strictEqual(this.statusCode, 401);
          assert.strictEqual(data.error, 'Token não fornecido');
          done();
        }
      };
      authenticateToken(req, res, () => {});
    });

    it('should reject request with invalid token', function(done) {
      const req = { 
        cookies: { authToken: 'invalid-token' }, 
        headers: {} 
      };
      const res = {
        status: function(code) { 
          this.statusCode = code; 
          return this; 
        },
        json: function(data) { 
          this.body = data;
          assert.strictEqual(this.statusCode, 403);
          assert.strictEqual(data.error, 'Token inválido');
          done();
        }
      };
      authenticateToken(req, res, () => {});
    });

    it('should accept valid token from cookie', function(done) {
      const validToken = jwt.sign(
        { id: 1, email: 'test@aluforce.ind.br', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
      const req = { 
        cookies: { authToken: validToken }, 
        headers: {} 
      };
      const res = {};
      authenticateToken(req, res, () => {
        assert.ok(req.user);
        assert.strictEqual(req.user.email, 'test@aluforce.ind.br');
        assert.strictEqual(req.user.role, 'admin');
        done();
      });
    });

    it('should accept valid token from Authorization header', function(done) {
      const validToken = jwt.sign(
        { id: 2, email: 'user@aluforce.ind.br', role: 'user' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
      const req = { 
        cookies: {}, 
        headers: { authorization: 'Bearer ' + validToken } 
      };
      const res = {};
      authenticateToken(req, res, () => {
        assert.ok(req.user);
        assert.strictEqual(req.user.email, 'user@aluforce.ind.br');
        done();
      });
    });

    it('should reject expired token', function(done) {
      const expiredToken = jwt.sign(
        { id: 1, email: 'test@aluforce.ind.br' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );
      const req = { 
        cookies: { authToken: expiredToken }, 
        headers: {} 
      };
      const res = {
        status: function(code) { 
          this.statusCode = code; 
          return this; 
        },
        json: function(data) { 
          assert.strictEqual(this.statusCode, 403);
          done();
        }
      };
      authenticateToken(req, res, () => {});
    });
  });

  describe('requireAdmin', function() {
    
    it('should reject non-authenticated user', function(done) {
      const req = {};
      const res = {
        status: function(code) { 
          this.statusCode = code; 
          return this; 
        },
        json: function(data) { 
          assert.strictEqual(this.statusCode, 401);
          done();
        }
      };
      requireAdmin(req, res, () => {});
    });

    it('should allow admin role', function(done) {
      const req = { user: { role: 'admin', email: 'admin@test.com' } };
      const res = {};
      requireAdmin(req, res, () => {
        done();
      });
    });

    it('should allow admin by email', function(done) {
      const req = { user: { role: 'user', email: 'ti@aluforce.ind.br' } };
      const res = {};
      requireAdmin(req, res, () => {
        done();
      });
    });

    it('should reject non-admin user', function(done) {
      const req = { user: { role: 'user', email: 'regular@test.com' } };
      const res = {
        status: function(code) { 
          this.statusCode = code; 
          return this; 
        },
        json: function(data) { 
          assert.strictEqual(this.statusCode, 403);
          done();
        }
      };
      requireAdmin(req, res, () => {});
    });
  });

  describe('checkPermission', function() {
    
    it('should allow admin regardless of permission', function(done) {
      const middleware = checkPermission('vendas.edit');
      const req = { user: { role: 'admin' } };
      const res = {};
      middleware(req, res, () => {
        done();
      });
    });

    it('should allow user with specific permission', function(done) {
      const middleware = checkPermission('vendas.edit');
      const req = { user: { role: 'user', permissions: ['vendas.edit', 'vendas.view'] } };
      const res = {};
      middleware(req, res, () => {
        done();
      });
    });

    it('should reject user without permission', function(done) {
      const middleware = checkPermission('admin.delete');
      const req = { user: { role: 'user', permissions: ['vendas.view'] } };
      const res = {
        status: function(code) { 
          this.statusCode = code; 
          return this; 
        },
        json: function(data) { 
          assert.strictEqual(this.statusCode, 403);
          assert.ok(data.error.includes('admin.delete'));
          done();
        }
      };
      middleware(req, res, () => {});
    });
  });
});
