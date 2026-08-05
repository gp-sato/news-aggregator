import { vi } from 'vitest';
import { assertSafeTestDatabaseUrl } from './test-support/database-safety';

vi.stubEnv('NODE_ENV', 'test');

// setupFilesの評価時に検査し、テストモジュールのimportより前に中断する。
assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
