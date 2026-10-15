import { z } from 'zod'

export const matchStatusSchema = z.enum(['draft', 'published', 'registration_closed', 'completed_pending_score', 'completed', 'cancelled'])
export const roleSchema = z.enum(['visitor', 'player', 'admin', 'owner'])
export const signupChoiceSchema = z.enum(['attending', 'maybe', 'absent'])

export const matchInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  opponent: z.string().trim().max(40).optional(),
  eventType: z.enum(['versus', 'event']),
  matchDate: z.iso.date(),
  kickoffTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  publicArea: z.string().trim().max(40).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  capacityEnabled: z.boolean().default(false),
  capacity: z.number().int().min(1).max(40),
  format: z.enum(['5-a-side', '7-a-side', '8-a-side', '11-a-side', 'custom']),
  jerseyRequirement: z.enum(['home', 'away', 'custom']).optional(),
  jerseyCustomNote: z.string().trim().max(60).optional(),
  exactLocation: z.string().trim().min(1).max(120),
  gatheringTime: z.string().regex(/^\d{2}:\d{2}$/),
  countInStats: z.boolean(),
  status: matchStatusSchema
})

export const signupInputSchema = z.object({
  matchId: z.string().min(1),
  playerId: z.string().min(1),
  choice: signupChoiceSchema,
  signupType: z.enum(['self', 'trial_companion', 'guest_companion']).default('self'),
  companionName: z.string().trim().max(30).optional(),
  note: z.string().max(100).default(''),
  expectedVersion: z.number().int().nonnegative().optional()
})

export const matchStatRowSchema = z.object({
  playerId: z.string().min(1),
  played: z.boolean(),
  goals: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative()
})

export const publishStatsSchema = z.object({
  matchId: z.string().min(1),
  rows: z.array(matchStatRowSchema).max(40),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  expectedVersion: z.number().int().nonnegative()
}).superRefine((value, context) => {
  if ((value.homeScore === null) !== (value.awayScore === null)) {
    context.addIssue({ code: 'custom', message: '两个比分必须同时填写或同时留空', path: ['homeScore'] })
  }
})
