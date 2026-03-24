const dashboardService = require('../../services/dashboardService');
const { success } = require('../../utils/apiResponse');

const getOverview = async (req, res, next) => {
  try {
    const data = await dashboardService.getOverview();
    return success(res, data, 'Dashboard overview fetched successfully');
  } catch (err) {
    next(err);
  }
};

const getFinancialSummary = async (req, res, next) => {
  try {
    const data = await dashboardService.getFinancialSummary();
    return success(res, data, 'Financial summary fetched successfully');
  } catch (err) {
    next(err);
  }
};

const getRecentActivity = async (req, res, next) => {
  try {
    const data = await dashboardService.getRecentActivity();
    return success(res, data, 'Recent activity fetched successfully');
  } catch (err) {
    next(err);
  }
};

module.exports = { getOverview, getFinancialSummary, getRecentActivity };
