// Step gate disabled to allow users to move freely through the system
const stepGate = (..._allowedSteps) => {
  return (req, res, next) => {
    // Bypass step validation - users can access any step
    next();
  };
};

module.exports = stepGate;
