const { validationResult } = require('express-validator');
const { error } = require('../utils/apiResponse');

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return error(res, 'Validation failed', 400, errors.array());
  }

  next();
};

module.exports = { validate };
