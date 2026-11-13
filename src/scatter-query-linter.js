/**
 * Scatter Query Linter for Sharded Relational Databases.
 * 
 * Inspired by Maude Lemaire (Scaling Slack, GitHub, and Cursor):
 * "Guard against ORM obscurity and scatter queries: Heavy ORMs like Rails
 * ActiveRecord hide the underlying data model, making it easy for engineers
 * to accidentally introduce 'scatter queries' (queries lacking a primary
 * sharding key that must scan every database shard)."
 */

'use strict';

class ScatterQueryLinter {
  constructor(options = {}) {
    // Map of table_name -> primary_shard_key (e.g. messages -> channel_id)
    this.shardedTables = options.shardedTables || {
      messages: 'channel_id',
      reactions: 'channel_id',
      threads: 'channel_id',
      pins: 'channel_id',
      commits: 'repo_id',
      pull_requests: 'repo_id',
      issues: 'repo_id',
    };
  }

  registerShardedTable(table, shardKey) {
    this.shardedTables[table.toLowerCase()] = shardKey.toLowerCase();
  }

  lintQuery(sqlString) {
    const findings = [];
    const normalized = sqlString.trim().toLowerCase();

    for (const [table, shardKey] of Object.entries(this.shardedTables)) {
      // Check if query targets this table
      const fromTablePattern = new RegExp(`\\b(from|update|into|join)\\s+['"]?${table}['"]?\\b`, 'i');
      if (fromTablePattern.test(normalized)) {
        // Must contain the shardKey in WHERE or ON clause
        const hasShardKey = new RegExp(`\\b${shardKey}\\s*(?:=|\\bin\\b|\\bbetween\\b)`, 'i').test(normalized);
        if (!hasShardKey) {
          findings.push({
            severity: 'ERROR',
            table,
            shardKey,
            rule: 'NO_SCATTER_QUERIES',
            message: `Scatter Query Detected: Query touches sharded table '${table}' without primary shard key '${shardKey}'. This will fan out and scan every database shard.`,
            query: sqlString.trim(),
          });
        }
      }
    }

    return {
      clean: findings.length === 0,
      findings,
    };
  }

  lintSourceCode(sourceCode) {
    const findings = [];
    const lines = sourceCode.split('\n');

    // Simple heuristic to extract SQL strings or ORM .find/.where chains
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/select|update|delete\s+from/i.test(line)) {
        const result = this.lintQuery(line);
        for (const f of result.findings) {
          findings.push({ ...f, line: i + 1, code: line.trim() });
        }
      }
    }

    return {
      clean: findings.length === 0,
      findings,
    };
  }
}

module.exports = {
  ScatterQueryLinter,
};
