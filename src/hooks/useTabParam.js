import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

// Keeps which tab of a page is open in the address, as ?tab=…, so a reload,
// the Back button after a look at another page, and a link sent to a colleague
// all open the same tab.
//
//   const [tab, setTab] = useTabParam(['page', 'calls', 'members'], 'page')
//
// `allowed` lists the tabs: their keys, or the page's own [key, label] pairs.
// `fallback` is the tab the page opens on (the first one when left out). It is
// what an address with no tab, or with a tab that is not in the list, shows,
// and choosing it takes the parameter out again, so the page's plain address
// stays plain. `name` is the parameter's name, for a page that keeps a second
// choice in the address beside its tab:
//
//   const [view, setView] = useTabParam(['list', 'board'], 'list', 'view')
//
// Changing tab replaces the address in place and adds nothing to the history:
// Back leaves the page, it does not walk back through the tabs. Every other
// parameter, the #fragment and the state the page was opened with are kept.

const keysOf = (allowed) => allowed.map((entry) => (Array.isArray(entry) ? entry[0] : entry))

// The tab a query string asks for. `search` is the address's own
// ("?tab=calls&q=x", with or without the question mark) or a URLSearchParams.
export function tabFromSearch(search, allowed, fallback, name = 'tab') {
  const keys = keysOf(allowed)
  const home = fallback ?? keys[0]
  const asked = new URLSearchParams(search).get(name)
  return asked !== null && keys.includes(asked) ? asked : home
}

// The query string that opens `tab`, ready to be an address's `search`: empty,
// or starting with its question mark. The fallback tab, and a tab that is not
// in the list, leave the parameter out; the other parameters stay as they are.
export function searchForTab(search, tab, allowed, fallback, name = 'tab') {
  const keys = keysOf(allowed)
  const home = fallback ?? keys[0]
  const next = new URLSearchParams(search)
  if (tab === home || !keys.includes(tab)) next.delete(name)
  else next.set(name, tab)
  const text = next.toString()
  return text ? `?${text}` : ''
}

export default function useTabParam(allowed, fallback, name = 'tab') {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const tab = tabFromSearch(params, allowed, fallback, name)

  // The list is often built afresh on every render; its keys as one string
  // keep setTab the same function for as long as the tabs are the same.
  const keyList = keysOf(allowed).join('\n')
  const setTab = useCallback(
    (next) => {
      const keys = keyList ? keyList.split('\n') : []
      // Read from the address bar at the moment of the click, not from the
      // last render: two parameters changed in one handler then both land.
      const now = window.location.search
      const search = searchForTab(now, next, keys, fallback, name)
      // The tab that is already open: nothing to change, so no navigation.
      if (search === now) return
      navigate({ search, hash: window.location.hash }, { replace: true, state })
    },
    [navigate, state, keyList, fallback, name],
  )

  return [tab, setTab]
}
