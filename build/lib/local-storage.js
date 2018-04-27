'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _url = require('url');

var _url2 = _interopRequireDefault(_url);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _async = require('async');

var _async2 = _interopRequireDefault(_async);

var _utils = require('./utils');

var _storageUtils = require('./storage-utils');

var _pluginLoader = require('../lib/plugin-loader');

var _localStorage = require('@verdaccio/local-storage');

var _localStorage2 = _interopRequireDefault(_localStorage);

var _streams = require('@verdaccio/streams');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/* eslint prefer-rest-params: 0 */

// $FlowFixMe


/**
 * Implements Storage interface (same for storage.js, local-storage.js, up-storage.js).
 */
class LocalStorage {

  constructor(config, logger) {
    this.logger = logger.child({ sub: 'fs' });
    this.config = config;
    this.localData = this._loadStorage(config, logger);
  }

  addPackage(name, pkg, callback) {
    const storage = this._getLocalStorage(name);

    if (_lodash2.default.isNil(storage)) {
      return callback(_utils.ErrorCode.get404('this package cannot be added'));
    }

    storage.createPackage(name, (0, _storageUtils.generatePackageTemplate)(name), err => {
      if (_lodash2.default.isNull(err) === false && err.code === _storageUtils.fileExist) {
        return callback(_utils.ErrorCode.get409());
      }

      const latest = (0, _utils.getLatestVersion)(pkg);
      if (_lodash2.default.isNil(latest) === false && pkg.versions[latest]) {
        return callback(null, pkg.versions[latest]);
      }

      return callback();
    });
  }

  /**
   * Remove package.
   * @param {*} name
   * @param {*} callback
   * @return {Function}
   */
  removePackage(name, callback) {
    let storage = this._getLocalStorage(name);

    if (_lodash2.default.isNil(storage)) {
      return callback(_utils.ErrorCode.get404());
    }

    storage.readPackage(name, (err, data) => {
      if (_lodash2.default.isNil(err) === false) {
        if (err.code === _storageUtils.noSuchFile) {
          return callback(_utils.ErrorCode.get404());
        } else {
          return callback(err);
        }
      }

      data = (0, _storageUtils.normalizePackage)(data);

      this.localData.remove(name, removeFailed => {
        if (removeFailed) {
          // This will happen when database is locked
          return callback(_utils.ErrorCode.get422(removeFailed.message));
        }

        storage.deletePackage(_storageUtils.pkgFileName, err => {
          if (err) {
            return callback(err);
          }
          const attachments = Object.keys(data._attachments);

          this._deleteAttachments(storage, attachments, callback);
        });
      });
    });
  }

