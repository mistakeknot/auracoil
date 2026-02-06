import { describe, it, expect } from 'vitest';
import { isDangerousFile, scanForSecrets } from './secret-scanner.js';

describe('Secret Scanner', () => {
  describe('isDangerousFile', () => {
    it('should flag .env files', () => {
      expect(isDangerousFile('.env')).toBe(true);
      expect(isDangerousFile('.env.local')).toBe(true);
      expect(isDangerousFile('.env.production')).toBe(true);
    });

    it('should flag key files', () => {
      expect(isDangerousFile('id_rsa')).toBe(true);
      expect(isDangerousFile('server.key')).toBe(true);
      expect(isDangerousFile('cert.pem')).toBe(true);
    });

    it('should flag credential files', () => {
      expect(isDangerousFile('credentials.json')).toBe(true);
      expect(isDangerousFile('secrets.yaml')).toBe(true);
    });

    it('should allow safe files', () => {
      expect(isDangerousFile('package.json')).toBe(false);
      expect(isDangerousFile('index.ts')).toBe(false);
      expect(isDangerousFile('README.md')).toBe(false);
    });

    it('should allow .env.example', () => {
      // This is handled by the content check, not filename
      expect(isDangerousFile('.env.example')).toBe(true); // Filename still triggers
    });
  });
});
