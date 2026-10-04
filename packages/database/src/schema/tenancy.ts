import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Schools: the tenancy root for the shared single-school data model.
 *
 * Product baseline (文档 8.4 / 四端整改文档 8.4): 首期是**单校**部署，学校关系由
 * 后台建立，学生账号始终关联唯一学生档案。为了不给未来「一库多校」埋雷，这里先把
 * `schools` 作为作用域根落地，新增领域表统一带 `school_id`（可空 = 平台共享）。
 *
 * 约定：
 * - `school_id IS NULL` 表示**平台共享**资产（例如平台级项目模板 / 系统知识库）；
 * - `school_id = <id>` 表示该行只对某校可见；
 * - 学生私有事实（成长 / 记忆 / 计划 / 掌握度）在写入时由服务端解析当前学校并落
 *   `school_id`，客户端不能指定其它学校。
 *
 * 当前只种一行演示学校；真正的多校切换、RLS / SET ROLE 见
 * `docs/admin/database.md` 的未决事项。
 */
export const schools = pgTable(
  'schools',
  {
    id: text('id').primaryKey(),
    /** 稳定的机器码（导入 / 对接用），大小写不敏感唯一由应用层归一化保证。 */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** `'active' | 'archived'`；归档学校不可再挂新关系，但历史数据保留。 */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUniqueIdx: uniqueIndex('schools_code_unique_idx').on(table.code),
    statusIdx: index('schools_status_idx').on(table.status),
  }),
);
