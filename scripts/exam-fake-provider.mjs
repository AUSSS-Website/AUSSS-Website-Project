// A stand-in for Google, for the exam's stress test on a throwaway stack.
//
// A student signs in to the exam with Google: the page sends them to the
// sign-in service, which sends them to Google, which sends them back with a
// code; the sign-in service asks Google who the code belongs to, makes the
// account if it is new, and hands the page a session. No script can sign 400
// made-up students in to the real Google, so on a throwaway stack this stands
// in its place: the stack's sign-in service is told of one more provider
// (Keycloak's kind, whose address can be set) at this server's address, and
// scripts/exam-stress.mjs then takes every taker through that same path
// (PROVIDER=keycloak).
//
// THIS SERVER VOUCHES FOR WHATEVER ADDRESS IT IS ASKED ABOUT. A sign-in service
// that trusted it would let anybody in as anybody. It exists for a stack that
// is made for one run and thrown away (.github/workflows/exam-rehearsal.yml adds
// it to the runner's own copy of supabase/config.toml and nowhere else). It
// must never be named in the repository's supabase/config.toml, and never be
// added to the hosted project.
//
// It speaks the three parts of the exchange the sign-in service uses:
//   GET  <realm>/protocol/openid-connect/auth      back to the caller with the code it brought
//   POST <realm>/protocol/openid-connect/token     the code is the access token
//   GET  <realm>/protocol/openid-connect/userinfo  who the token belongs to
// A code is the address of the account it stands for, in base64url.
//
//   node scripts/exam-fake-provider.mjs            listens on 0.0.0.0:9911
import { createServer } from 'node:http'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REALM = '/realms/hall'
export const codeFor = (email) => Buffer.from(String(email)).toString('base64url')
export const emailOf = (code) => {
  const email = Buffer.from(String(code || ''), 'base64url').toString()
  return /^[^@\s]+@[^@\s]+$/.test(email) ? email : ''
}

export function fakeProvider() {
  const seen = { token: 0, userinfo: 0 }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://provider')
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }
    const parts = []
    for await (const part of req) parts.push(part)
    const body = new URLSearchParams(Buffer.concat(parts).toString())

    if (url.pathname === `${REALM}/protocol/openid-connect/auth`) {
      // A browser would show a sign-in page here. The caller says who it is
      // with `login_hint`, and is sent back with that account's code.
      const back = new URL(url.searchParams.get('redirect_uri') || 'http://localhost/')
      back.searchParams.set('code', codeFor(url.searchParams.get('login_hint') || ''))
      back.searchParams.set('state', url.searchParams.get('state') || '')
      return send(302, {}, { location: back.toString() })
    }
    if (url.pathname === `${REALM}/protocol/openid-connect/token` && req.method === 'POST') {
      const email = emailOf(body.get('code'))
      if (!email) return send(400, { error: 'invalid_grant' })
      seen.token += 1
      return send(200, { access_token: body.get('code'), token_type: 'Bearer', expires_in: 3600 })
    }
    if (url.pathname === `${REALM}/protocol/openid-connect/userinfo`) {
      const email = emailOf(String(req.headers.authorization || '').replace(/^Bearer /i, ''))
      if (!email) return send(401, { error: 'invalid_token' })
      seen.userinfo += 1
      return send(200, { sub: `fake-${codeFor(email)}`, email, email_verified: true, name: email.split('@')[0].replace(/[-.]/g, ' ') })
    }
    if (url.pathname === '/seen') return send(200, seen)
    return send(404, { error: 'not_found' })
  })
  return { server, seen }
}

// Only when run as a script: a test may import the parts above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 9911)
  // On every interface: the sign-in service calls from inside its container.
  fakeProvider().server.listen(port, '0.0.0.0', () => console.log(`fake identity provider on port ${port}, realm ${REALM}`))
}
