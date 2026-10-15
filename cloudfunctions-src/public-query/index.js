const { db, command, ok, requireApproved, publicMatch, handleError } = require('./common')

const getPlayerAggregates = async (teamId) => {
  const result = await db.collection('player_match_stats').aggregate()
    .match({ teamId, countInStats: true, deletedAt: command.exists(false) })
    .group({
      _id: '$playerId',
      goals: command.aggregate.sum('$goals'),
      assists: command.aggregate.sum('$assists'),
      apps: command.aggregate.sum(1)
    })
    .end()
  return new Map(result.list.map((row) => [row._id, row]))
}

const withPlayerAggregate = (player, aggregates) => {
  const aggregate = aggregates.get(player._id)
  return {
    ...player,
    stats: {
      apps: Number(aggregate?.apps) || 0,
      goals: Number(aggregate?.goals) || 0,
      assists: Number(aggregate?.assists) || 0
    }
  }
}

exports.main = async (event) => {
  try {
    const payload = event.payload || {}
    const actor = await requireApproved()
    switch (event.action) {
      case 'getPublicHome': {
        const [matches, players, yearbook, aggregates] = await Promise.all([
          db.collection('matches').where({ teamId: actor.teamId, deletedAt: command.exists(false), status: command.in(['published', 'registration_closed', 'completed', 'completed_pending_score']) }).orderBy('matchDate', 'desc').limit(20).get(),
          db.collection('players').where({ teamId: actor.teamId, deletedAt: command.exists(false), memberType: 'formal' }).limit(200).get(),
          db.collection('yearbook_entries').where({ teamId: actor.teamId, deletedAt: command.exists(false), featured: true }).orderBy('date', 'desc').limit(6).get(),
          getPlayerAggregates(actor.teamId)
        ])
        const featuredPlayers = players.data.map((player) => withPlayerAggregate(player, aggregates))
          .sort((a, b) => b.stats.apps - a.stats.apps || a.displayName.localeCompare(b.displayName, 'zh-CN'))
          .slice(0, 6)
        return ok(event, { matches: matches.data.map(publicMatch), featuredPlayers, featuredYearbook: yearbook.data })
      }
      case 'listMatches': {
        const result = await db.collection('matches').where({ teamId: actor.teamId, deletedAt: command.exists(false), status: command.neq('draft') }).orderBy('matchDate', 'desc').limit(100).get()
        return ok(event, result.data.map(publicMatch))
      }
      case 'getMatch': {
        const result = await db.collection('matches').doc(payload.id).get()
        if (!result.data || result.data.teamId !== actor.teamId || result.data.status === 'draft' || result.data.deletedAt) return { ok: false, error: { code: 'MATCH_NOT_FOUND', message: '赛事不存在' }, requestId: event.requestId }
        return ok(event, publicMatch(result.data))
      }
      case 'listPlayers': {
        const [result, aggregates] = await Promise.all([
          db.collection('players').where({ teamId: actor.teamId, deletedAt: command.exists(false), memberType: 'formal' }).limit(200).get(),
          getPlayerAggregates(actor.teamId)
        ])
        const players = result.data.map((player) => withPlayerAggregate(player, aggregates))
          .sort((a, b) => b.stats.apps - a.stats.apps || a.displayName.localeCompare(b.displayName, 'zh-CN'))
        return ok(event, players.slice(0, 100))
      }
      case 'getPlayerProfile': {
        const [result, aggregates] = await Promise.all([
          db.collection('players').doc(payload.id).get(),
          getPlayerAggregates(actor.teamId)
        ])
        if (!result.data || result.data.teamId !== actor.teamId || result.data.deletedAt) throw Object.assign(new Error('球员不存在'), { code: 'PLAYER_NOT_FOUND' })
        return ok(event, withPlayerAggregate(result.data, aggregates))
      }
      case 'getYearbook': {
        const result = await db.collection('yearbook_entries').where({ teamId: actor.teamId, year: payload.year || 2026, deletedAt: command.exists(false) }).orderBy('date', 'desc').limit(100).get()
        return ok(event, result.data)
      }
      case 'getLeaderboard': {
        const field = ['apps', 'goals', 'assists'].includes(payload.metric) ? payload.metric : 'apps'
        const condition = { teamId: actor.teamId, deletedAt: command.exists(false), ...(payload.includeAll ? {} : { memberType: 'formal' }) }
        const [result, aggregates] = await Promise.all([
          db.collection('players').where(condition).limit(200).get(),
          getPlayerAggregates(actor.teamId)
        ])
        const players = result.data.map((player) => withPlayerAggregate(player, aggregates))
          .sort((a, b) => b.stats[field] - a.stats[field] || (field === 'apps' ? b.stats.apps - a.stats.apps : a.stats.apps - b.stats.apps) || a.displayName.localeCompare(b.displayName, 'zh-CN'))
        return ok(event, players.slice(0, 100))
      }
      default: throw Object.assign(new Error('未知公开查询'), { code: 'UNKNOWN_ACTION' })
    }
  } catch (error) { return handleError(event, error) }
}
