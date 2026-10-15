import { describe, expect, it } from 'vitest'
import { LocalStore } from '@/services/localStore'

describe('比赛体验修复', () => {
  it('重复编辑赛后数据时保留已存在的球员统计', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    const players = store.listPlayers(true)
    const rows = players.map((player, index) => ({
      playerId: player.id,
      played: index === 0,
      goals: index === 0 ? 1 : 0,
      assists: 0
    }))

    store.publishStats('m-history-1', rows, { home: 1, away: 0 })
    const first = store.listMatchStats('m-history-1')
    store.publishStats('m-history-1', rows, { home: 1, away: 0 })

    expect(store.listMatchStats('m-history-1')).toEqual(first)
    expect(store.getMatch('m-history-1')).toMatchObject({ apps: 1, goals: 1, assists: 0, homeScore: 1, awayScore: 0 })
  })
})
