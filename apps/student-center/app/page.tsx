import { redirect } from 'next/navigation';

/** `/` redirects into the student center; the shell lives on `/student/*`. */
export default function StudentHomePage() {
  redirect('/student/today');
}
