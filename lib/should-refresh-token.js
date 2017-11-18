const { service } = require('./service-name')

exports.shouldRefreshToken = (user, config, now = new Date()) =>
  user.services[service].receivedAt < (now.getTime() - 0.9 * 1000 * Number(config.ttl))
