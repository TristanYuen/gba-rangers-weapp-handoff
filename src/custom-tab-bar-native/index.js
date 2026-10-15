Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: '/pages/matches/index', label: '比赛' },
      { pagePath: '/pages/account/index', label: '我的球队' }
    ]
  },
  lifetimes: {
    attached() {
      this.syncSelected()
      wx.nextTick(() => this.syncSelected())
    }
  },
  pageLifetimes: {
    show() {
      this.syncSelected()
      wx.nextTick(() => {
        this.syncSelected()
        if (this.data.selected === 1) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      })
    }
  },
  methods: {
    syncSelected(fallbackSelected) {
      const pages = getCurrentPages()
      const route = pages[pages.length - 1]?.route || ''
      const selected = route === 'pages/account/index'
        ? 1
        : route === 'pages/matches/index'
          ? 0
          : fallbackSelected
      if (selected !== 0 && selected !== 1) return
      if (selected !== this.data.selected) this.setData({ selected })
    },
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const pagePath = this.data.tabs[index].pagePath
      this.setData({ selected: index })

      const pages = getCurrentPages()
      const currentRoute = pages[pages.length - 1]?.route || ''
      if (`/${currentRoute}` === pagePath) return

      wx.switchTab({
        url: pagePath,
        success: () => {
          wx.nextTick(() => {
            const currentPages = getCurrentPages()
            const currentPage = currentPages[currentPages.length - 1]
            const tabBar = currentPage?.getTabBar?.()
            if (tabBar) tabBar.setData({ selected: index })
            if (index === 1) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
          })
        },
        fail: () => this.syncSelected(index)
      })
    }
  }
})
