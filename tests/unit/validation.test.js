/**
 * ALUFORCE ERP - Unit Tests: Validation Utilities
 * Tests for input validation, sanitization, and business rules
 */

const assert = require('assert');

describe('Validation Utilities', function() {

  describe('Email Validation', function() {
    const validateEmail = (email) => {
      const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return regex.test(email);
    };

    it('should accept valid email addresses', function() {
      assert.ok(validateEmail('user@example.com'));
      assert.ok(validateEmail('test.user@aluforce.ind.br'));
      assert.ok(validateEmail('admin+tag@domain.co'));
    });

    it('should reject invalid email addresses', function() {
      assert.ok(!validateEmail(''));
      assert.ok(!validateEmail('invalid'));
      assert.ok(!validateEmail('no@domain'));
      assert.ok(!validateEmail('@nodomain.com'));
      assert.ok(!validateEmail('spaces not allowed@test.com'));
    });
  });

  describe('CPF Validation', function() {
    const validateCPF = (cpf) => {
      if (!cpf) return false;
      cpf = cpf.replace(/[^\d]/g, '');
      if (cpf.length !== 11) return false;
      if (/^(\d)\1{10}$/.test(cpf)) return false;
      
      let sum = 0;
      for (let i = 0; i < 9; i++) {
        sum += parseInt(cpf.charAt(i)) * (10 - i);
      }
      let digit1 = 11 - (sum % 11);
      if (digit1 > 9) digit1 = 0;
      if (parseInt(cpf.charAt(9)) !== digit1) return false;
      
      sum = 0;
      for (let i = 0; i < 10; i++) {
        sum += parseInt(cpf.charAt(i)) * (11 - i);
      }
      let digit2 = 11 - (sum % 11);
      if (digit2 > 9) digit2 = 0;
      if (parseInt(cpf.charAt(10)) !== digit2) return false;
      
      return true;
    };

    it('should accept valid CPF numbers', function() {
      assert.ok(validateCPF('529.982.247-25'));
      assert.ok(validateCPF('52998224725'));
    });

    it('should reject invalid CPF numbers', function() {
      assert.ok(!validateCPF(''));
      assert.ok(!validateCPF('123.456.789-00'));
      assert.ok(!validateCPF('111.111.111-11'));
      assert.ok(!validateCPF('000.000.000-00'));
      assert.ok(!validateCPF('12345'));
    });
  });

  describe('CNPJ Validation', function() {
    const validateCNPJ = (cnpj) => {
      if (!cnpj) return false;
      cnpj = cnpj.replace(/[^\d]/g, '');
      if (cnpj.length !== 14) return false;
      if (/^(\d)\1{13}$/.test(cnpj)) return false;
      
      let size = cnpj.length - 2;
      let numbers = cnpj.substring(0, size);
      let digits = cnpj.substring(size);
      let sum = 0;
      let pos = size - 7;
      
      for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
      }
      let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
      if (result !== parseInt(digits.charAt(0))) return false;
      
      size = size + 1;
      numbers = cnpj.substring(0, size);
      sum = 0;
      pos = size - 7;
      for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
      }
      result = sum % 11 < 2 ? 0 : 11 - sum % 11;
      if (result !== parseInt(digits.charAt(1))) return false;
      
      return true;
    };

    it('should accept valid CNPJ numbers', function() {
      assert.ok(validateCNPJ('11.222.333/0001-81'));
      assert.ok(validateCNPJ('11222333000181'));
    });

    it('should reject invalid CNPJ numbers', function() {
      assert.ok(!validateCNPJ(''));
      assert.ok(!validateCNPJ('11.111.111/1111-11'));
      assert.ok(!validateCNPJ('00.000.000/0000-00'));
      assert.ok(!validateCNPJ('12345'));
    });
  });

  describe('Phone Validation', function() {
    const validatePhone = (phone) => {
      if (!phone) return false;
      const cleaned = phone.replace(/[^\d]/g, '');
      return cleaned.length >= 10 && cleaned.length <= 11;
    };

    it('should accept valid phone numbers', function() {
      assert.ok(validatePhone('(11) 99999-9999'));
      assert.ok(validatePhone('11999999999'));
      assert.ok(validatePhone('(11) 3333-4444'));
    });

    it('should reject invalid phone numbers', function() {
      assert.ok(!validatePhone(''));
      assert.ok(!validatePhone('12345'));
      assert.ok(!validatePhone('123456789012'));
    });
  });

  describe('Currency Formatting', function() {
    const formatCurrency = (value) => {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(value);
    };

    const parseCurrency = (value) => {
      if (typeof value === 'number') return value;
      return parseFloat(value.replace(/[R$\s.]/g, '').replace(',', '.'));
    };

    it('should format currency correctly', function() {
      assert.strictEqual(formatCurrency(1234.56), 'R$\u00A01.234,56');
      assert.strictEqual(formatCurrency(0), 'R$\u00A00,00');
      assert.strictEqual(formatCurrency(-100), '-R$\u00A0100,00');
    });

    it('should parse currency strings correctly', function() {
      assert.strictEqual(parseCurrency('1.234,56'), 1234.56);
      assert.strictEqual(parseCurrency('100,00'), 100);
      assert.strictEqual(parseCurrency(50.5), 50.5);
    });
  });

  describe('Date Validation', function() {
    const isValidDate = (dateString) => {
      const date = new Date(dateString);
      return !isNaN(date.getTime());
    };

    const isDateInRange = (date, min, max) => {
      const d = new Date(date);
      return d >= new Date(min) && d <= new Date(max);
    };

    it('should validate date formats', function() {
      assert.ok(isValidDate('2026-01-18'));
      assert.ok(isValidDate('2026-12-31T23:59:59'));
      assert.ok(!isValidDate('invalid-date'));
      assert.ok(!isValidDate('32-13-2026'));
    });

    it('should check date ranges', function() {
      assert.ok(isDateInRange('2026-06-15', '2026-01-01', '2026-12-31'));
      assert.ok(!isDateInRange('2025-06-15', '2026-01-01', '2026-12-31'));
    });
  });

  describe('Password Strength', function() {
    const checkPasswordStrength = (password) => {
      const rules = {
        minLength: password.length >= 8,
        hasUppercase: /[A-Z]/.test(password),
        hasLowercase: /[a-z]/.test(password),
        hasNumber: /[0-9]/.test(password),
        hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password)
      };
      const score = Object.values(rules).filter(Boolean).length;
      return { rules, score, isStrong: score >= 4 };
    };

    it('should evaluate password strength', function() {
      const weak = checkPasswordStrength('123');
      assert.ok(!weak.isStrong);
      assert.ok(weak.score < 4);

      const strong = checkPasswordStrength('Aluforce@2026!');
      assert.ok(strong.isStrong);
      assert.strictEqual(strong.score, 5);
    });
  });
});
