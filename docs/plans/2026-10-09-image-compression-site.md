# 图片压缩网站 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个类似 TinyPNG 的图片压缩与格式转换网站，用户可以批量上传图片、查看压缩进度与结果、下载单张或打包文件，并为后续账号、额度和付费能力预留接口。

**Architecture:** 采用 React + Vite + Tailwind CSS 的前端单页应用，按页面、业务组件、状态和 API 客户端分层。首期后端采用 Node.js API + 独立图片处理 worker，上传使用对象存储的预签名 URL，处理完成后由 API 返回结果元数据；前端不直接承担大文件压缩，避免阻塞页面和绕过服务端安全策略。

**Tech Stack:** React、TypeScript、Vite、Tailwind CSS、React Router、TanStack Query、Zod、Node.js、Fastify、Sharp、Redis/BullMQ、S3 兼容对象存储、Vitest、Playwright。

---

## 产品边界与目标用户

首期目标用户是需要快速压缩网页素材的设计师、开发者和内容运营人员。产品核心承诺是“上传即压缩、结果可比较、下载够简单”，不在首期实现复杂编辑器、用户社区或在线图片管理。

MVP 支持 JPG/JPEG、PNG、WebP；单文件限制 20 MB，单批最多 20 张；压缩后保留原始尺寸，默认以无明显视觉损失为目标。AVIF、GIF 动图、TIFF、HEIC、登录、付费额度和永久历史记录作为第二阶段能力。

## 页面与用户流程

### 1. 首页 `/`

- 顶部：品牌、产品导航、语言入口、登录/账户入口（未接入时显示为后续占位入口）。
- 主工作区：大面积拖拽上传区，支持点击选择、粘贴图片和键盘操作；展示支持格式、大小与批量上限。
- 上传后：每张图片进入队列卡片，显示文件名、原始大小、状态、进度、错误信息。
- 空状态要有明确示例和隐私说明：文件仅为处理而暂存，超过生命周期自动清理。
- 页面下方：压缩前后对比说明、格式支持、FAQ 和简短 SEO 文案。

### 2. 结果工作区 `/compress`

- 结果列表：原图尺寸、原始大小、压缩后大小、节省比例、输出格式、下载按钮。
- 批量操作：全部下载、重新处理、删除失败项；全部下载生成 ZIP。
- 失败项提供可理解的原因，例如格式不支持、文件损坏、超过大小限制或处理超时。
- 支持在列表中继续追加图片，不丢失已经完成的结果。

### 3. 结果详情抽屉

- 显示原图/压缩图预览、尺寸、文件类型、压缩算法参数和节省比例。
- 提供“下载压缩图”和“重新压缩”操作；移动端改为底部抽屉。

### 4. 第二阶段页面

- `/pricing`：按月额度、单次购买和团队方案。
- `/account`：历史任务、剩余额度、API Key。
- `/api-docs`：面向开发者的批量压缩 API 文档。

## 视觉与交互方向

采用“明亮的工作台 + 高识别度绿色强调色”的方向，保留 TinyPNG 的直接性，但避免照搬品牌。背景使用温和的浅灰白，上传区用清晰边框、轻微纹理和大面积留白；成功态以绿色、失败态以珊瑚色区分。字体使用一个有个性的展示字体配合易读的正文无衬线字体，组件圆角控制在 8px 以内，重点使用拖拽反馈、队列进度和完成动画提升反馈感。

必须满足：键盘可操作、拖拽区有焦点样式、进度不仅依赖颜色、按钮在移动端有足够触控尺寸、图片预览提供替代文本、错误文案不暴露内部堆栈。

## 技术架构

### 前端目录

```text
src/
  app/                 # 路由、QueryClient、全局错误边界
  components/          # Button、Dropzone、ProgressBar、Modal 等通用组件
  features/compress/   # 上传队列、压缩结果、详情抽屉、业务 hooks
  pages/               # HomePage、CompressPage、PricingPage、AccountPage
  lib/                 # apiClient、validation、formatters、analytics
  styles/              # Tailwind 入口和设计 token
```

### 后端目录

```text
server/
  routes/              # upload、jobs、downloads、health
  services/            # jobService、storageService、zipService
  workers/             # Sharp 处理 worker
  schemas/             # Zod 请求/响应 schema
  config/              # 环境变量解析和默认值
```

### 处理流程

1. 前端调用 `POST /api/uploads/init`，提交文件名、大小、MIME 和校验摘要。
2. API 校验类型、大小和请求频率，返回对象存储预签名上传地址与 `assetId`。
3. 浏览器直传原图到临时桶，随后调用 `POST /api/jobs` 创建压缩任务。
4. API 将任务放入 BullMQ；worker 从临时桶读取文件，用 Sharp 处理并写入结果桶。
5. 前端通过 `GET /api/jobs/:jobId` 轮询，或后续升级为 SSE；任务完成后拿到结果下载地址。
6. `POST /api/downloads/zip` 为选中的结果生成短期 ZIP 下载地址。
7. 定时任务清理原图、压缩结果和 ZIP，默认保留 24 小时；付费账户再扩展保留策略。

## API 草案

### `POST /api/uploads/init`

请求：`{ fileName, fileSize, mimeType, sha256? }`

