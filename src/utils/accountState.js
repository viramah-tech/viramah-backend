const reconcileAccountState = (user) => {
  if (!user) return { accountStatus: 'pending', onboarding: { currentStep: 'pending' } };

  const nextState = {
    accountStatus: user.accountStatus || 'pending',
    onboarding: {
      ...(user.onboarding || {}),
      currentStep: user.onboarding?.currentStep || 'personal_details',
    },
  };

  const docsReady = !!user.verification?.documentVerified;
  const paymentReady = !!user.paymentSummary?.isFullyPaid;
  const roomReady = user.roomDetails?.status === 'checked_in' || user.roomDetails?.status === 'assigned' || !!user.roomDetails?.roomType;

  if (docsReady && paymentReady && roomReady) {
    nextState.accountStatus = 'active';
    nextState.onboarding.currentStep = 'completed';
  } else if (docsReady && paymentReady) {
    nextState.accountStatus = 'pending';
    nextState.onboarding.currentStep = 'final_payment';
  }

  return nextState;
};

module.exports = { reconcileAccountState };
