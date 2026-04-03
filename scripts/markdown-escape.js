'use strict';

function escapeMarkdownTableCell(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

module.exports = {
  escapeMarkdownTableCell,
};
