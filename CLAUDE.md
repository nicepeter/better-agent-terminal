# Better Agent Terminal

## Branch: `peter` vs `main` 分析

### Commits (2 个)
1. `eccb4e4` - fix: use login shell to load .zshrc/.bashrc on terminal startup
2. `7d56124` - feat: keep all workspaces mounted to preserve terminal state

---

### 功能修改总结

#### 1. Login Shell 支持 (`pty-manager.ts`)
**修复问题**: 终端启动时不会加载用户的 shell 配置文件

**修改内容**:
- 对 zsh/bash/sh 添加 `-l` 参数，使其以 login shell 方式启动
- 确保 `~/.zshrc` 或 `~/.bashrc` 被正确加载

---

#### 2. Workspace 状态保留 (`App.tsx`)
**修复问题**: 切换 workspace 时终端状态会丢失

**修改内容**:
- 原本只渲染当前 active workspace，改为渲染**所有 workspaces**
- 非活动的 workspace 使用 CSS `hidden` class 隐藏
- 切换时终端实例保持运行，不会被销毁重建

---

#### 3. 文件拖放功能 (`TerminalPanel.tsx`)
**新功能**: 支持拖放文件到终端

**实现细节**:
- 拖动文件到终端区域会自动输入文件路径
- 包含空格或特殊字符的路径会自动加引号
- 多个文件用空格分隔
- 拖动时显示 "Drop files here to paste path" 提示覆盖层

---

#### 4. Workspace 自定义颜色 (`Sidebar.tsx`, `workspace-store.ts`, `types`)
**新功能**: 为每个 workspace 设定终端颜色

**预设颜色选项**:
| 名称 | 背景色 | 文字色 |
|------|--------|--------|
| Default | #1f1d1a | #dfdbc3 |
| Dark | #1a1a2e | #eaeaea |
| Midnight | #0f0f23 | #cccccc |
| Forest | #1a2f1a | #b8d4b8 |
| Ocean | #0d253f | #a8d4f0 |
| Sunset | #2d1b1b | #f0c8a8 |
| Purple | #1e1a2e | #d4b8f0 |
| Coffee | #1f1814 | #d4c4b0 |

**UI 元素**:
- 侧边栏 workspace 项目新增颜色徽章
- 点击可开启颜色选择器
- 支持预设颜色或自定义 hex 颜色

---

### 文件变更统计
| 文件 | 变更 |
|------|------|
| `src/styles/main.css` | +214 (样式) |
| `src/components/Sidebar.tsx` | +132 (颜色选择器 UI) |
| `src/components/TerminalPanel.tsx` | +91 (拖放 + 颜色支持) |
| `src/App.tsx` | +17 (多 workspace 挂载) |
| `src/stores/workspace-store.ts` | +12 (颜色存储) |
| `electron/pty-manager.ts` | +3 (login shell) |
