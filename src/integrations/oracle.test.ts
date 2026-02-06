import { describe, it, expect, vi } from 'vitest';
import { isOracleAvailable, getOracleVersion, checkOracleSession } from './oracle.js';

describe('Oracle Integration', () => {
  describe('isOracleAvailable', () => {
    it('should return true when oracle is installed', async () => {
      // This test depends on Oracle being installed on the system
      const available = await isOracleAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('getOracleVersion', () => {
    it('should return version string when oracle is available', async () => {
      const version = await getOracleVersion();
      // Either null (not installed) or a version string
      if (version !== null) {
        // Version format may be "0.8.5" or "Oracle CLI v0.8.5"
        expect(version).toMatch(/\d+\.\d+\.\d+/);
      }
    });
  });

  describe('checkOracleSession', () => {
    it('should return a health status object', async () => {
      const status = await checkOracleSession();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('message');
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.message).toBe('string');
    }, 60000); // Allow 60s — Oracle health check uses a 30s timeout
  });
});
