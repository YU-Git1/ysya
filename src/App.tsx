import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { compressLocally, getFormatLabel, type LocalOutputFormat } from './lib/compression/localEncoder'
import { getCompressionConcurrency, TaskScheduler } from './lib/compression/taskQueue'
import { MAX_BATCH_BYTES, MAX_BATCH_FILES, MAX_FILE_BYTES, detectInputFormat, validateFiles } from './lib/compression/validation'
import { isAuthConfigured, supabase } from './lib/auth/supabase'
import { createZip } from './lib/compression/zipExport'
import { writeFilesToDirectory } from './lib/compression/folderExport'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  ChevronDown,
  CloudUpload,
  Download,
  FolderInput,
  FileImage,
  FileStack,
  Info,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react'

type ItemStatus = 'queued' | 'compressing' | 'done' | 'error'
type OutputFormat = LocalOutputFormat
type Language = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

type AppCopy = {
  home: string; navLabel: string; tool: string; how: string; language: string; login: string; menu: string
  heroTitle: string; heroTitleAccent: string; heroDescription: string; local: string; localDescription: string
  drop: string; formats: string; max: string; settings: string; output: string; keep: string; level: string
  folder: string; supportedFormats: string; batchLimit: string; exportAll: string; downloadFiles: string; exportZip: string; zipWorking: string; loginEmail: string; sendLoginLink: string; signOut: string; authMissing: string
  exportFolder: string
  workspace: string; done: string; working: string; files: string; fast: string; outputPrefix: string; pause: string; resume: string; waiting: string
  why: string; whyAccent: string; fastTitle: string; fastCopy: string; privateTitle: string; privateCopy: string; clearTitle: string; clearCopy: string; try: string
  help: string
}

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
]

type ImageItem = {
  id: string
  file: File
  previewUrl: string
  outputUrl?: string
  outputBlob?: Blob
  outputName?: string
  outputFormat?: string
  directoryPath?: string
  inputFormat: string
  compressionLevel: number
  requestedOutputFormat: OutputFormat
  originalSize: number
  outputSize?: number
  width?: number
  height?: number
  progress: number
  status: ItemStatus
  error?: string
}

const ACCEPTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/tiff', 'image/heic', 'image/heif', '.tif', '.tiff', '.heic', '.heif']
const OUTPUT_FORMATS: [OutputFormat, string][] = [['original', '保持默认'], ['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP'], ['image/avif', 'AVIF']]

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<import('./lib/compression/folderExport').DirectoryHandle>
  }
}

type DroppedEntry = FileSystemEntry & { file?: (success: (file: File) => void, error?: () => void) => void; createReader?: () => { readEntries: (success: (entries: DroppedEntry[]) => void, error?: () => void) => void } }

async function getDroppedFiles(items: DataTransferItemList, maxFiles = MAX_BATCH_FILES) {
  const files: { file: File; path?: string }[] = []
  const readEntry = async (entry: DroppedEntry, parent = ''): Promise<void> => {
    if (files.length >= maxFiles) return
    if (entry.isFile && entry.file) {
      const file = await new Promise<File | null>((resolve) => entry.file?.(resolve, () => resolve(null)))
      if (file) files.push({ file, path: parent || undefined })
      return
    }
    if (!entry.isDirectory || !entry.createReader) return
    const reader = entry.createReader()
    while (true) {
      const entries = await new Promise<DroppedEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])))
      if (!entries.length) break
      for (const child of entries) {
        if (files.length >= maxFiles) break
        await readEntry(child, [parent, entry.name].filter(Boolean).join('/'))
      }
      if (files.length >= maxFiles) break
    }
  }
  const entries = Array.from(items).map((item) => item.webkitGetAsEntry?.() as DroppedEntry | null).filter((entry): entry is DroppedEntry => Boolean(entry))
  if (!entries.length) return Array.from(items).slice(0, maxFiles).flatMap((item) => item.getAsFile() ? [{ file: item.getAsFile()! }] : [])
  for (const entry of entries) {
    if (files.length >= maxFiles) break
    await readEntry(entry)
  }
  return files
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatSavings(original: number, output?: number) {
  if (!output) return '—'
  const savings = Math.max(0, Math.round((1 - output / original) * 100))
  return `${savings}%`
}

function getOutputName(fileName: string, outputFormat: string) {
  const index = fileName.lastIndexOf('.')
  const baseName = index > 0 ? fileName.slice(0, index) : fileName
  const extension = outputFormat === 'original' || outputFormat === 'image/jpeg' ? 'jpg' : outputFormat === 'image/png' ? 'png' : outputFormat === 'image/webp' ? 'webp' : outputFormat === 'image/avif' ? 'avif' : outputFormat === 'image/gif' ? 'gif' : outputFormat === 'image/heic' || outputFormat === 'image/heif' ? 'heic' : 'tif'
  return `${baseName}-min.${extension}`
}

function formatLabel(outputFormat: OutputFormat, language: Language) {
  const format = outputFormat === 'original' ? '' : getFormatLabel(outputFormat)
  if (language === 'en') return outputFormat === 'original' ? 'Keep default' : `Convert to ${format}`
  if (language === 'ja') return outputFormat === 'original' ? 'デフォルト' : `${format} に変換`
  if (language === 'ko') return outputFormat === 'original' ? '기본 유지' : `${format}로 변환`
  if (language === 'zh-TW') return outputFormat === 'original' ? '保持預設' : `轉換為 ${format}`
  return outputFormat === 'original' ? '保持默认' : `转换为 ${format}`
}

