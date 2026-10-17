# DeepTutor knowledge adapter

Upstream: https://github.com/HKUDS/DeepTutor

Pinned commit: `6cf793bd868ba5ecbe64722936d4be8fab5a01df` (v1.6.14).

The deployment installs this exact source in a private directory. Its original LICENSE and THIRD_PARTY_NOTICES.md remain with the checkout. Qitu uses the original RAGService, LlamaIndex pipeline, embedding adapter, index versioning and indexing receipts; this is not a renamed keyword implementation.

Each operation runs in a separate process and version directory. Credentials arrive on stdin, never command-line arguments, browser JSON or logs. The adapter uses the upstream embedding context with a Qitu-resolved model; it does not write the shared model catalog. Qitu owns authorization, source permission checks, durable jobs and the publication transaction. The embedding-binding decorator is bypassed deliberately: the Qitu version snapshot, not DeepTutor's separate user catalog, owns binding. The wrapped RAG operation and its index readiness checks remain intact.

Only LlamaIndex is enabled for the initial local indexing path. Other catalog providers report ENGINE_ADAPTER_NOT_READY or REASONING_RETRIEVAL_REQUIRED; a catalog card is not a working adapter.
