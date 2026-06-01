'use strict';

/**
 * Backwards-compatible migration wrapper.
 *
 * The enterprise implementation lives in enterprise-postgres.js so the CLI,
 * tests, and standalone script all share one schema/migration generator.
 */

const {
  applySql,
  buildJsonlMigrationSql,
  guardSqlBatch,
  writeSqlIfRequested,
} = require('./enterprise-postgres');

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg, index) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    if (rest.length) {
      args[key] = rest.join('=');
      return;
    }
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? next : true;
  });
  return args;
}

async function migrateToPostgres(options = {}) {
  const args = { ...parseArgs(process.argv.slice(2)), ...options };
  const sql = buildJsonlMigrationSql({
    feedbackDir: args['feedback-dir'] || args.feedbackDir || process.cwd(),
    orgId: args['org-id'] || args.orgId,
    orgName: args['org-name'] || args.orgName,
    projectId: args['project-id'] || args.projectId,
    projectSlug: args['project-slug'] || args.projectSlug,
    agentId: args['agent-id'] || args.agentId,
  });
  const outputPath = writeSqlIfRequested(sql, args.out || args.output);
  const guard = guardSqlBatch(sql);
  if (args.apply) {
    return applySql({
      sql,
      databaseUrl: args['database-url'] || args.databaseUrl || process.env.DATABASE_URL || process.env.THUMBGATE_DATABASE_URL,
    });
  }
  return {
    ok: guard.ok,
    outputPath,
    sql,
    ...guard,
  };
}

module.exports = {
  migrateToPostgres,
};

if (require.main === module) {
  migrateToPostgres().then((result) => {
    if (process.argv.includes('--json')) {
      const { sql: _sql, ...payload } = result;
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (result.outputPath) {
      console.log(`Wrote ThumbGate enterprise Postgres migration SQL: ${result.outputPath}`);
    } else {
      process.stdout.write(result.sql);
    }
  }).catch((err) => {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.error(`Migration failed: ${err.message}`);
    }
    process.exit(1);
  });
}
