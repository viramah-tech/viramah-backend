const TransportStop = require("../models/TransportStop");
const User = require("../models/User");
const { recalculateGrandTotal } = require("../utils/waterfall");
const { NotFoundError, ValidationError, BadRequestError } = require("../utils/errors");

const GST_RATE = 0.18; // 18% GST for Transport Services

class TransportService {
  /**
   * Helper to format stop prices with 18% GST breakdown
   */
  formatStopWithGST(stop) {
    const obj = stop.toObject ? stop.toObject() : { ...stop };
    const monthlyBase = Number(obj.monthlyPrice) || 2000;
    const monthlyGst = Math.round(monthlyBase * GST_RATE);
    const monthlyTotal = monthlyBase + monthlyGst;

    const yearlyBase = Number(obj.yearlyPrice) || 20000;
    const yearlyGst = Math.round(yearlyBase * GST_RATE);
    const yearlyTotal = yearlyBase + yearlyGst;

    return {
      ...obj,
      gstRatePct: 18,
      monthly: {
        basePrice: monthlyBase,
        gstAmount: monthlyGst,
        totalWithGst: monthlyTotal,
      },
      yearly: {
        basePrice: yearlyBase,
        gstAmount: yearlyGst,
        totalWithGst: yearlyTotal,
      },
    };
  }

  /**
   * Get all bus stops / drop points with 18% GST breakdown
   */
  async getAllStops(includeInactive = false) {
    const query = includeInactive ? {} : { isActive: true };
    const stops = await TransportStop.find(query).sort({ createdAt: -1 });
    return stops.map((s) => this.formatStopWithGST(s));
  }

  /**
   * Get stop by ID with 18% GST breakdown
   */
  async getStopById(id) {
    const stop = await TransportStop.findById(id);
    if (!stop) throw new NotFoundError("Transport stop not found");
    return this.formatStopWithGST(stop);
  }

  /**
   * Admin: Create new drop point & prices
   */
  async createStop(data) {
    if (!data.name) throw new ValidationError("Stop name is required");
    const stop = new TransportStop({
      name: data.name,
      pickupTime: data.pickupTime || "07:30 AM",
      dropTime: data.dropTime || "05:30 PM",
      monthlyPrice: Number(data.monthlyPrice) || 2000,
      yearlyPrice: Number(data.yearlyPrice) || 20000,
      description: data.description || "",
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
    });
    const saved = await stop.save();
    return this.formatStopWithGST(saved);
  }

  /**
   * Admin: Update existing drop point & prices
   */
  async updateStop(id, data) {
    const stop = await TransportStop.findById(id);
    if (!stop) throw new NotFoundError("Transport stop not found");

    if (data.name !== undefined) stop.name = data.name;
    if (data.pickupTime !== undefined) stop.pickupTime = data.pickupTime;
    if (data.dropTime !== undefined) stop.dropTime = data.dropTime;
    if (data.monthlyPrice !== undefined) stop.monthlyPrice = Number(data.monthlyPrice);
    if (data.yearlyPrice !== undefined) stop.yearlyPrice = Number(data.yearlyPrice);
    if (data.description !== undefined) stop.description = data.description;
    if (data.isActive !== undefined) stop.isActive = Boolean(data.isActive);

    const saved = await stop.save();
    return this.formatStopWithGST(saved);
  }

  /**
   * Admin: Delete drop point
   */
  async deleteStop(id) {
    const stop = await TransportStop.findByIdAndDelete(id);
    if (!stop) throw new NotFoundError("Transport stop not found");
    return { success: true, message: "Drop point deleted permanently" };
  }

