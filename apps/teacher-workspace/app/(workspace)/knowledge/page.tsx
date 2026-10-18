import { redirect } from 'next/navigation';

/**
 * Knowledge resources are currently exposed through the shared platform
 * knowledge center. Keep the frozen teacher navigation URL valid while the
 * dedicated teacher projection is rolled out.
 */
export default function TeacherKnowledgePage() {
  redirect('/dashboard');
}
