import { describe, expect, it } from 'vitest'
import { describeNotification, notificationTarget } from './workUi.jsx'

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
