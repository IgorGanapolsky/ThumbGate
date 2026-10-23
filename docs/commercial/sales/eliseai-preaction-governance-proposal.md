Subject: Pre-action firewall for EliseAI voice & maintenance dispatch

Minna / Tony,

Saw EliseAI cross $200M ARR—powering 1 in 6 U.S. rental apartments with 24/7 conversational operations is incredible execution.

As voice and SMS agents move deeper into operational execution (especially real-time maintenance dispatch and leasing pre-qualification), the risk profile shifts from conversational quality to legal and financial liability. An un-gated LLM handling tenant calls can:
1. Dispatch an emergency contractor on an unverified or tenant-caused issue ($1,500–$3,500 unauthorized bill).
2. Commit to unauthorized move-in concessions or rent terms over voice/SMS during high-pressure tenant inquiries.
3. Introduce Fair Housing Act (42 U.S.C. § 3604) disparate impact exposure during autonomous pre-qualification questioning.

We built ThumbGate (`thumbgate` on npm). It’s an in-line, sub-5ms pre-action firewall that sits between conversational LLMs/voice pipelines (like Retell AI, Twilio, or custom WebRTC) and external tool execution:

```json
{
  "action": "dispatch_contractor",
  "toolInput": {
    "propertyId": "bldg_441",
    "issueCategory": "plumbing_leak",
    "emergencyDispatch": true,
    "estimatedCost": 2200
  },
  "thumbgateVerdict": "BLOCK",
  "reason": "Emergency contractor dispatch ($2,200) exceeds unverified cap ($500) without active lease verification & tenant-photo evidence."
}
```

We’re not selling a competing leasing bot. We provide the certified pre-action governance diode that guarantees your agents cannot take unauthorized financial or legal actions.

Are you open to reviewing the 5ms in-line diode schema to see if this solves contractor runaway dispatch across your enterprise property managers?

Best regards,

Igor Ganapolsky  
Founder & CTO, ThumbGate  
igor@igorganapolsky.com | https://thumbgate.ai  
