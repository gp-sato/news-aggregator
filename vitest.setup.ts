import { beforeAll, vi } from 'vitest';

beforeAll(() => {
  // Force test environment
  vi.stubEnv('NODE_ENV', 'test');

  const dbUrl = process.env.DATABASE_URL || '';

  // Check for dangerous cloud DB patterns
  const isCloudDb = dbUrl.includes('.supabase.co') || 
                    dbUrl.includes('pooler.supabase.com') ||
                    dbUrl.includes('.neon.tech') ||
                    dbUrl.includes('.rds.amazonaws.com');

  if (isCloudDb) {
    console.error('\n❌ SAFETY GUARD TRIGGERED: DATABASE_URL points to a Cloud/Production Database!');
    console.error(`URL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
    console.error('Unit tests must run against mocks or local DBs only. Aborting tests.\n');
    throw new Error('Safety guard abort: Cannot run tests against production/cloud DB.');
  }
});
