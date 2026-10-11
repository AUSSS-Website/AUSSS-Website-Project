// Adapted from react-bits (MIT), https://reactbits.dev/animations/image-trail
// Only variant 7 is kept (the gallery hero uses it). What differs from
// upstream is the frame loop. There it starts on the first pointer move and
// never ends. Here it runs only while there is something to work out: it
// rests once the eased point has caught the pointer up, wakes on the next
// move, and stays at rest while the hero is scrolled off screen. Leaving
// /gallery stops it, removes its listeners and kills the gsap tweens in
// flight. The pictures themselves are moved by gsap, which keeps its own
// clock and stops by itself.

import { useRef, useEffect } from 'react'
import { gsap } from 'gsap'

import './ImageTrail.css'

function lerp(a, b, n) {
  return (1 - n) * a + n * b
}

function getLocalPointerPos(e, rect) {
  let clientX = 0,
    clientY = 0
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX
    clientY = e.touches[0].clientY
  } else {
    clientX = e.clientX
    clientY = e.clientY
  }
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

function getMouseDistance(p1, p2) {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.hypot(dx, dy)
}

class ImageItem {
  DOM = { el: null, inner: null }
  defaultStyle = { scale: 1, x: 0, y: 0, opacity: 0 }
  rect = null

  constructor(DOM_el) {
    this.DOM.el = DOM_el
    this.DOM.inner = this.DOM.el.querySelector('.content__img-inner')
    this.getRect()
    this.initEvents()
  }
  initEvents() {
    this.resize = () => {
      gsap.set(this.DOM.el, this.defaultStyle)
      this.getRect()
    }
    window.addEventListener('resize', this.resize)
  }
  getRect() {
    this.rect = this.DOM.el.getBoundingClientRect()
  }
}

class ImageTrailVariant7 {
  constructor(container) {
    this.container = container
    this.DOM = { el: container }
    this.images = [...container.querySelectorAll('.content__img')].map((img) => new ImageItem(img))
    this.imagesTotal = this.images.length
    this.imgPosition = 0
    this.zIndexVal = 1
    this.activeImagesCount = 0
    this.isIdle = true
    this.threshold = 80

    this.mousePos = { x: 0, y: 0 }
    this.lastMousePos = { x: 0, y: 0 }
    this.cacheMousePos = { x: 0, y: 0 }

    this.visibleImagesCount = 0
    this.visibleImagesTotal = 9
    this.visibleImagesTotal = Math.min(this.visibleImagesTotal, this.imagesTotal - 1)

    this.frame = 0 // the frame asked for, 0 while the loop rests
    this.lastFrameAt = 0
    this.moved = false
    this.inView = true
    this.destroyed = false

    this.onPointerMove = (ev) => {
      const rect = container.getBoundingClientRect()
      this.mousePos = getLocalPointerPos(ev, rect)
      if (!this.moved) {
        // The first move: the eased point starts under the pointer.
        this.moved = true
        this.cacheMousePos = { ...this.mousePos }
      }
      this.wake()
    }
    container.addEventListener('mousemove', this.onPointerMove)
    // The listener only reads the finger's place, so it must not hold up a scroll.
    container.addEventListener('touchmove', this.onPointerMove, { passive: true })

    if (typeof IntersectionObserver !== 'undefined') {
      // Several changes can arrive in one call, oldest first: the last is how
      // things stand now. Going by the first could leave the trail at rest
      // with the hero back on screen.
      this.observer = new IntersectionObserver((entries) => {
        this.inView = entries[entries.length - 1].isIntersecting
        if (!this.inView) this.rest()
      })
      this.observer.observe(container)
    }
  }

  // Ask for one frame, unless one is already on its way.
  wake() {
    if (this.frame || !this.inView || this.destroyed) return
    this.frame = requestAnimationFrame((time) => this.render(time))
  }