  /**
   * Synchronize remote package info with the local one
   * @param {*} name
   * @param {*} packageInfo
   * @param {*} callback
   */
  updateVersions(name, packageInfo, callback) {
    this._readCreatePackage(name, (err, packageLocalJson) => {
      if (err) {
        return callback(err);
      }

      let change = false;
      for (let versionId in packageInfo.versions) {
        if (_lodash2.default.isNil(packageLocalJson.versions[versionId])) {
          let version = packageInfo.versions[versionId];

          // we don't keep readmes for package versions,
          // only one readme per package
          version = (0, _storageUtils.cleanUpReadme)(version);

          change = true;
          packageLocalJson.versions[versionId] = version;

          if (version.dist && version.dist.tarball) {
            const urlObject = _url2.default.parse(version.dist.tarball);
            const filename = urlObject.pathname.replace(/^.*\//, '');

            // we do NOT overwrite any existing records
            if (_lodash2.default.isNil(packageLocalJson._distfiles[filename])) {
              let hash = packageLocalJson._distfiles[filename] = {
                url: version.dist.tarball,
                sha: version.dist.shasum
              };
              /* eslint spaced-comment: 0 */
              // $FlowFixMe
              const upLink = version[Symbol.for('__verdaccio_uplink')];

              if (_lodash2.default.isNil(upLink) === false) {
                this._updateUplinkToRemoteProtocol(hash, upLink);
              }
            }
          }
        }
      }

      for (let tag in packageInfo[_utils.DIST_TAGS]) {
        if (!packageLocalJson[_utils.DIST_TAGS][tag] || packageLocalJson[_utils.DIST_TAGS][tag] !== packageInfo[_utils.DIST_TAGS][tag]) {
          change = true;
          packageLocalJson[_utils.DIST_TAGS][tag] = packageInfo[_utils.DIST_TAGS][tag];
        }
      }

      for (let up in packageInfo._uplinks) {
        if (Object.prototype.hasOwnProperty.call(packageInfo._uplinks, up)) {
          const need_change = !(0, _utils.isObject)(packageLocalJson._uplinks[up]) || packageInfo._uplinks[up].etag !== packageLocalJson._uplinks[up].etag || packageInfo._uplinks[up].fetched !== packageLocalJson._uplinks[up].fetched;

          if (need_change) {
            change = true;
            packageLocalJson._uplinks[up] = packageInfo._uplinks[up];
          }
        }
      }

      if (packageInfo.readme !== packageLocalJson.readme) {
        packageLocalJson.readme = packageInfo.readme;
        change = true;
      }

      if ('time' in packageInfo) {
        packageLocalJson.time = packageInfo.time;
        change = true;
      }

      if (change) {
        this.logger.debug('updating package info');
        this._writePackage(name, packageLocalJson, function (err) {
          callback(err, packageLocalJson);
        });
      } else {
        callback(null, packageLocalJson);
      }
    });
  }

  /**
   * Add a new version to a previous local package.
   * @param {*} name
   * @param {*} version
   * @param {*} metadata
   * @param {*} tag
   * @param {*} callback
   */
  addVersion(name, version, metadata, tag, callback) {
    this._updatePackage(name, (data, cb) => {
      // keep only one readme per package
      data.readme = metadata.readme;

      // TODO: lodash remove
      metadata = (0, _storageUtils.cleanUpReadme)(metadata);

      if (data.versions[version] != null) {
        return cb(_utils.ErrorCode.get409());
      }

      // if uploaded tarball has a different shasum, it's very likely that we have some kind of error
      if ((0, _utils.isObject)(metadata.dist) && _lodash2.default.isString(metadata.dist.tarball)) {
        let tarball = metadata.dist.tarball.replace(/.*\//, '');

        if ((0, _utils.isObject)(data._attachments[tarball])) {

          if (_lodash2.default.isNil(data._attachments[tarball].shasum) === false && _lodash2.default.isNil(metadata.dist.shasum) === false) {
            if (data._attachments[tarball].shasum != metadata.dist.shasum) {
              const errorMessage = `shasum error, ${data._attachments[tarball].shasum} != ${metadata.dist.shasum}`;
              return cb(_utils.ErrorCode.get400(errorMessage));
            }
          }

          let currentDate = new Date().toISOString();
          data.time['modified'] = currentDate;

          if ('created' in data.time === false) {
            data.time.created = currentDate;
          }

          data.time[version] = currentDate;
          data._attachments[tarball].version = version;
        }
      }

      data.versions[version] = metadata;
      (0, _utils.tagVersion)(data, version, tag);

      this.localData.add(name, addFailed => {
        if (addFailed) {
          return cb(_utils.ErrorCode.get422(addFailed.message));
        }

        cb();
      });
    }, callback);
  }

  /**
   * Merge a new list of tags for a local packages with the existing one.
   * @param {*} name
   * @param {*} tags
   * @param {*} callback
   */
  mergeTags(name, tags, callback) {
    this._updatePackage(name, (data, cb) => {
      /* eslint guard-for-in: 0 */
      for (let t in tags) {
        if (_lodash2.default.isNull(tags[t])) {
          delete data[_utils.DIST_TAGS][t];
          continue;
        }

        if (_lodash2.default.isNil(data.versions[tags[t]])) {
          return cb(this._getVersionNotFound());
        }
        const key = tags[t];
        (0, _utils.tagVersion)(data, key, t);
      }
      cb();
    }, callback);
  }

  /**
   * Return version not found
   * @return {String}
   * @private
   */
  _getVersionNotFound() {
    return _utils.ErrorCode.get404('this version doesn\'t exist');
  }

  /**
   * Return file no available
   * @return {String}
   * @private
   */
  _getFileNotAvailable() {
    return _utils.ErrorCode.get404('no such file available');
  }

  /**
   * Update the package metadata, tags and attachments (tarballs).
   * Note: Currently supports unpublishing only.
   * @param {*} name
   * @param {*} pkg
   * @param {*} revision
   * @param {*} callback
   * @return {Function}
   */
  changePackage(name, pkg, revision, callback) {
    if (!(0, _utils.isObject)(pkg.versions) || !(0, _utils.isObject)(pkg[_utils.DIST_TAGS])) {
      return callback(_utils.ErrorCode.get422());
    }

    this._updatePackage(name, (jsonData, cb) => {
      for (let ver in jsonData.versions) {

        if (_lodash2.default.isNil(pkg.versions[ver])) {
          this.logger.info({ name: name, version: ver }, 'unpublishing @{name}@@{version}');

          delete jsonData.versions[ver];

          for (let file in jsonData._attachments) {
            if (jsonData._attachments[file].version === ver) {
              delete jsonData._attachments[file].version;
            }
          }
        }
      }

      jsonData[_utils.DIST_TAGS] = pkg[_utils.DIST_TAGS];
      cb();
    }, function (err) {
      if (err) {
        return callback(err);
      }
      callback();
    });
  }
  /**
   * Remove a tarball.
   * @param {*} name
   * @param {*} filename
   * @param {*} revision
   * @param {*} callback
   */
  removeTarball(name, filename, revision, callback) {
    (0, _assert2.default)((0, _utils.validate_name)(filename));

    this._updatePackage(name, (data, cb) => {
      if (data._attachments[filename]) {
        delete data._attachments[filename];
        cb();
      } else {
        cb(this._getFileNotAvailable());
      }
    }, err => {
      if (err) {
        return callback(err);
      }
      const storage = this._getLocalStorage(name);

      if (storage) {
        storage.deletePackage(filename, callback);
      }
    });
  }

  /**
   * Add a tarball.
   * @param {String} name
   * @param {String} filename
   * @return {Stream}
   */
  addTarball(name, filename) {
    (0, _assert2.default)((0, _utils.validate_name)(filename));

    let length = 0;
    const shaOneHash = _crypto2.default.createHash('sha1');
    const uploadStream = new _streams.UploadTarball();
    const _transform = uploadStream._transform;
    const storage = this._getLocalStorage(name);

    uploadStream.abort = function () {};
    uploadStream.done = function () {};

    uploadStream._transform = function (data) {
      shaOneHash.update(data);
      // measure the length for validation reasons
      length += data.length;
      _transform.apply(uploadStream, arguments);
    };

    if (name === _storageUtils.pkgFileName || name === '__proto__') {
      process.nextTick(() => {
        uploadStream.emit('error', _utils.ErrorCode.get403());
      });
      return uploadStream;
    }

    if (!storage) {
      process.nextTick(() => {
        uploadStream.emit('error', 'can\'t upload this package');
      });
      return uploadStream;
    }

    const writeStream = storage.writeTarball(filename);

    writeStream.on('error', err => {
      if (err.code === _storageUtils.fileExist) {
        uploadStream.emit('error', _utils.ErrorCode.get409());
      } else if (err.code === _storageUtils.noSuchFile) {
        // check if package exists to throw an appropriate message
        this.getPackageMetadata(name, function (_err, res) {
          if (_err) {
            uploadStream.emit('error', _err);
          } else {
            uploadStream.emit('error', err);
          }
        });
      } else {
        uploadStream.emit('error', err);
      }
    });

    writeStream.on('open', function () {
      // re-emitting open because it's handled in storage.js
      uploadStream.emit('open');
    });

    writeStream.on('success', () => {
      this._updatePackage(name, function updater(data, cb) {
        data._attachments[filename] = {
          shasum: shaOneHash.digest('hex')
        };
        cb();
      }, function (err) {
        if (err) {
          uploadStream.emit('error', err);
        } else {
          uploadStream.emit('success');
        }
      });
    });

    uploadStream.abort = function () {
      writeStream.abort();
    };

    uploadStream.done = function () {
      if (!length) {
        uploadStream.emit('error', _utils.ErrorCode.get422('refusing to accept zero-length file'));
        writeStream.abort();
      } else {
        writeStream.done();
      }
    };

    uploadStream.pipe(writeStream);

    return uploadStream;
  }

  /**
   * Get a tarball.
   * @param {*} name
   * @param {*} filename
   * @return {ReadTarball}
   */
  getTarball(name, filename) {
    (0, _assert2.default)((0, _utils.validate_name)(filename));

    const storage = this._getLocalStorage(name);

    if (_lodash2.default.isNil(storage)) {
      return this._createFailureStreamResponse();
    }

    return this._streamSuccessReadTarBall(storage, filename);
  }

  /**
   * Return a stream that emits a read failure.
   * @private
   * @return {ReadTarball}
   */
  _createFailureStreamResponse() {
    const stream = new _streams.ReadTarball();

    process.nextTick(() => {
      stream.emit('error', this._getFileNotAvailable());
    });
    return stream;
  }

  /**
   * Return a stream that emits the tarball data
   * @param {Object} storage
   * @param {String} filename
   * @private
   * @return {ReadTarball}
   */
  _streamSuccessReadTarBall(storage, filename) {
    const stream = new _streams.ReadTarball();
    const readTarballStream = storage.readTarball(filename);
    const e404 = _utils.ErrorCode.get404;

    stream.abort = function () {
      if (_lodash2.default.isNil(readTarballStream) === false) {
        readTarballStream.abort();
      }
    };

    readTarballStream.on('error', function (err) {
      if (err && err.code === _storageUtils.noSuchFile) {
        stream.emit('error', e404('no such file available'));
      } else {
        stream.emit('error', err);
      }
    });

    readTarballStream.on('content-length', function (v) {
      stream.emit('content-length', v);
    });

    readTarballStream.on('open', function () {
      // re-emitting open because it's handled in storage.js
      stream.emit('open');
      readTarballStream.pipe(stream);
    });

    return stream;
  }

  /**
   * Retrieve a package by name.
   * @param {*} name
   * @param {*} callback
   * @return {Function}
   */
  getPackageMetadata(name, callback = () => {}) {

    const storage = this._getLocalStorage(name);
    if (_lodash2.default.isNil(storage)) {
      return callback(_utils.ErrorCode.get404());
    }

    this._readPackage(name, storage, callback);
  }

  /**
   * Search a local package.
   * @param {*} startKey
   * @param {*} options
   * @return {Function}
   */
  search(startKey, options) {
    const stream = new _streams.UploadTarball({ objectMode: true });

    this._eachPackage((item, cb) => {
      _fs2.default.stat(item.path, (err, stats) => {
        if (_lodash2.default.isNil(err) === false) {
          return cb(err);
        }

        if (stats.mtime.getTime() > parseInt(startKey, 10)) {
          this.getPackageMetadata(item.name, (err, data) => {
            if (err) {
              return cb(err);
            }

            const listVersions = Object.keys(data.versions);
            const versions = (0, _utils.semverSort)(listVersions);
            const latest = data[_utils.DIST_TAGS] && data[_utils.DIST_TAGS].latest ? data[_utils.DIST_TAGS].latest : versions.pop();

            if (data.versions[latest]) {
              const version = data.versions[latest];
              const pkg = {
                name: version.name,
                description: version.description,
                'dist-tags': { latest },
                maintainers: version.maintainers || [version.author].filter(Boolean),
                author: version.author,
                repository: version.repository,
                readmeFilename: version.readmeFilename || '',
                homepage: version.homepage,
                keywords: version.keywords,
                bugs: version.bugs,
                license: version.license,
                time: {
                  modified: item.time ? new Date(item.time).toISOString() : stats.mtime
                },
                versions: { [latest]: 'latest' }
              };

              stream.push(pkg);
            }

            cb();
          });
        } else {
          cb();
        }
      });
    }, function onEnd(err) {
      if (err) {
        return stream.emit('error', err);
      }
      stream.end();
    });

    return stream;
  }

  /**
   * Retrieve a wrapper that provide access to the package location.
   * @param {Object} packageInfo package name.
   * @return {Object}
   */
  _getLocalStorage(packageInfo) {
    return this.localData.getPackageStorage(packageInfo);
  }

  /**
   * Read a json file from storage.
   * @param {Object} storage
   * @param {Function} callback
   */
  _readPackage(name, storage, callback) {
    storage.readPackage(name, (err, result) => {
      if (err) {
        if (err.code === _storageUtils.noSuchFile) {
          return callback(_utils.ErrorCode.get404());
        } else {
          return callback(this._internalError(err, _storageUtils.pkgFileName, 'error reading'));
        }
      }

      callback(err, (0, _storageUtils.normalizePackage)(result));
    });
  }

  /**
   * Walks through each package and calls `on_package` on them.
   * @param {*} onPackage
   * @param {*} onEnd
   */
  _eachPackage(onPackage, onEnd) {
    const storages = {};

    storages[this.config.storage] = true;
    if (this.config.packages) {
      Object.keys(this.config.packages || {}).map(pkg => {
        if (this.config.packages[pkg].storage) {
          storages[this.config.packages[pkg].storage] = true;
        }
      });
    }
    const base = _path2.default.dirname(this.config.self_path);

    _async2.default.eachSeries(Object.keys(storages), function (storage, cb) {
      _fs2.default.readdir(_path2.default.resolve(base, storage), function (err, files) {
        if (err) {
          return cb(err);
        }

        _async2.default.eachSeries(files, function (file, cb) {
          if (file.match(/^@/)) {
            // scoped
            _fs2.default.readdir(_path2.default.resolve(base, storage, file), function (err, files) {
              if (err) {
                return cb(err);
              }

              _async2.default.eachSeries(files, (file2, cb) => {
                if ((0, _utils.validate_name)(file2)) {
                  onPackage({
                    name: `${file}/${file2}`,
                    path: _path2.default.resolve(base, storage, file, file2)
                  }, cb);
                } else {
                  cb();
                }
              }, cb);
            });
          } else if ((0, _utils.validate_name)(file)) {
            onPackage({
              name: file,
              path: _path2.default.resolve(base, storage, file)
            }, cb);
          } else {
            cb();
          }
        }, cb);
      });
    }, onEnd);
  }

  /**
   * Retrieve either a previous created local package or a boilerplate.
   * @param {*} name
   * @param {*} callback
   * @return {Function}
   */
  _readCreatePackage(name, callback) {
    const storage = this._getLocalStorage(name);
    if (_lodash2.default.isNil(storage)) {
      return this._createNewPackage(name, callback);
    }

    storage.readPackage(name, (err, data) => {
      // TODO: race condition
      if (_lodash2.default.isNil(err) === false) {
        if (err.code === _storageUtils.noSuchFile) {
          data = (0, _storageUtils.generatePackageTemplate)(name);
        } else {
          return callback(this._internalError(err, _storageUtils.pkgFileName, 'error reading'));
        }
      }

      callback(null, (0, _storageUtils.normalizePackage)(data));
    });
  }

  _createNewPackage(name, callback) {
    return callback(null, (0, _storageUtils.normalizePackage)((0, _storageUtils.generatePackageTemplate)(name)));
  }

  /**
   * Handle internal error
   * @param {*} err
   * @param {*} file
   * @param {*} message
   * @return {Object} Error instance
   */
  _internalError(err, file, message) {
    this.logger.error({ err: err, file: file }, `${message}  @{file}: @{!err.message}`);

    return _utils.ErrorCode.get500();
  }

  /**
   * @param {*} name package name
   * @param {*} updateHandler function(package, cb) - update function
   * @param {*} callback callback that gets invoked after it's all updated
   * @return {Function}
   */
  _updatePackage(name, updateHandler, callback) {
    const storage = this._getLocalStorage(name);

    if (!storage) {
      return callback(_utils.ErrorCode.get404());
    }

    storage.updatePackage(name, updateHandler, this._writePackage.bind(this), _storageUtils.normalizePackage, callback);
  }

  /**
   * Update the revision (_rev) string for a package.
   * @param {*} name
   * @param {*} json
   * @param {*} callback
   * @return {Function}
   */
  _writePackage(name, json, callback) {
    const storage = this._getLocalStorage(name);
    if (_lodash2.default.isNil(storage)) {
      return callback();
    }
    storage.savePackage(name, this._setDefaultRevision(json), callback);
  }

  _setDefaultRevision(json) {
    // calculate revision a la couchdb
    if (_lodash2.default.isString(json._rev) === false) {
      json._rev = _storageUtils.DEFAULT_REVISION;
    }

    json._rev = (0, _storageUtils.generateRevision)(json._rev);

    return json;
  }

  _deleteAttachments(storage, attachments, callback) {
    const unlinkNext = function (cb) {
      if (_lodash2.default.isEmpty(attachments)) {
        return cb();
      }

      const attachment = attachments.shift();
      storage.deletePackage(attachment, function () {
        unlinkNext(cb);
      });
    };

    unlinkNext(function () {
      // try to unlink the directory, but ignore errors because it can fail
      storage.removePackage(function (err) {
        callback(err);
      });
    });
  }

  /**
   * Ensure the dist file remains as the same protocol
   * @param {Object} hash metadata
   * @param {String} upLinkKey registry key
   * @private
   */
  _updateUplinkToRemoteProtocol(hash, upLinkKey) {
    // if we got this information from a known registry,
    // use the same protocol for the tarball
    //
    const tarballUrl = _url2.default.parse(hash.url);
    const uplinkUrl = _url2.default.parse(this.config.uplinks[upLinkKey].url);

    if (uplinkUrl.host === tarballUrl.host) {
      tarballUrl.protocol = uplinkUrl.protocol;
      hash.registry = upLinkKey;
      hash.url = _url2.default.format(tarballUrl);
    }
  }

  getSecret(config) {
    var _this = this;

    return _asyncToGenerator(function* () {
      const secretKey = yield _this.localData.getSecret();

      return _this.localData.setSecret(config.checkSecretKey(secretKey));
    })();
  }

  _loadStorage(config, logger) {
    const Storage = this._loadStorePlugin();

    if (_lodash2.default.isNil(Storage)) {
      return new _localStorage2.default(this.config, logger);
    } else {
      return Storage;
    }
  }

  _loadStorePlugin() {
    const plugin_params = {
      config: this.config,
      logger: this.logger
    };

    return _lodash2.default.head((0, _pluginLoader.loadPlugin)(this.config, this.config.store, plugin_params, function (plugin) {
      return plugin.getPackageStorage;
    }));
  }

}

exports.default = LocalStorage;