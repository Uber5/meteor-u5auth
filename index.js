const invariant = require('invariant')
const { shouldRefreshToken } = require('./lib/should-refresh-token')
const { service } = require('./lib/service-name')

// try to depend on a Meteor core package
const r = require

// this will crash, unless `meteor add accounts-base` has been done in the project?
// TODO: this seemed to work when using 'npm link', but not when installing from npm?
//const accountsBase = r('meteor/accounts-base')
//const ServiceConfiguration = r('meteor/service-configuration').ServiceConfiguration

const loginStyle = 'redirect' // that's all we offer

let _debug = false
exports.setU5AuthDebug = () => _debug = true

const log = function() {
  if (!_debug) {
    return
  }
  console.log.apply(this, [ 'meteor-u5auth DEBUG' ].concat(Array.prototype.slice.call(arguments)))
}

Accounts.oauth.registerService(service)

const validateConfig = config => {
  const keys = Meteor.isServer ? [ 'clientId', 'issuer', 'secret' ] : [ 'clientId', 'issuer']
  keys.forEach(key => {
    invariant(
      config[key],
      `Must provide "${key}" in u5auth config, see documentation of package "meteor-u5auth"`
    )
  })
  invariant(
    config.ttl && Number(config.ttl) > 0,
    'Must provide "ttl" in u5auth config, e.g. 3600 (seconds) for 60 minutes.'
  )
  return true
}

const getConfig = function() {
  const config = ServiceConfiguration.configurations.findOne({ service })
  if (!config || !validateConfig(config)) {
    throw new ServiceConfiguration.ConfigError(service)
  }
  return config
}

const determineLoginUrl = (config, code) => {
  // TODO: validate
  const flatScope = (config.requestPermissions || []).map(encodeURIComponent).join('+')
  const redirectUri = OAuth._redirectUri(service, config)
  return config.issuer + '/authorize' +
    '?client_id=' + config.clientId +
    '&scope=' + flatScope +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&state=' + OAuth._stateParam(loginStyle, code)
}

if (Meteor.isClient) {
  Meteor.loginWithU5Auth = function(options, callback) {

    let config
    try {
      config = getConfig()
    } catch(e) {
      console.error(e)
      return callback(new ServiceConfiguration.ConfigError(service))
    }

    const credentialToken = Random.secret()
    const loginUrl = determineLoginUrl(config, credentialToken)
    log('loginUrl', loginUrl)
    OAuth.launchLogin({
      loginService: 'u5auth',
      loginStyle,
      loginUrl,
      credentialRequestCompleteCallback: callback,
      credentialToken
    })
  }

  const callMethodNoArgs = method => () => new Promise((resolve, reject) => {
    Meteor.call(method, (err, result) => {
      if (err) {
        return reject(err)
      } else {
        resolve(result)
      }
    })
  })

  exports.getLiveToken = callMethodNoArgs('meteor-u5auth/getLiveToken')
  exports.refreshUserinfo = callMethodNoArgs('meteor-u5auth/refreshUserinfo')

}

if (Meteor.isServer) {

  // http://developer.github.com/v3/#user-agent-required
  let userAgent = "Meteor"
  if (Meteor.release) {
    userAgent += "/" + Meteor.release
  }

  const getToken = function (query) {
    const config = getConfig()

    var response
    try {
      response = HTTP.post(
        config.issuer + "/token", {
          headers: {
            Accept: 'application/json',
            "User-Agent": userAgent
          },
          params: {
            code: query.code,
            client_id: config.clientId,
            grant_type: 'authorization_code',
            client_secret: OAuth.openSecret(config.secret),
            redirect_uri: OAuth._redirectUri('mitre', config),
            state: query.state
          }
        });
    } catch (err) {
      throw _.extend(new Error("Unable to receive token (u5auth). " + err.message),
                    {response: err.response})
    }
    if (response.data.error) { // if the http response was a json object with an error attribute
      throw new Error("Error when receiving token: " + response.data.error)
    } else {
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token
      };
    }
  }

  const getIdentity = function (accessToken) {
    try {
      return HTTP.get(
        getConfig().issuer + "/userinfo", {
          headers: {
            "User-Agent": userAgent, // http://developer.github.com/v3/#user-agent-required
            authorization: 'Bearer ' + accessToken
          }
        }).data;
    } catch (err) {
      throw _.extend(new Error("u5auth: failed to query /userinfo: " + err.message),
                     {response: err.response});
    }
  }

  OAuth.registerService(service, 2, null, query => {

    log('about to getToken', query)
    const tokens = getToken(query)
    log('tokens', tokens)
    const identity = getIdentity(tokens.access_token)
    log('identity', identity)
  
    const serviceData = {
      id: identity.sub,
      accessToken: OAuth.sealSecret(tokens.access_token),
      refreshToken: OAuth.sealSecret(tokens.refresh_token),
      receivedAt: new Date().getTime()
    }
    Object.assign(serviceData, identity)
    log('serviceData', serviceData)

    return {
      serviceData: serviceData,
      options: {
        profile: identity
      }
    }
  })

  const refreshToken = async (user, config) => {

    log('about to refresh token, user', user)

    const body = 'grant_type=refresh_token' +
      '&refresh_token=' + user.services[service].refreshToken +
      '&client_id=' + config.clientId +
      '&client_secret=' + OAuth.openSecret(config.secret);
    const response = HTTP.post(
      config.issuer + "/token", {
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      content: body
    });
    log('refreshToken, response', response)
    const serviceData = response.data
    Meteor.users.update({
      _id: user._id
    }, {
      $set: {
        [`services.${service}.accessToken`]: serviceData.access_token,
        [`services.${service}.refreshToken`]: serviceData.refresh_token,
        [`services.${service}.receivedAt`]: new Date().getTime()
      }
    })
    log('token refreshed, user', user)

  }

  const getLiveToken = () => new Promise((resolve, reject) => {
    const user = Meteor.user()
    if (!user) {
      return reject(new Meteor.Error('logged-out'))
    }
    log('getLiveToken, user', user)
    const config = getConfig()
    if (shouldRefreshToken(user, config)) {
      return refreshToken(user, config)
        .then(() => resolve(Meteor.user().services[service].accessToken))
        .catch(err => {
          // if we can't refresh, we have to log out
          Meteor.users.update({ // TODO: we remove service details, this may be unnecessary
            _id: user._id
          }, {
            $set: {
              [`services.${service}`]: null,
            }
          })
          Meteor.logout()
          return reject(new Meteor.Error('logged-out'))
        })
    } else {
      return resolve(user.services[service].accessToken)
    }
  })

  Meteor.methods({
    'meteor-u5auth/getLiveToken': async () => {
      return await getLiveToken()
    },
    'meteor-u5auth/refreshUserinfo': () => {
      const userId = Meteor.user()._id
      const token = Promise.await(getLiveToken())
      const userinfo = getIdentity(token)
      log('refreshUserinfo, userId, userinfo', userId, userinfo)
      const op = {
        $set: {}
      }
      Object.keys(userinfo).forEach(key => {
        op.$set[`services.${service}.${key}`] = userinfo[key]
      })
      log('refreshUserinfo, op', op)
      Meteor.users.update(
        {
          _id: userId
        },
        op
      )
      log('token refreshed, userId', userId)
    }
  })

  exports.getLiveToken = getLiveToken

}
