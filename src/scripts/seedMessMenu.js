require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const MessMenu = require('../models/MessMenu');

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dailyTemplates = {
  Monday: {
    breakfast: [
      {
        optionId: 'b_mon_1',
        title: 'Poha with Sev & Masala Tea',
        description: 'Indori spiced flattened rice with roasted peanuts, fresh coriander, lemon, and crispy ratlami sev',
        dishes: ['Indori Poha with Sev', 'Boiled Sprouts Bowl', 'Fresh Banana', 'Masala Ginger Chai'],
        isVeg: true,
        calories: 340,
      },
      {
        optionId: 'b_mon_2',
        title: 'Masala Idli & Filter Coffee',
        description: 'Steamed rice cakes tossed in south Indian podi spices with coconut chutney',
        dishes: ['Podi Tossed Idli (3 pcs)', 'Coconut Chutney', 'Tomato Onion Chutney', 'Filter Coffee'],
        isVeg: true,
        calories: 310,
      },
    ],
    snacks: [
      {
        optionId: 's_mon_1',
        title: 'Crispy Veg Pakoras & Adrak Chai',
        description: 'Assorted onion, potato, and spinach fritters served piping hot with green chutney',
        dishes: ['Mix Veg Pakoras (6 pcs)', 'Pudina Chutney', 'Sweet Imli Chutney', 'Ginger Cardamom Tea'],
        isVeg: true,
        calories: 290,
      },
    ],
    dinner: [
      {
        optionId: 'd_mon_1',
        title: 'Dal Makhani & Paneer Do Pyaza',
        description: 'Creamy 12-hour simmered black lentils and cottage cheese cubes in rich onion gravy',
        dishes: ['Dal Makhani', 'Paneer Do Pyaza', 'Steamed Basmati Rice', 'Butter Roti (4 pcs)', 'Moong Dal Halwa'],
        isVeg: true,
        calories: 640,
      },
    ],
  },
  Tuesday: {
    breakfast: [
      {
        optionId: 'b_tue_1',
        title: 'Bedmi Puri & Aloo Subzi',
        description: 'Crispy lentil-stuffed fried puris with spiced tangy potato curry and sweet pickle',
        dishes: ['Bedmi Puri (3 pcs)', 'Mathura Style Aloo Subzi', 'Sweet Mango Pickle', 'Hot Masala Chai'],
        isVeg: true,
        calories: 460,
      },
    ],
    snacks: [
      {
        optionId: 's_tue_1',
        title: 'Samosa Pav & Green Chutney',
        description: 'Mumbai street style potato samosa sandwiched in soft pav with dry garlic chutney',
        dishes: ['Samosa Pav (2 pcs)', 'Spicy Garlic Chutney', 'Fried Green Chili', 'Special Cutting Chai'],
        isVeg: true,
        calories: 320,
      },
    ],
    dinner: [
      {
        optionId: 'd_tue_1',
        title: 'Kashmiri Rajma & Aloo Gobi',
        description: 'Slow-cooked kidney beans in authentic Kashmiri gravy with dry spiced cauliflower and potatoes',
        dishes: ['Kashmiri Rajma Curry', 'Aloo Gobi Matar', 'Jeera Rice', 'Tawa Phulka (4 pcs)', 'Kheer'],
        isVeg: true,
        calories: 580,
      },
    ],
  },
  Wednesday: {
    breakfast: [
      {
        optionId: 'b_wed_1',
        title: 'Crispy Medu Vada & Sambar',
        description: 'Golden fried lentil donuts with hot drumstick sambar and fresh coconut chutney',
        dishes: ['Medu Vada (2 pcs)', 'Hot Drumstick Sambar', 'Fresh Coconut Chutney', 'South Indian Filter Coffee'],
        isVeg: true,
        calories: 380,
      },
    ],
    snacks: [
      {
        optionId: 's_wed_1',
        title: 'Veg Grilled Cheese Sandwich',
        description: 'Toasted multi-grain bread with cucumber, tomato, potato, and melted Amul cheese',
        dishes: ['Grilled Veg Cheese Sandwich', 'Potato Chips', 'Tomato Ketchup', 'Hot Lemon Tea'],
        isVeg: true,
        calories: 310,
      },
    ],
    dinner: [
      {
        optionId: 'd_wed_1',
        title: 'Kadai Paneer & Dal Tadka',
        description: 'Cottage cheese cubes tossed with bell peppers and whole spices in a robust tomato gravy',
        dishes: ['Kadai Paneer Special', 'Yellow Dal Tadka', 'Peas Pulao', 'Butter Naan / Roti', 'Gulab Jamun (2 pcs)'],
        isVeg: true,
        calories: 670,
      },
    ],
  },
  Thursday: {
    breakfast: [
      {
        optionId: 'b_thu_1',
        title: 'Paneer Stuffed Paratha & Curd',
        description: 'Fresh grated paneer seasoned with herbs stuffed in whole wheat paratha, served with curd & butter',
        dishes: ['Paneer Paratha (2 pcs)', 'Fresh Curd Bowl', 'Mixed Pickle', 'Amul Butter', 'Hot Tea / Coffee'],
        isVeg: true,
        calories: 440,
      },
    ],
    snacks: [
      {
        optionId: 's_thu_1',
        title: 'Corn & Cheese Cutlets',
        description: 'Sweet corn and mashed potato patties pan-grilled till golden brown',
        dishes: ['Sweet Corn Cutlets (2 pcs)', 'Mint Coriander Dip', 'Sweet Imli Chutney', 'Masala Chai'],
        isVeg: true,
        calories: 270,
      },
    ],
    dinner: [
      {
        optionId: 'd_thu_1',
        title: 'Palak Paneer & Chana Dal',
        description: 'Creamy spinach puree with soft paneer cubes alongside tempered split Bengal gram dal',
        dishes: ['Palak Paneer', 'Chana Dal Fry', 'Steamed Rice', 'Tawa Phulka (4 pcs)', 'Fruit Custard'],
        isVeg: true,
        calories: 610,
      },
    ],
  },
  Friday: {
    breakfast: [
      {
        optionId: 'b_fri_1',
        title: 'Aloo Paratha & Sweet Curd',
        description: 'Authentic Punjabi potato stuffed paratha with dollops of white butter and sweetened curd',
        dishes: ['Aloo Paratha (2 pcs)', 'Fresh Sweet Curd', 'Mango Pickle', 'Kulhad Chai'],
        isVeg: true,
        calories: 430,
      },
      {
        optionId: 'b_fri_2',
        title: 'Mysore Masala Dosa',
        description: 'Crisp dosa smeared with spicy red chutney and stuffed with spiced potato mash',
        dishes: ['Mysore Masala Dosa', 'Coconut Chutney', 'Sambar', 'Filter Coffee'],
        isVeg: true,
        calories: 390,
      },
    ],
    snacks: [
      {
        optionId: 's_fri_1',
        title: 'Crispy Veg Spring Rolls & Chai',
        description: 'Crunchy rolls stuffed with julienned vegetables and noodles with sweet chili dipping sauce',
        dishes: ['Veg Spring Rolls (3 pcs)', 'Sweet Chili Dip', 'Masala Chai'],
        isVeg: true,
        calories: 260,
      },
    ],
    dinner: [
      {
        optionId: 'd_fri_1',
        title: 'Paneer Butter Masala Royal Feast',
        description: 'Rich velvety tomato gravy with paneer, creamy yellow dal tadka, aromatic jeera rice and dessert',
        dishes: ['Paneer Butter Masala', 'Dal Tadka', 'Jeera Rice', 'Butter Phulka (4 pcs)', 'Hot Gulab Jamun (2 pcs)'],
        isVeg: true,
        calories: 680,
      },
      {
        optionId: 'd_fri_2',
        title: 'Amritsari Chole & Bhature',
        description: 'Dark spiced chickpea curry served with hot puffed bhatures, pickled onions and chili',
        dishes: ['Amritsari Pindi Chole', 'Fluffy Bhature (2 pcs)', 'Sirka Onions', 'Pickled Green Chili'],
        isVeg: true,
        calories: 720,
      },
    ],
  },
  Saturday: {
    breakfast: [
      {
        optionId: 'b_sat_1',
        title: 'Chole Kulche & Butter Milk',
        description: 'Spiced dried yellow peas curry served with toasted soft kulchas and spiced butter milk',
        dishes: ['Chole Subzi', 'Amritsari Kulcha (2 pcs)', 'Pickled Onions', 'Chilled Masala Chaas'],
        isVeg: true,
        calories: 450,
      },
    ],
    snacks: [
      {
        optionId: 's_sat_1',
        title: 'Pav Bhaji Snack Platter',
        description: 'Mashed vegetable curry cooked on tawa with generous butter, served with toasted pav',
        dishes: ['Buttery Pav Bhaji', 'Butter Toasted Pav (2 pcs)', 'Onion Lemon Salad'],
        isVeg: true,
        calories: 380,
      },
    ],
    dinner: [
      {
        optionId: 'd_sat_1',
        title: 'Hyderabadi Veg Biryani Special',
        description: 'Fragrant basmati rice layered with spiced vegetables, saffron, and caramelised onions, with burani raita',
        dishes: ['Dum Veg Biryani', 'Burani Garlic Raita', 'Mirchi Ka Salan', 'Double Ka Meetha'],
        isVeg: true,
        calories: 690,
      },
    ],
  },
  Sunday: {
    breakfast: [
      {
        optionId: 'b_sun_1',
        title: 'Sunday Special Dosa Feast',
        description: 'Unlimited crisp butter plain and masala dosas with trio of chutneys and drumstick sambar',
        dishes: ['Butter Masala Dosa', 'Coconut Chutney', 'Tomato Chutney', 'Drumstick Sambar', 'Filter Coffee'],
        isVeg: true,
        calories: 420,
      },
    ],
    snacks: [
      {
        optionId: 's_sun_1',
        title: 'Hot Jalebi & Fafda / Dhokla',
        description: 'Traditional weekend snack of spongy steamed dhoklas and crispy sweet jalebis',
        dishes: ['Nylon Khaman Dhokla (4 pcs)', 'Crisp Jalebi (3 pcs)', 'Fried Green Chili', 'Chai'],
        isVeg: true,
        calories: 350,
      },
    ],
    dinner: [
      {
        optionId: 'd_sun_1',
        title: 'Weekend Special: Shahi Paneer & Pulao',
        description: 'Royal white gravy shahi paneer with dry fruit pulao, baby garlic naans, and ice cream dessert',
        dishes: ['Shahi Paneer', 'Yellow Dal Double Tadka', 'Kashmiri Pulao', 'Butter Naan / Roti', 'Vanilla Ice Cream Bowl'],
        isVeg: true,
        calories: 710,
      },
    ],
  },
};

async function seedWeeklyMenu() {
  await connectDB();

  const today = new Date();
  for (let i = -1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = days[d.getDay()];
    const tpl = dailyTemplates[dayName] || dailyTemplates.Monday;

    const meals = {
      breakfast: {
        startTime: '08:00 AM',
        endTime: '10:00 AM',
        options: tpl.breakfast,
      },
      snacks: {
        startTime: '05:00 PM',
        endTime: '06:30 PM',
        options: tpl.snacks,
      },
      dinner: {
        startTime: '08:00 PM',
        endTime: '10:00 PM',
        options: tpl.dinner,
      },
    };

    await MessMenu.findOneAndUpdate(
      { date: dateStr },
      {
        date: dateStr,
        dayOfWeek: dayName,
        published: true,
        createdBy: 'Hostel Incharge Desk',
        meals,
      },
      { upsert: true, new: true }
    );
    console.log(`Updated mess menu for ${dayName} (${dateStr})`);
  }

  await mongoose.disconnect();
  console.log('Finished seeding weekly menus successfully!');
}

seedWeeklyMenu().catch(console.error);
