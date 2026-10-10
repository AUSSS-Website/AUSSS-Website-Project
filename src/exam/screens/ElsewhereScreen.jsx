import { ExamCard, tapPrimaryCls } from '../examUi.jsx'

// Another tab of this browser has the exam open. The sitting is kept to one
// tab (useSitting.js says why), so this one shows nothing of the paper until
// the taker chooses it. The other tab is then the one that shows this screen.
export default function ElsewhereScreen({ onTakeOver }) {
  return (
    <ExamCard
      title="This exam is open in another tab"
      subtitle="Go back to that tab to carry on. If you cannot find it, use this one. Your answers are kept."
    >
      <button type="button" onClick={onTakeOver} className={`${tapPrimaryCls} mt-6 w-full`}>
        Use this tab
      </button>
    </ExamCard>
  )
}
