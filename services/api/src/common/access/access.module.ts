import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../modules/identity-auth/auth.module';
import { DirectoryModule } from '../../modules/directory/directory.module';
import { AccessPolicy } from './access-policy';

/**
 * 对象级授权模块。
 *
 * `AccessPolicy` 是后端对象级授权的唯一入口（ADR 0002）。这里把它注册为
 * 全局 provider：控制器只需注入 `AccessPolicy` 即可，无需逐个模块 import，
 * 便于后续把仍走 `request-auth.ts` 的控制器分批迁移过来。
 *
 * 依赖方向：`access` → `identity-auth`（会话）+ `directory`（关系真相），
 * 不反向依赖任何业务模块；因此不会形成模块环。
 *
 * 注意：本模块**只**提供授权判定，不写审计、不做幂等、不迁移控制器。
 */
@Global()
@Module({
  imports: [AuthModule, DirectoryModule],
  providers: [AccessPolicy],
  exports: [AccessPolicy],
})
export class AccessModule {}
