'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.setupUpLinks = setupUpLinks;
exports.updateVersionsHiddenUpLink = updateVersionsHiddenUpLink;
exports.fetchUplinkMetadata = fetchUplinkMetadata;

var _utils = require('./utils');

var _upStorage = require('./up-storage');

var _upStorage2 = _interopRequireDefault(_upStorage);

var _metadataUtils = require('./metadata-utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
  * Set up the Up Storage for each link.
 */
function setupUpLinks(config) {
	const uplinks = {};

	for (let uplinkName in config.uplinks) {
		if (Object.prototype.hasOwnProperty.call(config.uplinks, uplinkName)) {
			// instance for each up-link definition
			const proxy = new _upStorage2.default(config.uplinks[uplinkName], config);
			proxy.upname = uplinkName;

			uplinks[uplinkName] = proxy;
		}
	}

	return uplinks;
}

function updateVersionsHiddenUpLink(versions, upLink) {
	for (let i in versions) {
		if (Object.prototype.hasOwnProperty.call(versions, i)) {
			const version = versions[i];

			// holds a "hidden" value to be used by the package storage.
			// $FlowFixMe
			version[Symbol.for('__verdaccio_uplink')] = upLink.upname;
		}
	}
}

function fetchUplinkMetadata(name, packageInfo, options, upLink, logger) {

	return new Promise(function (resolve, reject) {
		const _options = Object.assign({}, options);
		const upLinkMeta = packageInfo._uplinks[upLink.upname];

		if ((0, _utils.isObject)(upLinkMeta)) {

			const fetched = upLinkMeta.fetched;

			// check whether is too soon to ask for metadata
			if (fetched && Date.now() - fetched < upLink.maxage) {
				return resolve(false);
			}

			_options.etag = upLinkMeta.etag;
		}

		upLink.getRemoteMetadata(name, _options, function handleUplinkMetadataResponse(err, upLinkResponse, eTag) {
			if (err && err.remoteStatus === 304) {
				upLinkMeta.fetched = Date.now();
			}

			if (err || !upLinkResponse) {
				// $FlowFixMe
				return reject(err || _utils.ErrorCode.get500('no data'));
			}

			try {
				(0, _utils.validate_metadata)(upLinkResponse, name);
			} catch (err) {
				logger.error({
					sub: 'out',
					err: err
				}, 'package.json validating error @{!err.message}\n@{err.stack}');
				return reject(err);
			}

			packageInfo._uplinks[upLink.upname] = {
				etag: eTag,
				fetched: Date.now()
			};

			// added to fix verdaccio#73
			if ('time' in upLinkResponse) {
				packageInfo.time = upLinkResponse.time;
			}

			updateVersionsHiddenUpLink(upLinkResponse.versions, upLink);

			try {
				(0, _metadataUtils.mergeVersions)(packageInfo, upLinkResponse);
			} catch (err) {
				logger.error({
					sub: 'out',
					err: err
				}, 'package.json parsing error @{!err.message}\n@{err.stack}');
				return reject(err);
			}

			// if we got to this point, assume that the correct package exists
			// on the uplink
			resolve(true);
		});
	});
}