const MessMenu = require("../models/MessMenu");
const MessVote = require("../models/MessVote");

// Helper to format date string YYYY-MM-DD
const getTodayStr = () => new Date().toISOString().split("T")[0];

// Default sample menu generator for dates with no custom menu set yet
const createDefaultMenuForDate = async (dateStr) => {
  const d = new Date(dateStr);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeek = days[d.getDay()] || "Today";

  const defaultMenu = {
    date: dateStr,
    dayOfWeek,
    published: true,
    createdBy: "System Default",
    meals: {
      breakfast: {
        startTime: "08:00 AM",
        endTime: "10:00 AM",
        options: [
          {
            optionId: "b_opt_1",
            title: "Aloo Paratha & Fresh Curd",
            description: "Punjabi Aloo Parathas with Amul Butter, Fresh Curd, Pickle & Tea",
            dishes: ["Aloo Stuffed Paratha (2x)", "Amul Butter Cube", "Fresh Sweet Curd", "Hot Ginger Tea"],
            isVeg: true,
            calories: 420,
          },
        ],
      },
      snacks: {
        startTime: "05:00 PM",
        endTime: "06:30 PM",
        options: [
          {
            optionId: "s_opt_1",
            title: "Crispy Samosa & Masala Chai",
            description: "Hot Potato Samosas with Mint & Imli Chutney, Masala Chai",
            dishes: ["Hot Potato Samosa (2x)", "Pudina Chutney", "Sweet Imli Chutney", "Kulhad Masala Chai"],
            isVeg: true,
            calories: 280,
          },
        ],
      },
      dinner: {
        startTime: "08:00 PM",
        endTime: "10:00 PM",
        options: [
          {
            optionId: "d_opt_1",
            title: "Kashmiri Rajma Chawal & Gulab Jamun",
            description: "Slow-cooked Kashmiri Rajma, Steamed Basmati Rice, Tawa Roti & Sweet",
            dishes: ["Kashmiri Special Rajma", "Steamed Basmati Rice", "Tawa Roti (4x)", "Gulab Jamun (1x)"],
            isVeg: true,
            calories: 620,
          },
        ],
      },
    },
  };

  try {
    return await MessMenu.create(defaultMenu);
  } catch (err) {
    return await MessMenu.findOne({ date: dateStr });
  }
};

// 1. Get menu for a specific date
const getMenuByDate = async (dateStr = getTodayStr()) => {
  let menu = await MessMenu.findOne({ date: dateStr });
  if (!menu) {
    menu = await createDefaultMenuForDate(dateStr);
  }
  return menu;
};

// 2. Get 7-day weekly menu starting from date
const getWeeklyMenu = async (startDateStr = getTodayStr()) => {
  const startDate = new Date(startDateStr);
  const dates = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }

  const existingMenus = await MessMenu.find({ date: { $in: dates } });
  const existingMap = new Map(existingMenus.map((m) => [m.date, m]));

  const result = [];
  for (const dateStr of dates) {
    if (existingMap.has(dateStr)) {
      result.push(existingMap.get(dateStr));
    } else {
      const created = await createDefaultMenuForDate(dateStr);
      result.push(created);
    }
  }

  return result;
};

// 3. Upsert menu for a date (Admin / Mess Incharge)
const upsertMenu = async (dateStr, menuData, updatedBy = "Mess Incharge") => {
  const existing = await MessMenu.findOne({ date: dateStr });

  if (existing) {
    existing.meals = menuData.meals || existing.meals;
    existing.published = typeof menuData.published === "boolean" ? menuData.published : existing.published;
    existing.createdBy = updatedBy;
    await existing.save();
    return existing;
  }

  const d = new Date(dateStr);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeek = days[d.getDay()] || "Today";

  return await MessMenu.create({
    date: dateStr,
    dayOfWeek,
    meals: menuData.meals,
    published: menuData.published ?? true,
    createdBy: updatedBy,
  });
};

// 4. Cast or update vote for a student
const castStudentVote = async ({ userId, studentName, roomNumber, date, category, optionId }) => {
  let voteDoc = await MessVote.findOne({ date, userId });

  if (!voteDoc) {
    voteDoc = new MessVote({
      date,
      userId,
      studentName: studentName || "Student",
      roomNumber: roomNumber || "",
      votes: {
        breakfast: null,
        snacks: null,
        dinner: null,
      },
    });
  }

  if (category && ["breakfast", "snacks", "dinner"].includes(category)) {
    voteDoc.votes[category] = optionId;
  }

  await voteDoc.save();
  return voteDoc;
};

// 5. Get student's vote for a date
const getStudentVote = async (userId, dateStr = getTodayStr()) => {
  return await MessVote.findOne({ date: dateStr, userId });
};

