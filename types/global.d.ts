declare const __DATA_MODE__: 'local' | 'cloudbase'
declare const __CLOUDBASE_ENV_ID__: string

declare module '*.png' {
  const src: string
  export default src
}
