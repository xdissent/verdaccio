'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

var _httpErrors = require('http-errors');

var _httpErrors2 = _interopRequireDefault(_httpErrors);

var _compression = require('compression');

var _compression2 = _interopRequireDefault(_compression);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _cors = require('cors');

var _cors2 = _interopRequireDefault(_cors);

var _storage = require('../lib/storage');

var _storage2 = _interopRequireDefault(_storage);

var _pluginLoader = require('../lib/plugin-loader');

var _debug = require('./debug');

var _debug2 = _interopRequireDefault(_debug);

var _auth = require('../lib/auth');

var _auth2 = _interopRequireDefault(_auth);

var _endpoint = require('./endpoint');

var _endpoint2 = _interopRequireDefault(_endpoint);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const LoggerApp = require('../lib/logger');
const Config = require('../lib/config');
const Middleware = require('./middleware');
const Cats = require('../lib/status-cats');

const defineAPI = function (config, storage) {
  const auth = new _auth2.default(config);
  const app = (0, _express2.default)();
  // run in production mode by default, just in case
  // it shouldn't make any difference anyway
  app.set('env', process.env.NODE_ENV || 'production');
  app.use((0, _cors2.default)());

  // Router setup
  app.use(Middleware.log);
  app.use(Middleware.errorReportingMiddleware);
  app.use(function (req, res, next) {
    res.setHeader('X-Powered-By', config.user_agent);
    next();
  });
  app.use(Cats.middleware);
  app.use((0, _compression2.default)());

  app.get('/favicon.ico', function (req, res, next) {
    req.url = '/-/static/favicon.png';
    next();
  });

  // Hook for tests only
  if (config._debug) {
    (0, _debug2.default)(app, config.self_path);
  }

  // register middleware plugins
  const plugin_params = {
    config: config,
    logger: LoggerApp.logger
  };
  const plugins = (0, _pluginLoader.loadPlugin)(config, config.middlewares, plugin_params, function (plugin) {
    return plugin.register_middlewares;
  });
  plugins.forEach(function (plugin) {
    plugin.register_middlewares(app, auth, storage);
  });

  // For  npm request
  app.use((0, _endpoint2.default)(config, auth, storage));

  // For WebUI & WebUI API
  if (_lodash2.default.get(config, 'web.enable', true)) {
    app.use('/', require('./web')(config, auth, storage));
    app.use('/-/verdaccio/', require('./web/api')(config, auth, storage));
  } else {
    app.get('/', function (req, res, next) {
      next(_httpErrors2.default[404]('Web interface is disabled in the config file'));
    });
  }

  // Catch 404
  app.get('/*', function (req, res, next) {
    next(_httpErrors2.default[404]('File not found'));
  });

  app.use(function (err, req, res, next) {
    if (_lodash2.default.isError(err)) {
      if (err.code === 'ECONNABORT' && res.statusCode === 304) {
        return next();
      }
      if (_lodash2.default.isFunction(res.report_error) === false) {
        // in case of very early error this middleware may not be loaded before error is generated
        // fixing that
        Middleware.errorReportingMiddleware(req, res, _lodash2.default.noop);
      }
      res.report_error(err);
    } else {
      // Fall to Middleware.final
      return next(err);
    }
  });

  app.use(Middleware.final);

  return app;
};

exports.default = (() => {
  var _ref = _asyncToGenerator(function* (configHash) {
    LoggerApp.setup(configHash.logs);
    const config = new Config(configHash);
    const storage = new _storage2.default(config);
    // waits until init calls have been intialized
    yield storage.init(config);
    return defineAPI(config, storage);
  });

  return function (_x) {
    return _ref.apply(this, arguments);
  };
})();