import { RecommendedTemplateDetail } from '../../../../features/inspiration';

/** `/student/inspiration/recommended/:templateId` — retained recommended-project detail. */
export default async function RecommendedTemplateRoute({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <RecommendedTemplateDetail templateId={templateId} />;
}
