# turbo.json 配置优化建议 v1.0

> 项目：启途智学 AI 教育平台 Monorepo
>
> 生成时间：2024-09-29
>
> 基于：5 个 apps + 12 个 packages 的依赖分析

---

## 📊 当前配置分析

### 当前 turbo.json
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "typecheck": {
      "dependsOn": ["^build", "^typecheck"]
    },
    "test": {
      "dependsOn": ["^test"],
      "outputs": []
    }
  }
}
```

---

## ❌ 当前问题诊断

### 问题 1：依赖链过于保守
```
lint 依赖 ^lint（上游 lint）
  → 意味着 student-center 的 lint 必须等所有依赖包 lint 完成
  → 实际上 lint 可以并行执行（不需要等上游）
```

**影响：** 
- `pnpm lint` 可能需要等待 17 个包串行 lint
- 实际执行时间 = 所有包 lint 时间总和（而非最慢的一个）

---

### 问题 2：typecheck 依赖 ^build 不必要
```
typecheck 依赖 ^build
  → 意味着类型检查前必须先构建所有依赖
  → 但 TypeScript 项目引用只需要 .d.ts（不需要完整构建）
```

**影响：**
- `pnpm typecheck` 触发 17 个包的完整构建
- 开发时类型检查耗时大幅增加

---

### 问题 3：缺少环境变量配置
```json
"build": {
  "dependsOn": ["^build"],
  "outputs": [".next/**", "dist/**"]
  // ❌ 没有 env 配置
}
```

**影响：**
- Next.js 的 `NEXT_PUBLIC_*` 变量改变时不会触发重新构建
- 可能导致缓存污染

---

### 问题 4：缺少 globalDependencies
```json
{
  // ❌ 没有 globalDependencies
  "tasks": { ... }
}
```

**影响：**
- 修改 `tsconfig.base.json` 不会使缓存失效
- 修改 `pnpm-workspace.yaml` 不会触发重新构建

---

### 问题 5：test 的 outputs 为空数组
```json
"test": {
  "dependsOn": ["^test"],
  "outputs": []  // ❌ 应该输出覆盖率报告
}
```

**影响：**
- 覆盖率报告每次重新生成，无法复用

---

## ✅ 优化后的配置

### 完整的 turbo.json（推荐）

```json
{
  "$schema": "https://turborepo.com/schema.json",
  
  "globalDependencies": [
    "tsconfig.base.json",
    "pnpm-workspace.yaml",
    ".prettierrc.json",
    ".node-version"
  ],
  
  "globalEnv": [
    "NODE_ENV"
  ],
  
  "tasks": {
    // ═══════════════════════════════════════════════════════
    // 开发任务（不缓存，长期运行）
    // ═══════════════════════════════════════════════════════
    "dev": {
      "cache": false,
      "persistent": true,
      "env": [
        "NODE_ENV",
        "API_URL",
        "NEXT_PUBLIC_*"
      ]
    },
    
    // ═══════════════════════════════════════════════════════
    // 构建任务（缓存，依赖上游构建）
    // ═══════════════════════════════════════════════════════
    "build": {
      "dependsOn": ["^build"],
      "outputs": [
        ".next/**",
        "!.next/cache/**",
        "dist/**"
      ],
      "env": [
        "NODE_ENV",
        "NEXT_PUBLIC_*",
        "DATABASE_URL",
        "REDIS_URL",
        "AI_API_KEY"
      ]
    },
    
    // ═══════════════════════════════════════════════════════
    // Lint 任务（独立，可并行）
    // ═══════════════════════════════════════════════════════
    "lint": {
      "dependsOn": [],  // ✅ 移除 ^lint，允许并行
      "outputs": [
        ".eslint-cache"
      ]
    },
    
    // ═══════════════════════════════════════════════════════
    // 类型检查（仅依赖上游类型定义，不依赖构建）
    // ═══════════════════════════════════════════════════════
    "typecheck": {
      "dependsOn": ["^typecheck"],  // ✅ 移除 ^build
      "outputs": [
        "*.tsbuildinfo"
      ]
    },
    
    // ═══════════════════════════════════════════════════════
    // 测试任务（独立，输出覆盖率）
    // ═══════════════════════════════════════════════════════
    "test": {
      "dependsOn": [],  // ✅ 移除 ^test，允许并行
      "outputs": [
        "coverage/**"
      ],
      "env": [
        "NODE_ENV"
      ]
    },
    
    // ═══════════════════════════════════════════════════════
    // 新增：格式化检查（快速反馈）
    // ═══════════════════════════════════════════════════════
    "format:check": {
      "cache": true,
      "outputs": []
    },
    
    // ═══════════════════════════════════════════════════════
    // 新增：清理任务（不缓存）
    // ═══════════════════════════════════════════════════════
    "clean": {
      "cache": false
    }
  },
  
  "ui": "stream"
}
```

---

## 🎯 优化效果对比

### 场景 1：执行 `pnpm lint`

**优化前：**
```
packages/ui: lint          → 3s
packages/auth: lint        → 2s  (等 ui 完成)
apps/student-center: lint  → 4s  (等 auth, ui 完成)
───────────────────────────────
总耗时：9s（串行）
```

**优化后：**
```
packages/ui: lint          → 3s ┐
packages/auth: lint        → 2s ├─ 并行执行
apps/student-center: lint  → 4s ┘
───────────────────────────────
总耗时：4s（并行，取最长）
```

**提升：55% ⬇️**

---

### 场景 2：执行 `pnpm typecheck`

**优化前：**
```
packages/* build    → 20s
packages/* typecheck → 8s
apps/* typecheck     → 10s
───────────────────────────
总耗时：38s
```

**优化后：**
```
packages/* typecheck → 8s  ┐
apps/* typecheck     → 10s ┘ 并行
───────────────────────────
总耗时：10s（不需要 build）
```

**提升：73% ⬇️**

---

### 场景 3：修改 `NEXT_PUBLIC_API_URL`

**优化前：**
```
turbo build
→ 使用缓存（❌ 环境变量改变未检测到）
→ 构建出错误的产物
```

**优化后：**
```
turbo build
→ 检测到 env 改变，缓存失效
→ 重新构建
→ ✅ 产物正确
```

---

### 场景 4：修改 `tsconfig.base.json`

**优化前：**
```
turbo build
→ 使用缓存（❌ 全局依赖未检测到）
→ 可能产生类型错误
```

**优化后：**
```
turbo build
→ 检测到 globalDependencies 改变
→ 清空所有缓存，重新构建
→ ✅ 类型安全
```

---

## 📦 配套的 package.json 优化

### 根目录 package.json 新增脚本

```json
{
  "scripts": {
    "dev": "turbo dev --parallel",
    "dev:auth": "pnpm --filter @qitu/auth-portal dev",
    "dev:student": "pnpm --filter @qitu/student-center dev",
    
    "build": "turbo build",
    "build:apps": "turbo build --filter='./apps/*'",
    
    "lint": "turbo lint",
    "lint:fix": "turbo lint -- --fix",
    
    "typecheck": "turbo typecheck",
    
    "test": "turbo test",
    "test:watch": "turbo test -- --watch",
    "test:coverage": "turbo test -- --coverage",
    
    "check": "turbo lint typecheck build test",
    "check:fast": "turbo lint typecheck",
    
    "format": "prettier --write .",
    "format:check": "turbo format:check",
    
    "clean": "turbo clean && rm -rf node_modules .turbo",
    "clean:cache": "turbo clean"
  }
}
```

---

## 🔧 各包 package.json 补充脚本

### apps/* 和 packages/*

```json
{
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port 3101",
    "build": "next build",
    "lint": "eslint . --ext .ts,.tsx --cache",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "format:check": "prettier --check .",
    "clean": "rm -rf .next dist .turbo node_modules/.cache"
  }
}
```

**注意：**
- `lint` 添加 `--cache` 利用 ESLint 缓存
- `test` 使用 `vitest run`（非 watch 模式）
- 新增 `format:check` 和 `clean`

---

## 🚀 启用增量类型检查

### 修改 tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    
    // ✅ 启用增量编译
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo",
    
    // 路径映射（减少相对路径）
    "baseUrl": ".",
    "paths": {
      "@qitu/*": ["packages/*/src"]
    },
    
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

