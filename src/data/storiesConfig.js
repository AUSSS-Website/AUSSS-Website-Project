// Runtime config for the exchange-story submission flow.
//
// Mirrors merchConfig.js: lets the AUSSS team flip submissions on/off and
// paste in the deployed Apps Script web app URL without touching UI code.

// Master switch. When false the /exchange/share page shows a "submissions
// are closed" message instead of the form, and the /exchange CTA hides.
export const STORIES_OPEN = true

// The Apps Script web app deployed from apps-script/stories.gs.
// Empty string = use the stub submit handler that just console-logs the
// payload, so the UX can be reviewed in dev without a backend.
export const STORIES_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbz-s7xWbh-UrPAWr_dRRJ0bRVsPecbcVFxeRmW7K51Ilp0EucthKaWSl5lPror3m5co_Q/exec'

// Story notifications are sent from inside apps-script/stories.gs, currently to
// aussswebsite@gmail.com. To reroute them, edit TEAM_EMAIL there and redeploy.
