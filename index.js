const invariant = require('invariant')

// try to depend on a Meteor core package
const r = require

// this will crash, unless `meteor add accounts-base` has been done in the project?
// TODO: issue meaningful error in case of error or null
const accountsBase = r('meteor/accounts-base')
const ServiceConfiguration = r('meteor/service-configuration').ServiceConfiguration

exports.sayHello = function() {
  console.log('Hello from meteor-u5auth')
}

const loginStyle = 'redirect' // that's all we offer
const service = 'u5auth'

Accounts.oauth.registerService(service)

const getConfig = function() {
  const config = ServiceConfiguration.configurations.findOne({ service })
  invariant(config.issuer, 'Must provide "issuer" in u5auth config, see documentation of package "meteor-u5auth"')
  if (!config)
    throw new ServiceConfiguration.ConfigError(service);
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
      return callback(new ServiceConfiguration.ConfigError(service))
    }

    const credentialToken = Random.secret()
    const loginUrl = determineLoginUrl(config, credentialToken)
    console.log('loginUrl', loginUrl)
    OAuth.launchLogin({
      loginService: 'u5auth',
      loginStyle,
      loginUrl,
      credentialRequestCompleteCallback: callback,
      credentialToken
    })
  }
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

    console.log('about to getToken', query)
    const tokens = getToken(query)
    console.log('tokens', tokens)
    const identity = getIdentity(tokens.access_token)
    console.log('identity', identity)
  
    const serviceData = {
      id: identity.sub,
      accessToken: OAuth.sealSecret(tokens.access_token),
      refreshToken: OAuth.sealSecret(tokens.refresh_token),
      email: identity.sub,
      username: identity.sub
    }
    Object.keys(identity).forEach(key => {
      serviceData[key] = identity[key]
    })
    console.log('serviceData', serviceData)
    
    return {
      serviceData: serviceData,
      options: {profile: identity}
    }
  })
}