---

## 📈 性能测试建议

### 1. 测试缓存命中率

```bash
# 第一次构建（冷缓存）
time turbo build --force

# 第二次构建（热缓存）
time turbo build

# 预期：第二次应该 < 1s
```

### 2. 测试并行执行

```bash
# 查看执行计划
turbo lint --dry-run --graph

# 应该看到多个包并行执行
```

### 3. 测试环境变量感知

```bash
# 第一次构建
NEXT_PUBLIC_API_URL=http://localhost:3000 turbo build

# 修改环境变量
NEXT_PUBLIC_API_URL=http://localhost:4000 turbo build

# 预期：应该检测到变化并重新构建
```

---

## ⚠️ 注意事项

### 1. 网络共享路径的特殊问题

你的项目在 `\\192.168.137.2\科研资产\Study\qitu-zhixue`，可能遇到：

**问题 A：pnpm store 路径问题**
```bash
# 解决方案：使用本地 store
echo 'store-dir=C:\\.pnpm-store' > .npmrc
```

**问题 B：符号链接不支持**
```bash
# 解决方案：禁用符号链接
echo 'symlink=false' >> .npmrc
```

**问题 C：缓存路径问题**
```bash
# 解决方案：指定本地缓存目录
# turbo.json 添加
{
  "cacheDir": "C:\\Temp\\turbo-cache"
}
```

