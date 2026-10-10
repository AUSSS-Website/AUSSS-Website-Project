import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import usePageTitle from '../hooks/usePageTitle.js'
import { examDoor, examWord, getSession, lastUserId, onAuthStateChange, signOut } from './examApi.js'
import { screenFor, signedOutWords } from './examFlow.js'
import ExamLayout from './ExamLayout.jsx'
import ExamSitting from './ExamSitting.jsx'
import { Waiting } from './examUi.jsx'
import { retryDelay, toMs } from './sitting.js'
import { forgetHeldPapers, hasHeldPaper } from './useSitting.js'
import DetailsScreen from './screens/DetailsScreen.jsx'
import NothingHereScreen from './screens/NothingHereScreen.jsx'
import OnTheListScreen from './screens/OnTheListScreen.jsx'
import SignInScreen from './screens/SignInScreen.jsx'
import UnreachedScreen from './screens/UnreachedScreen.jsx'

// /exam/<word>: the whole of a taker's flow at one address. Who is signed in
// and what rpc/exam_door answers decide the screen (screenFor in examFlow.js):
// sign in, nothing here, the details form, on the list, then the sitting.
// The exam keeps its own session state here; it has no AuthProvider and no
// react-query, so nothing of the portal loads for a taker.

// While a taker waits for the exam to open, the door is asked again this often.
const LOOK_EVERY_MS = 30 * 1000
// ... and no more often than this, however many times the page regains focus.
const LOOK_GAP_MS = 2000
const DAY_MS = 24 * 60 * 60 * 1000
// How long the session may take to be read before a paper the phone holds is
// shown without it. supabase-js answers at once unless it holds a session it
// has to renew and cannot reach its server, and it then tries for about 25
// seconds before saying so.
const SESSION_WAIT_MS = 4000
const UNREACHED = 'The exam could not be reached. Check your connection and try again.'

// Who is signed in on this phone, and a function that reads it again:
// undefined while it is being read, null when nobody is, else { id, email }.
// The same account keeps the same object through the hourly renewal of its
// session, so nothing that hangs on it starts again mid-exam.
//
// One more case: the session's hour ran out while there was no connection and
// the page was opened again. The session is still on the phone, but
// supabase-js cannot renew it and hands over nobody. That is not "signed
// out", and the Google button would only lead to an error page. The answer is
// then { id, email: '', unread: true } with the id of the account this phone
// last saw (null if it remembers none): the door carries on with that
// account's paper if the phone holds it, and keeps trying otherwise. The real
// session takes its place when the connection is back. A taker whose paper is
// on the phone is not kept waiting for supabase-js to give up, either: after
// SESSION_WAIT_MS the same answer is given early.
function useExamUser(word) {
  const [user, setUser] = useState(undefined)
  const reader = useRef(() => {})
  useEffect(() => {
    let alive = true
    let timer = null
    let failures = 0
    const early = setTimeout(() => {
      const id = lastUserId()
      if (alive && hasHeldPaper(word, id)) setUser((now) => (now === undefined ? { id, email: '', unread: true } : now))
    }, SESSION_WAIT_MS)
    const take = (session) => {
      if (!alive) return
      clearTimeout(timer)
      clearTimeout(early)
      const next = session?.user ? { id: session.user.id, email: session.user.email || '' } : null
      setUser((now) => (now && next && !now.unread && now.id === next.id && now.email === next.email ? now : next))
    }
    const read = () => {
      clearTimeout(timer)
      getSession().then(take, (error) => {
        if (!alive) return
        if (error?.kind !== 'offline') {
          take(null)
          return
        }
        setUser((now) => (now === undefined ? { id: lastUserId(), email: '', unread: true } : now))
        failures += 1
        timer = setTimeout(read, retryDelay(failures))
      })
    }
    reader.current = read
    read()
    window.addEventListener('online', read)
    // Only a sign-out says that nobody is signed in. The first word from
    // supabase-js is empty too when it could not renew the session, and
    // getSession above is what tells the two apart.
    const stop = onAuthStateChange((event, session) => {
      if (session || event === 'SIGNED_OUT') take(session)
    })
    return () => {
      alive = false
      clearTimeout(timer)
      clearTimeout(early)
      window.removeEventListener('online', read)
      stop()
    }
  }, [word])
  const readAgain = useCallback(() => reader.current(), [])
  return [user, readAgain]
}

export default function ExamDoor() {
  const word = examWord(useParams().word)
  // Not a word an exam could have: there is nothing to ask the database.
  if (!word) return <Navigate to="/" replace />
  return <Door key={word} word={word} />
}

