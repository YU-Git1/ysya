# 文件夹压缩、批量导出与格式扩展实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 扩展压缩鸭的本地批处理能力，支持文件夹导入、ZIP 导出、受控任务调度、多图片格式处理，并接入可配置的 Supabase 邮箱登录。

**Architecture:** 保持 React + Vite + TypeScript 单页应用。文件系统访问优先使用标准 `webkitdirectory` 文件输入以覆盖桌面浏览器；压缩调度通过有界并发队列控制内存；格式解码/编码封装在 codec 模块；ZIP 由浏览器生成；Supabase 使用公开 anon key，密钥通过环境配置，登录通过邮箱 magic link。

**Tech Stack:** React、TypeScript、Vite、Supabase JS、fflate、jSquash AVIF、UTIF、HEIC decoder、GIF decoder/encoder、Vitest。

---

## 验收原则

- 文件夹内递归选取符合支持范围的图片；非法文件、超限文件、超过批次总量都给出可理解提示。
- 每批最多 200 张、每张最多 20 MB、整批最多 512 MB；通过 1-2 个并发 worker 处理，暂停时不继续分发新任务。
- 单项下载保持原有行为；“全部导出”下拉包含逐张下载与 ZIP；ZIP 保留相对目录并处理重名。
- 支持 JPG、PNG、WebP、AVIF、GIF、TIFF、HEIC 输入，以及 JPG、PNG、WebP、AVIF 输出。默认时 GIF、TIFF、HEIC 原样保留；转为静态格式时只保留解码后的首帧。
- 登录使用 Supabase email OTP/magic link；未配置环境变量时明确提示未配置，不伪造登录成功。
- `npm run build` 和相关单元测试通过；桌面与移动端手动检查上传、队列、导出和登录弹窗。

## Task 1：测试基础与纯函数

**Files:** `package.json`、`src/lib/compression/validation.ts`、`src/lib/compression/validation.test.ts`、`vite.config.ts`

1. 安装 Vitest 与测试脚本。
2. 抽出文件类型/大小/批量限制验证，先写边界测试，再实现。
3. 将扩展名作为 HEIC/常见 TIFF MIME 空缺时的回退检测，但仍验证文件签名/解码。

## Task 2：文件夹导入与本地任务调度

**Files:** `src/App.tsx`、`src/lib/compression/taskQueue.ts`、相关测试、`src/index.css`

1. 增加隐藏的 `webkitdirectory` 输入；保留现有文件输入和拖拽导入。
2. 在上传区提供“选择图片”和“选择文件夹”入口，展示目录相对路径。
3. 以并发 1-2 的任务调度代替同时启动整批压缩；暂停只阻止派发，恢复后继续。
4. 限制 20 张和 20 MB 单文件，并正确释放失败/移除项 object URL。

## Task 3：ZIP 导出菜单

**Files:** `src/App.tsx`、`src/index.css`、`package.json`

1. 引入 fflate，按输出目录路径生成 ZIP，处理重复文件名并保留目录结构。
2. 在全部导出按钮旁加下拉箭头，选项为逐张下载与 ZIP 压缩包。
3. 增加 ZIP 生成中状态、异常提示和空结果禁用状态。

## Task 4：编码器适配与格式范围

**Files:** `src/lib/compression/codecs/*`、`src/lib/compression/localEncoder.ts`、格式 selector 和校验文案、测试

1. 建立输入检测/解码与输出编码器注册表。
2. 提供 JPG、PNG、WebP、AVIF 输出与 TIFF/HEIC/GIF 输入解码。
3. 默认原格式下 GIF、TIFF、HEIC 原样保留；转换到 JPG/PNG/WebP/AVIF 时输出静态图像。
4. TIFF/GIF 不作为转换目标，HEIC 暂不提供编码器，避免无压缩 TIFF 变大或丢失动画/多页内容。
5. 避免每档重复编码所有质量候选；使用有界二分/候选采样降低 CPU，并把重计算放到 worker 或可中断任务中。

## Task 5：Supabase 邮箱登录

**Files:** `src/lib/auth/*`、`src/App.tsx`、`.env.example`、`.github/workflows/deploy.yml`、`src/index.css`

1. 建立 Supabase client，读取 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。
2. 添加响应式登录弹窗，邮箱 OTP/magic link、发送中、成功、错误、未配置状态。
3. 监听 auth session 并支持退出；session 仅由 Supabase SDK 管理。
4. GitHub Actions 将仓库 Secrets 注入构建；缺少配置时应用保持匿名可用并显示配置提示。

## Task 6：验证与交付

- 运行单元测试与生产构建。
- 本地验证文件夹选择、目录结构 ZIP、并发上限、暂停/恢复、每种实际支持格式的导入与输出。
- 检查 390px 和 1280px 页面布局、键盘可达性和登录状态。
- 更新格式与压缩策略文档，提交完整功能改动。

## 技术边界

- 浏览器目录输入支持度以 Chromium/桌面浏览器为主；移动端通常只提供文件选择器，不保证目录访问。
- HEIC 解码可由 WASM 转码库实现；HEIC 编码器成熟度、包体和移动性能需专项验证。
- AVIF 编码 WASM 约 3.5 MB、HEIC 解码模块约 1.35 MB，均按需加载；首次使用相应格式时会额外下载并占用设备内存。
- 压缩档位调整质量搜索目标和最低样本 RGB 相似度，不承诺固定节省比例；个别复杂图片可能无法达到目标体积。
- GIF 动画保持需要帧级优化与重编码，不能通过单帧 Canvas 路径正确完成。
- Supabase 登录需要用户配置项目 URL、anon key、邮件模板和允许的重定向域名；这些不是代码可以代替创建的。
