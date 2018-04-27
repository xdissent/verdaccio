'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (route, auth, storage, config) {
  const can = (0, _middleware.allow)(auth);
  // TODO: anonymous user?
  route.get('/:package/:version?', can('access'), function (req, res, next) {
    const getPackageMetaCallback = function (err, info) {
      if (err) {
        return next(err);
      }
      info = (0, _utils.filter_tarball_urls)(info, req, config);

      let queryVersion = req.params.version;
      if (_lodash2.default.isNil(queryVersion)) {
        return next(info);
      }

      let t = (0, _utils.get_version)(info, queryVersion);
      if (_lodash2.default.isNil(t) === false) {
        return next(t);
      }

      if (_lodash2.default.isNil(info[_utils.DIST_TAGS]) === false) {
        if (_lodash2.default.isNil(info[_utils.DIST_TAGS][queryVersion]) === false) {
          queryVersion = info[_utils.DIST_TAGS][queryVersion];
          t = (0, _utils.get_version)(info, queryVersion);
          if (_lodash2.default.isNil(t) === false) {
            return next(t);
          }
        }
      }
      return next(_utils.ErrorCode.get404('version not found: ' + req.params.version));
    };

    storage.getPackage({
      name: req.params.package,
      req,
      callback: getPackageMetaCallback
    });
  });

  route.get('/:package/-/:filename', can('access'), function (req, res) {
    const stream = storage.getTarball(req.params.package, req.params.filename);

    stream.on('content-length', function (content) {
      res.header('Content-Length', content);
    });
    stream.on('error', function (err) {
      return res.report_error(err);
    });
    res.header('Content-Type', 'application/octet-stream');
    stream.pipe(res);
  });
};

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _middleware = require('../../middleware');

var _utils = require('../../../lib/utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }