---
trigger: always_on
description: Prohibits sub-agents from recursively invoking further sub-agents.
---

# Sub-Agent Delegation Guardrails

1. **No Recursive Delegation:** Sub-agents spawned via `invoke_subagent` must perform their assigned tasks directly and are strictly forbidden from calling `invoke_subagent` or delegating tasks to child sub-agents.
2. **Single-Tier Hierarchy:** Only the top-level parent agent coordinates multi-agent orchestration.
