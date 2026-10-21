import { BadRequestException } from '@nestjs/common';
import { DEFAULT_VISUAL_ASSETS, getVisualAsset, type VisualBinding, type VisualBindingPatch, type VisualOwner, type VisualUsage } from '@qitu/contracts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('素材配置须为对象');
  return Object.fromEntries(Object.entries(value));
}
export function parseVisualUsage(value: unknown): VisualUsage {
  if (value === 'avatar' || value === 'icon' || value === 'cover' || value === 'illustration') return value;
  throw new BadRequestException({ code: 'VISUAL_SLOT_MISMATCH', message: '素材用途无效' });
}
export function parseVisualOwner(value: unknown): VisualOwner {
  const owner = object(value);
  if (Object.keys(owner).some((key) => key !== 'kind' && key !== 'id') || typeof owner.id !== 'string' || !owner.id.trim() || owner.id.length > 160) throw new BadRequestException('素材对象无效');
  if (owner.kind === 'platform' && (owner.id === 'default' || owner.id === 'assistant' || owner.id === 'team' || owner.id === 'template' || owner.id === 'knowledge')) return { kind: 'platform', id: owner.id };
  if (owner.kind === 'assistant' || owner.kind === 'team' || owner.kind === 'template' || owner.kind === 'template-version' || owner.kind === 'knowledge') return { kind: owner.kind, id: owner.id };
  throw new BadRequestException('素材对象类型无效');
}
export function parseVisualPatch(value: unknown): VisualBindingPatch {
  const body = object(value);
  if (Object.keys(body).some((key) => !['owner', 'usage', 'selection', 'expectedRevision'].includes(key))) throw new BadRequestException('素材配置包含未知字段');
  const owner = parseVisualOwner(body.owner), usage = parseVisualUsage(body.usage);
  if (!Number.isSafeInteger(body.expectedRevision) || typeof body.expectedRevision !== 'number' || body.expectedRevision < 0) throw new BadRequestException('缺少有效的素材修订号');
  if (owner.kind === 'assistant' && usage !== 'avatar') throw new BadRequestException({ code: 'VISUAL_SLOT_MISMATCH', message: '助手仅接受头像素材' });
  if (owner.kind !== 'assistant' && owner.kind !== 'platform' && usage === 'avatar') throw new BadRequestException({ code: 'VISUAL_SLOT_MISMATCH', message: '此对象不支持助手头像' });
  const selection = object(body.selection);
  if (selection.kind === 'inherit' && Object.keys(selection).length === 1) return { owner, usage, selection: { kind: 'inherit' }, expectedRevision: body.expectedRevision };
  if (selection.kind !== 'asset' || Object.keys(selection).length !== 2 || typeof selection.assetId !== 'string') throw new BadRequestException('素材选择无效');
  const asset = getVisualAsset(selection.assetId);
  if (!asset || asset.id !== selection.assetId) throw new BadRequestException({ code: 'VISUAL_ASSET_NOT_FOUND', message: '素材不存在' });
  if (!asset.usages.includes(usage)) throw new BadRequestException({ code: 'VISUAL_SLOT_MISMATCH', message: '素材不适用于此展示位置' });
  return { owner, usage, selection: { kind: 'asset', assetId: asset.id }, expectedRevision: body.expectedRevision };
}
export function visualBindingKey(owner: VisualOwner, usage: VisualUsage): string {
  return `${owner.kind}:${encodeURIComponent(owner.id)}:${usage}`;
}
export function resolveVisualBinding(owner: VisualOwner, usage: VisualUsage, bindings: readonly VisualBinding[]): VisualBinding {
  const own = bindings.find((row) => row.owner.kind === owner.kind && row.owner.id === owner.id && row.usage === usage);
  const platformKind = owner.kind === 'template-version' ? 'template' : owner.kind;
  const platform = bindings.find((row) => row.owner.kind === 'platform' && row.owner.id === platformKind && row.usage === usage);
  const global = bindings.find((row) => row.owner.kind === 'platform' && row.owner.id === 'default' && row.usage === usage);
  const defaultId = platform?.selection.kind === 'asset' ? platform.selection.assetId
    : global?.selection.kind === 'asset' ? global.selection.assetId : DEFAULT_VISUAL_ASSETS[usage];
  return { owner, usage, selection: own?.selection ?? { kind: 'inherit' }, revision: own?.revision ?? 0,
    effectiveAssetId: own?.selection.kind === 'asset' ? own.selection.assetId : defaultId };
}
