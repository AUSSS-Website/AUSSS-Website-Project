// A responsive inline Canva embed, sized to fit within the viewport so the
// reader doesn't have to scroll a screen-and-a-half to clear it. The page's
// aspect ratio is preserved (padding-top trick, Canva's own technique) while
// the *width* is capped so the resulting height never exceeds `maxVh` of the
// viewport. On a narrow screen the container width wins and the height scales
// down with it. `ratio` is page height ÷ width; 1.4142 is A4 portrait (√2).
export default function CanvaFrame({ src, title, ratio = 1.4142, maxVh = 95 }) {
  // Canva "view" links accept ?embed to drop the chrome and render inline.
  const embed = src.includes('embed')
    ? src
    : `${src}${src.includes('?') ? '&' : '?'}embed`
  return (
    <div
      className="reveal mx-auto"
      // Cap width so height (= width × ratio) tops out at maxVh of the viewport.
      style={{ maxWidth: `calc(${maxVh}vh / ${ratio})` }}
    >
      <div
        className="relative h-0 w-full overflow-hidden rounded-2xl border border-line/10 bg-card shadow-lg shadow-black/20"
        style={{ paddingTop: `${ratio * 100}%` }}
      >
        <iframe
          src={embed}
          title={title}
          loading="lazy"
          allowFullScreen
          allow="fullscreen"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    </div>
  )
}