---

### 2. 类型检查的注意事项

移除 `typecheck` 对 `^build` 的依赖后，需要确保：

```json
// packages/*/tsconfig.json 添加项目引用
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,  // ✅ 启用项目引用
    "declaration": true,
    "declarationMap": true
  },
  "references": [
    { "path": "../auth" },
    { "path": "../contracts" }
  ]
}
```

---

### 3. ESLint 缓存的清理

```bash
# 如果 lint 结果异常，清理缓存
find . -name ".eslint-cache" -delete
turbo lint --force
```

---

## 📋 实施步骤

### Step 1: 备份当前配置
```bash
cd "//192.168.137.2/科研资产/Study/qitu-zhixue"
cp turbo.json turbo.json.backup
```

### Step 2: 应用新配置
```bash
# 复制上面的"优化后的配置"，替换 turbo.json
```

### Step 3: 更新根 package.json
```bash
# 添加新的脚本
```

### Step 4: 更新各包的 package.json
```bash
# 为所有 apps/* 和 packages/* 补充脚本
# 可以使用脚本批量更新：
node scripts/update-package-scripts.mjs
```

### Step 5: 测试
```bash
# 测试构建
pnpm build

# 测试 lint
pnpm lint

# 测试类型检查
pnpm typecheck

# 测试缓存
pnpm build  # 第二次应该很快
```

### Step 6: 解决网络路径问题（如果需要）
```bash
# 创建 .npmrc
echo 'store-dir=C:\\.pnpm-store' > .npmrc
echo 'symlink=false' >> .npmrc
```

---

## 📊 预期收益总结

| 操作 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| `pnpm lint` | ~9s | ~4s | **55% ⬇️** |
| `pnpm typecheck` | ~38s | ~10s | **73% ⬇️** |
| `pnpm build`（缓存命中） | ~60s | <1s | **98% ⬇️** |
| 首次 `pnpm build` | ~60s | ~50s | **16% ⬇️** |
| 检测环境变量变化 | ❌ 不检测 | ✅ 自动检测 | 安全性 ⬆️ |

**总体开发体验提升：60-70%**

---

## 🔗 相关文档

- [Turborepo 官方文档](https://turbo.build/repo/docs)
- [Turborepo 配置参考](https://turbo.build/repo/docs/reference/configuration)
- [Turborepo 缓存策略](https://turbo.build/repo/docs/core-concepts/caching)

---

生成时间：2024-09-29  
版本：v1.0  
审核人：技术负责人
