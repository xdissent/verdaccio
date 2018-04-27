'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _utils = require('../../../lib/utils');

var _middleware = require('../../middleware');

var _async = require('async');

var _async2 = _interopRequireDefault(_async);

var _marked = require('marked');

var _marked2 = _interopRequireDefault(_marked);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function addPackageWebApi(route, storage, auth) {
  const can = (0, _middleware.allow)(auth);

  // Get list of all visible package
  route.get('/packages', function (req, res, next) {
    storage.getLocalDatabase(function (err, packages) {
      if (err) {
        // that function shouldn't produce any
        throw err;
      }

      _async2.default.filterSeries(packages, function (pkg, cb) {
        auth.allow_access(pkg.name, req.remote_user, function (err, allowed) {
          setImmediate(function () {
            if (err) {
              cb(null, false);
            } else {
              cb(err, allowed);
            }
          });
        });
      }, function (err, packages) {
        if (err) {
          throw err;
        }

        next((0, _utils.sortByName)(packages));
      });
    });
  });

  // Get package readme
  route.get('/package/readme/(@:scope/)?:package/:version?', can('access'), function (req, res, next) {
    const packageName = req.params.scope ? (0, _utils.addScope)(req.params.scope, req.params.package) : req.params.package;

    storage.getPackage({
      name: packageName,
      req,
      callback: function (err, info) {
        if (err) {
          return next(err);
        }

        res.set('Content-Type', 'text/plain');
        next((0, _marked2.default)(info.readme || 'ERROR: No README data found!'));
      }
    });
  });

  route.get('/sidebar/(@:scope/)?:package', function (req, res, next) {
    const packageName = req.params.scope ? (0, _utils.addScope)(req.params.scope, req.params.package) : req.params.package;

    storage.getPackage({
      name: packageName,
      keepUpLinkData: true,
      req,
      callback: function (err, info) {
        if (_lodash2.default.isNil(err)) {
          const sideBarInfo = _lodash2.default.clone(info);
          sideBarInfo.latest = info.versions[info[_utils.DIST_TAGS].latest];

          info = (0, _utils.deleteProperties)(['readme', 'versions'], sideBarInfo);
          info = (0, _utils.addGravatarSupport)(sideBarInfo);
          next(info);
        } else {
          res.status(404);
          res.end();
        }
      }
    });
  });
}

exports.default = addPackageWebApi;