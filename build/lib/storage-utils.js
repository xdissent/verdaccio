'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.resourceNotAvailable = exports.pkgFileName = exports.noSuchFile = exports.fileExist = exports.DEFAULT_REVISION = exports.cleanUpReadme = exports.generateRevision = exports.normalizePackage = exports.generatePackageTemplate = exports.WHITELIST = undefined;
exports.cleanUpLinksRef = cleanUpLinksRef;
exports.checkPackageLocal = checkPackageLocal;
exports.publishPackage = publishPackage;
exports.checkPackageRemote = checkPackageRemote;

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _utils = require('./utils');

var _search = require('./search');

var _search2 = _interopRequireDefault(_search);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const pkgFileName = 'package.json';
const fileExist = 'EEXISTS';
const noSuchFile = 'ENOENT';
const resourceNotAvailable = 'EAGAIN';
const DEFAULT_REVISION = `0-0000000000000000`;

const generatePackageTemplate = function (name) {
  return {
    // standard things
    name,
    versions: {},
    'dist-tags': {},
    time: {},
    _distfiles: {},
    _attachments: {},
    _uplinks: {},
    _rev: ''
  };
};

/**
 * Normalise package properties, tags, revision id.
 * @param {Object} pkg package reference.
 */
function normalizePackage(pkg) {
  const pkgProperties = ['versions', 'dist-tags', '_distfiles', '_attachments', '_uplinks', 'time'];

  pkgProperties.forEach(key => {
    if (_lodash2.default.isNil((0, _utils.isObject)(pkg[key]))) {
      pkg[key] = {};
    }
  });

  if (_lodash2.default.isString(pkg._rev) === false) {
    pkg._rev = DEFAULT_REVISION;
  }

  // normalize dist-tags
  (0, _utils.normalizeDistTags)(pkg);

  return pkg;
}

function generateRevision(rev) {
  const _rev = rev.split('-');

  return (+_rev[0] || 0) + 1 + '-' + _crypto2.default.pseudoRandomBytes(8).toString('hex');
}

function cleanUpReadme(version) {
  if (_lodash2.default.isNil(version) === false) {
    delete version.readme;
  }

  return version;
}

const WHITELIST = exports.WHITELIST = ['_rev', 'name', 'versions', _utils.DIST_TAGS, 'readme', 'time'];

function cleanUpLinksRef(keepUpLinkData, result) {
  const propertyToKeep = [...WHITELIST];
  if (keepUpLinkData === true) {
    propertyToKeep.push('_uplinks');
  }

  for (let i in result) {
    if (propertyToKeep.indexOf(i) === -1) {
      // Remove sections like '_uplinks' from response
      delete result[i];
    }
  }

  return result;
}

/**
 * Check whether a package it is already a local package
 * @param {*} name
 * @param {*} localStorage
 */
function checkPackageLocal(name, localStorage) {
  return new Promise((resolve, reject) => {
    localStorage.getPackageMetadata(name, (err, results) => {
      if (!_lodash2.default.isNil(err) && err.status !== 404) {
        return reject(err);
      }
      if (results) {
        return reject(_utils.ErrorCode.get409('this package is already present'));
      }
      return resolve();
    });
  });
}

function publishPackage(name, metadata, localStorage) {
  return new Promise((resolve, reject) => {
    localStorage.addPackage(name, metadata, (err, latest) => {
      if (!_lodash2.default.isNull(err)) {
        return reject(err);
      } else if (!_lodash2.default.isUndefined(latest)) {
        _search2.default.add(latest);
      }
      return resolve();
    });
  });
}

function checkPackageRemote(name, isAllowPublishOffline, syncMetadata) {
  return new Promise((resolve, reject) => {
    // $FlowFixMe
    syncMetadata(name, null, {}, (err, packageJsonLocal, upLinksErrors) => {

      // something weird
      if (err && err.status !== 404) {
        return reject(err);
      }

      // checking package exist already
      if (_lodash2.default.isNil(packageJsonLocal) === false) {
        return reject(_utils.ErrorCode.get409('this package is already present'));
      }

      for (let errorItem = 0; errorItem < upLinksErrors.length; errorItem++) {
        // checking error
        // if uplink fails with a status other than 404, we report failure
        if (_lodash2.default.isNil(upLinksErrors[errorItem][0]) === false) {
          if (upLinksErrors[errorItem][0].status !== 404) {

            if (isAllowPublishOffline) {
              return resolve();
            }

            return reject(_utils.ErrorCode.get503('one of the uplinks is down, refuse to publish'));
          }
        }
      }

      return resolve();
    });
  });
}

exports.generatePackageTemplate = generatePackageTemplate;
exports.normalizePackage = normalizePackage;
exports.generateRevision = generateRevision;
exports.cleanUpReadme = cleanUpReadme;
exports.DEFAULT_REVISION = DEFAULT_REVISION;
exports.fileExist = fileExist;
exports.noSuchFile = noSuchFile;
exports.pkgFileName = pkgFileName;
exports.resourceNotAvailable = resourceNotAvailable;