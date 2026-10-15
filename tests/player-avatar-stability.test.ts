import { describe, expect, it } from 'vitest'
import { playerAvatarFallback } from '@/utils/playerAvatar'

describe('球员头像稳定性', () => {
  it('资料姓名缺失时仍可渲染占位头像', () => {
    expect(playerAvatarFallback(undefined)).toBe('—')
    expect(playerAvatarFallback('袁梓皓')).toBe('袁')
  })
})
