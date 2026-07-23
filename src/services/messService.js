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
        votingDeadline: "22:00",
        options: [
          {
            optionId: "b_opt_1",
            title: "Aloo Paratha & Curd Special",
            description: "Punjabi Aloo Parathas with Amul Butter, Fresh Curd, Pickle & Ginger Tea",
            dishes: ["2x Aloo Stuffed Paratha", "Amul Butter Cube", "Fresh Sweet Curd", "Mango Pickle", "Hot Ginger Tea"],
            isVeg: true,
            calories: 420,
          },
          {
            optionId: "b_opt_2",
            title: "Indori Poha & Jalebi Special",
            description: "Spiced Poha with Ratlami Sev, Fresh Jalebi, Banana & Special Chai",
            dishes: ["Indori Kanda Poha", "Ratlami Sev & Anar", "2x Sweet Crispy Jalebi", "Fresh Banana", "Special Masala Chai"],
            isVeg: true,
            calories: 360,
          },
        ],
      },
      snacks: {
        startTime: "05:00 PM",
        endTime: "06:30 PM",
        votingDeadline: "14:00",
        options: [
          {
            optionId: "s_opt_1",
            title: "Hot Samosa & Mint Chutney",
            description: "Crispy Potato Samosas with Green Mint Chutney, Sweet Imli Chutney & Chai",
            dishes: ["2x Crispy Potato Samosa", "Pudina Green Chutney", "Khatta Meetha Imli Chutney", "Kulhad Masala Chai"],
            isVeg: true,
            calories: 280,
          },
          {
            optionId: "s_opt_2",
            title: "Veg Cheese Grilled Sandwich",
            description: "Butter Toast Sandwich with Capsicum, Onion, Cheese & Cold Coffee",
            dishes: ["2x Veg Cheese Sandwich", "Tomato Ketchup", "Creamy Cold Coffee"],
            isVeg: true,
            calories: 310,
          },
        ],
      },
      dinner: {
        startTime: "08:00 PM",
        endTime: "10:00 PM",
        votingDeadline: "17:00",
        options: [
          {
            optionId: "d_opt_1",
            title: "Kashmiri Rajma Chawal Thali",
            description: "Slow-cooked Kashmiri Rajma, Steamed Basmati Rice, Tawa Roti, Salad & Sweet",
            dishes: ["Kashmiri Special Rajma", "Steamed Basmati Rice", "4x Butter Tawa Roti", "Green Cucumber Salad", "Gulab Jamun"],
            isVeg: true,
            calories: 620,
          },
          {
            optionId: "d_opt_2",
            title: "Dal Makhani & Veg Pulao Feast",
            description: "Creamy Dal Makhani, Mixed Vegetable Pulao, Butter Naan & Dessert",
            dishes: ["Amritsari Dal Makhani", "Jeera Veg Pulao", "2x Butter Naan", "Bundi Raita", "Vanilla Ice Cream"],
            isVeg: true,
            calories: 650,
          },
        ],
      },
    },
  };

  try {
    return await MessMenu.create(defaultMenu);
  } catch (err) {
    // If concurrent creation happened, fetch existing
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

    // Calculate percentages
    Object.values(tally).forEach((opt) => {
      opt.percentage = catTotalVotes > 0 ? Math.round((opt.votes / catTotalVotes) * 100) : 0;
    });

    results.categories[cat] = {
      startTime: mealInfo.startTime,
      endTime: mealInfo.endTime,
      votingDeadline: mealInfo.votingDeadline,
      totalVotes: catTotalVotes,
      options: Object.values(tally),
    };
  }

  return results;
};

// ── MONTHLY MESS MENU POLLING SYSTEM ──────────────────────────────────────────

const MessPoll = require("../models/MessPoll");
const MessPollVote = require("../models/MessPollVote");

// Create Default Monthly Poll if none exists
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
        description: "Balanced mix of Punjabi Parathas, South Indian Dosa/Idli breakfasts, Kashmiri Rajma & Paneer specials",
        image: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800",
        highlights: ["Aloo Paratha & Poha", "Rajma Chawal & Dal Makhani", "Veg Biryani & Gulab Jamun"],
      },
      {
        optionId: "plan_b",
        title: "Plan B — Deluxe Continental & Indian Menu",
        description: "Includes Cheese Sandwiches, Chole Bhature, Kadai Paneer, Hakka Noodle High Tea & Ice Cream desserts",
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800",
        highlights: ["Cheese Toast & Chole Bhature", "Kadai Paneer & Butter Naan", "Hakka Noodles & Brownie"],
      },
      {
        optionId: "plan_c",
        title: "Plan C — Healthy Fitness & High Protein Menu",
        description: "High protein sprout salads, Oats Poha, Soybean Curry, Brown Rice, Paneer Tikka & Seasonal Fruit Juices",
        image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800",
        highlights: ["Sprout Salads & Oats Poha", "Soybean Curry & Brown Rice", "Paneer Tikka & Fresh Juices"],
      },
    ],
  });
};

// Get current active monthly poll with WhatsApp style tally & student vote
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

// Create new monthly poll
const createMonthlyPoll = async (pollData, createdBy = "Mess Incharge") => {
  // Archive existing active polls
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

// Cast WhatsApp-style vote on monthly poll
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

// Close poll and declare winning menu plan
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

