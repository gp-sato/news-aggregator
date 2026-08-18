const LOCAL_DATABASE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('Test database URL must be a valid URL');
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  const hostname = parsedUrl.hostname.toLowerCase();
  const isPostgres = protocol === 'postgres:' || protocol === 'postgresql:';

  if (!isPostgres || !LOCAL_DATABASE_HOSTS.has(hostname)) {
    throw new Error('Tests may only use a local database');
  }
}
