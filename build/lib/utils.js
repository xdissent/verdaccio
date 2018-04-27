'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.parseConfigFile = exports.ErrorCode = exports.getLatestVersion = exports.getWebProtocol = exports.validate_package = exports.validate_name = exports.isObject = exports.validate_metadata = exports.filter_tarball_urls = exports.combineBaseUrl = exports.tagVersion = exports.get_version = exports.parse_address = exports.semverSort = exports.parseInterval = exports.fileExists = exports.folder_exists = exports.sortByName = exports.addScope = exports.deleteProperties = exports.addGravatarSupport = exports.DIST_TAGS = undefined;
exports.normalizeDistTags = normalizeDistTags;

var _user = require('../utils/user');

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _semver = require('semver');

var _semver2 = _interopRequireDefault(_semver);

var _jsYaml = require('js-yaml');

var _jsYaml2 = _interopRequireDefault(_jsYaml);

var _url2 = require('url');

var _url3 = _interopRequireDefault(_url2);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _httpErrors = require('http-errors');

var _httpErrors2 = _interopRequireDefault(_httpErrors);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const Logger = require('./logger');

const DIST_TAGS = exports.DIST_TAGS = 'dist-tags';

/**
 * Validate a package.
 * @return {Boolean} whether the package is valid or not
 */
function validate_package(name) {
	name = name.split('/', 2);
	if (name.length === 1) {
		// normal package
		return module.exports.validate_name(name[0]);
	} else {
		// scoped package
		return name[0][0] === '@' && module.exports.validate_name(name[0].slice(1)) && module.exports.validate_name(name[1]);
	}
}

/**
 * From normalize-package-data/lib/fixer.js
 * @param {*} name  the package name
 * @return {Boolean} whether is valid or not
 */