function getCopy(language: Language): AppCopy {
  if (language === 'en') return {
    home: 'QuackPress home', navLabel: 'Main navigation', tool: 'Compressor', how: 'How it works', language: 'English', login: 'Sign in', menu: 'Open menu',
    heroTitle: 'Lighter images,', heroTitleAccent: 'faster web.', heroDescription: 'Choose a format, upload images, preview the result, and download. Everything runs locally in your browser.', local: 'Local processing', localDescription: 'No signup. Your images stay on your device.',
    drop: 'Drag or click to choose files', formats: 'Formats', max: '20 MB per file', settings: 'Image compression settings', output: 'Output format', keep: 'Keep default', level: 'Compression level', folder: 'Choose folder', supportedFormats: 'JPG, PNG, WebP, AVIF, GIF, TIFF, HEIC', batchLimit: 'Up to 200 images · 512 MB per batch', exportAll: 'Export all', downloadFiles: 'Download files separately', exportZip: 'Export as ZIP archive', zipWorking: 'Creating ZIP...', exportFolder: 'Save to folder', loginEmail: 'Email address', sendLoginLink: 'Send sign-in link', signOut: 'Sign out', authMissing: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in.', workspace: 'YOUR WORKSPACE', done: 'Compression complete.', working: 'Making images lighter.', files: 'files', fast: 'Local processing, speed first', outputPrefix: 'Output:', pause: 'Pause', resume: 'Resume', waiting: 'Images are being processed in your browser. Please wait before leaving.',
    why: 'Less waiting,', whyAccent: 'more creating.', fastTitle: 'Fast enough to forget the wait', fastCopy: 'Everything runs in your browser. Your images take no detour through a server.', privateTitle: 'Your images stay private', privateCopy: 'QuackPress processes images locally in your browser. Nothing is uploaded.', clearTitle: 'Small, without visible loss', clearCopy: 'Smart encoding keeps important details while making files meaningfully smaller.', try: 'Try it', help: 'Help',
  }
  if (language === 'ja') return {
    home: 'QuackPress ホーム', navLabel: 'メインナビゲーション', tool: '圧縮ツール', how: '使い方', language: '日本語', login: 'ログイン', menu: 'メニューを開く',
    heroTitle: '画像を軽く、', heroTitleAccent: 'ウェブを速く。', heroDescription: '形式を選び、画像をアップロードして、結果を確認してダウンロード。すべてブラウザ内で処理します。', local: 'ローカル処理', localDescription: '登録不要。画像はデバイスから離れません。',
    drop: 'ドラッグまたはクリックしてファイルを選択', formats: '対応形式', max: '1ファイル最大 20 MB', settings: '画像圧縮設定', output: '出力形式', keep: 'デフォルト', level: '圧縮レベル', folder: 'フォルダーを選択', supportedFormats: 'JPG、PNG、WebP、AVIF、GIF、TIFF、HEIC', batchLimit: '一括最大200枚・512 MB', exportAll: 'すべて書き出す', downloadFiles: '個別にダウンロード', exportZip: 'ZIPで書き出す', zipWorking: 'ZIPを作成中…', exportFolder: 'フォルダーに保存', loginEmail: 'メールアドレス', sendLoginLink: 'ログインリンクを送信', signOut: 'ログアウト', authMissing: 'ログインを有効にするには Supabase の環境変数を設定してください。', workspace: 'YOUR WORKSPACE', done: '圧縮完了。', working: '画像を軽くしています。', files: 'ファイル', fast: 'ローカル処理、速度優先', outputPrefix: '出力:', pause: '一時停止', resume: '再開', waiting: 'ブラウザで画像を処理中です。完了までお待ちください。',
    why: '待ち時間を減らし、', whyAccent: '創造を増やす。', fastTitle: '待つことを忘れる速さ', fastCopy: 'すべてブラウザで処理。画像をサーバーへ送信しません。', privateTitle: '画像はデバイス内に', privateCopy: 'QuackPress はブラウザ内で画像を処理します。アップロードはありません。', clearTitle: '見た目を保って軽量化', clearCopy: '重要なディテールを残しながら、ファイルサイズを小さくします。', try: '試す', help: 'ヘルプ',
  }
  if (language === 'ko') return {
    home: 'QuackPress 홈', navLabel: '주 메뉴', tool: '압축 도구', how: '사용 방법', language: '한국어', login: '로그인', menu: '메뉴 열기',
    heroTitle: '이미지는 가볍게,', heroTitleAccent: '웹은 빠르게.', heroDescription: '형식을 선택하고 이미지를 업로드한 뒤 결과를 확인하고 다운로드하세요. 모든 처리는 브라우저에서 진행됩니다.', local: '로컬 처리', localDescription: '가입이 필요 없습니다. 이미지는 기기에 남습니다.',
    drop: '드래그하거나 클릭하여 파일 선택', formats: '지원 형식', max: '파일당 최대 20 MB', settings: '이미지 압축 설정', output: '출력 형식', keep: '기본 유지', level: '압축 정도', folder: '폴더 선택', supportedFormats: 'JPG, PNG, WebP, AVIF, GIF, TIFF, HEIC', batchLimit: '한 번에 최대 200개 · 512 MB', exportAll: '전체 내보내기', downloadFiles: '개별 파일 다운로드', exportZip: 'ZIP 파일로 내보내기', zipWorking: 'ZIP 만드는 중...', exportFolder: '폴더에 저장', loginEmail: '이메일 주소', sendLoginLink: '로그인 링크 보내기', signOut: '로그아웃', authMissing: '로그인을 사용하려면 Supabase 환경 변수를 설정하세요.', workspace: 'YOUR WORKSPACE', done: '압축 완료.', working: '이미지를 가볍게 만드는 중입니다.', files: '개 파일', fast: '로컬 처리, 빠른 속도', outputPrefix: '출력:', pause: '일시정지', resume: '계속', waiting: '브라우저에서 이미지를 처리 중입니다. 완료될 때까지 기다려 주세요.',
    why: '기다림은 줄이고,', whyAccent: '창작은 늘리고.', fastTitle: '기다림을 잊을 만큼 빠르게', fastCopy: '모든 처리는 브라우저에서 진행됩니다. 이미지가 서버를 거치지 않습니다.', privateTitle: '이미지는 기기에 안전하게', privateCopy: 'QuackPress는 브라우저에서 이미지를 처리하며 업로드하지 않습니다.', clearTitle: '화질은 유지하고 용량은 줄이고', clearCopy: '중요한 디테일을 유지하면서 파일을 작게 만듭니다.', try: '사용해 보기', help: '도움말',
  }
  if (language === 'zh-TW') return {
    home: '壓縮鴨首頁', navLabel: '主導覽', tool: '壓縮工具', how: '運作方式', language: '繁體中文', login: '登入', menu: '開啟選單',
    heroTitle: '圖片變輕，', heroTitleAccent: '網頁更快。', heroDescription: '選擇格式、上傳圖片、預覽結果後直接下載。壓縮過程在瀏覽器本機完成。', local: '本機處理', localDescription: '無需註冊，圖片不會離開你的裝置。',
    drop: '拖曳或點擊選擇檔案', formats: '支援格式', max: '單一檔案最大 20 MB', settings: '圖片壓縮設定', output: '輸出格式', keep: '保持預設', level: '壓縮程度', folder: '選擇資料夾', supportedFormats: 'JPG、PNG、WebP、AVIF、GIF、TIFF、HEIC', batchLimit: '單批最多 200 張 · 512 MB', exportAll: '全部匯出', downloadFiles: '分別下載檔案', exportZip: '匯出為 ZIP 壓縮檔', zipWorking: '正在建立 ZIP…', exportFolder: '匯出至資料夾', loginEmail: '電子郵件', sendLoginLink: '傳送登入連結', signOut: '登出', authMissing: '設定 Supabase 環境變數後即可啟用登入。', workspace: 'YOUR WORKSPACE', done: '壓縮完成。', working: '正在讓圖片變輕。', files: '個檔案', fast: '本機處理，速度優先', outputPrefix: '輸出：', pause: '暫停', resume: '繼續', waiting: '圖片正在瀏覽器中處理，離開頁面前請等待完成',
    why: '少一點等待，', whyAccent: '多一點創造。', fastTitle: '快得讓人忘記等待', fastCopy: '所有處理都在瀏覽器中完成，圖片不會繞路經過伺服器。', privateTitle: '圖片不離開你的裝置', privateCopy: '壓縮鴨在瀏覽器本機處理圖片，不會上傳。', clearTitle: '保持清晰，檔案更小', clearCopy: '保留重要細節，同時有效縮小檔案。', try: '試用看看', help: '說明中心',
  }
  return {
    home: '压缩鸭首页', navLabel: '主导航', tool: '压缩工具', how: '怎么工作', language: '简体中文', login: '登录', menu: '打开菜单',
    heroTitle: '图片变轻，', heroTitleAccent: '网页更快。', heroDescription: '选择格式，上传图片，预览结果后直接下载。压缩过程在浏览器本地完成。', local: '本地处理', localDescription: '无需注册，图片不离开你的设备。',
    drop: '拖拽或点击选择文件', formats: '支持格式', max: '单张文件最大 20 MB', settings: '图片压缩设置', output: '输出格式', keep: '保持默认', level: '压缩程度', folder: '选择文件夹', supportedFormats: 'JPG、PNG、WebP、AVIF、GIF、TIFF、HEIC', batchLimit: '单批最多 200 张 · 512 MB', exportAll: '全部导出', downloadFiles: '逐张下载', exportZip: '导出为 ZIP 压缩包', zipWorking: '正在打包 ZIP…', exportFolder: '导出到文件夹', loginEmail: '邮箱地址', sendLoginLink: '发送登录链接', signOut: '退出登录', authMissing: '配置 Supabase 环境变量后即可启用登录。', workspace: '你的工作区', done: '压缩完成。', working: '正在压缩图片。', files: '个文件', fast: '本地处理 · 速度优先', outputPrefix: '输出：', pause: '暂停', resume: '继续', waiting: '图片正在本地处理中，请稍候。',
    why: '少一点等待，', whyAccent: '多一点创造。', fastTitle: '快得让人忘记等待', fastCopy: '所有处理都在你的浏览器里完成。图片不会绕远路，上传后马上就能看到结果。', privateTitle: '图片不离开你的设备', privateCopy: '压缩鸭当前在浏览器本地完成处理，不需要把图片上传到我们的服务器。', clearTitle: '清晰，肉眼看不出差别', clearCopy: '智能选择压缩参数，在明显变小的同时，尽量保留每个重要的细节。', try: '试试看', help: '帮助中心',
  }
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<ImageItem[]>([])
  const removedItemIdsRef = useRef(new Set<string>())
  const isPausedRef = useRef(false)
  const zipMenuRef = useRef<HTMLDivElement>(null)
  const schedulerRef = useRef<TaskScheduler<ImageItem> | null>(null)
  const [items, setItems] = useState<ImageItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('original')
  const [compressionLevel, setCompressionLevel] = useState(1)
  const [activeItem, setActiveItem] = useState<ImageItem | null>(null)
  const [notice, setNotice] = useState('')
  const [language, setLanguage] = useState<Language>('zh-CN')
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false)
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false)
  const [isZipping, setIsZipping] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginMessage, setLoginMessage] = useState('')
  const [isSendingLogin, setIsSendingLogin] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [isNavVisible, setIsNavVisible] = useState(true)
  const navHideTimerRef = useRef<number | null>(null)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    const handleScroll = () => {
      setIsNavVisible(true)
      if (navHideTimerRef.current !== null) window.clearTimeout(navHideTimerRef.current)
      if (window.scrollY <= 8) return
      navHideTimerRef.current = window.setTimeout(() => setIsNavVisible(false), 900)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (navHideTimerRef.current !== null) window.clearTimeout(navHideTimerRef.current)
    }
  }, [])

  const completedItems = useMemo(() => items.filter((item) => item.status === 'done'), [items])
  const hasWork = items.length > 0
  const allDone = hasWork && items.every((item) => item.status === 'done' || item.status === 'error')
  const hasFailures = items.some((item) => item.status === 'error')
  const totalOriginal = items.reduce((sum, item) => sum + item.originalSize, 0)
  const totalOutput = completedItems.reduce((sum, item) => sum + (item.outputSize ?? 0), 0)
  const totalInputBytes = items.reduce((sum, item) => sum + item.originalSize, 0)
  const copy = getCopy(language)

  const updateItem = useCallback((id: string, update: Partial<ImageItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)))
  }, [])

  const compressItem = useCallback(
    async (item: ImageItem) => {
      updateItem(item.id, { status: 'compressing', progress: 8 })
      try {
        const result = await compressLocally(item.file, item.requestedOutputFormat, item.compressionLevel, (progress) => updateItem(item.id, { progress }), () => isPausedRef.current)
        if (removedItemIdsRef.current.has(item.id)) return
        const outputUrl = URL.createObjectURL(result.previewBlob ?? result.blob)
        if (result.previewBlob) URL.revokeObjectURL(item.previewUrl)
        updateItem(item.id, {
          previewUrl: result.previewBlob ? outputUrl : item.previewUrl,
          outputUrl,
          outputBlob: result.blob,
          outputName: getOutputName(item.file.name, result.mime),
          outputSize: result.blob.size,
          outputFormat: result.formatLabel,
          width: result.width,
          height: result.height,
          progress: 100,
          status: 'done',
        })
      } catch {
        updateItem(item.id, { status: 'error', error: language === 'en' ? 'Processing failed. Please retry.' : '图片处理失败，请重试' })
      }
    },
    [updateItem],
  )

  useEffect(() => {
    const scheduler = new TaskScheduler<ImageItem>(getCompressionConcurrency(), compressItem)
    scheduler.setPaused(isPausedRef.current)
    schedulerRef.current = scheduler
    return () => { schedulerRef.current = null }
  }, [compressItem])

  const startQueued = useCallback(
    (newItems: ImageItem[]) => {
      schedulerRef.current?.enqueue(newItems)
    },
    [],
  )

  const addFiles = useCallback(
    (files: { file: File; path?: string }[]) => {
      const validation = validateFiles(files.map(({ file }) => file), items.length, totalInputBytes)
      let acceptedIndex = 0
      const accepted: ImageItem[] = []
      files.forEach(({ file, path }) => {
        if (validation.accepted[acceptedIndex] !== file) return
        acceptedIndex += 1
        const item: ImageItem = {
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          file,
          previewUrl: URL.createObjectURL(file),
          originalSize: file.size,
          directoryPath: path,
          inputFormat: detectInputFormat(file) ?? 'unknown',
          compressionLevel,
          requestedOutputFormat: outputFormat,
          progress: 0,
          status: 'queued',
        }
        removedItemIdsRef.current.delete(item.id)
        accepted.push(item)
      })
      const firstError = validation.errors[0]
      if (firstError) {
        const reason = firstError.reason
        const detail = reason === 'unsupported' ? (language === 'en' ? 'unsupported format' : '格式暂不支持') : reason === 'file-too-large' ? (language === 'en' ? 'over 20 MB' : '单张超过 20 MB') : reason === 'batch-file-limit' ? (language === 'en' ? `maximum ${MAX_BATCH_FILES} images per batch` : `单批最多 ${MAX_BATCH_FILES} 张图片`) : (language === 'en' ? 'batch exceeds 512 MB' : '整批文件不能超过 512 MB')
        setNotice(`${firstError.file.name}: ${detail}`)
      }
      if (!accepted.length) return
      setItems((current) => [...current, ...accepted])
      startQueued(accepted)
    },
    [compressionLevel, language, outputFormat, startQueued, items.length, totalInputBytes],
  )

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []).map((file) => ({ file })))
    event.target.value = ''
  }

  const handleFolderInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []).map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
      return { file, path: relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : undefined }
    }))
    event.target.value = ''
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const remainingCapacity = Math.max(1, MAX_BATCH_FILES - itemsRef.current.length + 1)
    const files = await getDroppedFiles(event.dataTransfer.items, remainingCapacity)
    addFiles(files)
  }

  const removeItem = (id: string) => {
    removedItemIdsRef.current.add(id)
    schedulerRef.current?.removeQueued((item) => item.id === id)
    setItems((current) => {
      const item = current.find((entry) => entry.id === id)
      if (item) {
        URL.revokeObjectURL(item.previewUrl)
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl)
      }
      return current.filter((entry) => entry.id !== id)
    })
  }

  const retryItem = (item: ImageItem) => {
    removedItemIdsRef.current.delete(item.id)
    updateItem(item.id, { status: 'queued', progress: 0, error: undefined })
    schedulerRef.current?.enqueue([{ ...item, status: 'queued', progress: 0 }])
  }

  const downloadItem = (item: ImageItem) => {
    if (!item.outputBlob) return
    const link = document.createElement('a')
    const downloadUrl = URL.createObjectURL(item.outputBlob)
    link.href = downloadUrl
    link.download = item.outputName ?? getOutputName(item.file.name, outputFormat)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000)
  }

  const downloadAll = async () => {
    completedItems.forEach((item, index) => {
      window.setTimeout(() => downloadItem(item), index * 120)
    })
  }

  const downloadAllAsZip = async () => {
    if (!completedItems.length || isZipping) return
    setIsZipping(true)
    setIsExportMenuOpen(false)
    try {
      const archive = await createZip(completedItems.filter((item) => item.outputBlob).map((item) => ({
        name: item.outputName ?? getOutputName(item.file.name, item.requestedOutputFormat),
        path: item.directoryPath,
        blob: item.outputBlob!,
      })), () => {})
      const url = URL.createObjectURL(archive)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `quackpress-${new Date().toISOString().slice(0, 10)}.zip`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      setNotice(language === 'en' ? 'ZIP export failed. Please try again.' : 'ZIP 导出失败，请重试')
    } finally {
      setIsZipping(false)
    }
  }

  const downloadAllToFolder = async () => {
    if (!completedItems.length || !window.showDirectoryPicker || isZipping) return
    try {
      const root = await window.showDirectoryPicker()
      setIsZipping(true)
      setIsExportMenuOpen(false)
      await writeFilesToDirectory(root, completedItems.filter((item) => item.outputBlob).map((item) => ({
        name: item.outputName ?? getOutputName(item.file.name, item.requestedOutputFormat),
        path: item.directoryPath,
        blob: item.outputBlob!,
      })))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setNotice(language === 'en' ? 'Folder export failed. Please try again.' : '文件夹导出失败，请重试')
    } finally {
      setIsZipping(false)
    }
  }

  const sendLoginLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) {
      setLoginMessage(language === 'en' ? 'Authentication is not configured yet.' : '登录服务尚未配置，请稍后再试。')
      return
    }
    setIsSendingLogin(true)
    setLoginMessage('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: loginEmail.trim(), options: { emailRedirectTo: window.location.origin + window.location.pathname } })
      setLoginMessage(error ? (language === 'en' ? error.message : '邮件发送失败，请检查邮箱后重试。') : (language === 'en' ? 'Sign-in link sent. Check your inbox.' : '登录链接已发送，请查看邮箱。'))
    } catch {
      setLoginMessage(language === 'en' ? 'Could not send the sign-in link. Please try again.' : '登录链接发送失败，请稍后重试。')
    } finally {
      setIsSendingLogin(false)
    }
  }

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? ''))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserEmail(session?.user.email ?? ''))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => () => {
    itemsRef.current.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl)
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl)
    })
  }, [])

  return (
    <div className="app-shell">
      <header className={`topbar ${isNavVisible || isMobileNavOpen ? '' : 'topbar-hidden'}`}>
        <a className="brand" href="#top" aria-label={copy.home} onClick={() => setIsMobileNavOpen(false)}>
          <img className="brand-mark" src="/duck-mark.svg" alt="" />
          <span className="brand-name">{language === 'zh-CN' ? '压缩鸭' : language === 'zh-TW' ? '壓縮鴨' : 'QuackPress'}<span className="brand-english">{language === 'en' ? 'IMAGE TOOL' : 'QUACKPRESS'}</span></span>
        </a>
        <nav className="desktop-nav" aria-label={copy.navLabel}>
          <a className="nav-active" href="#compress">{copy.tool}</a>
          <a href="#how-it-works">{copy.how}</a>
        </nav>
        <div className="topbar-actions">
          <div className="language-menu">
            <button className="language-button" type="button" onClick={() => setIsLanguageMenuOpen((value) => !value)} aria-expanded={isLanguageMenuOpen} aria-haspopup="listbox"><span>{copy.language}</span><ChevronDown size={14} /></button>
            {isLanguageMenuOpen && <div className="language-options" role="listbox" aria-label="Language">
              {LANGUAGE_OPTIONS.map((option) => <button key={option.value} type="button" className={option.value === language ? 'selected' : ''} onClick={() => { setLanguage(option.value); setIsLanguageMenuOpen(false) }}>{option.label}</button>)}
            </div>}
          </div>
          {userEmail ? <div className="account-menu"><button className="ghost-button login-button" type="button" onClick={() => { void supabase?.auth.signOut() }}>{userEmail} · {copy.signOut}</button></div> : <button className="ghost-button login-button" type="button" onClick={() => { setLoginMessage(''); setIsLoginOpen(true) }}>{copy.login}</button>}
          <button className="mobile-menu" type="button" aria-label={copy.menu} aria-expanded={isMobileNavOpen} onClick={() => { setIsMobileNavOpen((value) => !value); setIsNavVisible(true) }}><Menu size={20} /></button>
        </div>
        {isMobileNavOpen && <nav className="mobile-nav-panel" aria-label={copy.navLabel}>
          <a href="#compress" onClick={() => setIsMobileNavOpen(false)}>{copy.tool}</a>
          <a href="#how-it-works" onClick={() => setIsMobileNavOpen(false)}>{copy.how}</a>
          <button type="button" onClick={() => { setIsMobileNavOpen(false); if (userEmail) void supabase?.auth.signOut(); else { setLoginMessage(''); setIsLoginOpen(true) } }}>{userEmail ? `${userEmail} · ${copy.signOut}` : copy.login}</button>
        </nav>}
      </header>

      <main id="top">
        <section className="hero-section" id="intro">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> QUACKPRESS IMAGE TOOL</div>
            <h1>{copy.heroTitle}<br /><em>{copy.heroTitleAccent}</em></h1>
            <p className="hero-description">{copy.heroDescription}</p>
            <div className="hero-proof"><span className="local-proof"><LockKeyhole size={13} /> {copy.local}</span><span>{copy.localDescription}</span></div>
          </div>
          <div className="hero-aside"><span className="aside-number">01</span><span className="aside-label">DROP<br />YOUR FILES<br />HERE</span><span className="aside-arrow">↘</span></div>
        </section>

        <section className="workspace-section" id="compress">
          <div
            className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input ref={inputRef} type="file" accept={ACCEPTED_FORMATS.join(',')} multiple hidden onChange={handleInput} />
            <input ref={folderInputRef} type="file" accept={ACCEPTED_FORMATS.join(',')} multiple hidden onChange={handleFolderInput} {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>} />
            <button className="dropzone-main" type="button" onClick={() => inputRef.current?.click()}>
              <span className="dropzone-art"><CloudUpload size={30} strokeWidth={1.5} /><span className="dropzone-plus">+</span></span>
              <span className="dropzone-title">{copy.drop}</span>
              <span className="dropzone-meta"><span>{copy.formats}</span><strong>{copy.supportedFormats}</strong><i /> <span>{copy.max}</span></span>
              <span className="dropzone-capacity">{copy.batchLimit}</span>
            </button>
            <button className="folder-picker" type="button" onClick={() => folderInputRef.current?.click()}><FolderInput size={15} />{copy.folder}</button>
          </div>
          <div className="settings-panel" aria-label={copy.settings}>
            <div className="format-selector" aria-label={copy.output}>
              <span className="format-selector-label">{copy.output}</span>
              <div className="format-options">
                {OUTPUT_FORMATS.map(([value, fallback]) => {
                  const label = value === 'original' ? copy.keep : fallback
                  return (
                  <label className={`format-option ${outputFormat === value ? 'format-option-selected' : ''}`} key={value}>
                    <input type="radio" name="output-format" value={value} checked={outputFormat === value} onChange={() => setOutputFormat(value)} />
                    <span className="radio-mark" />
                    <span>{label}</span>
                  </label>
                  )
                })}
              </div>
            </div>
            <div className="compression-level" aria-label={copy.level}>
              <div className="compression-level-heading"><span>{copy.level}</span><strong>{compressionLevel}</strong></div>
              <div className="compression-range-wrap">
                <input className="compression-range" type="range" min="1" max="5" step="1" value={compressionLevel} onChange={(event) => setCompressionLevel(Number(event.target.value))} aria-valuemin={1} aria-valuemax={5} aria-valuenow={compressionLevel} />
                <strong className="compression-range-value" style={{ left: `${((compressionLevel - 1) / 4) * 100}%`, transform: `translate(calc(-50% + ${8 - ((compressionLevel - 1) / 4) * 16}px), -50%)` }}>{compressionLevel}</strong>
              </div>
            </div>
          </div>
          {hasWork && (
            <div className="queue-panel">
              <div className="queue-header">
                <div><span className="section-kicker">{copy.workspace}</span><h2>{allDone && hasFailures ? (language === 'en' ? 'Finished with errors.' : '处理完成，部分图片失败。') : allDone ? copy.done : copy.working}</h2></div>
              <div className="queue-actions">
                {completedItems.length > 0 && <div className="export-menu" ref={zipMenuRef}>
                  <button className="primary-button compact" type="button" onClick={downloadAll} disabled={isZipping}><Download size={16} />{copy.exportAll}<span>{[...new Set(completedItems.map((item) => item.outputFormat).filter(Boolean))].join(' / ')}</span></button>
                  <button className="export-chevron" type="button" aria-label={copy.exportZip} aria-expanded={isExportMenuOpen} onClick={() => setIsExportMenuOpen((value) => !value)}><ChevronDown size={15} /></button>
                  {isExportMenuOpen && <div className="export-options" role="menu"><button type="button" role="menuitem" onClick={() => { downloadAll(); setIsExportMenuOpen(false) }}>{copy.downloadFiles}</button><button type="button" role="menuitem" onClick={() => void downloadAllAsZip()} disabled={isZipping}>{isZipping ? copy.zipWorking : copy.exportZip}</button>{window.showDirectoryPicker && <button type="button" role="menuitem" onClick={() => void downloadAllToFolder()} disabled={isZipping}>{copy.exportFolder}</button>}</div>}
                </div>}
                </div>
              </div>
              <div className="queue-summary"><span><FileStack size={15} /> {items.length} {copy.files}</span><span><Zap size={15} /> {allDone ? `${language === 'en' ? 'Saved' : language === 'ja' ? '削減' : language === 'ko' ? '절약' : language === 'zh-TW' ? '節省' : '共节省'} ${formatSavings(totalOriginal, totalOutput)}` : copy.fast}</span><span className="format-summary">{copy.outputPrefix} {formatLabel(outputFormat, language)}</span><button className="pause-button" onClick={() => setIsPaused((value) => { const paused = !value; isPausedRef.current = paused; schedulerRef.current?.setPaused(paused); return paused })}>{isPaused ? <Play size={14} /> : <Pause size={14} />} {isPaused ? copy.resume : copy.pause}</button></div>
              <div className="items-list">
                {items.map((item) => <ImageRow key={item.id} item={item} language={language} onRemove={removeItem} onRetry={retryItem} onDownload={downloadItem} onPreview={setActiveItem} />)}
              </div>
              {!allDone && <div className="queue-footer"><LoaderCircle className="spin" size={15} /> {copy.waiting}</div>}
            </div>
          )}
          {notice && <div className="notice" role="alert"><Info size={16} /> {notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={15} /></button></div>}
        </section>

        <section className="features-section" id="how-it-works">
          <div className="section-heading"><span className="section-kicker">WHY QUACKPRESS</span><h2>{copy.why}<br /><em>{copy.whyAccent}</em></h2></div>
          <div className="feature-grid">
            <FeatureCard number="01" icon={<Zap size={19} />} title={copy.fastTitle} copy={copy.fastCopy} tryLabel={copy.try} />
            <FeatureCard number="02" icon={<ShieldCheck size={19} />} title={copy.privateTitle} copy={copy.privateCopy} tryLabel={copy.try} />
            <FeatureCard number="03" icon={<Sparkles size={19} />} title={copy.clearTitle} copy={copy.clearCopy} tryLabel={copy.try} />
          </div>
        </section>

      </main>

      <footer className="footer"><span>© 2026 QuackPress</span><span>{language === 'en' ? 'Made for the web, with care.' : language === 'ja' ? 'ウェブのために、丁寧に。' : language === 'ko' ? '웹을 위해 정성껏 만들었습니다.' : language === 'zh-TW' ? '為網頁而作，用心壓縮。' : '为网页而作，用心压缩。'}</span><div><a href="#how-it-works">{copy.help}</a></div></footer>
      {activeItem && <PreviewModal item={activeItem} language={language} onClose={() => setActiveItem(null)} onDownload={downloadItem} />}
      {isLoginOpen && <div className="modal-backdrop" role="presentation" onClick={() => setIsLoginOpen(false)}><section className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title" onClick={(event) => event.stopPropagation()}><div className="login-modal-header"><div><span className="section-kicker">QUACKPRESS</span><h2 id="login-title">{copy.login}</h2></div><button className="icon-button" type="button" onClick={() => setIsLoginOpen(false)} aria-label={language === 'en' ? 'Close' : '关闭'}><X size={18} /></button></div><form onSubmit={(event) => void sendLoginLink(event)}><label htmlFor="login-email">{copy.loginEmail}</label><input id="login-email" type="email" required autoComplete="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="name@example.com" /><button className="primary-button" type="submit" disabled={isSendingLogin}>{isSendingLogin ? <LoaderCircle className="spin" size={16} /> : null}{copy.sendLoginLink}</button></form>{loginMessage && <p className="login-message" role="status">{loginMessage}</p>}{!isAuthConfigured && <p className="login-configuration">{copy.authMissing}</p>}</section></div>}
    </div>
  )
}

