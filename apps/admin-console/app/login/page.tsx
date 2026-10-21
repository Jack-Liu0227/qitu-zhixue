import { UnifiedLoginRedirect } from '@qitu/auth';

export default async function LegacyLogin({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  return <UnifiedLoginRedirect role="admin" target={typeof query.next === 'string' ? query.next : '/admin'} />;
}
