import type { ReactNode } from 'react';
import { GreetingBanner } from '@qitu/ui';

/**
 * Greeting-banner *content* for the shell slot.
 *
 * The banner is a shell layout concern: the module does not re-implement
 * `StudentShell` and does not hard-code the mascot. Route wiring (Wave 4)
 * mounts this as `<StudentShell header={<TodayGreetingBanner ... />}>`.
 */
export function TodayGreetingBanner({
  studentName,
  message,
  mascot,
}: {
  studentName: string;
  message: string;
  mascot?: ReactNode;
}) {
  return <GreetingBanner studentName={studentName} message={message} mascot={mascot} />;
}
