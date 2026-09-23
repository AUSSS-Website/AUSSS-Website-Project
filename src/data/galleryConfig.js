// The Apps Script web app deployed from apps-script/gallery.gs. It keeps the
// list of hidden gallery photos: the admin page (/gallery/admin) edits it and
// the public gallery reads it on load, so a takedown reaches every visitor
// without a redeploy. See apps-script/gallery.README.md for the deploy.
export const GALLERY_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbwep4pLHw6O9EqNmvQDYZmpldgKioWbUm2Er4geJPTiuC36SRNZNXfvTpxENTcNX5dXPg/exec'
