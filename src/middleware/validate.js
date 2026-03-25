const { validationResult } = require('express-validator');
const { error } = require('../utils/apiResponse');

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorArr = errors.array();
    const message = errorArr[0].msg || 'Validation failed';
    return error(res, message, 400, errorArr);
  }

  next();
};

module.exports = { validate };
