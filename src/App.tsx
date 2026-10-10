import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { compressLocally } from './lib/compression/localEncoder'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleHelp,
  CloudUpload,
  Download,
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
type OutputFormat = 'original' | 'image/jpeg' | 'image/png' | 'image/webp'
type Language = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

type AppCopy = {
  home: string; navLabel: string; tool: string; how: string; privacy: string; language: string; login: string; menu: string
  heroTitle: string; heroTitleAccent: string; heroDescription: string; local: string; localDescription: string
  drop: string; formats: string; max: string; settings: string; output: string; keep: string; level: string
  workspace: string; done: string; working: string; files: string; fast: string; outputPrefix: string; pause: string; resume: string; waiting: string
  why: string; whyAccent: string; fastTitle: string; fastCopy: string; privateTitle: string; privateCopy: string; clearTitle: string; clearCopy: string; try: string
  privacyTitle: string; privacyCopy: string; privacyLink: string; help: string
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
  outputName?: string
  outputFormat?: string
  originalSize: number
  outputSize?: number
  width?: number
  height?: number
  progress: number
  status: ItemStatus
  error?: string
}

const MAX_FILES = 20
const MAX_SIZE = 20 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

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

function getOutputName(fileName: string, outputFormat: OutputFormat) {
  const index = fileName.lastIndexOf('.')
  const baseName = index > 0 ? fileName.slice(0, index) : fileName
  if (outputFormat === 'original') return `${baseName}-min${index > 0 ? fileName.slice(index) : '.jpg'}`
  const extension = outputFormat === 'image/jpeg' ? 'jpg' : outputFormat === 'image/png' ? 'png' : 'webp'
  return `${baseName}-min.${extension}`
}

function getFormatDetails(file: File, outputFormat: OutputFormat) {
  if (outputFormat === 'original') {
    const mime = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    return { mime, quality: mime === 'image/png' ? undefined : mime === 'image/jpeg' ? 0.84 : 0.78, label: mime === 'image/png' ? 'PNG' : mime === 'image/webp' ? 'WebP' : 'JPG' }
  }
  return { mime: outputFormat, quality: outputFormat === 'image/png' ? undefined : outputFormat === 'image/jpeg' ? 0.84 : 0.78, label: outputFormat === 'image/jpeg' ? 'JPG' : outputFormat === 'image/png' ? 'PNG' : 'WebP' }
}

function formatLabel(outputFormat: OutputFormat, language: Language) {
  const format = outputFormat === 'image/jpeg' ? 'JPG' : outputFormat === 'image/png' ? 'PNG' : 'WebP'
  if (language === 'en') return outputFormat === 'original' ? 'Keep default' : `Convert to ${format}`
  if (language === 'ja') return outputFormat === 'original' ? 'デフォルト' : `${format} に変換`
  if (language === 'ko') return outputFormat === 'original' ? '기본 유지' : `${format}로 변환`
  if (language === 'zh-TW') return outputFormat === 'original' ? '保持預設' : `轉換為 ${format}`
  return outputFormat === 'original' ? '保持默认' : `转换为 ${format}`
}

function getBatchDownloadLabel(items: ImageItem[], language: Language) {
  const formats = [...new Set(items.map((item) => item.outputFormat).filter(Boolean))]
  if (language === 'en') return formats.length === 1 ? `Download all ${formats[0]}` : 'Download all'
  if (language === 'ja') return formats.length === 1 ? `${formats[0]}を一括ダウンロード` : '一括ダウンロード'
  if (language === 'ko') return formats.length === 1 ? `${formats[0]} 모두 다운로드` : '모두 다운로드'
  if (language === 'zh-TW') return formats.length === 1 ? `全部下載 ${formats[0]}` : '全部下載'
  return formats.length === 1 ? `全部下载 ${formats[0]}` : '全部下载'
}

