import { describe, expect, it } from 'vitest'
import { searchForTab, tabFromSearch } from './useTabParam.js'

const TABS = ['page', 'calls', 'members']
// The same tabs as a page writes them, with their labels.
const PAIRS = [
  ['page', 'Committee page'],
  ['calls', 'Open calls'],
  ['members', 'Members'],
]

describe('tabFromSearch: the tab an address asks for', () => {
  it('is the one named, when it is a tab of the page', () => {
    expect(tabFromSearch('?tab=calls', TABS, 'page')).toBe('calls')
    expect(tabFromSearch('tab=members', TABS, 'page')).toBe('members')
    expect(tabFromSearch(new URLSearchParams({ tab: 'calls' }), TABS, 'page')).toBe('calls')
  })

  it('is the fallback when the address names none', () => {
    expect(tabFromSearch('', TABS, 'page')).toBe('page')
    expect(tabFromSearch('?q=heart', TABS, 'calls')).toBe('calls')
  })

  it('is the fallback when the address names a tab the page does not have', () => {
    expect(tabFromSearch('?tab=settings', TABS, 'page')).toBe('page')
    expect(tabFromSearch('?tab=', TABS, 'page')).toBe('page')
    expect(tabFromSearch('?tab=Calls', TABS, 'page')).toBe('page')
  })

  it('is the first tab when no fallback is given', () => {
    expect(tabFromSearch('', TABS)).toBe('page')
    expect(tabFromSearch('?tab=nowhere', ['orders', 'stories'])).toBe('orders')
  })

  it('reads the tabs from [key, label] pairs as well', () => {
    expect(tabFromSearch('?tab=members', PAIRS, 'page')).toBe('members')
    expect(tabFromSearch('?tab=Members', PAIRS, 'page')).toBe('page')
    expect(tabFromSearch('', PAIRS)).toBe('page')
  })

  it('reads the parameter it is told to', () => {
    expect(tabFromSearch('?tab=calls&view=board', ['list', 'board'], 'list', 'view')).toBe('board')
    expect(tabFromSearch('?tab=calls', ['list', 'board'], 'list', 'view')).toBe('list')
  })

  it('has nothing to give a page with no tabs at all', () => {
    expect(tabFromSearch('?tab=orders', [])).toBeUndefined()
  })
})

describe('searchForTab: the address that opens a tab', () => {
  it('names the tab', () => {
    expect(searchForTab('', 'calls', TABS, 'page')).toBe('?tab=calls')
    expect(searchForTab('?tab=calls', 'members', TABS, 'page')).toBe('?tab=members')
  })

  it('is left clean by the fallback tab', () => {
    expect(searchForTab('?tab=calls', 'page', TABS, 'page')).toBe('')
    expect(searchForTab('', 'page', TABS, 'page')).toBe('')
    expect(searchForTab('?tab=stories', 'orders', ['orders', 'stories'])).toBe('')
  })

  it('keeps every other parameter, in its place', () => {
    expect(searchForTab('?q=heart&tab=calls&paper=7', 'members', TABS, 'page')).toBe('?q=heart&tab=members&paper=7')
    expect(searchForTab('?q=heart&tab=calls&paper=7', 'page', TABS, 'page')).toBe('?q=heart&paper=7')
    expect(searchForTab('?q=heart', 'calls', TABS, 'page')).toBe('?q=heart&tab=calls')
  })

  it('keeps a value with spaces and Arabic in it whole', () => {
    const next = searchForTab(`?q=${encodeURIComponent('علم التشريح')}`, 'calls', TABS, 'page')
    expect(new URLSearchParams(next).get('q')).toBe('علم التشريح')
    expect(new URLSearchParams(next).get('tab')).toBe('calls')
  })

  it('treats a tab the page does not have as the fallback', () => {
    expect(searchForTab('?tab=calls&q=x', 'settings', TABS, 'page')).toBe('?q=x')
  })

  it('writes one parameter and leaves another tab-like one alone', () => {
    expect(searchForTab('?tab=calls', 'board', ['list', 'board'], 'list', 'view')).toBe('?tab=calls&view=board')
    expect(searchForTab('?tab=calls&view=board', 'list', ['list', 'board'], 'list', 'view')).toBe('?tab=calls')
  })

  it('takes [key, label] pairs', () => {
    expect(searchForTab('', 'members', PAIRS, 'page')).toBe('?tab=members')
    expect(searchForTab('?tab=members', 'page', PAIRS)).toBe('')
  })

  it('gives back the same string for the tab that is already open, so nothing navigates', () => {
    expect(searchForTab('?tab=calls', 'calls', TABS, 'page')).toBe('?tab=calls')
    expect(searchForTab('?q=heart&tab=calls', 'calls', TABS, 'page')).toBe('?q=heart&tab=calls')
  })

  it('opens what it wrote', () => {
    for (const tab of TABS) {
      expect(tabFromSearch(searchForTab('?q=heart', tab, TABS, 'page'), TABS, 'page')).toBe(tab)
    }
  })
})
