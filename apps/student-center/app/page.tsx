import { redirect } from 'next/navigation';

/**
 * `/student` redirects into the student center; the shell lives on
 * `/student/*`.
 *
 * `next.config.ts` sets `basePath: '/student'` and `next/navigation`'s
 * `redirect()` **prepends the basePath automatically**, so this must be the
 * basePath-relative path. Passing `/student/today` produced
 * `/student/student/today` (404).
 */
export default function StudentHomePage() {
  redirect('/today');
}