// 6. Get real-time voting results and headcount breakdown for a date
const getVotingResults = async (dateStr = getTodayStr()) => {
  const menu = await getMenuByDate(dateStr);
  const votes = await MessVote.find({ date: dateStr });

  const totalVoters = votes.length;
  const results = {
    date: dateStr,
    dayOfWeek: menu.dayOfWeek,
    totalVoters,
    categories: {},
  };

  const categories = ["breakfast", "snacks", "dinner"];

  for (const cat of categories) {
    const mealInfo = menu.meals[cat] || {};
    const options = mealInfo.options || [];

    const tally = {};
    options.forEach((opt) => {
      tally[opt.optionId] = {
        optionId: opt.optionId,
        title: opt.title,
        isVeg: opt.isVeg,
        votes: 0,
        percentage: 0,
      };
    });

    let catTotalVotes = 0;

    votes.forEach((v) => {
      const chosenOptId = v.votes?.[cat];
      if (chosenOptId && tally[chosenOptId]) {
        tally[chosenOptId].votes += 1;
        catTotalVotes += 1;
      }
    });

    Object.values(tally).forEach((opt) => {
      opt.percentage = catTotalVotes > 0 ? Math.round((opt.votes / catTotalVotes) * 100) : 0;
    });

    results.categories[cat] = {
      startTime: mealInfo.startTime,
      endTime: mealInfo.endTime,
      totalVotes: catTotalVotes,
      options: Object.values(tally),
    };
  }

  return results;
};

// ── MONTHLY MESS MENU POLLING SYSTEM ──────────────────────────────────────────

const MessPoll = require("../models/MessPoll");
const MessPollVote = require("../models/MessPollVote");

const createDefaultMonthlyPoll = async () => {
  const currentMonth = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
  return await MessPoll.create({
    month: currentMonth,
    title: `Monthly Mess Menu Selection Poll — ${currentMonth}`,
    status: "active",
    closingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    createdBy: "Mess Incharge",
    options: [
      {
        optionId: "plan_a",
        title: "Plan A — North & South Fusion Thali",
        description: "Balanced mix of Punjabi Parathas, South Indian Dosa/Idli breakfasts, Kashmiri Rajma & Evening Tea Snacks",
        image: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800",
        highlights: ["Aloo Paratha & Poha", "Kashmiri Rajma & Dal Makhani", "Samosa & Chai", "Gulab Jamun"],
      },
      {
        optionId: "plan_b",
        title: "Plan B — Deluxe Continental & Indian Menu",
        description: "Includes Cheese Sandwiches, Chole Bhature, Kadai Paneer, Veg Noodles Snacks & Ice Cream desserts",
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800",
        highlights: ["Cheese Toast & Chole Bhature", "Kadai Paneer & Dal Makhani", "Spring Roll Snacks", "Ice Cream"],
      },
    ],
  });
};

const getActiveMonthlyPoll = async (userId = null) => {
  let poll = await MessPoll.findOne({ status: "active" }).sort({ createdAt: -1 });

  if (!poll) {
    poll = await createDefaultMonthlyPoll();
  }

  const votes = await MessPollVote.find({ pollId: poll._id });
  const totalVotes = votes.length;

  const tally = {};
  poll.options.forEach((opt) => {
    tally[opt.optionId] = {
      ...opt.toObject(),
      voteCount: 0,
      percentage: 0,
      voters: [],
    };
  });

  let myVotedOptionId = null;

  votes.forEach((v) => {
    if (tally[v.optionId]) {
      tally[v.optionId].voteCount += 1;
      tally[v.optionId].voters.push({ name: v.studentName, room: v.roomNumber });
    }
    if (userId && v.userId === userId) {
      myVotedOptionId = v.optionId;
    }
  });

  Object.values(tally).forEach((opt) => {
    opt.percentage = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
  });

  return {
    poll,
    totalVotes,
    optionsWithTally: Object.values(tally),
    myVotedOptionId,
  };
};

const createMonthlyPoll = async (pollData, createdBy = "Mess Incharge") => {
  await MessPoll.updateMany({ status: "active" }, { status: "closed" });

  return await MessPoll.create({
    month: pollData.month || new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
    title: pollData.title || `Monthly Mess Menu Poll`,
    status: "active",
    closingDate: pollData.closingDate || "",
    options: pollData.options || [],
    createdBy,
  });
};

const castMonthlyPollVote = async ({ pollId, userId, studentName, roomNumber, optionId }) => {
  let vote = await MessPollVote.findOne({ pollId, userId });

  if (vote) {
    vote.optionId = optionId;
    vote.studentName = studentName || vote.studentName;
    vote.roomNumber = roomNumber || vote.roomNumber;
    await vote.save();
  } else {
    vote = await MessPollVote.create({
      pollId,
      userId,
      studentName: studentName || "Student",
      roomNumber: roomNumber || "",
      optionId,
    });
  }

  return vote;
};

const closePollAndDeclareWinner = async (pollId) => {
  const poll = await MessPoll.findById(pollId);
  if (!poll) throw new Error("Poll not found");

  const votes = await MessPollVote.find({ pollId: poll._id });
  const counts = {};

  votes.forEach((v) => {
    counts[v.optionId] = (counts[v.optionId] || 0) + 1;
  });

  let winnerOptId = poll.options[0]?.optionId;
  let maxCount = -1;

  Object.entries(counts).forEach(([optId, cnt]) => {
    if (cnt > maxCount) {
      maxCount = cnt;
      winnerOptId = optId;
    }
  });

  poll.status = "published";
  poll.winningOptionId = winnerOptId;
  await poll.save();

  return poll;
};

module.exports = {
  getMenuByDate,
  getWeeklyMenu,
  upsertMenu,
  castStudentVote,
  getStudentVote,
  getVotingResults,
  getActiveMonthlyPoll,
  createMonthlyPoll,
  castMonthlyPollVote,
  closePollAndDeclareWinner,
};
