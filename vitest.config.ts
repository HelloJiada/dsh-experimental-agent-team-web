import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // 排除残留 worktree / 隐藏目录等历史遗留测试代码，避免测试计数虚高污染发布门控
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**', '**/coverage/**']
  }
})
