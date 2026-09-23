// Switch and endpoint for exchange-story submissions (/exchange/share).

// When false, /exchange/share shows a "submissions are paused" message
// instead of the form.
export const STORIES_OPEN = true

// The Apps Script web app deployed from apps-script/stories.gs. It emails each
// story to aussswebsite@gmail.com; change TEAM_EMAIL there and redeploy to
// reroute them.
export const STORIES_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbz-s7xWbh-UrPAWr_dRRJ0bRVsPecbcVFxeRmW7K51Ilp0EucthKaWSl5lPror3m5co_Q/exec'