  /**
   * Student: Subscribe to a drop point with 18% additional GST
   */
  async subscribePass(userId, { stopId, billingCycle = "monthly" }) {
    const user = await User.findOne({ "basicInfo.userId": userId }) || await User.findById(userId);
    if (!user) throw new NotFoundError("Student record not found");

    const stop = await TransportStop.findById(stopId);
    if (!stop || !stop.isActive) throw new ValidationError("Selected drop point is invalid or inactive");

    const cycle = billingCycle === "yearly" ? "yearly" : "monthly";
    const baseFee = cycle === "yearly" ? stop.yearlyPrice : stop.monthlyPrice;
    const gstAmount = Math.round(baseFee * GST_RATE);
    const totalFeeWithGst = baseFee + gstAmount;

    const now = new Date();
    const validUntil = new Date(now);
    if (cycle === "yearly") {
      validUntil.setFullYear(validUntil.getFullYear() + 1);
    } else {
      validUntil.setMonth(validUntil.getMonth() + 1);
    }

    // Update user transportPass
    user.transportPass = {
      isOptedIn: true,
      stopId: stop._id,
      stopName: stop.name,
      billingCycle: cycle,
      basePrice: baseFee,
      gstRatePct: 18,
      gstAmount: gstAmount,
      feeAmount: totalFeeWithGst,
      subscribedAt: now,
      validUntil,
      status: "active",
    };

    if (user.roomDetails) {
      user.roomDetails.includeTransport = true;
    }

    // Sync financial ledger paymentSummary.transportFee
    if (!user.paymentSummary) user.paymentSummary = {};
    if (!user.paymentSummary.transportFee) {
      user.paymentSummary.transportFee = { total: 0, paid: 0, remaining: 0 };
    }

    const currentPaid = user.paymentSummary.transportFee.paid || 0;
    user.paymentSummary.transportFee.basePrice = baseFee;
    user.paymentSummary.transportFee.gstAmount = gstAmount;
    user.paymentSummary.transportFee.total = totalFeeWithGst;
    user.paymentSummary.transportFee.remaining = Math.max(0, totalFeeWithGst - currentPaid);

    recalculateGrandTotal(user.paymentSummary);
    await user.save();

    return {
      message: "Transport pass booked successfully with 18% GST",
      transportPass: user.transportPass,
      paymentSummary: user.paymentSummary,
    };
  }

  /**
   * Student: Cancel active transport pass
   */
  async cancelPass(userId) {
    const user = await User.findOne({ "basicInfo.userId": userId }) || await User.findById(userId);
    if (!user) throw new NotFoundError("Student record not found");

    const currentPaid = user.paymentSummary?.transportFee?.paid || 0;
    const hasApprovedPayment = Array.isArray(user.paymentDetails) && user.paymentDetails.some(
      (p) => p.category === "transport" && ["approved", "completed", "confirmed", "paid"].includes((p.status || "").toLowerCase())
    );

    if (currentPaid > 0 || hasApprovedPayment) {
      throw new BadRequestError("Transport pass cannot be cancelled after payment has been made. Please contact admin for cancellation support.");
    }

    user.transportPass.isOptedIn = false;
    user.transportPass.status = "cancelled";
    user.transportPass.feeAmount = 0;
    user.transportPass.basePrice = 0;
    user.transportPass.gstAmount = 0;

    if (user.roomDetails) {
      user.roomDetails.includeTransport = false;
    }

    if (user.paymentSummary && user.paymentSummary.transportFee) {
      const currentPaid = user.paymentSummary.transportFee.paid || 0;
      user.paymentSummary.transportFee.total = currentPaid;
      user.paymentSummary.transportFee.remaining = 0;
      recalculateGrandTotal(user.paymentSummary);
    }

    if (Array.isArray(user.paymentDetails)) {
      user.paymentDetails = user.paymentDetails.filter(
        (p) => !(p.category === "transport" && p.status === "pending")
      );
    }

    await user.save();
    return {
      message: "Transport pass cancelled successfully",
      transportPass: user.transportPass,
      paymentSummary: user.paymentSummary,
    };
  }

  /**
   * Admin: Get subscriber roster list
   */
  async getSubscribers() {
    const users = await User.find({
      "transportPass.isOptedIn": true,
      "transportPass.status": "active",
    }).select("basicInfo roomDetails transportPass paymentSummary accountStatus");

    return users.map((u) => ({
      userId: u.basicInfo?.userId,
      name: u.basicInfo?.fullName,
      email: u.basicInfo?.email,
      phone: u.basicInfo?.phone,
      roomNumber: u.roomDetails?.roomNumber || "N/A",
      stopName: u.transportPass?.stopName,
      billingCycle: u.transportPass?.billingCycle,
      basePrice: u.transportPass?.basePrice || u.transportPass?.feeAmount,
      gstAmount: u.transportPass?.gstAmount || 0,
      feeAmount: u.transportPass?.feeAmount,
      subscribedAt: u.transportPass?.subscribedAt,
      validUntil: u.transportPass?.validUntil,
      status: u.transportPass?.status,
    }));
  }
}

module.exports = new TransportService();
