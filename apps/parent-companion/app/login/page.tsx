import { redirect } from 'next/navigation';

export default async function LegacyLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const params = new URLSearchParams({ role: 'parent', next: query.next ?? '/parent' });
  redirect('/login?' + params.toString());
}
