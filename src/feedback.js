'use strict';

/**
 * src/feedback.js — Re-exports and convenience entrypoint for ThumbGate feedback & lessons.
 */
const feedbackLoop = require('../scripts/feedback-loop');
const lessonRetrieval = require('../scripts/lesson-retrieval');
const lessonSearch = require('../scripts/lesson-search');
const verifiedLessons = require('../scripts/verified-lessons');

module.exports = {
  ...feedbackLoop,
  ...lessonRetrieval,
  ...lessonSearch,
  ...verifiedLessons,
  retrieve_lessons: lessonRetrieval.retrieve_lessons || lessonRetrieval.retrieveRelevantLessons,
  retrieveLessons: lessonRetrieval.retrieveLessons || lessonRetrieval.retrieveRelevantLessons,
  search_lessons: lessonSearch.search_lessons || lessonSearch.searchLessons,
  searchLessons: lessonSearch.searchLessons,
  capture_feedback: feedbackLoop.capture_feedback || feedbackLoop.captureFeedback,
};
