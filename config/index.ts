import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin'
import devConfig from './dev'
import prodConfig from './prod'

export default defineConfig<'webpack5'>(async (merge) => {
  const outputRoot = process.env.TARO_ENV === 'h5' ? 'dist-h5' : 'dist'
  const defaultDataMode = process.env.NODE_ENV === 'production' ? 'cloudbase' : 'local'
  const dataMode = process.env.TARO_APP_DATA_MODE || defaultDataMode
  const cloudbaseEnvId = process.env.TARO_APP_CLOUDBASE_ENV_ID || (dataMode === 'cloudbase' ? 'cloud1-d4g1nl8yx26d1f3f2' : '')
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'gba-rangers-weapp',
    date: '2026-07-23',
    designWidth: 750,
    deviceRatio: { 375: 2, 640: 1.17, 750: 1, 828: 0.905 },
    sourceRoot: 'src',
    outputRoot,
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: true },
    defineConstants: {
      __DATA_MODE__: JSON.stringify(dataMode),
      __CLOUDBASE_ENV_ID__: JSON.stringify(cloudbaseEnvId)
    },
    copy: {
      patterns: process.env.TARO_ENV === 'h5' ? [] : [
        { from: 'src/custom-tab-bar-native', to: `${outputRoot}/custom-tab-bar` },
        { from: 'src/assets/gba-crest-white-v2.png', to: `${outputRoot}/assets/gba-crest-white-v2.png` }
      ],
      options: {}
    },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } }
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin)
      }
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      router: { mode: 'hash' },
      devServer: { host: '127.0.0.1', port: 10086, open: false },
      postcss: {
        autoprefixer: { enable: true, config: {} },
        cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } }
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin)
      }
    }
  }

  return process.env.NODE_ENV === 'development'
    ? merge({}, baseConfig, devConfig)
    : merge({}, baseConfig, prodConfig)
})
