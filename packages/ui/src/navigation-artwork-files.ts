import governance64 from '../assets/navigation/governance-v1-64.png';
import governance128 from '../assets/navigation/governance-v1-128.png';
import workbench64 from '../assets/navigation/workbench-v1-64.png';
import workbench128 from '../assets/navigation/workbench-v1-128.png';
import students64 from '../assets/navigation/students-v1-64.png';
import students128 from '../assets/navigation/students-v1-128.png';
import statistics64 from '../assets/navigation/statistics-v1-64.png';
import statistics128 from '../assets/navigation/statistics-v1-128.png';
import relationships64 from '../assets/navigation/relationships-v1-64.png';
import relationships128 from '../assets/navigation/relationships-v1-128.png';
import settings64 from '../assets/navigation/settings-v1-64.png';
import settings128 from '../assets/navigation/settings-v1-128.png';
import home64 from '../assets/navigation/home-v1-64.png';
import home128 from '../assets/navigation/home-v1-128.png';
import messages64 from '../assets/navigation/messages-v1-64.png';
import messages128 from '../assets/navigation/messages-v1-128.png';
import gateway64 from '../assets/navigation/gateway-v1-64.png';
import gateway128 from '../assets/navigation/gateway-v1-128.png';
import plugins64 from '../assets/navigation/plugins-v1-64.png';
import plugins128 from '../assets/navigation/plugins-v1-128.png';
import database64 from '../assets/navigation/database-v1-64.png';
import database128 from '../assets/navigation/database-v1-128.png';
import ops64 from '../assets/navigation/ops-v1-64.png';
import ops128 from '../assets/navigation/ops-v1-128.png';
import system64 from '../assets/navigation/system-v1-64.png';
import system128 from '../assets/navigation/system-v1-128.png';
import feishu64 from '../assets/navigation/feishu-v1-64.png';
import feishu128 from '../assets/navigation/feishu-v1-128.png';
import about64 from '../assets/navigation/about-v1-64.png';
import about128 from '../assets/navigation/about-v1-128.png';
import account from '../assets/brand/qitu-user-avatar-v2.png';
import profile64 from '../assets/navigation/profile-v1-64.png';
import profile128 from '../assets/navigation/profile-v1-128.png';
import assistants64 from '../assets/navigation/assistants-v1-64.png';
import assistants128 from '../assets/navigation/assistants-v1-128.png';
import teacherStatistics64 from '../assets/navigation/teacher-statistics-v1-64.png';
import teacherStatistics128 from '../assets/navigation/teacher-statistics-v1-128.png';

export const FIXED_NAVIGATION_FILES = {
  governance: { small: governance64, large: governance128 },
  workbench: { small: workbench64, large: workbench128 },
  students: { small: students64, large: students128 },
  statistics: { small: statistics64, large: statistics128 },
  relationships: { small: relationships64, large: relationships128 },
  settings: { small: settings64, large: settings128 },
  home: { small: home64, large: home128 },
  messages: { small: messages64, large: messages128 },
  gateway: { small: gateway64, large: gateway128 },
  plugins: { small: plugins64, large: plugins128 },
  database: { small: database64, large: database128 },
  ops: { small: ops64, large: ops128 },
  system: { small: system64, large: system128 },
  feishu: { small: feishu64, large: feishu128 },
  about: { small: about64, large: about128 },
  account: { small: account, large: account },
  profile: { small: profile64, large: profile128 },
  assistants: { small: assistants64, large: assistants128 },
  'teacher-statistics': { small: teacherStatistics64, large: teacherStatistics128 },
};

export type FixedNavigationArtworkId = keyof typeof FIXED_NAVIGATION_FILES;