function validate_name(name) {
	if (_lodash2.default.isString(name) === false) {
		return false;
	}
	name = name.toLowerCase();

	// all URL-safe characters and "@" for issue #75
	return !(!name.match(/^[-a-zA-Z0-9_.!~*'()@]+$/) || name.charAt(0) === '.' // ".bin", etc.
	|| name.charAt(0) === '-' // "-" is reserved by couchdb
	|| name === 'node_modules' || name === '__proto__' || name === 'package.json' || name === 'favicon.ico');
}

/**
 * Check whether an element is an Object
 * @param {*} obj the element
 * @return {Boolean}
 */
function isObject(obj) {
	return _lodash2.default.isObject(obj) && _lodash2.default.isNull(obj) === false && _lodash2.default.isArray(obj) === false;
}

/**
 * Validate the package metadata, add additional properties whether are missing within
 * the metadata properties.
 * @param {*} object
 * @param {*} name
 * @return {Object} the object with additional properties as dist-tags ad versions
 */
function validate_metadata(object, name) {
	(0, _assert2.default)(isObject(object), 'not a json object');
	_assert2.default.equal(object.name, name);

	if (!isObject(object[DIST_TAGS])) {
		object[DIST_TAGS] = {};
	}

	if (!isObject(object['versions'])) {
		object['versions'] = {};
	}

	return object;
}

/**
 * Create base url for registry.
 * @return {String} base registry url
 */
function combineBaseUrl(protocol, host, prefix) {
	let result = `${protocol}://${host}`;

	if (prefix) {
		prefix = prefix.replace(/\/$/, '');

		result = prefix.indexOf('/') === 0 ? `${result}${prefix}` : prefix;
	}

	return result;
}

/**
 * Iterate a packages's versions and filter each original tarbal url.
 * @param {*} pkg
 * @param {*} req
 * @param {*} config
 * @return {String} a filtered package
 */
function filter_tarball_urls(pkg, req, config) {
	/**
  * Filter a tarball url.
  * @param {*} _url
  * @return {String} a parsed url
  */
	const filter = function (_url) {
		if (!req.headers.host) {
			return _url;
		}
		// $FlowFixMe
		const filename = _url3.default.parse(_url).pathname.replace(/^.*\//, '');
		const base = combineBaseUrl(getWebProtocol(req), req.headers.host, config.url_prefix);

		return `${base}/${pkg.name.replace(/\//g, '%2f')}/-/${filename}`;
	};

	for (let ver in pkg.versions) {
		if (Object.prototype.hasOwnProperty.call(pkg.versions, ver)) {
			const dist = pkg.versions[ver].dist;
			if (_lodash2.default.isNull(dist) === false && _lodash2.default.isNull(dist.tarball) === false) {
				dist.tarball = filter(dist.tarball);
			}
		}
	}
	return pkg;
}

/**
 * Create a tag for a package
 * @param {*} data
 * @param {*} version
 * @param {*} tag
 * @return {Boolean} whether a package has been tagged
 */
function tagVersion(data, version, tag) {
	if (tag) {
		if (data[DIST_TAGS][tag] !== version) {
			if (_semver2.default.parse(version, true)) {
				// valid version - store
				data[DIST_TAGS][tag] = version;
				return true;
			}
		}
		Logger.logger.warn({ ver: version, tag: tag }, 'ignoring bad version @{ver} in @{tag}');
		if (tag && data[DIST_TAGS][tag]) {
			delete data[DIST_TAGS][tag];
		}
	}
	return false;
}

/**
 * Gets version from a package object taking into account semver weirdness.
 * @return {String} return the semantic version of a package
 */
function get_version(pkg, version) {
	// this condition must allow cast
	if (pkg.versions[version] != null) {
		return pkg.versions[version];
	}

	try {
		version = _semver2.default.parse(version, true);
		for (let versionItem in pkg.versions) {
			// $FlowFixMe
			if (version.compare(_semver2.default.parse(versionItem, true)) === 0) {
				return pkg.versions[versionItem];
			}
		}
	} catch (err) {
		return undefined;
	}
}

/**
 * Parse an internet address
 * Allow:
		- https:localhost:1234        - protocol + host + port
		- localhost:1234              - host + port
		- 1234                        - port
		- http::1234                  - protocol + port
		- https://localhost:443/      - full url + https
		- http://[::1]:443/           - ipv6
		- unix:/tmp/http.sock         - unix sockets
		- https://unix:/tmp/http.sock - unix sockets (https)
 * @param {*} urlAddress the internet address definition
 * @return {Object|Null} literal object that represent the address parsed
 */
function parse_address(urlAddress) {
	//
	// TODO: refactor it to something more reasonable?
	//
	//        protocol :  //      (  host  )|(    ipv6     ):  port  /
	let urlPattern = /^((https?):(\/\/)?)?((([^\/:]*)|\[([^\[\]]+)\]):)?(\d+)\/?$/.exec(urlAddress);

	if (urlPattern) {
		return {
			proto: urlPattern[2] || 'http',
			host: urlPattern[6] || urlPattern[7] || 'localhost',
			port: urlPattern[8] || '4873'
		};
	}

	urlPattern = /^((https?):(\/\/)?)?unix:(.*)$/.exec(urlAddress);

	if (urlPattern) {
		return {
			proto: urlPattern[2] || 'http',
			path: urlPattern[4]
		};
	}

	return null;
}

/**
 * Function filters out bad semver versions and sorts the array.
 * @return {Array} sorted Array
 */
function semverSort(listVersions) {
	return listVersions.filter(function (x) {
		if (!_semver2.default.parse(x, true)) {
			Logger.logger.warn({ ver: x }, 'ignoring bad version @{ver}');
			return false;
		}
		return true;
	}).sort(_semver2.default.compareLoose).map(String);
}

/**
 * Flatten arrays of tags.
 * @param {*} data
 */
function normalizeDistTags(pkg) {
	let sorted;
	if (!pkg[DIST_TAGS].latest) {
		// overwrite latest with highest known version based on semver sort
		sorted = semverSort(Object.keys(pkg.versions));
		if (sorted && sorted.length) {
			pkg[DIST_TAGS].latest = sorted.pop();
		}
	}

	for (let tag in pkg[DIST_TAGS]) {
		if (_lodash2.default.isArray(pkg[DIST_TAGS][tag])) {
			if (pkg[DIST_TAGS][tag].length) {
				// sort array
				// $FlowFixMe
				sorted = semverSort(pkg[DIST_TAGS][tag]);
				if (sorted.length) {
					// use highest version based on semver sort
					pkg[DIST_TAGS][tag] = sorted.pop();
				}
			} else {
				delete pkg[DIST_TAGS][tag];
			}
		} else if (_lodash2.default.isString(pkg[DIST_TAGS][tag])) {
			if (!_semver2.default.parse(pkg[DIST_TAGS][tag], true)) {
				// if the version is invalid, delete the dist-tag entry
				delete pkg[DIST_TAGS][tag];
			}
		}
	}
}

const parseIntervalTable = {
	'': 1000,
	ms: 1,
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 86400000,
	w: 7 * 86400000,
	M: 30 * 86400000,
	y: 365 * 86400000
};

/**
 * Parse an internal string to number
 * @param {*} interval
 * @return {Number}
 */
function parseInterval(interval) {
	if (typeof interval === 'number') {
		return interval * 1000;
	}
	let result = 0;
	let last_suffix = Infinity;
	interval.split(/\s+/).forEach(function (x) {
		if (!x) return;
		let m = x.match(/^((0|[1-9][0-9]*)(\.[0-9]+)?)(ms|s|m|h|d|w|M|y|)$/);
		if (!m || parseIntervalTable[m[4]] >= last_suffix || m[4] === '' && last_suffix !== Infinity) {
			throw Error('invalid interval: ' + interval);
		}
		last_suffix = parseIntervalTable[m[4]];
		result += Number(m[1]) * parseIntervalTable[m[4]];
	});
	return result;
}

/**
 * Detect running protocol (http or https)
 * @param {*} req
 * @return {String}
 */
function getWebProtocol(req) {
	return req.get('X-Forwarded-Proto') || req.protocol;
}

const getLatestVersion = function (pkgInfo) {
	return pkgInfo[DIST_TAGS].latest;
};

const ErrorCode = {
	get409: (message = 'this package is already present') => {
		return (0, _httpErrors2.default)(409, message);
	},
	get422: customMessage => {
		return (0, _httpErrors2.default)(422, customMessage || 'bad data');
	},
	get400: customMessage => {
		return (0, _httpErrors2.default)(400, customMessage);
	},
	get500: customMessage => {
		return customMessage ? (0, _httpErrors2.default)(500, customMessage) : (0, _httpErrors2.default)(500);
	},
	get403: (message = 'can\'t use this filename') => {
		return (0, _httpErrors2.default)(403, message);
	},
	get503: (message = 'resource temporarily unavailable') => {
		return (0, _httpErrors2.default)(503, message);
	},
	get404: customMessage => {
		return (0, _httpErrors2.default)(404, customMessage || 'no such package available');
	},
	getCode: (statusCode, customMessage) => {
		return (0, _httpErrors2.default)(statusCode, customMessage);
	}
};

const parseConfigFile = configPath => _jsYaml2.default.safeLoad(_fs2.default.readFileSync(configPath, 'utf8'));

/**
 * Check whether the path already exist.
 * @param {String} path
 * @return {Boolean}
 */
function folder_exists(path) {
	try {
		const stat = _fs2.default.statSync(path);
		return stat.isDirectory();
	} catch (_) {
		return false;
	}
}

/**
 * Check whether the file already exist.
 * @param {String} path
 * @return {Boolean}
 */
function fileExists(path) {
	try {
		const stat = _fs2.default.statSync(path);
		return stat.isFile();
	} catch (_) {
		return false;
	}
}

function sortByName(packages) {
	return packages.sort(function (a, b) {
		if (a.name < b.name) {
			return -1;
		} else {
			return 1;
		}
	});
}

function addScope(scope, packageName) {
	return `@${scope}/${packageName}`;
}

function deleteProperties(propertiesToDelete, objectItem) {
	_lodash2.default.forEach(propertiesToDelete, property => {
		delete objectItem[property];
	});

	return objectItem;
}

function addGravatarSupport(pkgInfo) {
	if (_lodash2.default.isString(_lodash2.default.get(pkgInfo, 'latest.author.email'))) {
		pkgInfo.latest.author.avatar = (0, _user.generateGravatarUrl)(pkgInfo.latest.author.email);
	} else {
		// _.get can't guarantee author property exist
		_lodash2.default.set(pkgInfo, 'latest.author.avatar', (0, _user.generateGravatarUrl)());
	}

	if (_lodash2.default.get(pkgInfo, 'latest.contributors.length', 0) > 0) {
		pkgInfo.latest.contributors = _lodash2.default.map(pkgInfo.latest.contributors, contributor => {
			if (_lodash2.default.isString(contributor.email)) {
				contributor.avatar = (0, _user.generateGravatarUrl)(contributor.email);
			} else {
				contributor.avatar = (0, _user.generateGravatarUrl)();
			}

			return contributor;
		});
	}

	return pkgInfo;
}

exports.addGravatarSupport = addGravatarSupport;
exports.deleteProperties = deleteProperties;
exports.addScope = addScope;
exports.sortByName = sortByName;
exports.folder_exists = folder_exists;
exports.fileExists = fileExists;
exports.parseInterval = parseInterval;
exports.semverSort = semverSort;
exports.parse_address = parse_address;
exports.get_version = get_version;
exports.tagVersion = tagVersion;
exports.combineBaseUrl = combineBaseUrl;
exports.filter_tarball_urls = filter_tarball_urls;
exports.validate_metadata = validate_metadata;
exports.isObject = isObject;
exports.validate_name = validate_name;
exports.validate_package = validate_package;
exports.getWebProtocol = getWebProtocol;
exports.getLatestVersion = getLatestVersion;
exports.ErrorCode = ErrorCode;
exports.parseConfigFile = parseConfigFile;