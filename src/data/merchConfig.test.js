import { describe, expect, it } from 'vitest'
import {
  normalizePaymentMethods,
  paymentMethodLabel,
  paymentMethodsFrom,
  paymentValueProblem,
  shippedPaymentMethods,
} from './merchConfig.js'

const method = (over = {}) => ({
  id: 'instapay',
  type: 'link',
  label: 'Instapay',
  hint: 'Send + upload receipt',
  value: 'https://ipn.eg/S/name/instapay/abc',
  available: true,
  ...over,
})

describe('paymentValueProblem', () => {
  it('asks for a value when it is empty', () => {
    expect(paymentValueProblem('link', '')).toBe('Fill this in.')
    expect(paymentValueProblem('phone', '   ')).toBe('Fill this in.')
    expect(paymentValueProblem('handle', undefined)).toBe('Fill this in.')
  })

  it('takes only https links', () => {
    expect(paymentValueProblem('link', 'https://ipn.eg/S/x')).toBe('')
    expect(paymentValueProblem('link', 'http://ipn.eg/S/x')).not.toBe('')
    expect(paymentValueProblem('link', 'javascript:alert(1)')).not.toBe('')
    expect(paymentValueProblem('link', 'https://a b')).not.toBe('')
  })

  it('takes handles with or without the @', () => {
    expect(paymentValueProblem('handle', '@sarsorz')).toBe('')
    expect(paymentValueProblem('handle', 'sarsorz')).toBe('')
    expect(paymentValueProblem('handle', '@a b')).not.toBe('')
  })

  it('takes phone numbers', () => {
    expect(paymentValueProblem('phone', '01003522721')).toBe('')
    expect(paymentValueProblem('phone', '+20 100 352 2721')).toBe('')
    expect(paymentValueProblem('phone', 'call me')).not.toBe('')
  })

  it('wants a known type', () => {
    expect(paymentValueProblem('cheque', '123')).toBe('Choose a type.')
  })
})

describe('normalizePaymentMethods', () => {
  it('answers null for anything but a list', () => {
    expect(normalizePaymentMethods(null)).toBeNull()
    expect(normalizePaymentMethods({ id: 'x' })).toBeNull()
    expect(normalizePaymentMethods('instapay')).toBeNull()
  })

  it('keeps a good method and drops unknown keys', () => {
    expect(normalizePaymentMethods([{ ...method(), extra: 'x' }])).toEqual([method()])
  })

  it('drops rows that are not objects or lack a name or a good id', () => {
    const out = normalizePaymentMethods([
      null,
      'instapay',
      method({ label: '' }),
      method({ id: 'Insta Pay' }),
      method({ id: '' }),
      method({ id: 'ok' }),
    ])
    expect(out.map((m) => m.id)).toEqual(['ok'])
  })

  it('drops unknown types', () => {
    expect(normalizePaymentMethods([method({ type: 'cheque' })])).toEqual([])
  })

  it('keeps the first of two methods with the same id', () => {
    const out = normalizePaymentMethods([method({ label: 'First' }), method({ label: 'Second' })])
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('First')
  })

  it('drops javascript: and other non-https links', () => {
    expect(normalizePaymentMethods([method({ value: 'javascript:alert(1)' })])).toEqual([])
    expect(normalizePaymentMethods([method({ value: 'http://ipn.eg/S/x' })])).toEqual([])
  })

  it('adds the @ to a handle', () => {
    const [m] = normalizePaymentMethods([method({ id: 'telda', type: 'handle', value: 'sarsorz' })])
    expect(m.value).toBe('@sarsorz')
  })

  it('trims text and treats only false as unavailable', () => {
    const [a, b] = normalizePaymentMethods([
      method({ label: '  Instapay  ', available: undefined }),
      method({ id: 'off', available: false }),
    ])
    expect(a.label).toBe('Instapay')
    expect(a.available).toBe(true)
    expect(b.available).toBe(false)
  })
})

describe('paymentMethodsFrom', () => {
  it('falls back to the shipped list when the setting is missing, broken or empty', () => {
    expect(paymentMethodsFrom(undefined)).toBe(shippedPaymentMethods)
    expect(paymentMethodsFrom({ nope: true })).toBe(shippedPaymentMethods)
    expect(paymentMethodsFrom([])).toBe(shippedPaymentMethods)
    expect(paymentMethodsFrom([method({ value: 'javascript:alert(1)' })])).toBe(shippedPaymentMethods)
  })

  it('uses the setting when it holds a usable list', () => {
    expect(paymentMethodsFrom([method({ id: 'cash', label: 'Cash' })]).map((m) => m.id)).toEqual(['cash'])
  })

  it('keeps the shipped list clean', () => {
    expect(normalizePaymentMethods(shippedPaymentMethods)).toEqual(shippedPaymentMethods)
  })
})

describe('paymentMethodLabel', () => {
  it('names a method by its id, or shows the id of a removed one', () => {
    expect(paymentMethodLabel(shippedPaymentMethods, 'vodafone')).toBe('Vodafone Cash')
    expect(paymentMethodLabel(shippedPaymentMethods, 'gone')).toBe('gone')
  })
})
