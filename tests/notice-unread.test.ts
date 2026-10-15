import { describe, expect, it } from 'vitest'
import { LocalStore } from '@/services/localStore'

describe('通知未读数量', () => {
  it('阅读后消除数量，重复阅读不产生负数，新通知重新增加', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    store.hydrateFromCloud({ notices: [] })
    const first = store.createNotice({ type: 'match_signup', title: '报名', content: '请确认', audience: 'all_members' })
    expect(store.getUnreadNoticeCount()).toBe(1)
    store.markNoticeRead(first.id)
    store.markNoticeRead(first.id)
    expect(store.getUnreadNoticeCount()).toBe(0)
    store.createNotice({ type: 'match_signup', title: '新通知', content: '新的报名', audience: 'all_members' })
    expect(store.getUnreadNoticeCount()).toBe(1)
  })
  it('未通过审核的身份不会显示缓存通知数量', () => {
    const store = new LocalStore()
    store.setDemoRole('visitor')
    expect(store.getUnreadNoticeCount()).toBe(0)
  })
})
