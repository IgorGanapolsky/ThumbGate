'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  estimateTokens,
  measureFootprint,
  buildMcpToolFootprintReport,
  buildFeedbackContextFootprintReport,
  buildContextFootprintReport,
} = require('../scripts/context-footprint');

function makeTool(name) {
  return {
    name,
    description: `Tool ${name}`,
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'A long schema description agents do not need until selected.' },
        maxItems: { type: 'number', description: 'Maximum items to return.' },
        includeProof: { type: 'boolean', description: 'Whether proof links should be included.' },
      },
    },
  };
}

function makeEntry(id, text) {
  return {
    id,
    signal: 'negative',
    context: text,
    whatWentWrong: text,
  };
}

describe('context-footprint', () => {
  it('estimates tokens from JSON payload size', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.ok(estimateTokens({ value: 'x'.repeat(80) }) > 10);
  });

  it('measures reduction and target status', () => {
    const report = measureFootprint(
      { payload: 'x'.repeat(1000) },
      { payload: 'x'.repeat(500) },
      { targetReduction: 0.22 },
    );
    assert.ok(report.savings.bytes > 0);
    assert.ok(report.savings.estimatedTokens > 0);
    assert.equal(report.savings.targetMet, true);
  });

  it('reports lossless MCP tool discovery savings through schema URLs', () => {
    const report = buildMcpToolFootprintReport(
      [makeTool('capture_feedback'), makeTool('construct_context_pack')],
      { schemaUrlTemplate: 'https://app.example.com/.well-known/mcp/tools/{name}.json' },
    );

    assert.equal(report.kind, 'mcp-tool-discovery');
    assert.equal(report.qualityContract.behaviorPreserved, true);
    assert.equal(report.toolCount, 2);
    assert.ok(report.footprint.savings.reductionRatio > 0);
    assert.match(report.qualityContract.schemaUrlTemplate, /tools\/\{name\}\.json/);
  });

  it('reports feedback context compaction while preserving anchors', () => {
    const anchor = makeEntry('anchor', 'proof critical lesson');
    const entries = [
      anchor,
      ...Array.from({ length: 18 }, (_, index) => makeEntry(`e${index}`, `same repeated failure ${index}`)),
    ];
    const report = buildFeedbackContextFootprintReport(entries, [anchor], {
      windowSize: 5,
      perEntryMaxChars: 32,
    });

    assert.equal(report.kind, 'feedback-context-compaction');
    assert.equal(report.qualityContract.anchorsPreserved, true);
    assert.ok(report.compaction.optimizedItems < report.compaction.baselineItems);
    assert.ok(report.footprint.savings.estimatedTokens > 0);
  });

  it('builds a combined report with recommendations', () => {
    const report = buildContextFootprintReport({
      tools: [makeTool('search_lessons')],
      entries: [makeEntry('e1', 'short'), makeEntry('e2', 'x'.repeat(1000))],
      perEntryMaxChars: 100,
    });

    assert.equal(report.name, 'thumbgate-context-footprint');
    assert.ok(report.mcpToolDiscovery);
    assert.ok(report.feedbackContext);
    assert.ok(report.recommendations.some((item) => item.includes('tool index')));
  });
});
