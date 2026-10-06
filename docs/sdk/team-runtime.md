# Team Runtime SDK Contract

The server runs one Tutor Agent as the Team leader. Child Agents receive typed
delegate tasks through the server mailbox and return typed results. They do not
open independent student sessions and they do not write domain records directly.

## Agent definition

`AgentConfig` has four distinct concerns:

- `mission` (and the compatibility `roleDefinition`) explains why the Agent exists.
- `constraints` describes required and forbidden behavior. Constraints marked
  `server` or `domain` must be enforced by services, not only placed in a prompt.
- `dataScopes`, `skillIds`, `toolIds` and `routes` define the capabilities that
  the server binds to the Agent.
- `model` selects the provider and model directly for this Agent.

All Agents reference one `globalPolicy`, representing the repository/server
`AGENTS.md`. A child Agent does not need its own `AGENTS.md`; the optional
`agentDefinition` field is retained only for existing records and compatibility.

## Delegation and mailbox

`TeamRun`, `TeamTask`, `TeamMessage` and `TeamEvent` are versioned with
`qitu.team-runtime.v1`. `createTypedAgentDelegate` is the SDK boundary for
leader-to-child calls. It checks the server-resolved recipient allow-list and
verifies the returned run, task, task kind and correlation identifiers.

The first typed task kinds are `interest.confirmation`,
`project.recommendation`, `pbl.plan`, `pbl.advance`, `project.review`,
`profile.generate` and `growth.record`. Profile and growth results are
projections; the owning domain service remains responsible for validation,
idempotent persistence and audit records.

## Graph projections

`StaticAgentGraph` shows configured Agents and allowed routes. `DynamicAgentGraph`
shows executions and mailbox edges for one Team Run. Both are read projections;
the browser must not use graph data to bypass authorization or write state.

## Provider import and voice

`createProviderImportManifest` accepts an unknown pi catalog and returns a
credential-free `ProviderImportManifest`. It strips credential fields and URL
user info/query/fragment; auth is represented only by a configured flag and an
optional one-way fingerprint. Server-side credential resolution remains a
separate operation.

`VoiceGateway` keeps ASR, TTS and realtime selection separate from text
`ModelRuntime`. `createVoiceGateway` validates request shape and delegates to a
server-owned provider adapter. Voice model descriptors expose capabilities and
credential status, never credentials.

Voice presets are catalog metadata only. The API now deploys a Qwen
OpenAI-compatible `VoiceGatewayProvider` for explicitly declared audio models.
The server still reports a model as unavailable until the provider credential is
present, the model declares audio input/output, and the upstream `/models`
probe confirms that model. A preset must not by itself bind `tutor.live` or
claim that audio requests can run.

When a Qwen (or other) model catalog omits input/output modality metadata, the
importer keeps the model text-only (`input: ['text']`, `output: ['text']`) and
sets voice capability to `null`. It must not infer audio support from an id,
name, or provider preset; an administrator may add an explicit, audited audio
declaration after verifying the upstream adapter.
