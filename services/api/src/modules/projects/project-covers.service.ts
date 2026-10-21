import { Inject, Injectable } from '@nestjs/common';
import type { ProjectHistoryItem } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { VisualAssetsService } from '../visual-assets/visual-assets.service';
import { resolveVisualBinding } from '../visual-assets/visual-assets.policy';

/** Artwork selection affects presentation only; never use it to resolve teaching identity. */
@Injectable()
export class ProjectCoversService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly visuals: VisualAssetsService) {}
  async decorate(items: ProjectHistoryItem[]): Promise<ProjectHistoryItem[]> {
    const bindings = await this.visuals.presentationSnapshot();
    const versions = this.db && items.length ? (await this.db.execute(sql`SELECT id,template_id FROM project_template_versions
      WHERE id IN (${sql.join(items.map(item => sql`${item.templateVersionId}`), sql`,`)})`)).rows : [];
    return items.map(item => {
      const version = versions.find(row => row.id === item.templateVersionId);
      const own = bindings.find(binding => binding.usage === 'cover' && binding.selection.kind === 'asset'
        && binding.owner.kind === 'template-version' && binding.owner.id === item.templateVersionId)
        ?? bindings.find(binding => binding.usage === 'cover' && binding.selection.kind === 'asset'
          && binding.owner.kind === 'template' && binding.owner.id === version?.template_id);
      const platform = bindings.find(binding => binding.owner.kind === 'platform' && ['template','default'].includes(binding.owner.id)
        && binding.usage === 'cover' && binding.selection.kind === 'asset');
      const text = [item.title, item.subtitle, ...item.tags].join(' ').toLowerCase();
      const fallback = /光|optics|lens/.test(text) ? 'cover-optics-v1' : /动能|速度|小车|kinetic/.test(text) ? 'cover-kinetic-v1'
        : /python|编程|游戏|coding/.test(text) ? 'cover-coding-v1' : 'artifact-integrated-v1';
      const coverAssetId = own?.selection.kind === 'asset' ? own.selection.assetId
        : platform ? resolveVisualBinding({ kind: 'template-version', id: item.templateVersionId }, 'cover', bindings).effectiveAssetId : fallback;
      return { ...item, coverAssetId };
    });
  }
}
