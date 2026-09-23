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
      {/* Soft gradient seams so section background colours blend into each
          other instead of hard-cutting. Each strip starts at the section
          above's edge colour and ends at the one below's (light + dark). */}
      <div
        aria-hidden="true"
        className="h-24 bg-gradient-to-b from-forest-950 to-cream dark:to-forest-950 sm:h-32"
      />
      <About />
      <div
        aria-hidden="true"
        className="h-24 bg-gradient-to-b from-cream to-forest-950 dark:from-forest-950 sm:h-32"
      />
      <ExecutiveBoard />
      <TeamOfficials />
    </>
  )
}
