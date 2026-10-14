import type { WorksStore } from '../works.store';
import { MediaArtifactResolver, type MediaArtifactRef } from './media-compliance-validator';
import { CodeArtifactResolver, type CodeArtifactRef } from './code-static-check-producer';

/**
 * P2 生产者端口实现：把 `WorksStore` 的**只读**能力收窄成生产者需要的两个方法。
 *
 * 为什么不直接注入整个 store 给生产者：
 * - 生产者自己不该拥有「改作品状态」的能力。把它们放在这里，
 *   既让依赖方向单向（生产者 → 读端口），也让「谁能写」在代码里一眼可查。
 *
 * 为什么两个实现都只用到 `findVersionById` / `findVersionByObjectKey`：
 * 这两个方法都是本工作流**新增的只读方法**（见 `works.store.ts`），
 * 因此不会与任何既有调用点产生行为耦合。
 */

/**
 * 视频 / 文档证据引用解析：objectKey → 真实版本行（含归属学生）。
 *
 * 归属校验在这里完成，`studentId` 只能来自**服务端存储行**，
 * 客户端提交的任何身份字段都不参与这条判断。
 */
export class StoreBackedMediaArtifactResolver extends MediaArtifactResolver {
  constructor(private readonly store: WorksStore) {
    super();
  }

  async resolveByObjectKey(objectKey: string): Promise<MediaArtifactRef | null> {
    const found = await this.store.findVersionByObjectKey(objectKey);
    if (found === null) return null;
    return {
      artifactId: found.artifact.id,
      artifactVersionId: found.version.id,
      objectKey: found.version.objectKey ?? objectKey,
      versionTitle: found.version.title,
      studentId: found.artifact.studentId,
    };
  }
}

/**
 * 代码版本解析：版本 id → 该版本登记的文件清单。
 *
 * **诚实限制（写进代码也写进 PR）**：`artifact_versions` 只登记**一个**
 * `object_key`，没有多文件清单字段（多文件打包/目录清单需要一次 schema 变更）。
 * 因此这里只能把该版本的对象登记为**一个**候选文件：
 *
 * - 版本标题以 `.py` 结尾 → 视为 Python 源文件；
 * - 否则文件清单为空 → `runCodeStaticCheck` 报 `CODE_FILE_MISSING:<entryFile>`
 *   （**结构不合格**），而不是假装读到了代码。
 *
 * 即：多文件项目（雷霆战机的 main.py + settings.py 等）的静态检查在本次范围内
 * **做不了**，它需要一个显式的文件清单字段，而不是猜测。
 */
export class StoreBackedCodeArtifactResolver extends CodeArtifactResolver {
  constructor(private readonly store: WorksStore) {
    super();
  }

  async resolve(artifactVersionId: string): Promise<CodeArtifactRef | null> {
    const found = await this.store.findVersionById(artifactVersionId);
    if (found === null) return null;
    const objectKey = found.version.objectKey;
    const title = found.version.title.trim();
    const isPython = title.toLowerCase().endsWith('.py');
    return {
      artifactId: found.artifact.id,
      artifactVersionId: found.version.id,
      studentId: found.artifact.studentId,
      files: isPython && objectKey !== null ? [{ filename: title, objectKey }] : [],
    };
  }
}