function ImageRow({ item, language, onRemove, onRetry, onDownload, onPreview }: { item: ImageItem; language: Language; onRemove: (id: string) => void; onRetry: (item: ImageItem) => void; onDownload: (item: ImageItem) => void; onPreview: (item: ImageItem) => void }) {
  const statusCopy = language === 'en' ? { queued: 'Queued', compressing: 'Compressing', done: 'Done', error: 'Failed' } : language === 'ja' ? { queued: '待機中', compressing: '圧縮中', done: '完了', error: '失敗' } : language === 'ko' ? { queued: '대기 중', compressing: '압축 중', done: '완료', error: '실패' } : language === 'zh-TW' ? { queued: '排隊中', compressing: '壓縮中', done: '已完成', error: '處理失敗' } : { queued: '排队中', compressing: '压缩中', done: '已完成', error: '处理失败' }
  const action = language === 'en' ? { compare: 'Compare', download: 'Download', retry: 'Retry', remove: 'Remove', saved: 'saved' } : language === 'ja' ? { compare: '比較', download: 'ダウンロード', retry: '再試行', remove: '削除', saved: '削減' } : language === 'ko' ? { compare: '비교', download: '다운로드', retry: '다시 시도', remove: '삭제', saved: '절약' } : language === 'zh-TW' ? { compare: '比較', download: '下載', retry: '重試', remove: '刪除', saved: '節省空間' } : { compare: '对比', download: '下载', retry: '重试', remove: '删除', saved: '节省空间' }
  return <div className={`image-row status-${item.status}`}>
    <button className="thumb-button" onClick={() => item.status === 'done' && onPreview(item)} aria-label={`${item.file.name} 预览`}><img src={item.previewUrl} alt="" /><span className="thumb-overlay"><MoreHorizontal size={17} /></span></button>
    <div className="image-info"><div className="image-name" title={item.file.name}>{item.file.name}</div><div className="image-meta">{formatBytes(item.originalSize)} {item.width && `· ${item.width} × ${item.height}`} {item.status === 'done' && <><span className="meta-arrow">→</span> {formatBytes(item.outputSize ?? 0)} · {item.outputFormat}</>}</div></div>
    <div className="row-status"><div className="status-line"><span className={`status-dot status-dot-${item.status}`} />{statusCopy[item.status]}</div>{item.status === 'compressing' && <div className="mini-progress"><span style={{ width: `${item.progress}%` }} /></div>}{item.status === 'error' && <span className="error-copy">{item.error}</span>}</div>
    <div className="saving-cell">{item.status === 'done' ? <><strong>↓ {formatSavings(item.originalSize, item.outputSize)}</strong><span>{action.saved}</span></> : <span>—</span>}</div>
    <div className="row-actions">{item.status === 'done' && <><button className="compare-button" onClick={() => onPreview(item)} aria-label={`${action.compare} ${item.file.name}`}><ArrowLeftRight size={15} /><span>{action.compare}</span></button><button className="download-button" onClick={() => onDownload(item)} aria-label={`${action.download} ${item.outputFormat ?? 'image'}`}><ArrowDownToLine size={16} /><span className="download-label">{action.download} {item.outputFormat ?? (language === 'en' ? 'image' : '图片')}</span></button></>}{item.status === 'error' && <button className="retry-button" onClick={() => onRetry(item)}><RefreshCw size={15} /> {action.retry}</button>}<button className="remove-button" onClick={() => onRemove(item.id)} aria-label={`${action.remove} ${item.file.name}`} title={action.remove}><Trash2 size={16} /></button></div>
  </div>
}

