# DeepTutor knowledge adapter

Upstream: https://github.com/HKUDS/DeepTutor

Pinned commit: `6cf793bd868ba5ecbe64722936d4be8fab5a01df` (v1.6.14).

The deployment installs this exact source in a private directory. Its original LICENSE and THIRD_PARTY_NOTICES.md remain with the checkout. Qitu uses the original RAGService, LlamaIndex pipeline, embedding adapter, index versioning and indexing receipts; this is not a renamed keyword implementation.

Each operation runs in a separate process and version directory. Credentials arrive on stdin, never command-line arguments, browser JSON or logs. The adapter uses the upstream embedding context with a Qitu-resolved model; it does not write the shared model catalog. Qitu owns authorization, source permission checks, durable jobs and the publication transaction. The embedding-binding decorator is bypassed deliberately: the Qitu version snapshot, not DeepTutor's separate user catalog, owns binding. The wrapped RAG operation and its index readiness checks remain intact.


## Upstream boundary

Qitu uses DeepTutor only for its RAG and embedding capabilities. The only upstream modules in scope, and the only DeepTutor modules the adapter may import, are:

- `deeptutor.services.embedding.config`
- `deeptutor.services.embedding`
- `deeptutor.services.rag.service`
- `deeptutor.services.rag.pipelines.llamaindex.config`

The boundary is enforced in three tiers, because "we do not import it" and "it is never loaded" are different claims:

1. **Adapter source (strict).** `bridge.py` must not reference `deeptutor.services.skill`, `deeptutor.tools`, `deeptutor.services.sandbox`, or `deeptutor.api`. Enforced by an AST allowlist in `test_bridge.py` and by `tooling/verify-knowledge-upstream.mjs`.
2. **Hard-forbidden at runtime (zero tolerance).** `deeptutor.services.skill.*`, `deeptutor.services.sandbox.*`, and `deeptutor.api.*` must never appear in `sys.modules` after a real bridge operation. These are the second-writable-authority, code-execution, and upstream HTTP/admin surfaces respectively.
3. **Pinned transitive coupling (monitored).** Upstream's own RAG service import chain *does* transitively load exactly five tool modules: `deeptutor.tools`, `deeptutor.tools.builtin`, `deeptutor.tools.builtin_specs`, `deeptutor.tools.prompting`, `deeptutor.tools.question_bank`. Qitu never calls them, and preventing module-level import would require patching the pinned upstream tree, which is deliberately not done. The list is therefore pinned in `test_bridge.py`: if an upstream bump grows it, the test fails and the change must be reviewed rather than absorbed silently.

Qitu does not start or expose DeepTutor's FastAPI application or its admin routes such as `/api/ns`. The adapter remains a private stdin/stdout process; DeepTutor's FastAPI service is not part of the Qitu service list.

Note on test hygiene: the runtime boundary assertion checks the absolute state of `sys.modules` and must not pre-delete modules. Pre-deletion makes the test order-dependent and produces a false pass when an earlier test has already cached the RAG import chain.

This boundary prevents the skill hub from becoming a second writable source of truth. `services/knowledge/` is not version-controlled, so skill-hub changes would have no diff, review, or rollback path. DeepTutor's authorization granularity is user/workspace, which does not match Qitu's school/mentor/student and object-level permission model. A resident Python service would also impose avoidable memory pressure for this per-operation adapter.

If sandbox support is needed in the future, it must be an independent sidecar exposing only sandbox capabilities. Skill packages must still be published through git/DB and loaded only after publication. This is conditional on the reproducible-build requirements below being complete; see `docs/plan/20261018-skill-tool-governance-and-assignment.md`, section 9.

Reproducible builds require the upstream pin to be verifiable, with installation steps and checksums checked into the repository. The pin is checked by `tooling/verify-knowledge-upstream.mjs`; installation instructions and a source checksum are not yet checked in and remain a follow-up requirement.
