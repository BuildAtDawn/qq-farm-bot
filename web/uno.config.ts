import { defineConfig, presetAttributify, presetIcons, presetUno } from 'unocss'

export default defineConfig({
  content: {
    pipeline: {
      include: [
        /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/,
        'src/**/*.{js,ts}',
      ],
    },
  },
  theme: {
    fontFamily: {
      sans: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      serif: '"Songti SC", "Noto Serif CJK SC", serif',
      mono: '"SFMono-Regular", Consolas, monospace',
    },
  },
  shortcuts: {
    'i-carbon-list-blocked': 'i-fas-ban',
    'i-carbon-user-offline': 'i-fas-user-slash',
    'i-carbon-leaf': 'i-fas-leaf',
    'i-carbon-crown': 'i-fas-crown',
    'i-carbon-circle': 'i-fas-circle',
    'i-fas-circle-notch-function': 'i-fas-circle-notch',
    'i-fas-circle-notch-string': 'i-fas-circle-notch',
    'i-fas-circle-notch-return': 'i-fas-circle-notch',
    'i-carbon-circle-dash-function': 'i-carbon-circle-dash',
    'i-carbon-circle-dash-string': 'i-carbon-circle-dash',
    'i-carbon-circle-dash-return': 'i-carbon-circle-dash',
    // Attributify may combine dynamic icon values with neighboring template tokens.
    'i-carbon-calendar-adapted': 'i-carbon-calendar',
    'i-carbon-run-dashboard-page': 'i-carbon-run',
    'i-carbon-run-return': 'i-carbon-run',
    'i-carbon-run-div': 'i-carbon-run',
    'i-carbon-chevron-left-1': 'i-carbon-chevron-left',
    'i-carbon-chevron-right-1': 'i-carbon-chevron-right',
    'i-carbon-renew-1': 'i-carbon-renew',
  },
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: true,
      safelist: [
        'i-fas-ban',
        'i-fas-user-slash',
        'i-fas-leaf',
        'i-fas-crown',
        'i-fas-circle',
        'i-fas-circle-notch',
      ],
      collections: {
        'carbon': () => import('@iconify-json/carbon/icons.json').then(i => i.default),
        'fas': () => import('@iconify-json/fa-solid/icons.json').then(i => i.default),
        'svg-spinners': () => import('@iconify-json/svg-spinners/icons.json').then(i => i.default),
      },
    }),

  ],
})
