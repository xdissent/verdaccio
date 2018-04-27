'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _pluginLoader = require('../lib/plugin-loader');

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _jsonwebtoken = require('jsonwebtoken');

var _jsonwebtoken2 = _interopRequireDefault(_jsonwebtoken);

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const LoggerApi = require('./logger');
/**
 * Handles the authentification, load auth plugins.
 */
class Auth {

  constructor(config) {
    this.config = config;
    this.logger = LoggerApi.logger.child({ sub: 'auth' });
    this.secret = config.secret;
    this.plugins = this._loadPlugin(config);
    this._applyDefaultPlugins();
  }

  _loadPlugin(config) {
    const plugin_params = {
      config,
      logger: this.logger
    };

    return (0, _pluginLoader.loadPlugin)(config, config.auth, plugin_params, function (p) {
      return p.authenticate || p.allow_access || p.allow_publish;
    });
  }

  _applyDefaultPlugins() {
    const allow_action = function (action) {
      return function (user, pkg, cb) {
        let ok = pkg[action].reduce(function (prev, curr) {
          if (user.name === curr || user.groups.indexOf(curr) !== -1) return true;
          return prev;
        }, false);

        if (ok) {
          return cb(null, true);
        }

        if (user.name) {
          cb(_utils.ErrorCode.get403('user ' + user.name + ' is not allowed to ' + action + ' package ' + pkg.name));
        } else {
          cb(_utils.ErrorCode.get403('unregistered users are not allowed to ' + action + ' package ' + pkg.name));
        }
      };
    };

    this.plugins.push({
      authenticate: function (user, password, cb) {
        cb(_utils.ErrorCode.get403('bad username/password, access denied'));
      },

      add_user: function (user, password, cb) {
        return cb(_utils.ErrorCode.get409('bad username/password, access denied'));
      },

      allow_access: allow_action('access'),
      allow_publish: allow_action('publish')
    });
  }

  authenticate(user, password, cb) {
    const plugins = this.plugins.slice(0);(function next() {
      let p = plugins.shift();

      if (typeof p.authenticate !== 'function') {
        return next();
      }

      p.authenticate(user, password, function (err, groups) {
        if (err) {
          return cb(err);
        }

        // Expect: SKIP if groups is falsey and not an array
        //         with at least one item (truthy length)
        // Expect: CONTINUE otherwise (will error if groups is not
        //         an array, but this is current behavior)
        // Caveat: STRING (if valid) will pass successfully
        //         bug give unexpected results
        // Info: Cannot use `== false to check falsey values`
        if (!!groups && groups.length !== 0) {
          // TODO: create a better understanding of expectations
          if (typeof groups === 'string') {
            throw new TypeError('invalid type for function');
          }
          return cb(err, authenticatedUser(user, groups));
        }
        next();
      });
    })();
  }

  add_user(user, password, cb) {
    let self = this;
    let plugins = this.plugins.slice(0);(function next() {
      let p = plugins.shift();
      let n = 'adduser';
      if (typeof p[n] !== 'function') {
        n = 'add_user';
      }
      if (typeof p[n] !== 'function') {
        next();
      } else {
        // p.add_user() execution
        p[n](user, password, function (err, ok) {
          if (err) {
            return cb(err);
          }
          if (ok) {
            return self.authenticate(user, password, cb);
          }
          next();
        });
      }
    })();
  }

  /**
   * Allow user to access a package.
   */
  allow_access(packageName, user, callback) {
    let plugins = this.plugins.slice(0);
    // $FlowFixMe
    let pkg = Object.assign({ name: packageName }, this.config.getMatchedPackagesSpec(packageName));

    (function next() {
      let p = plugins.shift();

      if (typeof p.allow_access !== 'function') {
        return next();
      }

      p.allow_access(user, pkg, function (err, ok) {

        if (err) {
          return callback(err);
        }

        if (ok) {
          return callback(null, ok);
        }

        next(); // cb(null, false) causes next plugin to roll
      });
    })();
  }

  /**
   * Allow user to publish a package.
   */
  allow_publish(packageName, user, callback) {
    let plugins = this.plugins.slice(0);
    // $FlowFixMe
    let pkg = Object.assign({ name: packageName }, this.config.getMatchedPackagesSpec(packageName));

    (function next() {
      let p = plugins.shift();

      if (typeof p.allow_publish !== 'function') {
        return next();
      }

      p.allow_publish(user, pkg, function (err, ok) {
        if (err) return callback(err);
        if (ok) return callback(null, ok);
        next(); // cb(null, false) causes next plugin to roll
      });
    })();
  }

