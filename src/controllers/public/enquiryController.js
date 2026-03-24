const { success } = require('../../utils/apiResponse');

const submitEnquiry = async (req, res, next) => {
  try {
    const { name, email, phone, message } = req.body;

    // Enquiry is validated by middleware; actual processing
    // (e.g., AppScript integration) is handled by the frontend
    return success(res, { name, email, phone, message }, 'Enquiry submitted successfully', 201);
  } catch (err) {
    next(err);
  }
};

module.exports = { submitEnquiry };
