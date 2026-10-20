/** One executable catalog supplies API discovery, plan validation and the model operation guide. */
export const ADMIN_COPILOT_CONTRACT_VERSION = '1.1.0';
export const ADMIN_COPILOT_SCOPES = ['global', 'selected_template'] as const;
export type AdminCopilotScope = typeof ADMIN_COPILOT_SCOPES[number];
export const ADMIN_COPILOT_OPERATIONS = [
  {
    "kind": "assistant.create",
    "label": "创建助手",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "assistant",
    "createsResource": true,
    "inputGuide": "{name,description,role,instructions,modelProviderId?,modelId?,enabledSkills?:string[],toolIds?:string[],mcpServerIds?:string[],temperature?:number,enabled?:boolean}"
  },
  {
    "kind": "assistant.update",
    "label": "修改助手",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "assistant",
    "createsResource": false,
    "inputGuide": "{id,expectedUpdatedAt:<current catalog timestamp>,patch:<same optional fields>}; arrays replace and must preserve unrelated IDs."
  },
  {
    "kind": "team.create",
    "label": "创建团队",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "team",
    "createsResource": true,
    "inputGuide": "{name,description,leaderAssistantId,members:[{assistantId,role:\"leader\"|\"teammate\"|\"reviewer\"|\"coach\",slotId?,roleLabel?,pblPhase?}],workspaceMode?:\"shared\"|\"isolated\",sessionMode?:\"auto\"|\"plan\"|\"supervised\",concurrencyLimit?:1..8,pblSpec?,enabled?}"
  },
  {
    "kind": "team.update",
    "label": "修改团队",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "team",
    "createsResource": false,
    "inputGuide": "{id,expectedUpdatedAt:<current catalog timestamp>,patch:<same optional fields>}; preserve existing member slotId."
  },
  {
    "kind": "workflow.update",
    "label": "修改团队工作流",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "team",
    "createsResource": false,
    "inputGuide": "{id:<team ID>,expectedUpdatedAt:<current catalog timestamp>,pblSpec:{projectId,projectName,targetDomain,theoryMasteredGate:true,allowAutonomousAdvance:false,phases:[{phase:\"exploration\"|\"concept_mastery\"|\"guided_practice\"|\"deliverable_review\",title,assignedAssistantId,learningObjectives?:string[],deliverableType?,evidenceProfile?:\"runnable_code\"|\"experiment_report\"}]}}. Use existing phases when editing; omit gateCondition to let owner derive hard gates."
  },
  {
    "kind": "template.create",
    "label": "创建项目模板",
    "scopes": [
      "global"
    ],
    "targetResource": "template",
    "createsResource": true,
    "inputGuide": "{schoolId:null,slug,title,summary,domain?,ageRange?,difficulty?,estimatedDurationMinutes?,requiredMaterials?:string[],learningObjectives?:string[],outcomeForm?,safetyNotes?}"
  },
  {
    "kind": "template.update",
    "label": "修改模板信息",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "template",
    "createsResource": false,
    "inputGuide": "{id,patch:<metadata excluding slug/schoolId>}. Published metadata cannot be edited."
  },
  {
    "kind": "template.version",
    "label": "创建模板版本",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "template",
    "createsResource": true,
    "inputGuide": "{templateId,sourceVersionId?,stages?:[{id,label}],content?:object,contentPatch?:object,rubric?:array}. Source version clones all fields, contentPatch merges TOP LEVEL fields. To associate an actual team: contentPatch:{linkedTeamId:<real team ID>}. This creates an unpublished version; keep existing ProjectTemplateSpec and all sessions. New template requires stages/content. Never set a fake bindingId or teamVersionId."
  },
  {
    "kind": "skill.create",
    "label": "创建技能草稿",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "skill",
    "createsResource": true,
    "inputGuide": "{id:<new lowercase canonical ID>,description,version,content:<Markdown teaching instructions, no frontmatter>}. Creates a quarantined draft excluded from the teaching runtime. Never overwrite existing skills; revise using new ID."
  },
  {
    "kind": "skill.publish",
    "label": "发布技能",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "skill",
    "createsResource": false,
    "inputGuide": "{id,digest:<exact draft digest returned by skill.create>}. Admin publication through the server with digest/audit. When user asks to configure and enable a new skill, create then publish then bind its canonical ID to the assistant. A draft cannot be bound. Reference prior write updatedAt when updating the same assistant/team twice in one plan."
  },
  {
    "kind": "skill.revoke",
    "label": "撤销技能发布",
    "scopes": [
      "global"
    ],
    "targetResource": "skill",
    "createsResource": false,
    "inputGuide": "{id:<published teaching canonical skill ID>,digest:<exact current published digest>}. Revoke through the governed skill owner and audit; the current catalog must read back revoked/unavailable. Shared teaching skill revocation requires global scope and affects every binding immediately. Never revoke runtime:admin skills or rewrite historical frozen snapshots."
  },
  {
    "kind": "mcp.register",
    "label": "登记 MCP",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "mcp",
    "createsResource": true,
    "inputGuide": "{id,label,description,endpointOrigin:<HTTPS URL without credentials/query>,toolIds:string[]}. Custom connector metadata only, remains disabled/not_configured until a supported execution driver is installed. Do not claim it is callable."
  },
  {
    "kind": "mcp.update",
    "label": "修改 MCP 登记",
    "scopes": [
      "global"
    ],
    "targetResource": "mcp",
    "createsResource": false,
    "inputGuide": "{id,label,description,endpointOrigin:<HTTPS URL without credentials/query>,toolIds:string[]}. Custom connector metadata only, remains disabled/not_configured until a supported execution driver is installed. Do not claim it is callable."
  },
  {
    "kind": "ima.configure",
    "label": "配置 IMA 授权",
    "scopes": [
      "global"
    ],
    "targetResource": "platform",
    "createsResource": false,
    "inputGuide": "{enabled?:boolean,assistantBindings?:[{id,enabled}],agentBindings?:[{id,enabled}]}. Existing governed IMA adapter only."
  },
  {
    "kind": "knowledge.create",
    "label": "创建知识库",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "knowledge",
    "createsResource": true,
    "inputGuide": "{name,engineInstanceId,embeddingModelRef?:<providerId:modelId>,retrievalMode?,storageWorkspaceRef?:\"account\"}. Creates an empty platform knowledge base, not remote IMA contents."
  },
  {
    "kind": "knowledge.bind",
    "label": "绑定知识库助手",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "knowledge",
    "createsResource": false,
    "inputGuide": "{id:<KB ID>,expectedRevision:<base revision>,bindings:[{agentKind:\"admin_assistant\",agentId,mode:\"retrieve\",enabled:true}]}. Whole array; preserve existing unrelated grants. Read base revision from catalog. A newly created KB receipt contains revision/bindings."
  },
  {
    "kind": "knowledge.configure",
    "label": "配置知识服务",
    "scopes": [
      "global"
    ],
    "targetResource": "platform",
    "createsResource": false,
    "inputGuide": "{expectedRevision:<platform config revision>,config:<complete current knowledge configuration>}. Preserve unrelated engines and grants. Enable platformTools[\"project-knowledge\"] and include assistant in boundAssistants ONLY if requested to grant knowledge retrieval. Knowledge engine configuration uses existing providers and validated fields."
  },
  {
    "kind": "model.provider",
    "label": "配置模型提供商",
    "scopes": [
      "global"
    ],
    "targetResource": "model_provider",
    "createsResource": false,
    "inputGuide": "{id,name?,baseUrl?,api?,authHeader?,enabled?}. Non-secret provider settings only. New provider needs baseUrl; credentials must be entered in model settings. Never change a shared provider URL unless explicitly asked."
  },
  {
    "kind": "model.create",
    "label": "登记模型",
    "scopes": [
      "global"
    ],
    "targetResource": "model",
    "createsResource": false,
    "inputGuide": "{providerId,modelId,displayName,api?,input?:[\"text\"|\"image\"|\"audio\"|\"embedding\"],output?:[\"text\"|\"image\"|\"audio\"|\"embedding\"],contextWindow?,maxTokens?,enabled?}"
  },
  {
    "kind": "model.update",
    "label": "修改模型",
    "scopes": [
      "global"
    ],
    "targetResource": "model",
    "createsResource": false,
    "inputGuide": "same fields with providerId/modelId identifying the existing model. To assign a model to an assistant use assistant.update with BOTH modelProviderId and modelId."
  },
  {
    "kind": "binding.create",
    "label": "创建教学绑定",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "binding",
    "createsResource": true,
    "inputGuide": "{templateId,versionId,teamVersionId}. Uses an existing immutable team version and the template binding owner. Creates a draft; linkedTeamId is not an active binding."
  },
  {
    "kind": "binding.draft",
    "label": "保存教学配置草稿",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "binding",
    "createsResource": false,
    "inputGuide": "{templateId,versionId,bindingId,draft:<TeachingBundleDraft>}. Save canonical roleMap/skillPins/toolIds/mcpServerIds/knowledgeBaseIds/modelByPurpose via the binding owner. Draft templateVersionId/teamVersionId must match; this does not activate."
  },
  {
    "kind": "binding.validate",
    "label": "校验教学绑定",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "binding",
    "createsResource": false,
    "inputGuide": "{templateId,versionId,bindingId}. Compile actual catalogs and validate using the binding owner; failures stay explicit."
  },
  {
    "kind": "binding.activate",
    "label": "激活教学绑定",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "binding",
    "createsResource": false,
    "inputGuide": "{templateId,versionId,bindingId}. Requires existing owner approval and validation gates. Never bypass unpublished template or invalid bundle checks."
  },
  {
    "kind": "binding.retire",
    "label": "停用教学绑定",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "binding",
    "createsResource": false,
    "inputGuide": "{templateId,versionId,bindingId,reason}. Retire through owner; never rewrite historical frozen projects."
  },
  {
    "kind": "growth.projection.configure",
    "label": "配置画像与成长助手",
    "scopes": [
      "global"
    ],
    "targetResource": "platform",
    "createsResource": false,
    "inputGuide": "{expectedRevision,settings:{profileAssistantId:string|null,growthAssistantId:string|null}}. Use the exact current growthProjectionSettings revision and enabled assistant IDs present in the owner catalog. Null disables that purpose. Delegates to the growth settings owner; configuring an assistant does not generate or accept growth facts."
  },
  {
    "kind": "team.version",
    "label": "发布团队版本",
    "scopes": [
      "global",
      "selected_template"
    ],
    "targetResource": "team",
    "createsResource": true,
    "inputGuide": "{id:<real team ID>,expectedUpdatedAt:<current team revision>}. Publishes an immutable server-generated team/role/assistant/model/skill/tool snapshot. No client runtimeSnapshot is accepted. Receipt id is the teamVersionId for binding.create. Skills must be published teaching canonical IDs; disabled/incomplete sources fail. Publication does not activate any template binding. Use the published model pair and skill pins in the teaching bundle draft."
  }
] as const;
export const ADMIN_COPILOT_ACTIONS = ADMIN_COPILOT_OPERATIONS.map(operation => operation.kind);
export type AdminCopilotActionKind = typeof ADMIN_COPILOT_ACTIONS[number];
export interface AdminCopilotAction {
  id: string;
  kind: AdminCopilotActionKind;
  label: string;
  /** Only earlier actions may be referenced, using {"$ref":"actionId.field"}. */
  input: Record<string, unknown>;
}
export interface AdminCopilotRequest {
  /** Omitted only for legacy clients: derive from templateId. */
  scope?: AdminCopilotScope;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  templateId: string | null;
  templateVersionId: string | null;
  assistantId: string;
  teamId: string | null;
  modelProviderId: string;
  modelId: string;
  permission: 'read_only' | 'full_access';
}
export interface AdminCopilotPlan {
  reply: string;
  actions: AdminCopilotAction[];
}
export interface AdminCopilotReceipt {
  id: string;
  kind: AdminCopilotActionKind;
  label: string;
  status: 'succeeded' | 'failed' | 'blocked';
  result?: unknown;
  code?: string;
  message?: string;
}
export interface AdminCopilotResponse {
  reply: string;
  receipts: AdminCopilotReceipt[];
  status: 'answered' | 'completed' | 'partial';
  skill: { id: string; digest: string; version: string };
  contractVersion: string;
  scope: AdminCopilotScope;
}

export interface AdminCopilotCapabilities {
  contractVersion: string;
  skill: { id: string; digest: string; version: string };
  scopes: readonly AdminCopilotScope[];
  operations: readonly (typeof ADMIN_COPILOT_OPERATIONS[number])[];
  readiness: 'ready';
  references?: {
    digest: string;
    resources: readonly { resource: string; description: string; digest: string; operations: readonly AdminCopilotActionKind[] }[];
  };
}
