#!/usr/bin/env node
/**
 * Skill Proposer (EvoSkill Phase 1)
 * 
 * Analyzes recurring failure patterns in memory-log.jsonl.
 * Diagnoses the root cause using 'Reasoning' traces and proposes 
 * a new functional skill (tool) to solve the capability gap.
 */

const fs = require('fs');
const path = require('path');
const { 
  parseFeedbackFile, 
  clusterByTags, 
  extractTags,
  discoverFeedbackDir
} = require('./skill-generator');

function proposeSkills(options = {}) {
  const feedbackDir = options.feedbackDir || discoverFeedbackDir();
  const logPath = path.join(feedbackDir, 'memory-log.jsonl');
  const proposalsDir = path.join(feedbackDir, 'skill-proposals');

  const memories = parseFeedbackFile(logPath);
  const mistakes = memories.filter(m => m.category === 'error' || m.title.startsWith('MISTAKE:'));
  
  if (mistakes.length === 0) {
    console.log('No mistakes found in memory log.');
    return [];
  }

  // Cluster by tags (EvoSkill refinement)
  const clusters = clusterByTags(mistakes, 2);
  const proposals = [];

  for (const [tagKey, cluster] of clusters) {
    if (cluster.entries.length < 2) continue; // Lower threshold for autonomous discovery

    console.log(`Analyzing cluster: [${tagKey}] (${cluster.entries.length} evidences)`);

    // Extract root cause from reasoning traces
    const reasoningTraces = cluster.entries
      .map(e => {
        const match = e.content.match(/Reasoning: (.*)/);
        return match ? match[1] : null;
      })
      .filter(Boolean);

    const commonProblem = cluster.entries[0].title.replace('MISTAKE: ', '');
    const tags = cluster.tags;

    const proposal = {
      id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      problem: commonProblem,
      diagnosis: reasoningTraces.length > 0 ? reasoningTraces[0] : 'Repeated execution failure in this domain.',
      suggestedSkill: {
        name: `solve-${tags[0]}-${tags[1] || 'logic'}`.toLowerCase().replace(/[^a-z-]/g, ''),
        description: `Automated skill to handle ${tags.join(', ')} patterns efficiently.`,
        tags,
        // Propose a generic tool structure that the Materializer can flesh out
        toolSpec: {
          name: `handle_${tags[0].replace(/-/g, '_')}`,
          description: `Fixes ${commonProblem}`,
          parameters: {
            type: 'object',
            properties: {
              context: { type: 'string', description: 'The current task context' }
            }
          }
        }
      },
      evidenceIds: cluster.entries.map(e => e.id),
      timestamp: new Date().toISOString()
    };

    proposals.push(proposal);
    
    if (!fs.existsSync(proposalsDir)) fs.mkdirSync(proposalsDir, { recursive: true });
    fs.writeFileSync(
      path.join(proposalsDir, `${proposal.suggestedSkill.name}.json`), 
      JSON.stringify(proposal, null, 2)
    );
  }

  return proposals;
}

if (require.main === module) {
  const props = proposeSkills();
  if (props && props.length > 0) {
    const feedbackDir = discoverFeedbackDir();
    const proposalsDir = path.join(feedbackDir, 'skill-proposals');
    console.log(`\nGenerated ${props.length} skill proposals in ${proposalsDir}`);
    props.forEach(p => console.log(` - ${p.suggestedSkill.name}: ${p.problem}`));
  }
}

module.exports = { proposeSkills };