function Door({ word }) {
  usePageTitle('Exchange exam')
  const [user, readAgain] = useExamUser(word)
  const userId = user?.id || null
  // The session could not be read (see useExamUser) ...
  const unread = Boolean(user?.unread)
  // ... and this phone remembers no account to carry on as.
  const nobody = unread && !userId

  // What rpc/exam_door last said: { status: 'asking' }, { status: 'answered',
  // data } or { status: 'failed', error, failures }.
  const [door, setDoor] = useState({ status: 'asking' })
  // The taker started here, or the phone holds their paper: the sitting is on
  // screen whatever the door says next.
  const [started, setStarted] = useState(false)
  // The paper rpc/exam_start has just made, by its id. The sitting shows the
  // phone's copy only if it is of that paper: after the officers delete a
  // paper and the taker starts again, the copy on the phone is of the old one.
  const [startedId, setStartedId] = useState(null)
  const [editing, setEditing] = useState(false)
  // The sentence of a sitting the database no longer knows.
  const [gone, setGone] = useState('')
  // Bad news from this page itself (a sign-out that did not go through).
  const [notice, setNotice] = useState('')
  // Said on the sign-in card to a taker whose session ended under them.
  const [signedOut, setSignedOut] = useState('')
  const asked = useRef(0)
  // For that sentence: who was signed in, whether their paper or their place
  // on the list had been on screen, and whether they pressed "Sign out".
  const was = useRef({ id: null, inside: false, left: false })

  // Asks the door. `quiet` leaves the screen as it is until the answer comes
  // (the looks while waiting for the exam to open, the retries); only the
  // last question asked counts.
  const ask = useCallback(
    async ({ quiet = false } = {}) => {
      if (!userId) return
      asked.current += 1
      const mine = asked.current
      if (!quiet) setDoor({ status: 'asking' })
      try {
        const data = await examDoor(word)
        if (mine === asked.current) setDoor({ status: 'answered', data })
      } catch (error) {
        if (mine !== asked.current) return
        // A quiet look that fails changes nothing that is already on screen.
        setDoor((now) =>
          now.status === 'answered' ? now : { status: 'failed', error, failures: (now.failures || 0) + 1 },
        )
      }
    },
    [word, userId],
  )

  // A new account, or none: nothing of the last one stays.
  useEffect(() => {
    asked.current += 1
    const before = was.current
    // The account went without the taker asking (the session was ended from
    // another tab, or could not be renewed): say so on the sign-in card, and
    // whether this phone still holds their paper.
    if (!userId && before.id && before.inside && !before.left) {
      setSignedOut(signedOutWords(hasHeldPaper(word, before.id)))
    } else if (userId) {
      setSignedOut('')
    }
    was.current = { id: userId, inside: false, left: false }
    // The phone holds this account's paper: it is shown at once, and the
    // sitting asks the database behind it. The door has nothing to ask then,
    // which saves a refresh on a slow network one round trip.
    const held = hasHeldPaper(word, userId)
    setStarted(held)
    setStartedId(null)
    setEditing(false)
    setGone('')
    setNotice('')
    setDoor({ status: 'asking' })
    if (!held) ask()
  }, [ask, word, userId])

  const screen = screenFor({ user, door, started, editing, gone })
  const data = door.status === 'answered' ? door.data : null
  const exam = data?.exam || null

  useEffect(() => {
    if (screen === 'sitting' || screen === 'listed') was.current.inside = true
  }, [screen])

  // A wait this long is the network (or a session being renewed over it):
  // the spinner's line says so, where "One moment" would look stuck.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (screen !== 'wait') {
      setSlow(false)
      return undefined
    }
    const timer = setTimeout(() => setSlow(true), SESSION_WAIT_MS)
    return () => clearTimeout(timer)
  }, [screen])

  // The session is back after it could not be read: what the door was turned
  // away for will pass now.
  const wasUnread = useRef(false)
  useEffect(() => {
    if (wasUnread.current && !unread && userId && !started) ask({ quiet: true })
    wasUnread.current = unread
  }, [unread, userId, started, ask])

  // The database did not answer: keep trying, further apart each time, and at
  // once when the phone says it is back online. (With nobody to ask as, it is
  // the session that is read again, and useExamUser does that by itself.)
  const unanswered =
    door.status === 'failed' && (door.error?.kind === 'offline' || (unread && door.error?.kind === 'signed_out'))
  const retrying = screen === 'unreached' && (nobody || unanswered)
  const failures = door.failures || 0
  useEffect(() => {
    if (!retrying || nobody) return undefined
    const again = () => ask({ quiet: true })
    const timer = setTimeout(again, retryDelay(failures))
    window.addEventListener('online', again)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', again)
    }
  }, [retrying, nobody, failures, ask])

  // On the list before the exam opens: look again every 30 seconds, when the
  // page regains focus, and at the opening time itself, so the start code
  // field appears without a refresh.
  const waiting = screen === 'listed' && exam?.phase === 'before'
  const opensIn = waiting ? toMs(exam.opens_at) - toMs(data.now) : NaN
  const looked = useRef(0)
  useEffect(() => {
    if (!waiting) return undefined
    const look = () => {
      // A phone in a pocket has nobody to show the start code field to.
      if (document.visibilityState === 'hidden') return
      if (Date.now() - looked.current < LOOK_GAP_MS) return
      looked.current = Date.now()
      ask({ quiet: true })
    }
    const every = setInterval(look, LOOK_EVERY_MS)
    // A few seconds apart from phone to phone, so a hall does not ask as one.
    // Only within a day: a longer timer than the browser can hold fires at once.
    const atOpening =
      opensIn > 0 && opensIn < DAY_MS ? setTimeout(look, opensIn + 500 + Math.random() * 2500) : null
    window.addEventListener('focus', look)
    document.addEventListener('visibilitychange', look)
    return () => {
      clearInterval(every)
      clearTimeout(atOpening)
      window.removeEventListener('focus', look)
      document.removeEventListener('visibilitychange', look)
    }
  }, [waiting, opensIn, ask])

  const leave = useCallback(async () => {
    setNotice('')
    was.current.left = true
    try {
      await signOut()
      // The session listener shows the sign-in card. Nothing of the paper
      // stays on the phone for whoever holds it next.
      forgetHeldPapers(word, userId)
    } catch (error) {
      was.current.left = false
      setNotice(error?.message || 'You could not be signed out. Try again.')
    }
  }, [word, userId])

  // The database refused the sitting (the paper or the exam was deleted): ask
  // the door what there is now.
  const leaveSitting = useCallback(
    (sentence) => {
      setGone(sentence || 'Your paper could not be opened.')
      setStarted(false)
      setStartedId(null)
      ask()
    },
    [ask],
  )

  const saved = useCallback(
    (answer) => {
      setDoor((now) => {
        if (now.status !== 'answered' || !now.data) return now
        const registration = answer?.registration === 'held' ? 'held' : now.data.registration
        return { ...now, data: { ...now.data, registration, me: answer?.me || now.data.me } }
      })
      if (answer?.registration !== 'held') return
      setEditing(false)
      // The taker may have been typing for a while: the exam may have opened since.
      ask({ quiet: true })
    },
    [ask],
  )

  if (screen === 'sitting') {
    return (
      <ExamSitting
        word={word}
        userId={userId}
        // null when the door did not ask because the phone holds the paper
        attemptId={startedId || data?.attempt?.id || null}
        title={exam?.title || ''}
        notice={notice}
        onGone={leaveSitting}
        onSignOut={leave}
      />
    )
  }

  const email = data?.me?.email || user?.email || ''
  const held = data?.registration === 'held'

  return (
    <ExamLayout title={exam?.title || ''}>
      {screen === 'wait' && <Waiting>{slow ? 'Still reaching the exam. Check your connection.' : undefined}</Waiting>}
      {screen === 'sign-in' && (
        <SignInScreen word={word} problem={user ? (door.status === 'failed' ? door.error?.message : '') : signedOut} />
      )}
      {screen === 'unreached' && (
        <UnreachedScreen
          // A session that could not be read is turned away as "signed out",
          // which is not what happened: the plain sentence is said for it.
          message={gone || (unread ? '' : door.error?.message) || UNREACHED}
          again={retrying}
          notice={notice}
          onRetry={() => {
            setGone('')
            if (nobody) readAgain()
            else ask()
          }}
          onSignOut={leave}
        />
      )}
      {screen === 'nothing' && <NothingHereScreen email={email} notice={notice} onSignOut={leave} />}
      {screen === 'details' && (
        <DetailsScreen
          word={word}
          me={data.me}
          email={email}
          held={held}
          notice={notice || gone}
          onSaved={saved}
          onCancel={editing ? () => setEditing(false) : undefined}
          onSignOut={leave}
        />
      )}
      {screen === 'listed' && (
        <OnTheListScreen
          word={word}
          exam={exam}
          me={data.me}
          notice={notice || gone}
          onEdit={() => setEditing(true)}
          onSignOut={leave}
          onStarted={(id) => {
            setGone('')
            setStartedId(typeof id === 'string' && id ? id : null)
            setStarted(true)
          }}
          onBack={() => ask()}
        />
      )}
    </ExamLayout>
  )
}