  /**
   * Set up a basic middleware.
   * @return {Function}
   */
  basic_middleware() {
    let self = this;
    let credentials;
    return function (req, res, _next) {
      req.pause();

      const next = function (err) {
        req.resume();
        // uncomment this to reject users with bad auth headers
        // return _next.apply(null, arguments)

        // swallow error, user remains unauthorized
        // set remoteUserError to indicate that user was attempting authentication
        if (err) {
          req.remote_user.error = err.message;
        }
        return _next();
      };

      if (req.remote_user != null && req.remote_user.name !== undefined) {
        return next();
      }
      req.remote_user = buildAnonymousUser();

      let authorization = req.headers.authorization;
      if (authorization == null) {
        return next();
      }

      let parts = authorization.split(' ');

      if (parts.length !== 2) {
        return next(_utils.ErrorCode.get400('bad authorization header'));
      }

      const scheme = parts[0];
      if (scheme === 'Basic') {
        credentials = new Buffer(parts[1], 'base64').toString();
      } else if (scheme === 'Bearer') {
        credentials = self.aes_decrypt(new Buffer(parts[1], 'base64')).toString('utf8');
        if (!credentials) {
          return next();
        }
      } else {
        return next();
      }

      const index = credentials.indexOf(':');
      if (index < 0) {
        return next();
      }

      const user = credentials.slice(0, index);
      const pass = credentials.slice(index + 1);

      self.authenticate(user, pass, function (err, user) {
        if (!err) {
          req.remote_user = user;
          next();
        } else {
          req.remote_user = buildAnonymousUser();
          next(err);
        }
      });
    };
  }

  /**
   * Set up the bearer middleware.
   * @return {Function}
   */
  bearer_middleware() {
    let self = this;
    return function (req, res, _next) {
      req.pause();
      const next = function (_err) {
        req.resume();
        /* eslint prefer-spread: "off" */
        /* eslint prefer-rest-params: "off" */
        return _next.apply(null, arguments);
      };

      if (req.remote_user != null && req.remote_user.name !== undefined) {
        return next();
      }
      req.remote_user = buildAnonymousUser();

      let authorization = req.headers.authorization;
      if (authorization == null) {
        return next();
      }

      let parts = authorization.split(' ');

      if (parts.length !== 2) {
        return next(_utils.ErrorCode.get400('bad authorization header'));
      }

      let scheme = parts[0];
      let token = parts[1];

      if (scheme !== 'Bearer') {
        return next();
      }
      let user;
      try {
        user = self.decode_token(token);
      } catch (err) {
        return next(err);
      }

      req.remote_user = authenticatedUser(user.u, user.g);
      // $FlowFixMe
      req.remote_user.token = token;
      next();
    };
  }

  /**
   * JWT middleware for WebUI
   */
  jwtMiddleware() {
    return (req, res, _next) => {
      if (req.remote_user !== null && req.remote_user.name !== undefined) {
        return _next();
      }

      req.pause();
      const next = function (_err) {
        req.resume();
        return _next();
      };

      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) {
        return next();
      }

      let decoded;
      try {
        decoded = this.decode_token(token);
      } catch (err) {
        // FIXME: intended behaviour, do we want it?
      }

      if (decoded) {
        req.remote_user = authenticatedUser(decoded.user, decoded.group);
      } else {
        req.remote_user = buildAnonymousUser();
      }

      next();
    };
  }

  /**
   * Generates the token.
   * @param {object} user
   * @param {string} expire_time
   * @return {string}
   */
  issue_token(user, expire_time) {
    return _jsonwebtoken2.default.sign({
      user: user.name,
      group: user.real_groups && user.real_groups.length ? user.real_groups : undefined
    }, this.secret, {
      notBefore: '1000', // Make sure the time will not rollback :)
      expiresIn: expire_time || '7d'
    });
  }

  /**
   * Decodes the token.
   * @param {*} token
   * @return {Object}
   */
  decode_token(token) {
    let decoded;
    try {
      decoded = _jsonwebtoken2.default.verify(token, this.secret);
    } catch (err) {
      throw _utils.ErrorCode.getCode(401, err.message);
    }

    return decoded;
  }

  /**
   * Encrypt a string.
   */
  aes_encrypt(buf) {
    const c = _crypto2.default.createCipher('aes192', this.secret);
    const b1 = c.update(buf);
    const b2 = c.final();
    return Buffer.concat([b1, b2]);
  }

  /**
    * Dencrypt a string.
   */
  aes_decrypt(buf) {
    try {
      const c = _crypto2.default.createDecipher('aes192', this.secret);
      const b1 = c.update(buf);
      const b2 = c.final();
      return Buffer.concat([b1, b2]);
    } catch (_) {
      return new Buffer(0);
    }
  }
}

/**
 * Builds an anonymous user in case none is logged in.
 * @return {Object} { name: xx, groups: [], real_groups: [] }
 */
function buildAnonymousUser() {
  return {
    name: undefined,
    // groups without '$' are going to be deprecated eventually
    groups: ['$all', '$anonymous', '@all', '@anonymous'],
    real_groups: []
  };
}

/**
 * Authenticate an user.
 * @return {Object} { name: xx, groups: [], real_groups: [] }
 */
function authenticatedUser(name, groups) {
  let _groups = (groups || []).concat(['$all', '$authenticated', '@all', '@authenticated', 'all']);
  return {
    name: name,
    groups: _groups,
    real_groups: groups
  };
}

exports.default = Auth;