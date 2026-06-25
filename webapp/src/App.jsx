import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

// Same idea as gui.py's `colors`: cycle a palette per segment.
const PALETTE = [
  [255, 0, 0], [0, 255, 0], [60, 120, 255], [255, 255, 0], [255, 0, 255],
  [0, 255, 255], [255, 128, 0], [128, 0, 255], [0, 200, 128], [200, 0, 100],
]
const MAX_W = 900 // max on-screen width; image is scaled to fit, coords mapped back

export default function App() {
  const [imageId, setImageId] = useState(null)
  const [dims, setDims] = useState(null)        // {w, h} of the original image
  const [baseImg, setBaseImg] = useState(null)  // HTMLImageElement of the photo
  const [masks, setMasks] = useState([])        // [{ img: HTMLImageElement, color }]
  const [status, setStatus] = useState('画像を読み込んでください')
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')

  const canvasRef = useRef(null)
  const dragRef = useRef(null)                  // {x0,y0,x1,y1} in display coords
  const [, force] = useState(0)                 // force re-render while dragging

  const scale = dims ? Math.min(1, MAX_W / dims.w) : 1
  const dispW = dims ? Math.round(dims.w * scale) : 0
  const dispH = dims ? Math.round(dims.h * scale) : 0

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setMasks([]); setImageId(null); setDims(null); setBaseImg(null)
    setFileName(file.name)

    const img = new Image()
    img.onload = () => setBaseImg(img)
    img.src = URL.createObjectURL(file)

    setBusy(true)
    setStatus('画像の埋め込みを計算中… (数秒かかります)')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setImageId(data.id)
      setDims({ w: data.width, h: data.height })
      setStatus('準備完了 — 画像上でバウンディングボックスをドラッグしてください')
    } catch (err) {
      setStatus('アップロード失敗: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const redraw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv || !baseImg || !dims) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(baseImg, 0, 0, dispW, dispH)
    for (const m of masks) ctx.drawImage(m.img, 0, 0, dispW, dispH)
    const d = dragRef.current
    if (d) {
      ctx.strokeStyle = 'red'
      ctx.lineWidth = 2
      ctx.strokeRect(
        Math.min(d.x0, d.x1), Math.min(d.y0, d.y1),
        Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0),
      )
    }
  }, [baseImg, dims, masks, dispW, dispH])

  useEffect(() => { redraw() }, [redraw])

  const posOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e) => {
    if (!imageId || busy) return
    const p = posOf(e)
    dragRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
    force((n) => n + 1)
  }

  const onMove = (e) => {
    if (!dragRef.current) return
    const p = posOf(e)
    dragRef.current.x1 = p.x
    dragRef.current.y1 = p.y
    redraw()
  }

  const onUp = async () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null

    // map display coords back to original image pixels
    const xmin = Math.min(d.x0, d.x1) / scale
    const xmax = Math.max(d.x0, d.x1) / scale
    const ymin = Math.min(d.y0, d.y1) / scale
    const ymax = Math.max(d.y0, d.y1) / scale
    if (xmax - xmin < 3 || ymax - ymin < 3) { redraw(); return } // ignore stray clicks

    const color = PALETTE[masks.length % PALETTE.length]
    setBusy(true)
    setStatus('セグメンテーション中…')
    try {
      const res = await fetch('/api/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: imageId, box: [xmin, ymin, xmax, ymax], color, alpha: 150 }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const mimg = new Image()
      mimg.onload = () => setMasks((prev) => [...prev, { img: mimg, color }])
      mimg.src = data.mask
      setStatus('完了 — 続けてボックスを描けます')
    } catch (err) {
      setStatus('セグメント失敗: ' + err.message)
      redraw()
    } finally {
      setBusy(false)
    }
  }

  const undo = () => setMasks((prev) => prev.slice(0, -1))
  const clearAll = () => setMasks([])

  const save = () => {
    if (!baseImg || !dims) return
    const cv = document.createElement('canvas')
    cv.width = dims.w
    cv.height = dims.h
    const ctx = cv.getContext('2d')
    ctx.drawImage(baseImg, 0, 0)
    for (const m of masks) ctx.drawImage(m.img, 0, 0)
    const a = document.createElement('a')
    a.href = cv.toDataURL('image/png')
    a.download = (fileName.replace(/\.[^.]+$/, '') || 'image') + '_overlay.png'
    a.click()
  }

  return (
    <div className="app">
      <header>
        <h1>MedSAM <span>browser</span></h1>
        <p className="sub">バウンディングボックスでセグメンテーション</p>
      </header>

      <div className="toolbar">
        <label className="btn primary">
          画像を読み込む
          <input type="file" accept="image/*" onChange={onFile} hidden />
        </label>
        <button onClick={undo} disabled={!masks.length || busy}>元に戻す (Undo)</button>
        <button onClick={clearAll} disabled={!masks.length || busy}>全消去</button>
        <button onClick={save} disabled={!masks.length || busy}>重畳画像を保存</button>
        <span className={'status' + (busy ? ' busy' : '')}>{status}</span>
      </div>

      <div className="stage">
        {dims ? (
          <canvas
            ref={canvasRef}
            width={dispW}
            height={dispH}
            className={busy ? 'wait' : 'ready'}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={() => { if (dragRef.current) { dragRef.current = null; redraw() } }}
          />
        ) : (
          <div className="placeholder">画像を読み込むとここに表示されます</div>
        )}
      </div>

      {masks.length > 0 && <p className="count">{masks.length} 個のマスク</p>}
    </div>
  )
}
