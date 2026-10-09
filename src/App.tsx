import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { compressLocally } from './lib/compression/localEncoder'
import {
  ArrowDownToLine,
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

function formatLabel(outputFormat: OutputFormat) {
  return outputFormat === 'original' ? '保持原格式' : outputFormat === 'image/jpeg' ? '转换为 JPG' : outputFormat === 'image/png' ? '转换为 PNG' : '转换为 WebP'
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<ImageItem[]>([])
  const isPausedRef = useRef(false)
  const [items, setItems] = useState<ImageItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('original')
  const [activeItem, setActiveItem] = useState<ImageItem | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const completedItems = useMemo(() => items.filter((item) => item.status === 'done'), [items])
  const hasWork = items.length > 0
  const allDone = hasWork && items.every((item) => item.status === 'done' || item.status === 'error')
  const totalOriginal = items.reduce((sum, item) => sum + item.originalSize, 0)
  const totalOutput = completedItems.reduce((sum, item) => sum + (item.outputSize ?? 0), 0)

  const updateItem = useCallback((id: string, update: Partial<ImageItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)))
  }, [])

  const compressItem = useCallback(
    async (item: ImageItem) => {
      updateItem(item.id, { status: 'compressing', progress: 8 })
      try {
        const result = await compressLocally(item.file, outputFormat, (progress) => updateItem(item.id, { progress }), () => isPausedRef.current)
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
        updateItem(item.id, { status: 'error', error: '图片处理失败，请重试' })
      }
    },
    [outputFormat, updateItem],
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
          errors.push(`${file.name} 格式不支持`)
          return
        }
        if (file.size > MAX_SIZE) {
          errors.push(`${file.name} 超过 20 MB`)
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
      if (files.length > remaining) errors.push(`单批最多处理 ${MAX_FILES} 张图片`)
      if (errors.length) setNotice(errors[0])
      if (!accepted.length) return
      setItems((current) => [...current, ...accepted])
      startQueued(accepted)
    },
    [items.length, startQueued],
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
      <header className="topbar">
        <a className="brand" href="#top" aria-label="压缩鸭首页">
          <img className="brand-mark" src="/duck-mark.svg" alt="" />
          <span className="brand-name">压缩鸭<span className="brand-english">QUACKPRESS</span></span>
        </a>
        <nav className="desktop-nav" aria-label="主导航">
          <a className="nav-active" href="#compress">压缩工具</a>
          <a href="#how-it-works">怎么工作</a>
          <a href="#privacy">隐私保护</a>
        </nav>
        <div className="topbar-actions">
          <button className="language-button" type="button"><span>中文</span><ChevronDown size={14} /></button>
          <button className="ghost-button login-button" type="button">登录</button>
          <button className="mobile-menu" type="button" aria-label="打开菜单"><Menu size={20} /></button>
        </div>
      </header>

      <main id="top">
        <section className="hero-section" id="intro">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> QUACKPRESS IMAGE TOOL</div>
            <h1>图片变轻，<br /><em>网页更快。</em></h1>
            <p className="hero-description">选择格式，上传图片，预览结果后直接下载。压缩过程在浏览器本地完成。</p>
            <div className="hero-proof"><span className="local-proof"><LockKeyhole size={13} /> 本地处理</span><span>无需注册，图片不离开你的设备</span></div>
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
            <div className="dropzone-title">拖拽图片到这里</div>
            <div className="dropzone-subtitle">或点击选择文件</div>
            <div className="dropzone-meta"><span>支持格式</span><strong>JPG、PNG、WebP</strong><i /> <span>单张文件最大 20 MB</span></div>
          </div>
          <div className="local-processing-note"><LockKeyhole size={13} /> 本地处理 · 图片不会上传到服务器</div>
          <div className="format-selector" aria-label="选择输出格式">
            <span className="format-selector-label">输出格式</span>
            <div className="format-options">
              {([['original', '保持原格式'], ['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP']] as [OutputFormat, string][]).map(([value, label]) => (
                <label className={`format-option ${outputFormat === value ? 'format-option-selected' : ''}`} key={value}>
                  <input type="radio" name="output-format" value={value} checked={outputFormat === value} onChange={() => setOutputFormat(value)} />
                  <span className="radio-mark" />
                  <span>{label}</span>
                  {value === 'original' && <small>默认</small>}
                </label>
              ))}
            </div>
          </div>
          {hasWork && (
            <div className="queue-panel">
              <div className="queue-header">
                <div><span className="section-kicker">YOUR WORKSPACE</span><h2>{allDone ? '压缩完成。' : '正在让图片变轻。'}</h2></div>
                <div className="queue-actions">
                  {allDone && <button className="primary-button compact" onClick={downloadAll}><Download size={16} /> 全部下载 {completedItems[0]?.outputFormat ?? ''}</button>}
                </div>
              </div>
              <div className="queue-summary"><span><FileStack size={15} /> {items.length} 个文件</span><span><Zap size={15} /> {allDone ? `共节省 ${formatSavings(totalOriginal, totalOutput)}` : '本地处理，速度优先'}</span><span className="format-summary">输出：{formatLabel(outputFormat)}</span><button className="pause-button" onClick={() => setIsPaused((value) => { isPausedRef.current = !value; return !value })}>{isPaused ? <Play size={14} /> : <Pause size={14} />} {isPaused ? '继续' : '暂停'}</button></div>
              <div className="items-list">
                {items.map((item) => <ImageRow key={item.id} item={item} onRemove={removeItem} onRetry={retryItem} onDownload={downloadItem} onPreview={setActiveItem} />)}
              </div>
              {!allDone && <div className="queue-footer"><LoaderCircle className="spin" size={15} /> 图片正在浏览器中处理，离开页面前请等待完成</div>}
            </div>
          )}
          {notice && <div className="notice" role="alert"><Info size={16} /> {notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={15} /></button></div>}
        </section>

        <section className="features-section" id="how-it-works">
          <div className="section-heading"><span className="section-kicker">WHY QUACKPRESS</span><h2>少一点等待，<br />多一点创造。</h2></div>
          <div className="feature-grid">
            <FeatureCard number="01" icon={<Zap size={19} />} title="快得让人忘记等待" copy="所有处理都在你的浏览器里完成。图片不会绕远路，上传后马上就能看到结果。" />
            <FeatureCard number="02" icon={<ShieldCheck size={19} />} title="图片不离开你的设备" copy="压缩鸭当前在浏览器本地完成处理，不需要把图片上传到我们的服务器。" />
            <FeatureCard number="03" icon={<Sparkles size={19} />} title="清晰，肉眼看不出差别" copy="智能选择压缩参数，在明显变小的同时，尽量保留每个重要的细节。" />
          </div>
        </section>

        <section className="privacy-strip" id="privacy"><div className="privacy-icon"><LockKeyhole size={22} /></div><div><strong>隐私优先的压缩</strong><span>无需注册，无需上传到服务器。压缩和预览都留在你的设备上。</span></div><CircleHelp size={18} className="privacy-help" /></section>
      </main>

      <footer className="footer"><span>© 2026 压缩鸭 QuackPress</span><span>Made for the web, with care.</span><div><a href="#privacy">隐私说明</a><a href="#how-it-works">帮助中心</a></div></footer>
      {activeItem && <PreviewModal item={activeItem} onClose={() => setActiveItem(null)} onDownload={downloadItem} />}
    </div>
  )
}

