# DEV Community Article Comments

## Comment 1 — "I Lost 3 Hours of Claude Code Work to Compaction" by gonewx

Compaction is brutal because the context window is the only memory the agent has. I ran into the same thing. What finally helped was moving the important accepted and rejected decisions outside the session window so the next run starts from the same constraints instead of rediscovering them from scratch.

## Comment 2 — "Your AI Has Infinite Knowledge and Zero Habits" by elliotJL

The "zero habits" framing is spot-on. The thing that changed this for me was treating repeated failures as durable constraints instead of more prompt text. Once the rejected behavior survives the next session, the agent starts looking less stateless.

## Comment 3 — "How I Stopped Claude Code From Losing Context After Every Compaction" by chudi_nnorukam

Your dev-docs approach is smart. Externalizing context is the part that matters. What helped on my side was keeping the accepted and rejected workflow decisions durable too, so compaction does not wipe out the operating rules right when the agent needs them.
