// The two documents on /constitution: the society's own Constitution & Bylaws
// and the national federation's, and the page's short account of how the
// society's is amended (it cites the document's sections, so it changes with
// it). Edited by the EB, who upload a new PDF when a General Assembly adopts a
// new version. Until something is published the page shows the two files that
// ship with the site (public/assets/docs).
//
// The download names are fixed here rather than taken from the upload, so a
// member always saves a file called what it is.
export const AUSSS_FILE_NAME = 'AUSSS-Constitution-and-Bylaws.pdf'
export const NATIONAL_FILE_NAME = 'IFMSA-Egypt-Constitution-and-Bylaws.pdf'

const versionHelp = (example) =>
  `One short line saying which version this is, such as “${example}”. It comes first in the line of facts under the document. Leave it empty to show only the pages and the size.`

export default {
  key: 'constitution.documents',
  title: 'Constitution page: the documents',
  description:
    'The AUSSS Constitution & Bylaws and IFMSA-Egypt’s, as PDFs. Upload the new version when a General Assembly adopts it; the page and the Members page switch to it once you publish.',
  path: '/constitution',
  editors: [],
  fields: [
    {
      name: 'ausss',
      type: 'pdf',
      label: 'AUSSS Constitution & Bylaws',
      required: true,
      help: 'The PDF read on the page and offered for download, up to 25 MB. Check it in the preview before you publish.',
    },
    {
      name: 'ausssVersion',
      type: 'text',
      label: 'Which version this is',
      max: 80,
      help: versionHelp('As amended at the LGA of October 2026'),
    },
    {
      name: 'steps',
      type: 'list',
      label: 'How it’s amended',
      itemLabel: 'step',
      titleField: 'title',
      min: 1,
      max: 8,
      help: 'The numbered steps under the document, drawn from it. If a new version moves or renumbers the sections they cite, change them here too.',
      fields: [
        { name: 'title', type: 'text', label: 'Step', required: true, max: 40 },
        { name: 'ref', type: 'text', label: 'Sections', max: 60, help: 'The sections it comes from, such as §14.1, §18.1.3.' },
        { name: 'body', type: 'textarea', label: 'What happens', required: true, max: 600 },
      ],
    },
    {
      name: 'national',
      type: 'pdf',
      label: 'IFMSA-Egypt Constitution & Bylaws',
      required: true,
      help: 'The federation’s own document, opened from its card further down the page. Up to 25 MB.',
    },
    {
      name: 'nationalVersion',
      type: 'text',
      label: 'Which version this is',
      max: 80,
      help: versionHelp('Issued October 2026'),
    },
  ],
  defaults: {
    ausss: {
      url: `/assets/docs/${AUSSS_FILE_NAME}`,
      name: AUSSS_FILE_NAME,
      pages: 38,
      bytes: 789020,
    },
    ausssVersion: '',
    steps: [
      {
        title: 'Propose',
        ref: '§1.2.5, §14.2',
        body: 'A motion to amend can be raised only by a Full member, and the written proposal must reach the Secretary General before the General Assembly.',
      },
      {
        title: 'Circulate',
        ref: '§14.3–14.4, §18.1',
        body: 'The Secretary General shares every proposal with the Supervising Council, Team of Officials and all members beforehand. Bylaw changes to Chapters 1 and 2 need at least two Full members and one month’s notice; other points need two weeks’. Skipping these steps makes a proposal invalid.',
      },
      {
        title: 'Vote',
        ref: '§14.1, §18.1.3, §11.2',
        body: 'Amendments are decided at the Local General Assembly by a two-thirds majority, with every Full member casting one vote.',
      },
      {
        title: 'Adopt',
        ref: '§18.1.4, §11.4',
        body: 'Changes take effect once adopted by the General Assembly. A bylaw point can likewise be suspended by a two-thirds majority in an official LGA.',
      },
    ],
    national: {
      url: `/assets/docs/${NATIONAL_FILE_NAME}`,
      name: NATIONAL_FILE_NAME,
      pages: 49,
      bytes: 1756124,
    },
    // The cover reads "Issued in October 2026", after the federation's
    // end-of-term General Assembly of 2025-26.
    nationalVersion: 'Issued October 2026',
  },
}
