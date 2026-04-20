const { ValidationError } = require("../utils/errors");

const validate = (schema, source = "body") => {
  return (req, res, next) => {
    const target = source === "query" ? req.query : source === "params" ? req.params : req.body;
    const { error, value } = schema.validate(target, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      const message = error.details.map((d) => d.message).join(", ");
      return next(new ValidationError(message));
    }
    if (source === "body") req.validatedBody = value;
    else if (source === "query") req.validatedQuery = value;
    else req.validatedParams = value;
    next();
  };
};

module.exports = validate;
