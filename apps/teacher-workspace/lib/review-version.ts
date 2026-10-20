import type { TeacherArtifactReviewItem, TeacherArtifactVersionView } from '@qitu/contracts';

/** A review refers to its submitted immutable version, never an arbitrary latest version. */
export function reviewVersion(review: TeacherArtifactReviewItem, versions: readonly TeacherArtifactVersionView[]): TeacherArtifactVersionView {
  if (!review.versionAvailable || !review.artifactVersionId) throw new Error('该审核记录无法定位原始送审版本，请学生重新送审。');
  const found = versions.find((item) => item.id === review.artifactVersionId && item.ordinal === review.artifactVersionOrdinal);
  if (!found || !found.inlineText?.trim()) throw new Error('原始送审版本正文不可用，暂不能在此审核。');
  return found;
}
