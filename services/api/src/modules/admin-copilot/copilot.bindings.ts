import { ServiceUnavailableException } from '@nestjs/common';
import type { AdminCopilotActionKind, CurrentUser } from '@qitu/contracts';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import { parseTeachingBundleDraft } from '../templates/templates-binding.controller';
import { exact, text } from './copilot.protocol';

/** Delegate lifecycle and compilation to the established binding owner. */
export async function executeBinding(owner: TemplateBindingService | undefined, actor: CurrentUser,
  kind: AdminCopilotActionKind, input: Record<string, unknown>, key: string) {
  if (!owner) throw new ServiceUnavailableException({ code: 'COPILOT_BINDING_UNAVAILABLE', message: '模板绑定服务不可用。' });
  const extra = kind === 'binding.prepare' ? ['arrangement'] : kind === 'binding.draft' ? ['bindingId', 'draft'] :
    kind === 'binding.retire' ? ['bindingId', 'reason'] : ['bindingId'];
  exact(input, ['templateId', 'versionId', ...extra]);
  const templateId = text(input.templateId, 'templateId');
  const versionId = text(input.versionId, 'versionId');
  if (kind === 'binding.prepare') {
    const result = await owner.prepareCurrentTeams(actor, templateId, versionId, input.arrangement, key);
    return { ...result.binding, templateId, versionId };
  }
  const bindingId = text(input.bindingId, 'bindingId');
  const result = kind === 'binding.draft'
    ? await owner.saveTeachingBundleDraft(actor, templateId, versionId, bindingId, parseTeachingBundleDraft(input.draft), key)
    : kind === 'binding.validate' ? await owner.validateBinding(actor, templateId, versionId, bindingId, key)
    : kind === 'binding.activate' ? await owner.activateBinding(actor, templateId, versionId, bindingId, key)
    : await owner.retireBinding(actor, templateId, versionId, bindingId, { reason: text(input.reason, 'reason', 2000) }, key);
  return { ...result.binding, templateId, versionId };
}
