// Shrinks a picked image to a JPEG no wider or taller than `maxPx`, in the
// browser (canvas), with the phone's EXIF orientation applied. Used for the
// merch receipt screenshot so the upload stays small (the bucket caps files
// at 2 MB) and needs no server-side processing.

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image'))
    }
    img.src = url
  })
}

export async function resizeImage(file, maxPx = 1600, quality = 0.85) {
  const source = await decodeImage(file)
  try {
    const sw = source.width || source.naturalWidth
    const sh = source.height || source.naturalHeight
    const scale = Math.min(1, maxPx / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff' // PNG transparency becomes white, not black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(source, 0, 0, w, h)
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
        'image/jpeg',
        quality,
      )
    })
  } finally {
    if (typeof source.close === 'function') source.close()
  }
}
