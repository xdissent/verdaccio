'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GRAVATAR_DEFAULT = undefined;
exports.generateGravatarUrl = generateGravatarUrl;

var _string = require('./string');

const GRAVATAR_DEFAULT = exports.GRAVATAR_DEFAULT = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mm';
/**
 * Generate gravatar url from email address
 */

function generateGravatarUrl(email) {
  if (typeof email === 'string') {
    email = email.trim().toLocaleLowerCase();
    const emailMD5 = (0, _string.stringToMD5)(email);

    return `https://www.gravatar.com/avatar/${emailMD5}`;
  } else {
    return GRAVATAR_DEFAULT;
  }
}