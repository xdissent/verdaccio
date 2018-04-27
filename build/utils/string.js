'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.spliceURL = spliceURL;
exports.stringToMD5 = stringToMD5;

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function spliceURL(...args) {
  return Array.from(args).reduce((lastResult, current) => lastResult + current).replace(/([^:])(\/)+(.)/g, `$1/$3`);
}

/**
 * Get MD5 from string
 */

function stringToMD5(string) {
  return _crypto2.default.createHash('md5').update(string).digest('hex');
}