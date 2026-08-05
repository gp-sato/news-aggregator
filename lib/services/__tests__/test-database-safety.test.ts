import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabaseUrl } from '../../../test-support/database-safety';

describe('assertSafeTestDatabaseUrl', () => {
  it.each([
    undefined,
    'postgresql://postgres:test@localhost:5432/test',
    'postgresql://postgres:test@127.0.0.1:5432/test',
    'postgresql://postgres:test@[::1]:5432/test',
  ])('ローカルDBまたは未設定を許可する', (databaseUrl) => {
    expect(() => assertSafeTestDatabaseUrl(databaseUrl)).not.toThrow();
  });

  it('未知のリモートDBを拒否し接続情報をエラーに含めない', () => {
    const databaseUrl = 'postgresql://review_user:secret@db.internal.example/test';

    expect(() => assertSafeTestDatabaseUrl(databaseUrl)).toThrow(
      'Tests may only use a local database'
    );

    try {
      assertSafeTestDatabaseUrl(databaseUrl);
    } catch (error) {
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('db.internal.example');
    }
  });

  it('不正な接続文字列を拒否する', () => {
    expect(() => assertSafeTestDatabaseUrl('not-a-database-url')).toThrow(
      'Test database URL must be a valid URL'
    );
  });
});
