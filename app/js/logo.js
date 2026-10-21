// The AXON logo: an open book with circuit traces and a spark rising from the spine.
// Drawn in a 40x40 box with currentColor, so it takes the theme's accent colour wherever it's used.
export const LOGO_INNER = `
  <path d="M20 13.2C16 10.6 10.6 10.1 5.5 11.1V30.6C10.6 29.6 16 30.1 20 32.6C24 30.1 29.4 29.6 34.5 30.6V11.1C29.4 10.1 24 10.6 20 13.2Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
  <path d="M20 13.2V32.6" stroke="currentColor" stroke-width="1.5"/>
  <path d="M8.6 16.4H12.4L14.4 18.4H16.6M8.6 21.2H10.8L12.8 23.2H16.6M8.6 26H13.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".85"/>
  <path d="M31.4 16.4H27.6L25.6 18.4H23.4M31.4 21.2H29.2L27.2 23.2H23.4M31.4 26H26.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".85"/>
  <g fill="currentColor"><circle cx="17" cy="18.4" r="1.15"/><circle cx="17" cy="23.2" r="1.15"/><circle cx="14" cy="26" r="1.15"/><circle cx="23" cy="18.4" r="1.15"/><circle cx="23" cy="23.2" r="1.15"/><circle cx="26" cy="26" r="1.15"/></g>
  <g class="spark"><path d="M20 12.4V8.4M20 10L16.4 7.6M20 10L23.6 7.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  <circle cx="20" cy="6.6" r="2" fill="currentColor"/><circle cx="15.6" cy="7" r="1.15" fill="currentColor"/><circle cx="24.4" cy="7" r="1.15" fill="currentColor"/></g>`;

// Square app icon: rounded tile in the theme background with the logo in the accent colour.
export const iconSVG = (bg, fg, size = 256) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}">
  <rect width="40" height="40" rx="9" fill="${bg}"/><g color="${fg}" transform="translate(1.6 1.6) scale(.92)">${LOGO_INNER}</g></svg>`;
