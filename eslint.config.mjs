import nextVitals from 'eslint-config-next/core-web-vitals'

const config = [
  {
    ignores: [
      '.next/**',
      'playwright-report/**',
      'research/**',
      'src/_archive/**',
    ],
  },
  ...nextVitals,
]

export default config
