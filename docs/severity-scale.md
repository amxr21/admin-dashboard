# Bug Severity Scale (P0-P3)

The canonical severity scale for admin-dashboard. Every skill that classifies bugs (SHIP merge gate, testgen, hardening, errorlog, drift-check) uses these definitions — no reinvention per skill.

## The scale

| Severity | Definition | Merge decision | Response time |
|---|---|---|---|
| **P0** | Critical — app broken/unusable, crash, data loss, security hole, can't log in, users' data or money at risk | **Never merge.** Roll back if already merged. | Drop everything |
| **P1** | High — major feature broken but the app is still usable elsewhere. Auth flow broken for some role, a critical page doesn't load, integration with a required third-party service down. | **Never merge.** Fix before shipping. | Same day |
| **P2** | Medium — annoying but workaroundable. Wrong error message, minor visual glitch, an edge-case route returns the wrong status but the happy path works. | **Log to error log, don't block.** Ship with a note; fix in a follow-up PR. | Within the week |
| **P3** | Low — cosmetic or edge-case, barely noticeable. Text alignment off in an obscure state, a hover animation stutters on old hardware. | **Log to error log, don't block.** Fix when convenient. | When convenient |

## How to classify

Ask two questions:

1. **What happens if we ship this?** — no impact / mild annoyance / major disruption / catastrophic
2. **How many users are affected?** — none / few edge cases / a segment / everyone

The higher answer wins. A "mild annoyance for everyone" is still P2, not P3. A "catastrophic for one user" is still P0.

If you can't decide between two levels, pick the higher one. False alarms are cheaper than missed criticals.

## Where the scale applies

- **SHIP merge gate**: P0/P1 blocks any merge. P2/P3 logs and allows.
- **testgen**: prioritize writing tests for anything that could produce P0/P1 failures (auth, payments, data writes).
- **hardening**: security findings are graded on this scale; audit reports lead with P0/P1 counts.
- **errorlog**: every logged bug carries its severity at time of discovery.
- **drift-check**: drift findings are graded — a drifted security pattern in an active auth flow is P0/P1; a drifted button hover animation is P2/P3.

## What is NOT a severity

- Personal preference ("I don't like this UX")
- Missing feature ("we should also do X") — that's a feature request, not a bug
- Unfinished work ("this is only half-built") — that's status, not severity
- Style/convention issues that lint or format catches — those get fixed automatically, they don't get severity

## Anti-patterns

- **Inflating severity to force priority.** Marking a P2 as a P1 to jump the queue trains everyone to distrust the scale.
- **Deflating severity to unblock a ship.** Marking a P1 as a P2 to get past the gate is the classic "we'll fix it later" that never gets fixed.
- **Not classifying at all.** "It's just a bug" is not a severity. Every bug gets a number.

## Escalation triggers

If you find:
- Exposed admin routes or credentials → **P0 immediately**
- Any bug involving unauthorized data access → **P0 immediately**
- Ongoing outage → **P0 until resolved**
- Two P1s in the same feature → escalate the whole feature to P0 (compounding bugs suggest a deeper problem)