function ImageRow({ item, onRemove, onRetry, onDownload, onPreview }: { item: ImageItem; onRemove: (id: string) => void; onRetry: (item: ImageItem) => void; onDownload: (item: ImageItem) => void; onPreview: (item: ImageItem) => void }) {
  const statusCopy = { queued: '排队中', compressing: '压缩中', done: '已完成', error: '处理失败' }
  return <div className={`image-row status-${item.status}`}>
    <button className="thumb-button" onClick={() => item.status === 'done' && onPreview(item)} aria-label={`${item.file.name} 预览`}><img src={item.previewUrl} alt="" /><span className="thumb-overlay"><MoreHorizontal size={17} /></span></button>
    <div className="image-info"><div className="image-name" title={item.file.name}>{item.file.name}</div><div className="image-meta">{formatBytes(item.originalSize)} {item.width && `· ${item.width} × ${item.height}`} {item.status === 'done' && <><span className="meta-arrow">→</span> {formatBytes(item.outputSize ?? 0)} · {item.outputFormat}</>}</div></div>
    <div className="row-status"><div className="status-line"><span className={`status-dot status-dot-${item.status}`} />{statusCopy[item.status]}</div>{item.status === 'compressing' && <div className="mini-progress"><span style={{ width: `${item.progress}%` }} /></div>}{item.status === 'error' && <span className="error-copy">{item.error}</span>}</div>
    <div className="saving-cell">{item.status === 'done' ? <><strong>↓ {formatSavings(item.originalSize, item.outputSize)}</strong><span>节省空间</span></> : <span>—</span>}</div>
    <div className="row-actions">{item.status === 'done' && <button className="download-button" onClick={() => onDownload(item)} aria-label={`下载 ${item.outputFormat ?? '图片'}`}><ArrowDownToLine size={16} /><span className="download-label">下载 {item.outputFormat ?? '图片'}</span></button>}{item.status === 'error' && <button className="retry-button" onClick={() => onRetry(item)}><RefreshCw size={15} /> 重试</button>}<button className="remove-button" onClick={() => onRemove(item.id)} aria-label={`删除 ${item.file.name}`} title="删除"><Trash2 size={16} /></button></div>
  </div>
}

function FeatureCard({ number, icon, title, copy }: { number: string; icon: ReactNode; title: string; copy: string }) {
  return <article className="feature-card"><div className="feature-top"><span>{number}</span><div className="feature-icon">{icon}</div></div><h3>{title}</h3><p>{copy}</p><a href="#compress">试试看 <span>↗</span></a></article>
}

function PreviewModal({ item, onClose, onDownload }: { item: ImageItem; onClose: () => void; onDownload: (item: ImageItem) => void }) {
  const [showOriginal, setShowOriginal] = useState(false)
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="preview-modal" role="dialog" aria-modal="true" aria-label="图片预览" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="section-kicker">PREVIEW</span><h2>{item.file.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭预览"><X size={18} /></button></div><div className="preview-stage"><img src={showOriginal ? item.previewUrl : item.outputUrl} alt={item.file.name} /><div className="preview-label">{showOriginal ? '原图' : '压缩后'}</div></div><div className="preview-toggle"><button className={!showOriginal ? 'selected' : ''} onClick={() => setShowOriginal(false)}>压缩后 · {formatBytes(item.outputSize ?? 0)}</button><button className={showOriginal ? 'selected' : ''} onClick={() => setShowOriginal(true)}>原图 · {formatBytes(item.originalSize)}</button></div><div className="modal-footer"><div><strong>节省 {formatSavings(item.originalSize, item.outputSize)}</strong><span>保持原始尺寸 · {item.outputFormat}</span></div><button className="primary-button" onClick={() => onDownload(item)}><Download size={16} /> 下载 {item.outputFormat}</button></div></div></div>
}

export default App
