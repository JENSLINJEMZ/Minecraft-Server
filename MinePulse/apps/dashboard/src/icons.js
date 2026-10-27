/**
 * Inline SVG icon set (24x24, stroked) used across the dashboard.
 * Path data is kept here so templates stay readable.
 */
export const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  chart: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  users:
    'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  plug:
    'M10 3h4v3a2 2 0 1 0 3 2h3v4h-3a2 2 0 1 0 0 4h3v4h-4v-3a2 2 0 1 0-4 0v3H4v-4h3a2 2 0 1 0 0-4H4V8h3a2 2 0 1 0 3-2z',
  doc: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4',
  gear:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12l2-1-2-4-2 1-2-1V5H9v2L7 8 5 7l-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h6v-2l2-1 2 1 2-4z',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 3 2 20h20zM12 10v4M12 17v.1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  refresh: 'M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-3-3',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM7 7h.1M7 17h.1',
  cpu: 'M9 9h6v6H9zM4 9h2M18 9h2M4 15h2M18 15h2M9 4v2M15 4v2M9 18v2M15 18v2M4 4h16v16H4z',
  memory: 'M3 7h18v10H3zM6 10v4M9 10v4M12 10v4M15 10v4M18 10v4',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  copy: 'M9 9h11v11H9zM5 15V5a2 2 0 0 1 2-2h8',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 14h10l1-14',
  chevron: 'm9 6 6 6-6 6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 8v.1M12 11v5',
};

export const ic = (key, attrs = '') =>
  `<svg class="i" viewBox="0 0 24 24" ${attrs}><path d="${ICONS[key] ?? ''}"/></svg>`;
