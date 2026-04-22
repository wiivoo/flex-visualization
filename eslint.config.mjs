import nextVitals from 'eslint-config-next/core-web-vitals'

const config = [
  {
    ignores: ['src/_archive/**'],
  },
  ...nextVitals,
]

export default config
