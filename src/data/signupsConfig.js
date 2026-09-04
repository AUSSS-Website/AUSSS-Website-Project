// Runtime config for the lightweight "sign-ups" capture (recruitment waitlist
// + newsletter). Mirrors storiesConfig.js / merchConfig.js so the AUSSS team
// can flip things on and paste the deployed endpoint without touching UI code.

// Show the "notify me when registration opens" form on /join.
export const WAITLIST_OPEN = true

// Show the newsletter signup (footer + magazine).
export const NEWSLETTER_OPEN = true

// The Apps Script web app deployed from apps-script/signups.gs.
// Empty string = use the stub handler that just console-logs, so the UX can be
// reviewed in dev without a backend. Paste the /exec URL here after deploying.
export const SIGNUPS_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbyd738Fo_JZ_wd58Lx9jDhObYQ_HFvTZO-rokpfaO01FwLU6wTWG1r5ZYUQRUZ5X9BHvA/exec'

// Sign-up notifications are emailed from inside apps-script/signups.gs,
// currently to aussswebsite@gmail.com. Change TEAM_EMAIL there and redeploy to
// reroute them.
