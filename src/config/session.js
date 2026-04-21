const session = require("express-session");
const MongoStore = require("connect-mongo");

const createSessionMiddleware = () => {
  const isProduction = process.env.NODE_ENV === "production";
  
  return session({
    secret: process.env.SESSION_SECRET || "viramah-dev-session-secret-do-not-use-in-prod",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      dbName: process.env.DB_NAME || "viramah",
      collectionName: "sessions",
      ttl: 24 * 60 * 60,
      mongoOptions: !isProduction ? { tlsAllowInvalidCertificates: true } : {},
    }),
    cookie: {
      httpOnly: true,
      secure: isProduction,
      maxAge: 24 * 60 * 60 * 1000,
      // Cross-domain: admin/website on Amplify need to send cookies to API on EC2.
      // sameSite "none" + secure is required for cross-origin cookie delivery.
      // domain ".viramahstay.com" lets *.viramahstay.com share the cookie.
      sameSite: isProduction ? "none" : "lax",
      domain: isProduction ? ".viramahstay.com" : "localhost",
      path: "/",
    },
  });
};

module.exports = createSessionMiddleware;
