import type { TemplateBindingStore } from './templates-binding.store';
import { teachingValueDigest } from './teaching-bundle.canonical';

/** List metadata comes from the same validated frozen schedule used to create projects. */
export async function templateSchedule(versionId: string | null, bindings?: TemplateBindingStore) {
  const binding = versionId ? await bindings?.findActiveBinding(versionId) : null;
  const bundle = binding?.bundlePayload;
  const profile = bundle && binding?.status === 'active' && binding.validation.valid
    && bundle.templateVersionId === versionId && teachingValueDigest(bundle) === binding.bundleDigest
    ? bundle.template.curriculum?.profiles.find(item => item.id === bundle.scheduleProfileId) : null;
  return { lessonCount: profile?.schedule.lessonCount ?? null, lessonMinutes: profile?.schedule.lessonMinutes ?? null };
}
