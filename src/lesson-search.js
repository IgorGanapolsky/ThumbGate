'use strict';

const lessonSearch = require('../scripts/lesson-search');
const { lookupLessonByError } = require('../scripts/verified-lessons');

module.exports = {
  ...lessonSearch,
  lookupLessonByError,
};
