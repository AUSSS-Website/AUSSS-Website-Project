import { ExamCard, Problem, tapOutlineCls } from '../examUi.jsx'

// Signed in, and no ready exam has this address's word: a mistyped link, an
// exam still in draft, or one that has been deleted. Signing out lets the
// taker try another account.
export default function NothingHereScreen({ email, notice = '', onSignOut }) {
  return (
    <ExamCard
      title="No exam here"
      subtitle="There is no exam at this address. Check the link the exchange team sent you."
    >
      {email && (
        <p className="mt-6 text-center text-xs text-soft/60">
          Signed in as <span className="text-ink [overflow-wrap:anywhere]">{email}</span>
        </p>
      )}
      <Problem>{notice}</Problem>
      <button type="button" onClick={onSignOut} className={`${tapOutlineCls} mt-4 w-full`}>
        Sign out
      </button>
    </ExamCard>
  )
}
