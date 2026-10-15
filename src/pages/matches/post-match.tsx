import { useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { View, Text, Button, Input, Switch } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { MatchPublic, MatchStatInput, MatchStatRecord } from '@/domain/types'
import { appService } from '@/services'
import { cloudbaseEnabled } from '@/services/cloudService'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

export default function PostMatchPage() {
  const { params } = useRouter()
  const id = params.id?.trim()
  const { syncError, refresh } = useCloudPageRefresh({ intervalMs: 0 })
  const [syncing, setSyncing] = useState(cloudbaseEnabled)
  useDidShow(() => {
    if (!cloudbaseEnabled) return
    setSyncing(true)
    void refresh().finally(() => setSyncing(false))
  })
  usePageShare({ title: '大湾区流浪者｜赛后数据', path: id ? `/pages/matches/post-match?id=${id}` : '/pages/matches/post-match' })
  if (cloudbaseEnabled && syncing) return <PageShell className='content'><View className='notice notice--warning'><Text className='notice__title'>正在读取比赛和球员数据</Text><Text>请稍候，数据同步完成后才能编辑赛后记录。</Text></View></PageShell>
  if (cloudbaseEnabled && syncError) {
    const retry = async () => {
      setSyncing(true)
      await refresh(true)
      setSyncing(false)
    }
    return <PageShell className='content'><View className='notice notice--danger'><Text className='notice__title'>无法读取最新赛后数据</Text><Text>{syncError}</Text></View><Button className='button button--primary' onClick={() => void retry()}>重试同步</Button></PageShell>
  }
  const access = appService.getAccess()
  const match = id ? (() => {
    try { return appService.getMatch(id) } catch { return null }
  })() : null

  if (!access.canManage) return <PageShell className='content'><View className='notice notice--danger'>只有管理员可以录入赛后数据。</View></PageShell>
  if (!id) return <PageShell className='content'><View className='notice notice--danger'><Text className='notice__title'>缺少比赛信息</Text><Text>请先从历史比赛列表选择一场真实比赛。</Text></View><Button className='button button--primary' onClick={() => Taro.switchTab({ url: '/pages/matches/index' })}>返回历史比赛</Button></PageShell>
  if (!match) return <PageShell className='content'><View className='notice notice--danger'><Text className='notice__title'>比赛不存在</Text><Text>该比赛可能已删除，请重新选择历史比赛。</Text></View><Button className='button button--primary' onClick={() => Taro.switchTab({ url: '/pages/matches/index' })}>返回历史比赛</Button></PageShell>
  if (!['completed', 'completed_pending_score'].includes(match.status)) return <PageShell className='content'><View className='notice notice--warning'><Text className='notice__title'>当前比赛不可录入</Text><Text>只有历史比赛可以发布赛后数据。</Text></View><Button className='button button--primary' onClick={() => Taro.switchTab({ url: '/pages/matches/index' })}>返回历史比赛</Button></PageShell>

  return <PostMatchEditor id={id} match={match} refresh={refresh} />
}

const PostMatchEditor = ({ id, match, refresh }: { id: string; match: MatchPublic; refresh: (showFailure?: boolean) => Promise<boolean> }) => {
  const players = appService.listPlayers(true)
  const existingStats = appService.listMatchStats(id)
  const existingByPlayerId = new Map(existingStats.map((row) => [row.playerId, row]))
  const temporaryIdentity = (memberType: string | undefined, displayName: string | undefined) => {
    if (!displayName) return null
    const prefix = displayName.match(/^（(试训|客串|待定)）/)
    const type = memberType === 'trial' || memberType === 'guest'
      ? memberType
      : prefix?.[1] === '客串' ? 'guest' : prefix ? 'trial' : null
    if (!type) return null
    const name = displayName.replace(/^（(?:试训|客串|待定)）/, '').trim()
    return name ? `${type}:${name}` : null
  }
  const matchOnlyRows = existingStats
    .filter((row) => row.memberType === 'trial' || row.memberType === 'guest' || /^（(?:试训|客串|待定)）/.test(row.displayName || ''))
    .map((row) => ({ row, identity: temporaryIdentity(row.memberType, row.displayName) }))
    .filter((entry): entry is { row: typeof existingStats[number]; identity: string } => Boolean(entry.identity))
  const shadowedRosterIds = new Set(players
    .filter((player) => player.memberType === 'trial' || player.memberType === 'guest')
    .filter((player) => matchOnlyRows.some((entry) => entry.identity === temporaryIdentity(player.memberType, player.displayName) && entry.row.playerId !== player.id))
    .map((player) => player.id))
  const initialRows: MatchStatInput[] = [
    ...players.filter((player) => !shadowedRosterIds.has(player.id)).map((player): MatchStatInput => {
      const existing = existingByPlayerId.get(player.id)
      const metadata = player.memberType === 'formal'
        ? { memberType: 'formal' as const }
        : { displayName: player.displayName, memberType: player.memberType }
      return existing
        ? { ...existing, ...metadata, playerId: player.id, played: true, goals: existing.goals, assists: existing.assists }
        : { playerId: player.id, ...metadata, played: false, goals: 0, assists: 0 }
    }),
    ...existingStats
      .filter((row) => !players.some((player) => player.id === row.playerId))
      .map((row): MatchStatInput => ({ ...row, played: true }))
  ]
  const [rows, setRows] = useState<MatchStatInput[]>(initialRows)
  const [temporaryName, setTemporaryName] = useState('')
  const [saving, setSaving] = useState(false)
  const [baselineVersion] = useState((match as MatchPublic & { version?: number }).version)
  const [homeScore, setHomeScore] = useState(match.homeScore === null ? '' : `${match.homeScore}`)
  const [awayScore, setAwayScore] = useState(match.awayScore === null ? '' : `${match.awayScore}`)
  const [conflictPending, setConflictPending] = useState(false)
  const [conflictSnapshot, setConflictSnapshot] = useState<{ version?: number; homeScore: number | null; awayScore: number | null; rows: MatchStatRecord[] } | null>(null)
  const [conflictReviewed, setConflictReviewed] = useState(false)
  const [refreshingConflict, setRefreshingConflict] = useState(false)
  const update = (playerId: string, patch: Partial<MatchStatInput>) => {
    setConflictReviewed(false)
    setRows((current) => current.map((row) => row.playerId === playerId ? { ...row, ...patch } : row))
  }
  const loadedApps = initialRows.filter((row) => row.played).length
  const hasIncompleteBaseline = typeof match.apps === 'number' && loadedApps !== match.apps
  const refreshConflictSnapshot = async () => {
    setRefreshingConflict(true)
    setConflictReviewed(false)
    try {
      const synced = await refresh(true)
      if (!synced) return
      const latestMatch = appService.getMatch(id) as MatchPublic & { version?: number }
      const latestRows = appService.listMatchStats(id)
      setConflictSnapshot({ version: latestMatch.version, homeScore: latestMatch.homeScore, awayScore: latestMatch.awayScore, rows: latestRows })
      Taro.showToast({ title: '已刷新，请核对', icon: 'none', duration: 2500 })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '刷新最新记录失败', icon: 'none', duration: 2500 })
    } finally {
      setRefreshingConflict(false)
    }
  }
  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      if (conflictPending && (!conflictSnapshot || !conflictReviewed)) {
        Taro.showToast({ title: '请刷新并核对云端最新记录后再提交', icon: 'none', duration: 2500 })
        return
      }
      if (!rows.some((row) => row.played)) {
        Taro.showToast({ title: '请先核对并录入本场出场球员', icon: 'none', duration: 2500 })
        return
      }
      if (hasIncompleteBaseline) {
        const confirmation = await Taro.showModal({
          title: '本场个人明细人数不一致',
          content: `比赛记录为${match.apps}人出场，当前载入${loadedApps}条个人出场明细。保存会覆盖本场全部个人数据，并重算全队榜单。请对照原始记录核对后再继续。`,
          confirmText: '确认继续',
          cancelText: '返回核对'
        })
        if (!confirmation.confirm) return
      }
      const score = { home: homeScore === '' ? null : Number(homeScore), away: awayScore === '' ? null : Number(awayScore) }
      await appService.publishStats(id, rows, score, conflictPending ? conflictSnapshot?.version : baselineVersion)
      Taro.showToast({ title: '赛后数据已发布', icon: 'success' })
      setTimeout(() => void Taro.redirectTo({ url: `/pages/matches/detail?id=${id}` }), 500)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'VERSION_CONFLICT') {
        setConflictPending(true)
        setConflictSnapshot(null)
        await refreshConflictSnapshot()
        return
      }
      Taro.showToast({ title: error instanceof Error ? error.message : '发布失败', icon: 'none', duration: 2500 })
    } finally {
      setSaving(false)
    }
  }
  const totals = rows.reduce((value, row) => ({ apps: value.apps + (row.played ? 1 : 0), goals: value.goals + row.goals, assists: value.assists + row.assists }), { apps: 0, goals: 0, assists: 0 })
  const teamGoals = match.homeScore === null ? totals.goals : match.homeScore
  const hasUnassignedTeamGoals = match.homeScore !== null && teamGoals !== totals.goals
  return (
    <PageShell>
      <PageHero eyebrow='POST MATCH' title='赛后数据' subtitle={match.title} midnight />
      <View className='content stack'>
        <View className={`notice ${totals.assists > teamGoals ? 'notice--danger' : ''}`}>
          <Text className='notice__title'>{totals.apps} 人出场 · {teamGoals} 球 · {totals.assists} 助攻{totals.assists > teamGoals ? ' · 数据异常' : ''}</Text>
          {!existingStats.length ? <Text>当前比赛没有已载入的个人明细。请按Excel核对实际出场人员后再发布。</Text> : null}
          {hasUnassignedTeamGoals ? <Text>球员明细记录{totals.goals}球，球队比分为{teamGoals}球，差额按赛事备注保留为乌龙球或凑脚球员进球。</Text> : null}
        </View>
        {conflictPending ? <View className='notice notice--warning'>
          <Text className='notice__title'>另一位管理员已保存了这场比赛</Text>
          <Text>你的未提交修改仍保留在表单里。刷新后的云端记录如下，请逐项核对后再重提。</Text>
          {conflictSnapshot ? <>
            <Text>云端当前记录{conflictSnapshot.version ? `（版本${conflictSnapshot.version}）` : ''}：{conflictSnapshot.rows.length}人出场 · {conflictSnapshot.rows.reduce((sum, row) => sum + row.goals, 0)}球 · {conflictSnapshot.rows.reduce((sum, row) => sum + row.assists, 0)}助攻；比分{conflictSnapshot.homeScore === null ? '未录入' : `${conflictSnapshot.homeScore}比${conflictSnapshot.awayScore}`}</Text>
            {conflictSnapshot.rows.map((row) => {
              const player = players.find((item) => item.id === row.playerId)
              const name = player?.displayName ?? row.displayName ?? '单场临时球员'
              return <Text key={`latest-${row.playerId}`}>{name}：{row.goals}球，{row.assists}助攻</Text>
            })}
            <Button className='button button--light' disabled={refreshingConflict} onClick={() => setConflictReviewed(true)}>{conflictReviewed ? '已核对，可重新提交' : '我已核对云端明细'}</Button>
          </> : <Text>尚未取得最新记录，先刷新后才能提交。</Text>}
          <Button className='button button--light' disabled={refreshingConflict} onClick={() => void refreshConflictSnapshot()}>{refreshingConflict ? '正在刷新…' : '刷新云端最新记录'}</Button>
        </View> : null}
        <View className='card form-card'>
          <Text className='section-heading__title'>比分（选填）</Text><View className='grid-2' style={{ marginTop: '18px' }}><Input className='field__input' type='number' value={homeScore} placeholder='本队' onInput={(e) => { setConflictReviewed(false); setHomeScore(e.detail.value) }} /><Input className='field__input' type='number' value={awayScore} placeholder='对手' onInput={(e) => { setConflictReviewed(false); setAwayScore(e.detail.value) }} /></View>
        </View>
        <View className='card card__body'>
          <Text className='section-heading__title'>单场凑脚球员</Text>
          <Input className='field__input' value={temporaryName} placeholder='填写姓名，记录本场数据' onInput={(event) => setTemporaryName(event.detail.value)} />
          <Button className='button button--light' onClick={() => {
            const name = temporaryName.trim()
            if (!name) return
            const displayName = `（客串）${name}`
            if (rows.some((row) => row.displayName === displayName)) {
              void Taro.showToast({ title: '该球员已在本场名单中', icon: 'none' })
              return
            }
            setRows((current) => [...current, { playerId: `match-guest-${Date.now()}`, displayName, memberType: 'guest', played: true, goals: 0, assists: 0 }])
            setConflictReviewed(false)
            setTemporaryName('')
          }}
          >添加凑脚球员（不计入球队榜单）</Button>
          <View className='post-match-stat-headings' aria-label='球员数据列说明'>
            <View className='post-match-stat-headings__player' />
            <Text className='post-match-stat-heading'>进球</Text>
            <Text className='post-match-stat-heading'>助攻</Text>
          </View>
          {rows.map((row) => {
            const player = players.find((item) => item.id === row.playerId)
            return <View className='list-row' key={row.playerId}>
              <Switch checked={row.played} color='#123BB4' onChange={(e) => update(row.playerId, { played: e.detail.value, goals: e.detail.value ? row.goals : 0, assists: e.detail.value ? row.assists : 0 })} />
              <View className='list-row__main'><Text className='list-row__title'>{player && player.memberType !== 'formal' && !/^（(?:试训|客串|待定)）/.test(player.displayName) ? `（${player.memberType === 'trial' ? '试训' : '客串'}）${player.displayName}` : player?.displayName ?? row.displayName ?? '已移出名册球员'}</Text><Text className='list-row__meta'>{row.played ? player?.memberType === 'formal' && match.countInStats !== false ? '实际出场 · 计入俱乐部榜单' : '单场出场 · 不计入俱乐部榜单' : '未出场'}</Text></View>
              <Input className='field__input' style={{ width: '88px', minHeight: '62px' }} disabled={!row.played} type='number' value={`${row.goals}`} onInput={(e) => update(row.playerId, { goals: Number(e.detail.value) || 0 })} />
              <Input className='field__input' style={{ width: '88px', minHeight: '62px' }} disabled={!row.played} type='number' value={`${row.assists}`} onInput={(e) => update(row.playerId, { assists: Number(e.detail.value) || 0 })} />
            </View>
          })}
        </View>
        <Button className='button button--primary' loading={saving} disabled={saving || totals.assists > totals.goals || (conflictPending && !conflictReviewed)} onClick={submit}>{conflictPending ? conflictReviewed ? '核对完成，重新提交' : '先刷新并核对云端记录' : '发布赛后数据并更新榜单'}</Button>
      </View>
    </PageShell>
  )
}
