import { UnifiedLoginRedirect } from '@qitu/auth';

export default async function LegacyLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <UnifiedLoginRedirect role="admin" target={query.next ?? '/admin'} />;
}
