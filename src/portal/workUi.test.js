import { describe, expect, it } from 'vitest'
import { campaignDates, describeNotification, notificationTarget, progressText } from './workUi.jsx'

const about = (kind, payload) => describeNotification({ kind, payload }, {})

describe('what a notification about a submission says', () => {
  it('names the buyer and the reference of an order', () => {
    expect(about('order_new', { name: 'Amal Samir', ref: 'AUSSS-7F3K2Q', subtotal: 640 })).toEqual({
      line: 'New merch order',
      detail: 'Amal Samir · AUSSS-7F3K2Q · 640 EGP',
    })
  })
  it('names the sender of a story', () => {
    expect(about('story_new', { name: 'Omar Example', destination: 'Lisbon', ref: 'STORY-AAA111' })).toEqual({
      line: 'New exchange story',
      detail: 'Omar Example · Lisbon · STORY-AAA111',
    })
  })
  it('names one sign-up on the waitlist', () => {
    expect(about('signup_new', { name: 'Waiting One', count: 1 })).toEqual({
      line: 'New sign-up on the waitlist',
      detail: 'Waiting One',
    })
  })
  it('says so when a sign-up left no name', () => {
    expect(about('signup_new', { name: '', count: 1 }).detail).toBe('They left no name')
  })
  it('counts several sign-ups in one line, with the latest name', () => {
    expect(about('signup_new', { name: 'Waiting Three', count: 3 })).toEqual({
      line: '3 new sign-ups on the waitlist',
      detail: 'The latest is Waiting Three',
    })
    expect(about('signup_new', { name: '', count: 12 }).detail).toBe('The latest is somebody who left no name')
  })
  it('counts one when an old row has no count', () => {
    expect(about('signup_new', { name: 'Waiting One' }).line).toBe('New sign-up on the waitlist')
  })
})

describe('where a notification about a submission leads', () => {
  it('opens the tab its kind is listed under', () => {
    expect(notificationTarget({ kind: 'order_new', payload: {} })).toBe('/portal/submissions?tab=orders')
    expect(notificationTarget({ kind: 'story_new', payload: {} })).toBe('/portal/submissions?tab=stories')
    expect(notificationTarget({ kind: 'signup_new', payload: {} })).toBe('/portal/submissions?tab=signups')
  })
  it('leads nowhere for a kind it does not know', () => {
    expect(notificationTarget({ kind: 'something_else', payload: {} })).toBeNull()
  })
})

describe('what a notification about a campaign says and where it leads', () => {
  const note = { kind: 'campaign_note', payload: { campaign_id: 'cp-1', title: 'Welcome week', actor_id: 'u-2', excerpt: 'The hall is free.' } }

  it('names who left the note and on which campaign', () => {
    expect(describeNotification(note, { 'u-2': { full_name: 'Sara Ali' } })).toEqual({
      line: 'Sara Ali left a note on “Welcome week”',
      detail: 'The hall is free.',
    })
  })
  it('opens the campaign', () => {
    expect(notificationTarget(note)).toBe('/portal/campaigns/cp-1')
  })
  it('opens the subtask when the notification is about one', () => {
    expect(notificationTarget({ kind: 'task_comment', payload: { task_id: 't-1' } })).toBe('/portal/tasks/t-1')
  })
})

describe('when a campaign runs, and how far it is', () => {
  const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  it('gives both days, one of them, or nothing', () => {
    expect(campaignDates({ starts_on: '2026-11-20', ends_on: '2026-11-27' })).toBe(`${day('2026-11-20')} to ${day('2026-11-27')}`)
    expect(campaignDates({ starts_on: '2026-11-20', ends_on: '2026-11-20' })).toBe(day('2026-11-20'))
    expect(campaignDates({ starts_on: '2026-11-20', ends_on: null })).toBe(`From ${day('2026-11-20')}`)
    expect(campaignDates({ starts_on: null, ends_on: '2026-11-27' })).toBe(`Until ${day('2026-11-27')}`)
    expect(campaignDates({ starts_on: null, ends_on: null })).toBe('')
  })
  it('counts subtasks and people in words', () => {
    expect(progressText({ total: 0, done: 0, people: 0 })).toBe('No subtasks yet')
    expect(progressText({ total: 1, done: 0, people: 1 })).toBe('0 of 1 subtask done · 1 person')
    expect(progressText({ total: 5, done: 3, people: 8 })).toBe('3 of 5 subtasks done · 8 people')
    expect(progressText({ total: 2, done: 2, people: 0 })).toBe('2 of 2 subtasks done')
  })
})
