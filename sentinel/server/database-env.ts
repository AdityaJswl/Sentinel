/** Validate without including credentials in validation errors. */
export function databaseUrls(env: NodeJS.ProcessEnv) {
  function parse(key: 'DATABASE_URL' | 'DIRECT_URL') {
    let url: URL;
    try {
      url = new URL(env[key] ?? '');
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
      if (!url.hostname || !url.username || !url.password) throw new Error();
      if (/YOUR.PASSWORD|\[|\]/i.test(decodeURIComponent(url.password))) throw new Error();
    } catch {
      throw new Error(
        `${key} must contain a PostgreSQL connection URL with the actual database password. Set it privately in .env.local or server environment variables.`,
      );
    }
    const schema = url.searchParams.get('schema') ?? 'sentinel';
    if (schema !== 'sentinel' && !/^sentinel_test_[a-f0-9]{32}$/.test(schema)) {
      throw new Error(`${key} must use the private sentinel schema.`);
    }
    url.searchParams.set('schema', schema);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      url.searchParams.set('sslmode', 'require');
    }
    url.searchParams.set('connect_timeout', '10');
    if (key === 'DATABASE_URL') {
      url.searchParams.set('connection_limit', '3');
      url.searchParams.set('pool_timeout', '15');
      if (url.port === '6543') url.searchParams.set('pgbouncer', 'true');
    } else if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
      throw new Error(
        'DIRECT_URL needs the session pooler (5432) or a direct PostgreSQL connection, not transaction pooling.',
      );
    }
    return url;
  }
  const runtime = parse('DATABASE_URL');
  const direct = parse('DIRECT_URL');
  if (runtime.searchParams.get('schema') !== direct.searchParams.get('schema')) {
    throw new Error('DATABASE_URL and DIRECT_URL must use the same schema.');
  }
  return { DATABASE_URL: runtime.toString(), DIRECT_URL: direct.toString() };
}
