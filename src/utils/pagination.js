/**
 * Calculate total pages by dividing total items by items per page and rounding up
 * @param {number} total - Total number of items
 * @param {number} limit - Items per page
 * @returns {number} Total number of pages
 */
const divideAndRoundUp = (total, limit) => {
  if (limit <= 0) {
    return 0;
  }
  return Math.ceil(total / limit);
};

module.exports = {
  divideAndRoundUp,
};

