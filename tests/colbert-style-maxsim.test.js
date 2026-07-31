'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  tokenize,
  embedToken,
  maxSim,
  encodeMultiVector,
  scoreLateInteraction,
  rerankWithMaxSim,
  cosine,
} = require('../scripts/colbert-style-maxsim');

describe('colbert-style MaxSim', () => {
  it('tokenizes and embeds deterministically', () => {
    const a = embedToken('force');
    const b = embedToken('force');
    assert.equal(a.length, 32);
    assert.deepEqual(Array.from(a), Array.from(b));
    assert.ok(Math.abs(cosine(a, a) - 1) < 1e-6);
  });

  it('scores related pairs higher than unrelated', () => {
    const related = scoreLateInteraction(
      'git push --force to main',
      'Never force-push to the protected main branch',
    );
    const unrelated = scoreLateInteraction(
      'git push --force to main',
      'The weather in Paris is pleasant this afternoon',
    );
    assert.ok(related.score > unrelated.score, `${related.score} > ${unrelated.score}`);
    assert.equal(related.mode, 'colbert-style-hash');
  });

  it('MaxSim is zero for empty bags', () => {
    assert.equal(maxSim([], encodeMultiVector('hello').vectors), 0);
    assert.equal(maxSim(encodeMultiVector('hello').vectors, []), 0);
  });

  it('reranks candidates so force-push lesson beats decoy', () => {
    const candidates = [
      {
        id: 'decoy',
        title: 'Deploy notes',
        content: 'Always deploy on Friday after lunch',
        relevanceScore: 0.9,
      },
      {
        id: 'force',
        title: 'Force push blocked',
        content: 'Never git push --force to main or protected branches',
        whatWentWrong: 'force push wiped history on main',
        relevanceScore: 0.4,
      },
    ];
    const out = rerankWithMaxSim('git push --force main', candidates, { topK: 2, blendWeight: 0.8 });
    assert.equal(out[0].id, 'force');
    assert.ok(out[0].maxSimScore > out[1].maxSimScore);
  });

  it('tokenize drops short noise', () => {
    assert.deepEqual(tokenize('a to be force-push'), ['to', 'be', 'force', 'push']);
  });
});
