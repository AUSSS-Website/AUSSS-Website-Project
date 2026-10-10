import { ExamCard, Problem, tapLinkCls, tapPrimaryCls } from '../examUi.jsx'

// The database did not answer the door, or said something about this sitting
// that no other screen explains. `message` is the sentence to show; `again`
// is true while the page keeps trying on its own; `notice` is bad news from
// the page itself (a sign-out that did not go through).
export default function UnreachedScreen({ message, again = false, notice = '', onRetry, onSignOut }) {
  return (
    <ExamCard title="We could not open the exam" subtitle={message}>
      {again && (
        <p className="mt-4 text-center text-xs text-soft/60" role="status">
          This page keeps trying on its own.
        </p>
      )}
      <Problem>{notice}</Problem>
      <button type="button" onClick={onRetry} className={`${tapPrimaryCls} mt-6 w-full`}>
        Try again
      </button>
      <p className="mt-2 text-center">
        <button type="button" onClick={onSignOut} className={tapLinkCls}>
          Sign out
        </button>
      </p>
    </ExamCard>
  )
}
