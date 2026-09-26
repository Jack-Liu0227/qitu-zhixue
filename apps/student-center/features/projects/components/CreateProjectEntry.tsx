import { INSPIRATION_HREF } from '../constants';
import { StudentLink } from '../../../components/student-link';

/**
 * 「创建新项目」引导（验收 7）。
 *
 * 只跳转灵感空间；本模块**不得**调用 POST /projects，
 * 创建唯一入口是灵感空间的意图确认（确认门 Q3）。
 */
export function CreateProjectEntry() {
  return (
    <StudentLink className="qitu-button qitu-button-primary" href={INSPIRATION_HREF}>
      创建新项目
    </StudentLink>
  );
}