  rest() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.lastFrameAt = 0
  }

  render(time) {
    this.frame = 0
    // Upstream eases 0.3 of the way on every frame, which is twice as fast on
    // a 120 Hz screen. This is the same ease measured in time.
    const elapsed = this.lastFrameAt ? Math.min(time - this.lastFrameAt, 100) : 1000 / 60
    this.lastFrameAt = time
    const ease = 1 - 0.7 ** (elapsed / (1000 / 60))

    let distance = getMouseDistance(this.mousePos, this.lastMousePos)
    this.cacheMousePos.x = lerp(this.cacheMousePos.x, this.mousePos.x, ease)
    this.cacheMousePos.y = lerp(this.cacheMousePos.y, this.mousePos.y, ease)

    if (distance > this.threshold) {
      this.showNextImage()
      this.lastMousePos = { ...this.mousePos }
    }
    if (this.isIdle && this.zIndexVal !== 1) this.zIndexVal = 1

    // Another frame only while the eased point is still catching up. Once it
    // has, nothing here changes until the pointer moves, and that wakes the
    // loop again.
    if (getMouseDistance(this.cacheMousePos, this.mousePos) > 0.5) {
      this.wake()
    } else {
      this.cacheMousePos = { ...this.mousePos }
      this.lastFrameAt = 0
    }
  }

  destroy() {
    this.destroyed = true
    this.rest()
    this.observer?.disconnect()
    this.container.removeEventListener('mousemove', this.onPointerMove)
    this.container.removeEventListener('touchmove', this.onPointerMove)
    this.images.forEach((img) => {
      gsap.killTweensOf(img.DOM.el)
      window.removeEventListener('resize', img.resize)
    })
  }

  showNextImage() {
    ++this.zIndexVal
    this.imgPosition = this.imgPosition < this.imagesTotal - 1 ? this.imgPosition + 1 : 0
    const img = this.images[this.imgPosition]
    ++this.visibleImagesCount

    gsap.killTweensOf(img.DOM.el)
    const scaleValue = gsap.utils.random(0.5, 1.6)

    gsap
      .timeline({
        onStart: () => this.onImageActivated(),
        onComplete: () => this.onImageDeactivated(),
      })
      .fromTo(
        img.DOM.el,
        {
          scale: scaleValue - Math.max(gsap.utils.random(0.2, 0.6), 0),
          rotationZ: 0,
          opacity: 1,
          zIndex: this.zIndexVal,
          x: this.cacheMousePos.x - img.rect.width / 2,
          y: this.cacheMousePos.y - img.rect.height / 2,
        },
        {
          duration: 0.4,
          ease: 'power3',
          scale: scaleValue,
          rotationZ: gsap.utils.random(-3, 3),
          x: this.mousePos.x - img.rect.width / 2,
          y: this.mousePos.y - img.rect.height / 2,
        },
        0,
      )

    if (this.visibleImagesCount >= this.visibleImagesTotal) {
      const lastInQueue = getNewPosition(this.imgPosition, this.visibleImagesTotal, this.images)
      const oldImg = this.images[lastInQueue]
      gsap.to(oldImg.DOM.el, {
        duration: 0.4,
        ease: 'power4',
        opacity: 0,
        scale: 1.3,
        onComplete: () => {
          if (this.activeImagesCount === 0) {
            this.isIdle = true
          }
        },
      })
    }
  }

  onImageActivated() {
    this.activeImagesCount++
    this.isIdle = false
  }
  onImageDeactivated() {
    this.activeImagesCount--
  }
}

function getNewPosition(position, offset, arr) {
  const realOffset = Math.abs(offset) % arr.length
  if (position - realOffset >= 0) {
    return position - realOffset
  } else {
    return arr.length - (realOffset - position)
  }
}

export default function ImageTrail({ items = [] }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    const instance = new ImageTrailVariant7(containerRef.current)
    return () => instance.destroy()
  }, [items])

  return (
    <div className="content" ref={containerRef}>
      {items.map((url, i) => (
        <div className="content__img" key={`${url}-${i}`}>
          <div className="content__img-inner" style={{ backgroundImage: `url(${url})` }} />
        </div>
      ))}
    </div>
  )
}
