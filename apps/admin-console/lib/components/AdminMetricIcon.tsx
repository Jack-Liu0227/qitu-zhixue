import type { SVGProps } from 'react';

export type AdminMetricIconName =
  | 'student'
  | 'project'
  | 'alert'
  | 'teacher'
  | 'pending'
  | 'work'
  | 'activity'
  | 'session'
  | 'time'
  | 'task'
  | 'coverage'
  | 'guardian'
  | 'unbound';

const iconProps: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function AdminMetricIcon({ name }: { name: AdminMetricIconName }) {
  let content: React.ReactNode;

  switch (name) {
    case 'student':
      content = <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3.2 2.4-4.8 5.5-4.8s4.9 1.6 5.5 4.8" /><path d="M15.5 6.2a2.8 2.8 0 0 1 0 5.5M17 14.3c1.9.6 3 2.1 3.5 4.7" /></>;
      break;
    case 'project':
      content = <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M7 8h10M7 12h6M7 16h3" /></>;
      break;
    case 'alert':
      content = <><path d="m12 4 8 15H4L12 4Z" /><path d="M12 9v4M12 16h.01" /></>;
      break;
    case 'teacher':
      content = <><circle cx="12" cy="8" r="3" /><path d="M5 20c.8-3.4 3.1-5.2 7-5.2s6.2 1.8 7 5.2" /><path d="M4 11h3M17 11h3" /></>;
      break;
    case 'pending':
      content = <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>;
      break;
    case 'work':
      content = <><path d="M5 7.5h14v11H5z" /><path d="M8 7.5V5h8v2.5M8 12h8M10 15h4" /></>;
      break;
    case 'activity':
      content = <><path d="M4 17V7M10 17V4M16 17v-7M22 17H2" /><path d="m4 12 6-5 6 3 6-6" /></>;
      break;
    case 'session':
      content = <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 8h8M8 12h5M8 16h3" /></>;
      break;
    case 'time':
      content = <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>;
      break;
    case 'task':
      content = <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 2.5 2.5L16 9" /></>;
      break;
    case 'coverage':
      content = <><path d="M12 4 19 7v5c0 4.2-2.6 6.8-7 8-4.4-1.2-7-3.8-7-8V7l7-3Z" /><path d="m9 12 2 2 4-4" /></>;
      break;
    case 'guardian':
      content = <><circle cx="8" cy="9" r="2.5" /><circle cx="16" cy="9" r="2.5" /><path d="M3.5 19c.5-2.7 2-4 4.5-4s4 1.3 4.5 4M11.5 19c.5-2.7 2-4 4.5-4s4 1.3 4.5 4" /></>;
      break;
    case 'unbound':
      content = <><circle cx="12" cy="12" r="8" /><path d="m9 9 6 6M15 9l-6 6" /></>;
      break;
  }

  return <svg {...iconProps}>{content}</svg>;
}