function getCopy(language: Language): AppCopy {
  if (language === 'en') return {
    home: 'QuackPress home', navLabel: 'Main navigation', tool: 'Compressor', how: 'How it works', privacy: 'Privacy', language: 'English', login: 'Sign in', menu: 'Open menu',
    heroTitle: 'Lighter images,', heroTitleAccent: 'faster web.', heroDescription: 'Choose a format, upload images, preview the result, and download. Everything runs locally in your browser.', local: 'Local processing', localDescription: 'No signup. Your images stay on your device.',
    drop: 'Drag or click to choose files', formats: 'Formats', max: '20 MB per file', settings: 'Image compression settings', output: 'Output format', keep: 'Keep default', level: 'Compression level', workspace: 'YOUR WORKSPACE', done: 'Compression complete.', working: 'Making images lighter.', files: 'files', fast: 'Local processing, speed first', outputPrefix: 'Output:', pause: 'Pause', resume: 'Resume', waiting: 'Images are being processed in your browser. Please wait before leaving.',
    why: 'Less waiting,', whyAccent: 'more creating.', fastTitle: 'Fast enough to forget the wait', fastCopy: 'Everything runs in your browser. Your images take no detour through a server.', privateTitle: 'Your images stay private', privateCopy: 'QuackPress processes images locally in your browser. Nothing is uploaded.', clearTitle: 'Small, without visible loss', clearCopy: 'Smart encoding keeps important details while making files meaningfully smaller.', try: 'Try it', privacyTitle: 'Privacy-first compression', privacyCopy: 'No signup and no uploads. Compression and previews stay on your device.', privacyLink: 'Privacy', help: 'Help',
  }
  if (language === 'ja') return {
    home: 'QuackPress ホーム', navLabel: 'メインナビゲーション', tool: '圧縮ツール', how: '使い方', privacy: 'プライバシー', language: '日本語', login: 'ログイン', menu: 'メニューを開く',
    heroTitle: '画像を軽く、', heroTitleAccent: 'ウェブを速く。', heroDescription: '形式を選び、画像をアップロードして、結果を確認してダウンロード。すべてブラウザ内で処理します。', local: 'ローカル処理', localDescription: '登録不要。画像はデバイスから離れません。',
    drop: 'ドラッグまたはクリックしてファイルを選択', formats: '対応形式', max: '1ファイル最大 20 MB', settings: '画像圧縮設定', output: '出力形式', keep: 'デフォルト', level: '圧縮レベル', workspace: 'YOUR WORKSPACE', done: '圧縮完了。', working: '画像を軽くしています。', files: 'ファイル', fast: 'ローカル処理、速度優先', outputPrefix: '出力:', pause: '一時停止', resume: '再開', waiting: 'ブラウザで画像を処理中です。完了までお待ちください。',
    why: '待ち時間を減らし、', whyAccent: '創造を増やす。', fastTitle: '待つことを忘れる速さ', fastCopy: 'すべてブラウザで処理。画像をサーバーへ送信しません。', privateTitle: '画像はデバイス内に', privateCopy: 'QuackPress はブラウザ内で画像を処理します。アップロードはありません。', clearTitle: '見た目を保って軽量化', clearCopy: '重要なディテールを残しながら、ファイルサイズを小さくします。', try: '試す', privacyTitle: 'プライバシー優先の圧縮', privacyCopy: '登録もアップロードも不要。圧縮とプレビューはデバイス内で完結します。', privacyLink: 'プライバシー', help: 'ヘルプ',
  }
  if (language === 'ko') return {
    home: 'QuackPress 홈', navLabel: '주 메뉴', tool: '압축 도구', how: '사용 방법', privacy: '개인정보 보호', language: '한국어', login: '로그인', menu: '메뉴 열기',
    heroTitle: '이미지는 가볍게,', heroTitleAccent: '웹은 빠르게.', heroDescription: '형식을 선택하고 이미지를 업로드한 뒤 결과를 확인하고 다운로드하세요. 모든 처리는 브라우저에서 진행됩니다.', local: '로컬 처리', localDescription: '가입이 필요 없습니다. 이미지는 기기에 남습니다.',
    drop: '드래그하거나 클릭하여 파일 선택', formats: '지원 형식', max: '파일당 최대 20 MB', settings: '이미지 압축 설정', output: '출력 형식', keep: '기본 유지', level: '압축 정도', workspace: 'YOUR WORKSPACE', done: '압축 완료.', working: '이미지를 가볍게 만드는 중입니다.', files: '개 파일', fast: '로컬 처리, 빠른 속도', outputPrefix: '출력:', pause: '일시정지', resume: '계속', waiting: '브라우저에서 이미지를 처리 중입니다. 완료될 때까지 기다려 주세요.',
    why: '기다림은 줄이고,', whyAccent: '창작은 늘리고.', fastTitle: '기다림을 잊을 만큼 빠르게', fastCopy: '모든 처리는 브라우저에서 진행됩니다. 이미지가 서버를 거치지 않습니다.', privateTitle: '이미지는 기기에 안전하게', privateCopy: 'QuackPress는 브라우저에서 이미지를 처리하며 업로드하지 않습니다.', clearTitle: '화질은 유지하고 용량은 줄이고', clearCopy: '중요한 디테일을 유지하면서 파일을 작게 만듭니다.', try: '사용해 보기', privacyTitle: '개인정보 우선 압축', privacyCopy: '가입과 업로드가 필요 없습니다. 압축과 미리보기는 기기에서 처리됩니다.', privacyLink: '개인정보', help: '도움말',
  }
  if (language === 'zh-TW') return {
    home: '壓縮鴨首頁', navLabel: '主導覽', tool: '壓縮工具', how: '運作方式', privacy: '隱私保護', language: '繁體中文', login: '登入', menu: '開啟選單',
    heroTitle: '圖片變輕，', heroTitleAccent: '網頁更快。', heroDescription: '選擇格式、上傳圖片、預覽結果後直接下載。壓縮過程在瀏覽器本機完成。', local: '本機處理', localDescription: '無需註冊，圖片不會離開你的裝置。',
    drop: '拖曳或點擊選擇檔案', formats: '支援格式', max: '單一檔案最大 20 MB', settings: '圖片壓縮設定', output: '輸出格式', keep: '保持預設', level: '壓縮程度', workspace: 'YOUR WORKSPACE', done: '壓縮完成。', working: '正在讓圖片變輕。', files: '個檔案', fast: '本機處理，速度優先', outputPrefix: '輸出：', pause: '暫停', resume: '繼續', waiting: '圖片正在瀏覽器中處理，離開頁面前請等待完成',
    why: '少一點等待，', whyAccent: '多一點創造。', fastTitle: '快得讓人忘記等待', fastCopy: '所有處理都在瀏覽器中完成，圖片不會繞路經過伺服器。', privateTitle: '圖片不離開你的裝置', privateCopy: '壓縮鴨在瀏覽器本機處理圖片，不會上傳。', clearTitle: '保持清晰，檔案更小', clearCopy: '保留重要細節，同時有效縮小檔案。', try: '試用看看', privacyTitle: '隱私優先的壓縮', privacyCopy: '無需註冊或上傳，壓縮與預覽都留在你的裝置上。', privacyLink: '隱私說明', help: '說明中心',
  }
  return {
    home: '压缩鸭首页', navLabel: '主导航', tool: '压缩工具', how: '怎么工作', privacy: '隐私保护', language: '简体中文', login: '登录', menu: '打开菜单',
    heroTitle: '图片变轻，', heroTitleAccent: '网页更快。', heroDescription: '选择格式，上传图片，预览结果后直接下载。压缩过程在浏览器本地完成。', local: '本地处理', localDescription: '无需注册，图片不离开你的设备。',
    drop: '拖拽或点击选择文件', formats: '支持格式', max: '单张文件最大 20 MB', settings: '图片压缩设置', output: '输出格式', keep: '保持默认', level: '压缩程度', workspace: 'YOUR WORKSPACE', done: '压缩完成。', working: '正在让图片变轻。', files: '个文件', fast: '本地处理，速度优先', outputPrefix: '输出：', pause: '暂停', resume: '继续', waiting: '图片正在浏览器中处理，离开页面前请等待完成',
    why: '少一点等待，', whyAccent: '多一点创造。', fastTitle: '快得让人忘记等待', fastCopy: '所有处理都在你的浏览器里完成。图片不会绕远路，上传后马上就能看到结果。', privateTitle: '图片不离开你的设备', privateCopy: '压缩鸭当前在浏览器本地完成处理，不需要把图片上传到我们的服务器。', clearTitle: '清晰，肉眼看不出差别', clearCopy: '智能选择压缩参数，在明显变小的同时，尽量保留每个重要的细节。', try: '试试看', privacyTitle: '隐私优先的压缩', privacyCopy: '无需注册，无需上传到服务器。压缩和预览都留在你的设备上。', privacyLink: '隐私说明', help: '帮助中心',
  }
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<ImageItem[]>([])
  const isPausedRef = useRef(false)
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
  const totalOriginal = items.reduce((sum, item) => sum + item.originalSize, 0)
  const totalOutput = completedItems.reduce((sum, item) => sum + (item.outputSize ?? 0), 0)
  const copy = getCopy(language)

  const updateItem = useCallback((id: string, update: Partial<ImageItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)))
  }, [])

  const compressItem = useCallback(
    async (item: ImageItem) => {
      updateItem(item.id, { status: 'compressing', progress: 8 })
      try {
        const result = await compressLocally(item.file, outputFormat, compressionLevel, (progress) => updateItem(item.id, { progress }), () => isPausedRef.current)
        const outputUrl = URL.createObjectURL(result.blob)
        updateItem(item.id, {
          outputUrl,
          outputName: getOutputName(item.file.name, outputFormat),
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
    [compressionLevel, language, outputFormat, updateItem],
  )

  const startQueued = useCallback(
    (newItems: ImageItem[]) => {
      window.setTimeout(() => newItems.forEach((item) => void compressItem(item)), 160)
    },
    [compressItem],
  )

  const addFiles = useCallback(
    (files: File[]) => {
      const remaining = MAX_FILES - items.length
      const accepted: ImageItem[] = []
      const errors: string[] = []
      files.slice(0, remaining).forEach((file) => {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          errors.push(language === 'en' ? `${file.name}: unsupported format` : `${file.name} 格式不支持`)
          return
        }
        if (file.size > MAX_SIZE) {
          errors.push(language === 'en' ? `${file.name}: over 20 MB` : `${file.name} 超过 20 MB`)
          return
        }
        const item: ImageItem = {
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          file,
          previewUrl: URL.createObjectURL(file),
          originalSize: file.size,
          progress: 0,
          status: 'queued',
        }
        accepted.push(item)
      })
      if (files.length > remaining) errors.push(language === 'en' ? `Up to ${MAX_FILES} images per batch` : `单批最多处理 ${MAX_FILES} 张图片`)
      if (errors.length) setNotice(errors[0])
      if (!accepted.length) return
      setItems((current) => [...current, ...accepted])
      startQueued(accepted)
    },
    [items.length, language, startQueued],
  )

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  const removeItem = (id: string) => {
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
    updateItem(item.id, { status: 'queued', progress: 0, error: undefined })
    compressItem({ ...item, status: 'queued', progress: 0 })
  }

  const downloadItem = (item: ImageItem) => {
    if (!item.outputUrl) return
    const link = document.createElement('a')
    link.href = item.outputUrl
    link.download = item.outputName ?? getOutputName(item.file.name, outputFormat)
    link.click()
  }

  const downloadAll = async () => {
    completedItems.forEach((item, index) => {
      window.setTimeout(() => downloadItem(item), index * 120)
    })
  }

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
          <a href="#privacy">{copy.privacy}</a>
        </nav>
        <div className="topbar-actions">
          <div className="language-menu">
            <button className="language-button" type="button" onClick={() => setIsLanguageMenuOpen((value) => !value)} aria-expanded={isLanguageMenuOpen} aria-haspopup="listbox"><span>{copy.language}</span><ChevronDown size={14} /></button>
            {isLanguageMenuOpen && <div className="language-options" role="listbox" aria-label="Language">
              {LANGUAGE_OPTIONS.map((option) => <button key={option.value} type="button" className={option.value === language ? 'selected' : ''} onClick={() => { setLanguage(option.value); setIsLanguageMenuOpen(false) }}>{option.label}</button>)}
            </div>}
          </div>
          <button className="ghost-button login-button" type="button">{copy.login}</button>
          <button className="mobile-menu" type="button" aria-label={copy.menu} aria-expanded={isMobileNavOpen} onClick={() => { setIsMobileNavOpen((value) => !value); setIsNavVisible(true) }}><Menu size={20} /></button>
        </div>
        {isMobileNavOpen && <nav className="mobile-nav-panel" aria-label={copy.navLabel}>
          <a href="#compress" onClick={() => setIsMobileNavOpen(false)}>{copy.tool}</a>
          <a href="#how-it-works" onClick={() => setIsMobileNavOpen(false)}>{copy.how}</a>
          <a href="#privacy" onClick={() => setIsMobileNavOpen(false)}>{copy.privacy}</a>
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
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click() }}
          >
            <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} multiple hidden onChange={handleInput} />
            <div className="dropzone-art"><CloudUpload size={30} strokeWidth={1.5} /><span className="dropzone-plus">+</span></div>
            <div className="dropzone-title">{copy.drop}</div>
            <div className="dropzone-meta"><span>{copy.formats}</span><strong>JPG, PNG, WebP</strong><i /> <span>{copy.max}</span></div>
          </div>
          <div className="settings-panel" aria-label={copy.settings}>
            <div className="format-selector" aria-label={copy.output}>
              <span className="format-selector-label">{copy.output}</span>
              <div className="format-options">
                {([['original', copy.keep], ['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP']] as [OutputFormat, string][]).map(([value, label]) => (
                  <label className={`format-option ${outputFormat === value ? 'format-option-selected' : ''}`} key={value}>
                    <input type="radio" name="output-format" value={value} checked={outputFormat === value} onChange={() => setOutputFormat(value)} />
                    <span className="radio-mark" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="compression-level" aria-label={copy.level}>
              <div className="compression-level-heading"><span>{copy.level}</span><strong>{compressionLevel}</strong></div>
              <input className="compression-range" type="range" min="1" max="5" step="1" value={compressionLevel} onChange={(event) => setCompressionLevel(Number(event.target.value))} aria-valuemin={1} aria-valuemax={5} aria-valuenow={compressionLevel} />
            </div>
          </div>
          {hasWork && (
            <div className="queue-panel">
              <div className="queue-header">
                <div><span className="section-kicker">{copy.workspace}</span><h2>{allDone ? copy.done : copy.working}</h2></div>
                <div className="queue-actions">
                  {allDone && <button className="primary-button compact" onClick={downloadAll}><Download size={16} /> {getBatchDownloadLabel(completedItems, language)}</button>}
                </div>
              </div>
              <div className="queue-summary"><span><FileStack size={15} /> {items.length} {copy.files}</span><span><Zap size={15} /> {allDone ? `${language === 'en' ? 'Saved' : language === 'ja' ? '削減' : language === 'ko' ? '절약' : language === 'zh-TW' ? '節省' : '共节省'} ${formatSavings(totalOriginal, totalOutput)}` : copy.fast}</span><span className="format-summary">{copy.outputPrefix} {formatLabel(outputFormat, language)}</span><button className="pause-button" onClick={() => setIsPaused((value) => { isPausedRef.current = !value; return !value })}>{isPaused ? <Play size={14} /> : <Pause size={14} />} {isPaused ? copy.resume : copy.pause}</button></div>
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

        <section className="privacy-strip" id="privacy"><div className="privacy-icon"><LockKeyhole size={22} /></div><div><strong>{copy.privacyTitle}</strong><span>{copy.privacyCopy}</span></div><CircleHelp size={18} className="privacy-help" /></section>
      </main>

      <footer className="footer"><span>© 2026 QuackPress</span><span>{language === 'en' ? 'Made for the web, with care.' : language === 'ja' ? 'ウェブのために、丁寧に。' : language === 'ko' ? '웹을 위해 정성껏 만들었습니다.' : language === 'zh-TW' ? '為網頁而作，用心壓縮。' : '为网页而作，用心压缩。'}</span><div><a href="#privacy">{copy.privacyLink}</a><a href="#how-it-works">{copy.help}</a></div></footer>
      {activeItem && <PreviewModal item={activeItem} language={language} onClose={() => setActiveItem(null)} onDownload={downloadItem} />}
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
