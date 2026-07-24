const TransportStop = require("../models/TransportStop");

async function seedTransportStops() {
  try {
    const count = await TransportStop.countDocuments();
    if (count > 0) return;

    const defaultStops = [
      {
        name: "GLA University Main Gate",
        pickupTime: "07:30 AM",
        dropTime: "05:30 PM",
        monthlyPrice: 2000,
        yearlyPrice: 20000,
        description: "Direct shuttle drop at GLA University Main Gate & Campus.",
        isActive: true,
      },
      {
        name: "Mathura Junction Railway Station",
        pickupTime: "07:15 AM",
        dropTime: "06:00 PM",
        monthlyPrice: 2500,
        yearlyPrice: 24000,
        description: "Express transport to Mathura Junction Station & City Center.",
        isActive: true,
      },
      {
        name: "Highway Plaza Mall",
        pickupTime: "07:45 AM",
        dropTime: "05:15 PM",
        monthlyPrice: 1800,
        yearlyPrice: 18000,
        description: "Shuttle drop at Highway Plaza Commercial Hub & NH-19.",
        isActive: true,
      },
      {
        name: "Vrindavan Chatikara Junction",
        pickupTime: "08:00 AM",
        dropTime: "05:00 PM",
        monthlyPrice: 1500,
        yearlyPrice: 15000,
        description: "Local route drop at Chatikara Crossing & Prem Mandir Link.",
        isActive: true,
      },
    ];

    await TransportStop.insertMany(defaultStops);
    console.log("[SEED] Created default transport drop points and prices.");
  } catch (err) {
    console.error("[SEED] Error seeding transport stops:", err.message);
  }
}

module.exports = seedTransportStops;