响应：`{ assetId, uploadUrl, expiresAt }`

### `POST /api/jobs`

请求：`{ assetIds: string[], outputFormat?: "original" | "webp" | "avif", quality?: number }`

响应：`{ jobId, items: [{ assetId, status }] }`

### `GET /api/jobs/:jobId`

响应：`{ jobId, status, progress, items: [{ assetId, status, originalBytes, outputBytes, savings, downloadUrl, errorCode? }] }`

所有接口统一返回 `{ data, error, requestId }` 结构；错误码使用稳定的机器可读值，前端负责本地化文案。

## 数据模型与安全约束

- `assets`：资产 ID、原始文件名、MIME、原始大小、对象键、创建时间、过期时间。
- `jobs`：任务 ID、状态、进度、请求参数、创建/完成时间、用户或匿名会话标识。
- `job_items`：每个资产的输入输出大小、输出对象键、错误码和完成时间。
- 匿名用户通过 HttpOnly 会话 Cookie 关联任务；不在 localStorage 保存敏感令牌。
- 服务端重新检测 MIME 和文件签名，不能只信任浏览器传入的 MIME。
- 限制单 IP/会话的并发任务、上传速率和每日匿名额度；压缩 worker 使用 CPU/内存上限。
- 下载地址使用短时预签名 URL；对象存储桶禁止公开读；响应加上 CSP、X-Content-Type-Options 和合理的 CORS 白名单。
- 原图与结果自动删除，日志中不写入原始文件名以外的隐私内容；生产环境接入病毒扫描和审计日志。

## 分阶段交付

### 阶段 0：基础设施与设计系统

- 初始化 React/Vite/Tailwind/TypeScript 工程并立即初始化 Git。
- 建立颜色、字体、间距、按钮、输入、状态标签和空状态 token。
- 配置 ESLint、Prettier、Vitest、Playwright、环境变量 schema 和基础 CI。

验收：`npm run build`、`npm run test`、`npm run lint` 通过，首页路由可以加载。

### 阶段 1：前端本地 MVP

- 完成首页上传区、拖拽/点击/粘贴、文件校验和上传队列。
- 使用本地 mock worker 模拟压缩进度与结果，完成结果列表、详情抽屉、下载按钮和失败重试。
- 覆盖桌面端与移动端布局，补齐键盘、屏幕阅读器和空/加载/错误状态。

验收：无需后端即可完整走通“选择 3 张图 -> 进度 -> 结果 -> 下载”的流程，无控制台错误。

### 阶段 2：真实 API 与图片处理

- 实现预签名上传、任务创建、Sharp worker、状态查询和短期下载。
- 接入 Redis/BullMQ，增加清理任务、失败重试和超时处理。
- 用真实图片样本验证 JPG、PNG、WebP 的压缩比例、视觉质量和 EXIF 处理。

验收：20 张、单张 20 MB 以内的批量任务可稳定完成；失败任务能重试；过期对象会被清理。

### 阶段 3：生产化与增长能力

- 接入匿名额度、登录、任务历史、计费和 API Key。
- 增加 AVIF、GIF 策略、ZIP 大批量下载、埋点、错误监控和性能监控。
- 做 SEO 元数据、结构化数据、站点地图、隐私政策和服务条款。

验收：支持灰度发布、回滚、关键指标告警和费用上限控制。

## 测试策略

- 单元测试：文件校验、格式化函数、压缩比例计算、任务状态机、API schema。
- 集成测试：上传初始化 -> 创建任务 -> 查询状态 -> 下载链接的 API 链路；worker 处理损坏文件和超时。
- E2E：桌面端和移动端分别覆盖拖拽上传、批量结果、单项失败、重试、全部下载。
- 视觉回归：首页空状态、上传中、完成、错误、详情抽屉五个关键快照。
- 性能验收：首屏 LCP < 2.5s（不含用户上传耗时）；前端主线程不因大文件预览阻塞；API P95 状态查询 < 300ms。

## 风险与决策

- 浏览器端压缩成本低但会占用用户设备并造成大文件卡顿，因此正式架构采用服务端 worker；本地 mock 仅用于前端阶段。
- 直接仿制 TinyPNG 的品牌、文案和视觉会带来知识产权风险，产品名、图标、文案和组件视觉必须原创。
- 无损压缩不等于文件一定变小；结果页需展示“节省比例”并允许输出格式转换，避免对极少数图片做过度承诺。
- 图片是高成本资源，必须先设置单文件、批量、并发和保留期限，再开放匿名上传。

## 首期建议指标

- 上传到首个任务开始的中位时间 < 2 秒。
- 任务完成率 > 99%（不含用户主动取消）。
- 平均压缩率按格式分别统计，不用单一目标误导用户。
- 结果下载成功率 > 99.5%。
- 首页上传区到首次上传转化率和移动端失败率作为迭代重点。

## 建议的实现顺序

1. 完成阶段 0 的工程与设计 token。
2. 先做阶段 1 的本地可用闭环，验证交互与视觉。
3. 再接入阶段 2 的真实处理服务，避免前后端同时变化导致排错困难。
4. 用真实图片样本和 Playwright 做验收，再决定是否进入账户、计费和 API 能力。

