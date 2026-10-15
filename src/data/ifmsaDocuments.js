// IFMSA's own documents for each standing committee, linked quietly in the
// "From IFMSA" box on its page (CommitteePage.jsx), and the EMR's strategic
// plan in one line on /ifmsa. They are IFMSA's files on its Google Drive, the
// ones each international team links from ifmsa.org/teams/<committee>-team,
// so a file the team replaces in place stays current here.
//
// Checked 2026-10-16. SCORP links no strategy (its next one is being written),
// so its page has none. A newer edition usually comes with a new file: put its
// id here and correct the label.

const drive = (id) => `https://drive.google.com/file/d/${id}/view`

export const committeeDocuments = {
  scope: [
    {
      label: 'Regulations',
      title: 'IFMSA SCOPE regulations, amended August 2026',
      href: drive('1U78i6sWuXK3GuwcTAhfopEg-tGHbm0aK'),
    },
    {
      label: 'Strategy 2022-2025',
      title: 'IFMSA SCOPE strategy 2022-2025',
      href: drive('1U4cQBThoErJYeT58iOKhivC0n9A0z_Ue'),
    },
  ],
  score: [
    {
      label: 'Regulations',
      title: 'IFMSA SCORE regulations, amended August 2026',
      href: drive('1rS9l7LPsvdCDW1dVlIDWJUA-9kgpu9oD'),
    },
    {
      label: 'Strategic plan 2022-2025 and annex',
      title: 'IFMSA SCORE strategic plan 2022-2025, with the annex for 2025-26',
      href: drive('1ctkNCoQkyu6ggR1_mWStR2YEkU8NQeoz'),
    },
  ],
  scome: [
    {
      label: 'Strategy 2025/26',
      title: 'IFMSA SCOME strategy 2025/26',
      href: drive('1__gpfpbSOY3TjOF9NdpJwH8foNzxO0n_'),
    },
  ],
  scoph: [
    {
      label: 'Strategic plan 2022-2025',
      title: 'IFMSA SCOPH strategic plan 2022-2025',
      href: drive('1yJ9KPLgaDNZbrtZqYQ81hfsDHsfiYMuA'),
    },
    {
      label: 'Strategy annex 2025-26',
      title: 'IFMSA SCOPH strategy annex 2025-26',
      href: drive('1VzbT-jhwU7xvVjRl7Ef0CEn-z_Q_ETBJ'),
    },
  ],
  scora: [
    {
      label: 'Strategy 2022-2025',
      title: 'IFMSA SCORA strategy 2022-2025',
      href: drive('1vaYenHrRZoNNVYf5_0AnSqGr4y1rrvpi'),
    },
  ],
}

export const regionStrategy = {
  label: 'the region’s strategic plan 2022-2025',
  title: 'IFMSA EMR strategic plan 2022-2025',
  href: drive('1cAQtRz7TlzEMoWxVPfyDh2SrvGOzhm7h'),
}