function FeatureCard({ number, icon, title, copy, tryLabel }: { number: string; icon: ReactNode; title: string; copy: string; tryLabel: string }) {
  return <article className="feature-card"><div className="feature-top"><span>{number}</span><div className="feature-icon">{icon}</div></div><h3>{title}</h3><p>{copy}</p><a href="#compress">{tryLabel} <span>↗</span></a></article>
}

function PreviewModal({ item, language, onClose, onDownload }: { item: ImageItem; language: Language; onClose: () => void; onDownload: (item: ImageItem) => void }) {
  const [comparisonMode, setComparisonMode] = useState<'side-by-side' | 'split'>('side-by-side')
  const [splitPosition, setSplitPosition] = useState(50)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draggingSplit, setDraggingSplit] = useState(false)
  const [draggingPan, setDraggingPan] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const panStartRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null)
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null)
  const modalCopy = language === 'en' ? { compare: 'COMPARE', close: 'Close comparison', modes: 'Comparison modes', side: 'Side by side', split: 'Split view', original: 'Original', compressed: 'Compressed', saved: 'saved', size: 'Original dimensions', download: 'Download' } : { compare: 'COMPARE', close: '关闭对比', modes: '对比模式', side: '并排对比', split: '分割对比', original: '原图', compressed: '压缩后', saved: '节省', size: '保持原始尺寸', download: '下载' }

  const setSplitFromClientX = useCallback((clientX: number) => {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    setSplitPosition(Math.min(95, Math.max(5, ((clientX - bounds.left) / bounds.width) * 100)))
  }, [])

  useEffect(() => {
    if (!draggingSplit) return
    const handlePointerMove = (event: PointerEvent) => setSplitFromClientX(event.clientX)
    const handlePointerUp = () => setDraggingSplit(false)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [draggingSplit, setSplitFromClientX])

  const updateZoom = (delta: number) => {
    setZoom((value) => {
      const next = Math.min(3, Math.max(1, Number((value + delta).toFixed(2))))
      return next
    })
  }

  const handleStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.split-handle')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointersRef.current.size === 2) {
      const [first, second] = [...activePointersRef.current.values()]
      pinchStartRef.current = { distance: Math.hypot(second.x - first.x, second.y - first.y), zoom }
      panStartRef.current = null
      setDraggingPan(false)
      return
    }
    if (zoom <= 1) return
    panStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    setDraggingPan(true)
  }

  const handleStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(event.pointerId)) activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinchStartRef.current && activePointersRef.current.size >= 2) {
      const [first, second] = [...activePointersRef.current.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      setZoom(Math.min(3, Math.max(1, Number((pinchStartRef.current.zoom * distance / pinchStartRef.current.distance).toFixed(2)))))
      return
    }
    const start = panStartRef.current
    if (!draggingPan || !start || start.pointerId !== event.pointerId) return
    setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y })
  }

  const stopStagePan = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId)
    if (activePointersRef.current.size < 2) pinchStartRef.current = null
    if (panStartRef.current?.pointerId === event.pointerId) panStartRef.current = null
    setDraggingPan(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 })
  }, [zoom])

  const imageTransform = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }
  const stageHandlers = {
    onPointerDown: handleStagePointerDown,
    onPointerMove: handleStagePointerMove,
    onPointerUp: stopStagePan,
    onPointerCancel: stopStagePan,
    onWheel: (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      updateZoom(event.deltaY < 0 ? 0.1 : -0.1)
    },
  }
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="preview-modal comparison-modal" role="dialog" aria-modal="true" aria-label={language === 'en' ? 'Image comparison preview' : '图片对比预览'} onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="section-kicker">{modalCopy.compare}</span><h2>{item.file.name}</h2></div><button className="icon-button" onClick={onClose} aria-label={modalCopy.close}><X size={18} /></button></div><div className="comparison-switch" role="group" aria-label={modalCopy.modes}><button className={comparisonMode === 'side-by-side' ? 'selected' : ''} onClick={() => setComparisonMode('side-by-side')}>{modalCopy.side}</button><button className={comparisonMode === 'split' ? 'selected' : ''} onClick={() => setComparisonMode('split')}>{modalCopy.split}</button></div>{comparisonMode === 'side-by-side' ? <div ref={stageRef} className={`comparison-stage side-by-side-stage ${draggingPan ? 'comparison-stage-dragging' : ''}`} {...stageHandlers}><div className="comparison-pane"><img src={item.previewUrl} alt={modalCopy.original} style={imageTransform} /><span>{modalCopy.original} · {formatBytes(item.originalSize)}</span></div><div className="comparison-pane"><img src={item.outputUrl} alt={modalCopy.compressed} style={imageTransform} /><span>{modalCopy.compressed} · {formatBytes(item.outputSize ?? 0)}</span></div><span className="zoom-indicator">{Math.round(zoom * 100)}%</span></div> : <div ref={stageRef} className={`comparison-stage split-stage ${draggingPan ? 'comparison-stage-dragging' : ''}`} {...stageHandlers}><img src={item.outputUrl} alt={modalCopy.compressed} style={imageTransform} /><div className="split-output" style={{ width: '100%', clipPath: `inset(0 ${100 - splitPosition}% 0 0)` }}><img src={item.previewUrl} alt={modalCopy.original} style={imageTransform} /></div><div className={`split-divider ${draggingSplit ? 'split-divider-dragging' : ''}`} style={{ left: `${splitPosition}%` }}><button className="split-handle" type="button" aria-label={language === 'en' ? 'Drag comparison position. Use arrow keys to fine tune.' : '拖动对比位置，使用左右方向键微调'} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSplitFromClientX(event.clientX); setDraggingSplit(true) }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setSplitPosition((value) => Math.max(5, value - 2)); if (event.key === 'ArrowRight') setSplitPosition((value) => Math.min(95, value + 2)) }}><span>↔</span></button></div><span className="comparison-tag tag-original">{modalCopy.original}</span><span className="comparison-tag tag-output">{modalCopy.compressed}</span><span className="zoom-indicator">{Math.round(zoom * 100)}%</span></div>}<div className="modal-footer"><div><strong>{modalCopy.saved} {formatSavings(item.originalSize, item.outputSize)}</strong><span>{modalCopy.size} · {item.outputFormat}</span></div><button className="primary-button" onClick={() => onDownload(item)}><Download size={16} /> {modalCopy.download} {item.outputFormat}</button></div></div></div>
}

export default App
