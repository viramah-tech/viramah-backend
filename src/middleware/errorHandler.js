const errorHandler = (err, req, res, _next) => {
  try {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Server Error';

    // Mongoose validation error
    if (err.name === 'ValidationError' && err.errors) {
      statusCode = 400;
      const messages = Object.values(err.errors).map((e) => e.message);
      message = messages.join(', ');
    }

    // Mongoose / DocumentDB duplicate key error
    if (err.code === 11000) {
      statusCode = 409;
      let field = 'unknown field';
      if (err.keyValue && typeof err.keyValue === 'object') {
        field = Object.keys(err.keyValue).join(', ');
      } else if (err.message) {
        // DocumentDB doesn't always set keyValue — extract from message
        const match = err.message.match(/index:\s+(\S+)/);
        if (match) field = match[1];
      }
      message = `Duplicate value for field: ${field}`;
    }

    // Mongoose cast error (invalid ObjectId)
    if (err.name === 'CastError') {
      statusCode = 400;
      message = `Invalid value for ${err.path || 'field'}: ${err.value}`;
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
      statusCode = 401;
      message = 'Invalid token';
    }

    if (err.name === 'TokenExpiredError') {
      statusCode = 401;
      message = 'Token has expired';
    }

    const response = {
      success: false,
      message,
    };

    if (process.env.NODE_ENV === 'development') {
      response.stack = err.stack;
    }

    // Guard against headers already sent
    if (res.headersSent) {
      console.error('[ErrorHandler] Headers already sent, cannot send error JSON:', message);
      return;
    }

    res.status(statusCode).json(response);
  } catch (handlerError) {
    // SAFETY NET: If the error handler itself crashes, still return JSON
    console.error('[ErrorHandler] CRITICAL — error handler threw:', handlerError);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
};

module.exports = errorHandler;
