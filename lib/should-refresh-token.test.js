const { shouldRefreshToken } = require('./should-refresh-token')

const newUser = receivedAt => ({
  services: {
    u5auth: {
      receivedAt
    }
  }
})

const newConfig = ttl => ({
  ttl
})

describe('shouldRefreshToken', () => {
  const now = new Date()
  it('says "no" for newly created token', () => {
    expect(shouldRefreshToken(newUser(now), newConfig(10), now)).toBeFalsy()
  })
  it('says "no" for token expiring 90% of ttl or less', () => {
    expect(
      shouldRefreshToken(
        newUser(now), newConfig(10), new Date(now.getTime() + 9 * 1000 - 1)
      )
    ).toBeFalsy()
    expect(
      shouldRefreshToken(
        newUser(now), newConfig(10), new Date(now.getTime() + 9 * 1000)
      )
    ).toBeFalsy()
  })
  it('says "yes" for token expiring in more than 90% of ttl', () => {
    expect(shouldRefreshToken(
      newUser(now), newConfig(10), new Date(now.getTime() + 9 * 1000 + 1)
      )
    ).toBeTruthy()
  })
})