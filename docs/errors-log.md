# Error Log

| Date | Project | Sev | Symptom | Root cause | Fix | Prevention | Related |
|------|---------|-----|---------|------------|-----|------------|---------|
| 2026-09-21 | Admin Dashboard | P1 | Branch-scoping PR caused broad backend integration failures: scoped reads returned `404`, reports omitted fixture data, and test factories hit invalid constraints. | Existing tests created global orders, stock movements, audit rows, and users without the explicit branch membership/context required by the fail-closed branch model; a few fixtures also relied on insertion order or exceeded schema limits. | Made branch ownership explicit in fixtures and request helpers, corrected invalid factory data, and aligned assertions with the scoped roster contract. | Require any new scoped integration fixture to declare `branchId` and use the shared scoped-auth helper; add a CI test that runs branch-scope fixtures against a fresh migrated database. | N/A |
