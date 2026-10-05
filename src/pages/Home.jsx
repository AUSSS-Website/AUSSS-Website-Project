import useReveal from '../hooks/useReveal.js'
import Hero from '../components/Hero.jsx'
import About from '../components/About.jsx'
import ExecutiveBoard from '../components/ExecutiveBoard.jsx'
import TeamOfficials from '../components/TeamOfficials.jsx'

export default function Home() {
  useReveal()

  return (
    <>
      <Hero />
      {/* Breathing room between the sections. The hero already ends in the
          page's own colour in both themes, so no seam is needed. */}
      <div aria-hidden="true" className="h-24 sm:h-32" />
      <About />
      <div aria-hidden="true" className="h-24 sm:h-32" />
      <ExecutiveBoard />
      <TeamOfficials />
    </>
  )
}
