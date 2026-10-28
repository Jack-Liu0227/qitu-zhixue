import { notFound } from 'next/navigation';
import { CompanyWorkspace } from '../../features/CompanyWorkspace';
const sections = [
  'work',
  'teams',
  'customers',
  'products',
  'finance',
  'data',
  'knowledge',
  'integrations',
];
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return <CompanyWorkspace section={section} />;
}
