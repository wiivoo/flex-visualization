import nextVitals from 'eslint-config-next/core-web-vitals'

const config = [
  {
    ignores: [
      '.next/**',
      'research/**',
      'src/_archive/**',
    ],
  },
  ...nextVitals,
]

export default config
