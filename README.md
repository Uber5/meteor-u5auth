# OAuth2 Authentication for Meteor, With Your Own Provider

Add Oauth2 authentication to your Meteor app, supports Meteor 1.5+


# Setup

1) Add required dependencies:

```sh
meteor add accounts-base accounts-oauth service-configuration \
  random oauth oauth2 http
meteor npm add meteor-u5auth
```

2) Configure Service

Add (or update) a
[service configuration](https://docs.meteor.com/v1.4.4/api/accounts.html#service-configuration)
for the `u5auth` service (on the _server side_ only, so keep it in the
`./server` directory):

```javascript
import { getLiveToken, setU5AuthDebug } from 'meteor-u5auth'

Meteor.startup(() => {

  if ()
  ServiceConfiguration.configurations.upsert({
    service: 'u5auth'
  }, {
    $set: {
      clientId: process.env.OAUTH2_ID || 'your-client-id',
      secret: process.env.OAUTH2_SECRET || 'your-client-secret',
      issuer: process.env.OAUTH2_SITE || 'https://my-oauth2-service.com',
      requestPermissions: [ 'email', 'userinfo', 'phone_number', 'sub' ],
      ttl: 60 /* minutes */ * 60 /* seconds */
    }
  })

})
```

* `clientId` and `secret` must be issued by your OAuth2 provider.
* `issuer` is the url pointing at your auth provider.
* Ensure the `ttl` is in line with the expiry of your tokens,
  1 hour in the code snippet above. The `ttl` will be used to get a new token,
  if 90% of the ttl have passed.
* `requestPermissions` are the
  [scopes](https://tools.ietf.org/html/rfc6749#section-3.3) you request with
  the token.
* It is good practice to keep live/production secrets out of the code.
  Therefore, you may want to use the approach using environment variables demonstrated above (`secret: process.env.OAUTH2_SECRET || 'test-secret'`).

# Usage

## Logging In

On the client, use `Meteor.loginWithU5Auth()`:

```javascript
Meteor.loginWithU5Auth({}, err => {
  if (err) {
    throw err
  }
})
```

## Logging Out

Use [`Meteor.logoug`](https://docs.meteor.com/v1.4.4/api/accounts.html#Meteor-logout):

```javascript
Meteor.logout()
```

This may not destroy your session at the auth provider. As a result, the next
login attempt may authorize you without prompting for (another) user/password.
In order to fully log out, you may have to make an additional call (via Ajax?)
to your auth provider.

## Get Token

The OAuth2 token received during login can be used to make calls to other APIs or
services that support your auth provider. The token can be used both client and
server side like this:

```javascript
import { getLiveToken } from 'meteor-u5auth'

function someFunction() {
  getLiveToken().then(token => {
    // now use the token
    ...
  })
}
```

Only use `getLiveToken` when you know the user is logged in. If in doubt,
check e.g. if `Meteor.user()` is available.

`getLiveToken` will ensure that the token is not expired, i.e. it will refresh the access token (via the refresh token, if available) before resolving the promise.

## Userinfo

The userinfo provided by the auth provider is available as:

```javascript
Meteor.user().profile
```

## Refresh Userinfo

In order to ensure userinfo is up-to-date, call `refreshUserinfo`:

```javascript
import { refreshUserinfo } from 'meteor-u5auth'

function someFunction() {
  refreshUserinfo().then(() => console.log('refreshed'))
}
```

Now `Meteor.user().profile` will have updated details from the auth provider.

# Debug

In order to debug anything related to this package, call `setU5AuthDebug`
on the server:

```javascript
import { setU5AuthDebug } from 'meteor-u5auth'

Meteor.startup(() => {
  setU5AuthDebug()
}
```

The server logs will now contain a detailed log under a prefix. Beware,
though, that access tokens and refresh tokens are then logged in
verbatim, which may be a security risk.